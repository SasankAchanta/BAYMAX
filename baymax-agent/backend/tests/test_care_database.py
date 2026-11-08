import asyncio,copy,json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx,pytest
from fastapi.testclient import TestClient
from backend.voice_api import app
from backend import care_database,shopping,voice_turn
from backend.care import CATALOG,mentioned_items,excluded_items
from backend.care_store import starter,CareStore,DatabaseUnavailable

class MemoryStore:
    def __init__(self):self.rows={}
    def configured(self):return True
    async def list(self):return copy.deepcopy(list(self.rows.values()))
    async def upsert(self,row):self.rows.setdefault(row['id'],copy.deepcopy(row))
    async def add_manual(self,row):self.rows[row['id']]=copy.deepcopy(row)
    async def recommend(self,key,reason):self.rows[key].update(reason=reason,recommended=True)
    async def offer(self,key,quote):
        for field in ['price_cents','currency','buy_url','price_status','provider','product_name','price_checked_at']:self.rows[key][field]=quote[field]
    async def seed(self):
        for key in CATALOG:self.rows.setdefault(key,starter(key))

@pytest.fixture
def database(monkeypatch):
    memory=MemoryStore();monkeypatch.setattr(care_database,'store',memory);return memory

def test_starter_table_has_requested_items_no_fabricated_prices_and_real_search_links(database):
    with TestClient(app) as client:
        data=client.get('/api/care-database').json()
        assert data['database']['connected'] is True
        assert {'acetaminophen','ibuprofen','nyquil','bandages','foot cast'} <= {i['id'] for i in data['items']}
        assert all(i['price_cents']==-1 and i['buy_url'].startswith('https://www.amazon.com/s?') for i in data['items'])
        assert all(not i['recommended'] for i in data['items'])
        assert data['shopping']['configured'] is False
        assert 'RAINFOREST_API_KEY' in client.post('/api/care-database/refresh').json()['message']

def test_recommendations_persist_reason_and_deduplicate(database):
    async def run():
        await database.seed()
        kit={'items':[{'id':'ibuprofen'}]}
        await care_database.save_recommendations(kit,'Discuss OTC pain relief with your pharmacist for a headache.')
        await care_database.save_recommendations(kit,'A later checkup recommendation.')
        rows=await database.list();row=next(r for r in rows if r['id']=='ibuprofen')
        assert row['recommended'] and row['reason']=='A later checkup recommendation.'
        assert sum(r['id']=='ibuprofen' for r in rows)==1
        assert kit['database_sync']['saved'] is True
    asyncio.run(run())

def test_voice_advice_automatically_saves_recommendations_before_reply(database,monkeypatch):
    monkeypatch.setenv('NVIDIA_API_KEY','test');monkeypatch.delenv('NVIDIA_VISION_MODEL',raising=False)
    result={'text':'Ask a pharmacist whether ibuprofen is suitable for your headache.','decision':{'kind':'care_kit','items':['ibuprofen'],'next_steps':'Possible OTC option for headache; suitability needs checking.'}}
    response=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(result)))])
    provider=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(return_value=response))),close=AsyncMock())
    monkeypatch.setattr(voice_turn,'AsyncOpenAI',lambda **kwargs:provider)
    with TestClient(app) as client:
        reply=client.post('/api/voice-turn',json={'transcript':'I have a headache'})
        assert reply.status_code==200
        assert reply.json()['care_kit']['database_sync']['saved'] is True
        rows=client.get('/api/care-database').json()['items']
        assert next(r for r in rows if r['id']=='ibuprofen')['recommended'] is True

def test_database_unavailable_is_explicit_and_does_not_break_voice_care(monkeypatch):
    class Offline(MemoryStore):
        async def list(self):raise DatabaseUnavailable('offline')
        async def upsert(self,row):raise DatabaseUnavailable('offline')
    monkeypatch.setattr(care_database,'store',Offline())
    response=TestClient(app).get('/api/care-database').json()
    assert response['database']['connected'] is False
    kit={'items':[{'id':'bandages'}]};asyncio.run(care_database.save_recommendations(kit,'Minor cut'))
    assert kit['database_sync']['saved'] is False

def test_product_lookup_validates_price_brand_and_safe_link(monkeypatch):
    monkeypatch.setenv('RAINFOREST_API_KEY','private-key')
    results=[{'title':'Advil PM ibuprofen diphenhydramine','asin':'B000000000','link':'https://www.amazon.com/dp/B000000000','price':{'value':1,'currency':'USD'}},{'title':'Unrelated aspirin','asin':'B000000001','link':'https://www.amazon.com/dp/B000000001','price':{'value':1,'currency':'USD'}}, {'title':'Ibuprofen tablets','asin':'B000000002','link':'https://malicious.example/dp/B000000002','price':{'value':2,'currency':'USD'}}, {'title':'Advil ibuprofen tablets 24 count','asin':'B000000003','link':'https://www.amazon.com/dp/B000000003','price':{'value':7.995,'currency':'USD'}}]
    def handler(request):
        assert request.url.params['search_term']=='ibuprofen Advil tablets'
        return httpx.Response(200,json={'request_info':{'success':True},'search_results':results})
    original=httpx.AsyncClient
    monkeypatch.setattr(shopping.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handler),**kwargs))
    quote=asyncio.run(shopping.lookup('ibuprofen'))
    assert quote['price_cents']==800 and quote['buy_url']=='https://www.amazon.com/dp/B000000003'
    assert quote['price_status']=='live_quote'

def test_lookup_failure_never_leaks_provider_key(monkeypatch):
    monkeypatch.setenv('RAINFOREST_API_KEY','private-key')
    original=httpx.AsyncClient
    monkeypatch.setattr(shopping.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(lambda request:httpx.Response(401)),**kwargs))
    with pytest.raises(shopping.ProductLookupError) as error:asyncio.run(shopping.lookup('bandages'))
    assert 'private-key' not in str(error.value)

def test_live_quotes_update_without_overwriting_recommendation_reason(database,monkeypatch):
    monkeypatch.setenv('RAINFOREST_API_KEY','test')
    monkeypatch.setattr(shopping,'lookup',AsyncMock(return_value={'price_cents':499,'currency':'USD','buy_url':'https://www.amazon.com/dp/B000000004','provider':'Rainforest / Amazon','product_name':'Adhesive bandages','price_status':'live_quote'}))
    async def run():
        await database.seed();kit={'items':[{'id':'bandages'}]};await care_database.save_recommendations(kit,'Small superficial cut.')
        await care_database.refresh_offers(['bandages'])
        row=database.rows['bandages'];assert row['price_cents']==499 and row['reason']=='Small superficial cut.' and row['recommended']
        await care_database.refresh_offers(['bandages']);assert shopping.lookup.await_count==1
    asyncio.run(run())

def test_drug_warning_does_not_become_a_purchase_recommendation():
    assert 'ibuprofen' in excluded_items('Avoid Advil because suitability is not confirmed.')
    assert {'acetaminophen','ibuprofen'} <= set(mentioned_items('Tylenol or Advil'))

@pytest.mark.parametrize('payload',[[],{'request_info':[]},{'request_info':{'success':True},'search_results':'bad'},{'request_info':{'success':True},'search_results':[None,{'title':'bandages','price':'bad'}]}])
def test_malformed_product_responses_fail_cleanly(monkeypatch,payload):
    monkeypatch.setenv('RAINFOREST_API_KEY','private-key');original=httpx.AsyncClient
    monkeypatch.setattr(shopping.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(lambda request:httpx.Response(200,json=payload)),**kwargs))
    with pytest.raises(shopping.ProductLookupError):asyncio.run(shopping.lookup('bandages'))

def test_manual_item_saves_price_reason_and_retailer_link_without_marking_baymax_recommended(database):
    with TestClient(app) as client:
        response=client.post('/api/care-database/items',json={'name':'Gauze pads','price':'7.50','reason':'Restock my first-aid kit.','url':'https://www.cvs.com/shop/gauze'})
        assert response.status_code==201
        row=response.json()['item']
        assert row['price_cents']==750 and row['price_status']=='manual_entry'
        assert row['provider']=='Added by you' and row['recommended'] is False
        assert database.rows[row['id']]['reason']=='Restock my first-aid kit.'
        again=client.post('/api/care-database/items',json={'name':' gauze   pads ','reason':'Duplicate'})
        assert again.status_code==409

def test_manual_item_can_omit_price_and_url(database):
    with TestClient(app) as client:
        response=client.post('/api/care-database/items',json={'name':'First aid scissors','reason':'Supplies'})
        assert response.status_code==201
        row=response.json()['item'];assert row['price_cents']==-1
        assert row['buy_url'].startswith('https://www.amazon.com/s?')
        assert 'First+aid+scissors' in row['buy_url']

@pytest.mark.parametrize('url',['javascript:alert(1)','https://amazon.com.evil.example/item','https://user:password@amazon.com/item','https://www.amazon.com:444/item'])
def test_manual_item_rejects_unsafe_links(database,url):
    assert TestClient(app).post('/api/care-database/items',json={'name':'Gauze','reason':'Supplies','url':url}).status_code==422

@pytest.mark.parametrize('price',['-1','12.345','NaN','100001'])
def test_manual_item_rejects_invalid_prices(database,price):
    assert TestClient(app).post('/api/care-database/items',json={'name':'Gauze','reason':'Supplies','price':price}).status_code==422

def test_manual_item_rejects_blank_fields(database):
    client=TestClient(app)
    assert client.post('/api/care-database/items',json={'name':'  ','reason':'Kit'}).status_code==422
    assert client.post('/api/care-database/items',json={'name':' a ','reason':'Kit'}).status_code==422
    assert client.post('/api/care-database/items',json={'name':'Gauze','reason':'  '}).status_code==422


def test_repeat_recommendation_preserves_live_offer(database,monkeypatch):
    async def run():
        await database.seed();row=database.rows['ibuprofen'];row.update(price_cents=1299,price_status='live_quote',buy_url='https://www.amazon.com/dp/B012345678',product_name='Ibuprofen')
        async def destructive_upsert(value):database.rows[value['id']]=value
        monkeypatch.setattr(database,'upsert',destructive_upsert)
        await care_database.save_recommendations({'items':[{'id':'ibuprofen'}]},'Discuss suitability with pharmacist')
        assert database.rows['ibuprofen']['price_cents']==1299
        assert database.rows['ibuprofen']['buy_url'].endswith('B012345678')
    asyncio.run(run())
