"""Backend-only adapter to the private SpacetimeDB care_item table."""
import os
from datetime import datetime,timezone
from urllib.parse import quote,urlencode
import httpx
from .care import CATALOG

COLUMNS=['id','name','price_cents','currency','reason','buy_url','price_status','provider','product_name','recommended','guidance','updated_at','price_checked_at']
QUERIES={'acetaminophen':'Tylenol acetaminophen tablets','ibuprofen':'ibuprofen Advil tablets','nyquil':'NyQuil cold flu nighttime','foot cast':'medical walking boot foot support','bandages':'sterile adhesive bandages','saline':'sterile saline wound wash'}
def timestamp():return datetime.now(timezone.utc).isoformat(timespec='seconds')
def search_url(key):return 'https://www.amazon.com/s?'+urlencode({'k':QUERIES.get(key,CATALOG[key]['name'])})
def starter(key):
    item=CATALOG[key]
    return dict(zip(COLUMNS,[key,item['name'],-1,'USD','Starter catalog item; not yet recommended by Baymax.',search_url(key),'api_key_required' if not os.getenv('RAINFOREST_API_KEY') else 'not_checked','Retailer search','',False,item['guidance'],timestamp(),'']))
class DatabaseUnavailable(Exception):pass
class CareStore:
    def configured(self):return bool(os.getenv('SPACETIMEDB_URL') and os.getenv('SPACETIMEDB_DATABASE') and os.getenv('SPACETIMEDB_TOKEN'))
    def connection(self):
        if not self.configured():raise DatabaseUnavailable('SpacetimeDB is not configured.')
        base=os.environ['SPACETIMEDB_URL'].rstrip('/')+'/v1/database/'+quote(os.environ['SPACETIMEDB_DATABASE'],safe='')
        return base,{'Authorization':'Bearer '+os.environ['SPACETIMEDB_TOKEN']}
    async def list(self):
        base,headers=self.connection()
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response=await client.post(base+'/sql',headers={**headers,'Content-Type':'text/plain'},content='SELECT '+', '.join(COLUMNS)+' FROM care_item')
                response.raise_for_status();data=response.json()
                return [dict(zip(COLUMNS,row)) for row in data[0]['rows']]
        except (httpx.HTTPError,ValueError,KeyError,IndexError,TypeError) as error:raise DatabaseUnavailable('SpacetimeDB could not be read. Check the local server and backend identity.') from error
    async def upsert(self,row):
        base,headers=self.connection()
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response=await client.post(base+'/call/upsert_item',headers=headers,json=[row[column] for column in COLUMNS]);response.raise_for_status()
        except httpx.HTTPError as error:raise DatabaseUnavailable('SpacetimeDB could not save this item.') from error
    async def add_manual(self,row):
        await self.call('add_manual_item',[row[column] for column in COLUMNS])
    async def call(self,name,args):
        base,headers=self.connection()
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response=await client.post(base+'/call/'+name,headers=headers,json=args);response.raise_for_status()
        except httpx.HTTPError as error:raise DatabaseUnavailable('SpacetimeDB could not save this change.') from error
    async def recommend(self,key,reason):
        await self.call('set_recommendation',[key,reason,timestamp()])
    async def offer(self,key,quote):
        await self.call('set_offer',[key,quote['price_cents'],quote['currency'],quote['buy_url'],quote['price_status'],quote['provider'],quote['product_name'],quote['price_checked_at']])
    async def seed(self):
        rows=await self.list();existing={row['id'] for row in rows}
        for key in CATALOG:
            if key not in existing:await self.upsert(starter(key))
store=CareStore()
