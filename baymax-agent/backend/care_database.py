"""Persistent care recommendations and review-only product links."""
import asyncio
import os
import hashlib
import re
from decimal import Decimal
from urllib.parse import urlencode,urlsplit
from pydantic import BaseModel,Field,field_validator
from contextlib import asynccontextmanager
from datetime import datetime,timezone
from fastapi import APIRouter,HTTPException,BackgroundTasks
from .care_store import store,starter,timestamp,DatabaseUnavailable
from .care import CATALOG
from . import shopping

_seed_lock=asyncio.Lock()
_refresh_lock=asyncio.Lock()
_refresh_status={'running':False,'updated':0,'failed':0,'message':''}
async def ensure_seed():
    async with _seed_lock:await store.seed()
@asynccontextmanager
async def lifespan(app):
    if store.configured():
        try:await ensure_seed()
        except DatabaseUnavailable:pass
    yield
router=APIRouter(prefix='/api/care-database',lifespan=lifespan)

async def save_recommendations(kit,reason):
    if not kit or not kit.get('items'):return
    if not store.configured():
        kit['database_sync']={'saved':False,'message':'SpacetimeDB is not configured.'};return
    try:
        count=0
        for item in kit['items']:
            key=item['id']
            if key not in CATALOG:continue
            await store.upsert(starter(key))
            await store.recommend(key,reason.strip()[:1500] or 'Recommended by Baymax during your checkup.');count+=1
        kit['database_sync']={'saved':True,'count':count}
    except DatabaseUnavailable:kit['database_sync']={'saved':False,'message':'Recommendation could not be saved to SpacetimeDB. Check the local database server.'}

async def _refresh_offers(keys=None,force=False):
    if not shopping.configured():return {'updated':0,'failed':0,'message':'Add RAINFOREST_API_KEY to backend/.env for live prices. Retailer search links are available now.'}
    if _refresh_lock.locked():return {'updated':0,'failed':0,'message':'A product refresh is already running.'}
    async with _refresh_lock:
        rows=await store.list();updated=failed=0
        for row in rows:
            if keys is not None and row['id'] not in keys:continue
            if not force and row.get('price_checked_at') and row['price_status']=='live_quote':
                try:
                    if (datetime.now(timezone.utc)-datetime.fromisoformat(row['price_checked_at'])).total_seconds()<86400:continue
                except ValueError:pass
            try:
                quote=await shopping.lookup(row['id']) if row['id'] in CATALOG else await shopping.lookup(row['id'],name=row['name'])
                await store.offer(row['id'],{**quote,'price_checked_at':timestamp()});updated+=1
            except shopping.ProductLookupError:
                await store.offer(row['id'],{**row,'price_status':'lookup_failed'});failed+=1
        return {'updated':updated,'failed':failed,'message':f'Updated {updated} product quotes; {failed} unavailable. Prices may change at checkout.'}

async def refresh_offers(keys=None,force=False):
    if _refresh_lock.locked():return {'message':'A product refresh is already running.'}
    _refresh_status.update(running=True,updated=0,failed=0,message='Searching retailer products; quotes update as each search finishes.')
    try:
        result=await _refresh_offers(keys,force)
        _refresh_status.update(result)
        return result
    except DatabaseUnavailable:
        result={'updated':0,'failed':0,'message':'Price refresh stopped: SpacetimeDB became unavailable. Existing quotes were preserved.'}
        _refresh_status.update(result);return result
    finally:_refresh_status['running']=False

@router.get('')
async def list_items():
    try:rows=await store.list();connected=True;message='Connected to private SpacetimeDB'
    except DatabaseUnavailable:
        rows=[starter(key) for key in CATALOG];connected=False;message='SpacetimeDB unavailable. Showing catalog preview; recommendations are not being persisted.'
    return {'items':sorted(rows,key=lambda r:(not r['recommended'],r['name'].lower())),'database':{'connected':connected,'engine':'SpacetimeDB','name':os.getenv('SPACETIMEDB_DATABASE',''),'location':'local' if urlsplit(os.getenv('SPACETIMEDB_URL','')).hostname in {'localhost','127.0.0.1'} else 'cloud','message':message},'shopping':{'configured':shopping.configured(),'provider':'Rainforest / Amazon','refresh':dict(_refresh_status),'message':'Live product lookup configured' if shopping.configured() else 'Live prices need RAINFOREST_API_KEY in backend/.env. Search links are available.'}}

@router.post('/refresh')
async def refresh(background_tasks:BackgroundTasks):
    if not store.configured():raise HTTPException(503,'Configure SpacetimeDB first.')
    if not shopping.configured():return {'message':'Add RAINFOREST_API_KEY to backend/.env for live prices. Search links are available.'}
    try:await store.list()
    except DatabaseUnavailable:raise HTTPException(503,'SpacetimeDB unavailable; no product refresh completed.')
    background_tasks.add_task(refresh_offers,force=True)
    return {'message':'Product refresh started. Quotes will appear as searches finish.'}


class ManualItem(BaseModel):
    name: str=Field(min_length=2,max_length=160)
    reason: str=Field(min_length=1,max_length=1500)
    price: Decimal|None=Field(default=None,ge=0,le=100000,max_digits=8,decimal_places=2)
    url: str=Field(default='',max_length=2000)
    @field_validator('name','reason')
    @classmethod
    def clean_text(cls,value,info):
        value=' '.join(value.split())
        if not value:raise ValueError('This field cannot be blank')
        if info.field_name=='name' and len(value)<2:raise ValueError('Item name must contain at least two characters')
        return value
    @field_validator('url')
    @classmethod
    def retailer_url(cls,value):
        value=value.strip()
        if not value:return ''
        url=urlsplit(value)
        allowed={'amazon.com','walmart.com','target.com','cvs.com','walgreens.com','costco.com'}
        if url.scheme!='https' or (url.hostname or '').removeprefix('www.') not in allowed or url.username or url.password or url.port not in (None,443):
            raise ValueError('Use a secure Amazon, Walmart, Target, CVS, Walgreens or Costco link')
        return url._replace(path=url.path or '/').geturl()

@router.post('/items',status_code=201)
async def add_item(item:ManualItem,background_tasks:BackgroundTasks):
    if not store.configured():raise HTTPException(503,'Configure SpacetimeDB before adding items.')
    normalized=' '.join(item.name.casefold().split())
    identifier='custom-'+hashlib.sha256(normalized.encode()).hexdigest()[:24]
    now=timestamp()
    row={'id':identifier,'name':item.name,'price_cents':int(item.price*100) if item.price is not None else -1,'currency':'USD','reason':item.reason,'buy_url':item.url or 'https://www.amazon.com/s?'+urlencode({'k':item.name}),'price_status':'manual_entry' if item.price is not None else ('not_checked' if shopping.configured() else 'api_key_required'),'provider':'Added by you','product_name':'','recommended':False,'guidance':'Manually added item; suitability has not been assessed by Baymax. Check product details before purchase.','updated_at':now,'price_checked_at':now if item.price is not None else ''}
    try:
        existing=next((entry for entry in await store.list() if entry['id']==identifier),None)
        if existing:raise HTTPException(409,'An item with this name is already saved.')
        await store.add_manual(row)
    except DatabaseUnavailable:raise HTTPException(503,'Could not save the item to SpacetimeDB. Your form has not been cleared.')
    if shopping.configured() and item.price is None:background_tasks.add_task(refresh_offers,[identifier])
    return {'item':row,'saved':True}
