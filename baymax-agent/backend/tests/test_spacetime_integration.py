"""Opt-in live local database verification; creates and removes its own isolated test database."""
import asyncio,os,subprocess,uuid,json
from pathlib import Path
import httpx,pytest
from dotenv import dotenv_values
from backend.care_store import CareStore,timestamp

@pytest.mark.skipif(os.getenv('BAYMAX_LIVE_DB_TEST')!='1',reason='Set BAYMAX_LIVE_DB_TEST=1 to verify the real local SpacetimeDB instance')
def test_real_spacetimedb_persistence_private_access_and_field_safe_reducers(monkeypatch):
    root=Path(__file__).resolve().parents[3]
    local_owner=json.loads((root/'.spacetime/owner.json').read_text(encoding='utf-8-sig'))
    name='baymax-care-test-'+uuid.uuid4().hex[:10]
    cli=str(root/'.tools/spacetime/spacetimedb-cli.exe')
    command=[cli,'--root-dir',str(root/'.spacetime')]
    published=False
    try:
        subprocess.run(command+['publish','--server','http://127.0.0.1:3000','--module-path',str(root/'baymax-agent/spacetimedb'),'--yes=skip-login',name],check=True,capture_output=True,text=True)
        published=True
        for key,value in {'SPACETIMEDB_URL':'http://127.0.0.1:3000','SPACETIMEDB_DATABASE':name,'SPACETIMEDB_TOKEN':local_owner['token']}.items():monkeypatch.setenv(key,value)
        async def run():
            store=CareStore();await store.seed();await store.recommend('bandages','Test-only reason for a minor cut.')
            quote={'price_cents':499,'currency':'USD','buy_url':'https://www.amazon.com/dp/B000000004','price_status':'live_quote','provider':'TEST FIXTURE','product_name':'Test bandage listing','price_checked_at':timestamp()}
            await store.offer('bandages',quote);await store.recommend('bandages','Updated test reason.');await store.seed()
            row=next(row for row in await store.list() if row['id']=='bandages')
            assert row['reason']=='Updated test reason.' and row['price_cents']==499 and row['recommended'] is True
            from backend.care_store import starter
            manual={**starter('bandages'),'id':'custom-0123456789abcdef01234567','name':'Test gauze pads','provider':'Added by you','reason':'Test manual entry','price_status':'manual_entry','price_cents':250}
            await store.add_manual(manual)
            assert next(r for r in await store.list() if r['id']==manual['id'])['price_cents']==250
            base=f'http://127.0.0.1:3000/v1/database/{name}'
            async with httpx.AsyncClient() as client:
                private=await client.post(base+'/sql',content='SELECT id FROM care_item',headers={'Content-Type':'text/plain'})
                assert private.status_code>=400
                attacker=(await client.post('http://127.0.0.1:3000/v1/identity')).json()['token']
                change=await client.post(base+'/call/set_recommendation',json=['bandages','Unauthorized write',timestamp()],headers={'Authorization':'Bearer '+attacker})
                assert change.status_code>=400
        asyncio.run(run())
    finally:
        if published:subprocess.run(command+['delete','--server','http://127.0.0.1:3000','--yes',name],check=True,capture_output=True,text=True)
