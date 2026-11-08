import asyncio
from fastapi.testclient import TestClient
from backend.voice_api import app
from backend import decision_log,checkins,demo_contact

def test_structured_history_survives_new_clients_and_exports_text():
    decision_log.log_decision('vision_confirmed',findings='Hand near chest',items=['cold pack'],next_steps='Ask about symptoms',action='HOLDING_CHEST',confidence=87,status='confirmed')
    with TestClient(app) as client:
        row=client.get('/api/decisions').json()['items'][0]
        assert row['confidence']==87 and row['action']=='HOLDING_CHEST' and row['items']==['cold pack']
    with TestClient(app) as client:
        assert client.get('/api/decisions').json()['items'][0]['id']==row['id']
        assert 'Hand near chest' in client.get('/api/decisions/export').text
        assert client.get('/api/decisions?limit=2001').status_code==422

def test_sms_delivery_is_tracked_without_resending(monkeypatch):
    from uuid import uuid4
    identifier=str(uuid4());checkins.incidents[identifier]={'id':identifier,'action':'HOLDING_CHEST','status':'CONTACTING','summary':'Demo'}
    calls=[]
    async def notify(*args):calls.append(args);return {'status':'accepted','mode':'sms','sid':'SM'+'a'*32,'provider_status':'queued','message':'Accepted'}
    async def delivery(sid):return {'provider_status':'delivered','error_code':None}
    async def sleep(_):pass
    monkeypatch.setattr(demo_contact,'notify',notify);monkeypatch.setattr(demo_contact,'delivery',delivery);monkeypatch.setattr(checkins.asyncio,'sleep',sleep)
    asyncio.run(checkins.dispatch_contact(identifier));asyncio.run(checkins.dispatch_contact(identifier))
    assert len(calls)==1 and checkins.incidents[identifier]['status']=='CONTACT_DELIVERED'
    assert decision_log.history(limit=500)['items'][0]['status']=='delivered'

def test_restart_restores_deadline_but_never_resends_ambiguous_contact():
    from uuid import uuid4
    import time
    first=str(uuid4());second=str(uuid4())
    decision_log.save_incident({'id':first,'action':'HOLDING_CHEST','status':'AWAITING_RESPONSE','deadline_ms':time.time()*1000+60000})
    decision_log.save_incident({'id':second,'action':'HOLDING_CHEST','status':'CONTACTING','deadline_ms':time.time()*1000})
    with TestClient(app):
        assert first in checkins.tasks
        assert checkins.incidents[second]['status']=='CONTACT_UNCONFIRMED'
        assert second not in checkins.contact_tasks


def test_legacy_text_entries_are_imported_once_without_invented_confidence():
    decision_log.LOG_PATH.write_text('[2026-11-01T12:00:00-06:00] care_kit\nUser symptoms: elbow discomfort\nVision findings: Not inspected\nRecommended items (review only): cold pack\nNext steps: Review care options\n'+'-'*72+'\n',encoding='utf-8')
    first=decision_log.history(limit=500)['items'];second=decision_log.history(limit=500)['items']
    assert len(first)==len(second)==1 and first[0]['confidence'] is None and first[0]['status']=='legacy'
