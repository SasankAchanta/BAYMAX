"""Product lookup through a configured provider. Never sends symptoms or conversation text."""
import os,re
from decimal import Decimal,InvalidOperation,ROUND_HALF_UP
from urllib.parse import urlsplit
import httpx
from .care import CATALOG
from .care_store import QUERIES

class ProductLookupError(Exception):pass
def configured():return bool(os.getenv('RAINFOREST_API_KEY'))
def safe_product_url(result):
    try:
        url=urlsplit(result.get('link',''))
        if url.scheme!='https' or url.hostname not in {'amazon.com','www.amazon.com'} or url.username or url.password:return None
        asin=str(result.get('asin',''))
        if not re.fullmatch(r'[A-Z0-9]{10}',asin):return None
        return 'https://www.amazon.com/dp/'+asin
    except (TypeError,ValueError):return None

def matches(key,title,custom_name=None):
    text=title.lower()
    if custom_name:
        words=[word for word in re.findall(r'[a-z0-9]+',custom_name.lower()) if len(word)>2 and word not in {'the','and','for','with','pack'}]
        return bool(words) and all(word in text for word in words)
    terms={'acetaminophen':('acetaminophen','tylenol'),'ibuprofen':('ibuprofen','advil'),'nyquil':('nyquil',),'foot cast':('walking boot','cast boot','fracture boot'),'bandages':('bandage','band-aid'),'saline':('saline',),'cold pack':('cold pack','ice pack'),'compression wrap':('compression','elastic bandage'),'elbow brace':('elbow',),'ankle brace':('ankle',),'petroleum jelly':('petroleum','vaseline'),'antibiotic ointment':('antibiotic','neosporin'),'cough drops':('lozenge','cough drop'),'tissues':('tissue',),'thermometer':('thermometer',)}
    if not any(term in text for term in terms.get(key,(key,))):return False
    if key in {'elbow brace','ankle brace'} and (not any(term in text for term in ('brace','support','stabilizer')) or 'bracelet' in text):return False
    if key=='ibuprofen' and (any(term in text for term in ('acetaminophen','naproxen','aspirin','dual action','diphenhydramine','pseudoephedrine','cold','sinus')) or re.search(r'\bpm\b',text)):return False
    if key=='acetaminophen' and (any(term in text for term in ('ibuprofen','nyquil','cold','flu','sinus','diphenhydramine')) or re.search(r'\bpm\b',text)):return False
    return True

async def lookup(key,name=None):
    if not configured():raise ProductLookupError('Add RAINFOREST_API_KEY to backend/.env for live product lookup.')
    params={'api_key':os.environ['RAINFOREST_API_KEY'],'type':'search','amazon_domain':'amazon.com','search_term':name or QUERIES.get(key,CATALOG[key]['name'] if key in CATALOG else key),'exclude_sponsored':'true'}
    try:
        async with httpx.AsyncClient(timeout=15,follow_redirects=False) as client:
            response=await client.get('https://api.rainforestapi.com/request',params=params);response.raise_for_status();data=response.json()
        if not isinstance(data,dict) or not isinstance(data.get('request_info'),dict) or data['request_info'].get('success') is not True:raise ProductLookupError('Product provider rejected the search. Check API access and credits.')
        results=data.get('search_results',[])
        if not isinstance(results,list):raise ProductLookupError('Product provider returned an invalid search response.')
        for result in results[:12]:
            if not isinstance(result,dict):continue
            title=str(result.get('title',''))[:300];url=safe_product_url(result)
            if not url or not matches(key,title,name):continue
            price=result.get('price') or {}
            if not isinstance(price,dict):continue
            value=price.get('value')
            if isinstance(value,bool) or value is None or price.get('currency')!='USD':continue
            try:amount=Decimal(str(value))
            except InvalidOperation:continue
            if not amount.is_finite() or amount<=0 or amount>100000:continue
            cents=int((amount*100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
            return {'price_cents':cents,'currency':'USD','buy_url':url,'provider':'Rainforest / Amazon','product_name':title,'price_status':'live_quote'}
        raise ProductLookupError('No matching product with a valid USD price was returned; retailer search remains available.')
    except ProductLookupError:raise
    except (httpx.HTTPError,ValueError,TypeError,InvalidOperation) as error:
        # Never expose request URLs: provider keys are query parameters.
        raise ProductLookupError('Live product lookup failed; retry later or check provider configuration.') from error
