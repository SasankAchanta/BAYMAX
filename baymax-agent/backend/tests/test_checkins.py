from uuid import uuid4
from fastapi.testclient import TestClient
from backend.voice_api import app
from backend import checkins,decision_log

def test_checkin_deadline_and_response_cancel_without_authorities(monkeypatch):
    clock=[1000.0];monkeypatch.setattr(checkins.time,'time',lambda:clock[0])
    identifier=str(uuid4())
    with TestClient(app) as client:
        response=client.post('/api/check-ins',json={'id':identifier,'action':'HOLDING_CHEST','summary':'Local sustained chest hold'})
        assert response.status_code==200
        assert response.json()['deadline_ms']==1060000
        assert response.json()['authorities_contacted'] is False
        clock[0]+=30
        assert client.post('/api/check-ins',json={'id':identifier,'action':'HOLDING_CHEST'}).json()['deadline_ms']==1060000
        assert client.post(f'/api/check-ins/{identifier}/respond',json={'response':'background babble'}).status_code==422
        assert client.post(f'/api/check-ins/{identifier}/respond',json={'response':'I have chest pain'}).json()['status']=='RESPONDED'
        clock[0]+=60;checkins.expire(identifier)
        assert checkins.incidents[identifier]['status']=='RESPONDED'
        assert 'check_in_answered' in decision_log.LOG_PATH.read_text(encoding='utf-8')
        assert 'demo_escalation' not in decision_log.LOG_PATH.read_text(encoding='utf-8')

def test_no_response_at_exact_deadline_logs_only_simulated_escalation(monkeypatch):
    clock=[2000.0];monkeypatch.setattr(checkins.time,'time',lambda:clock[0]);identifier=str(uuid4())
    with TestClient(app) as client:
        client.post('/api/check-ins',json={'id':identifier,'action':'REPEATED_LOUD_SOUNDS'})
        clock[0]+=59.999;checkins.expire(identifier);assert checkins.incidents[identifier]['status']=='AWAITING_RESPONSE'
        clock[0]+=0.001;checkins.expire(identifier)
        assert checkins.incidents[identifier]['status']=='ESCALATED_DEMO'
        assert checkins.incidents[identifier]['authorities_contacted'] is False
        assert client.post(f'/api/check-ins/{identifier}/respond',json={'response':"I'm fine"}).json()['status']=='ESCALATED_DEMO'
        log=decision_log.LOG_PATH.read_text(encoding='utf-8')
        assert 'demo_escalation' in log and 'no calls or messages placed' in log

def test_backend_timer_itself_waits_sixty_seconds_and_expires(monkeypatch):
    import asyncio
    clock=[3000.0];monkeypatch.setattr(checkins.time,'time',lambda:clock[0]);identifier=str(uuid4());delays=[]
    checkins.incidents[identifier]={'status':'AWAITING_RESPONSE','deadline_ms':3060000,'summary':'Repeated sound spikes'}
    async def advance(delay):
        delays.append(delay);clock[0]+=delay
    monkeypatch.setattr(checkins.asyncio,'sleep',advance)
    asyncio.run(checkins.wait_for_deadline(identifier))
    assert delays==[60.0]
    assert checkins.incidents[identifier]['status']=='ESCALATED_DEMO'
    assert 'demo_escalation' in decision_log.LOG_PATH.read_text(encoding='utf-8')
