import asyncio
from urllib.parse import parse_qs
from uuid import uuid4
import httpx,pytest
from fastapi.testclient import TestClient
from backend.voice_api import app
from backend import demo_contact,checkins

def configure(monkeypatch,mode='sms'):
    monkeypatch.delenv('TWILIO_SMS_TEMPLATE',raising=False)
    for key,value in {'ENABLE_REAL_ALERTS':'true','TWILIO_ALERT_MODE':mode,'TWILIO_ACCOUNT_SID':'AC'+'a'*32,'TWILIO_AUTH_TOKEN':'test-only-secret','TWILIO_PHONE_NUMBER':'+15555550100','DEMO_EMERGENCY_PHONE':'+15555550101'}.items():monkeypatch.setenv(key,value)

def mock_provider(monkeypatch,handler):
    original=httpx.AsyncClient
    monkeypatch.setattr(demo_contact.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handler),**kwargs))

@pytest.mark.parametrize('mode',['sms','call'])
def test_explicit_help_contacts_only_configured_demo_number_once(monkeypatch,mode):
    configure(monkeypatch,mode);calls=[]
    def handler(request):
        calls.append(request);body=parse_qs(request.content.decode())
        assert body['To']==['+15555550101'] and body['From']==['+15555550100']
        assert request.url.path.endswith('/Calls.json' if mode=='call' else '/Messages.json')
        if mode=='call':assert '<Response><Say>' in body['Twiml'][0]
        else:assert 'BAYMAX DEMO HELP REQUEST' in body['Body'][0]
        return httpx.Response(201,json={'sid':('CA' if mode=='call' else 'SM')+'b'*32,'status':'queued'})
    mock_provider(monkeypatch,handler)
    with TestClient(app) as client:
        identifier=str(uuid4());client.post('/api/check-ins',json={'id':identifier,'action':'HOLDING_CHEST'})
        client.post(f'/api/check-ins/{identifier}/respond',json={'response':"I'm not okay and I need help"})
        for _ in range(10):
            result=client.get(f'/api/check-ins/{identifier}').json()
            if result['status']!='CONTACTING':break
        assert result['status']=='CONTACT_ACCEPTED'
        assert result['contact']['provider_status']=='queued'
        assert result['authorities_contacted'] is False
        assert 'not yet confirmed' in result['contact']['message']
        client.post(f'/api/check-ins/{identifier}/respond',json={'response':'I need help'})
        assert len(calls)==1

def test_silence_at_sixty_seconds_uses_twilio(monkeypatch):
    configure(monkeypatch);clock=[1000.0];monkeypatch.setattr(checkins.time,'time',lambda:clock[0]);calls=[]
    def handler(request):calls.append(request);return httpx.Response(201,json={'sid':'SM'+'b'*32,'status':'queued'})
    mock_provider(monkeypatch,handler)
    with TestClient(app) as client:
        identifier=str(uuid4());client.post('/api/check-ins',json={'id':identifier,'action':'HOLDING_CHEST'})
        clock[0]+=59;assert client.get(f'/api/check-ins/{identifier}').json()['status']=='AWAITING_RESPONSE';assert not calls
        clock[0]+=1
        for _ in range(10):
            result=client.get(f'/api/check-ins/{identifier}').json()
            if result['status']=='CONTACT_ACCEPTED':break
        assert result['status']=='CONTACT_ACCEPTED' and len(calls)==1

def test_safe_or_declining_response_never_contacts_twilio(monkeypatch):
    configure(monkeypatch)
    mock_provider(monkeypatch,lambda request:pytest.fail('Unexpected external contact'))
    with TestClient(app) as client:
        for answer in ["I'm okay","I don't need help","Do not call anyone"]:
            identifier=str(uuid4());client.post('/api/check-ins',json={'id':identifier,'action':'HOLDING_CHEST'})
            assert client.post(f'/api/check-ins/{identifier}/respond',json={'response':answer}).json()['status']=='RESPONDED'

@pytest.mark.parametrize('timeout',[False,True])
def test_twilio_rejection_or_ambiguous_timeout_never_claims_success_or_retries(monkeypatch,timeout):
    configure(monkeypatch);calls=[]
    def handler(request):
        calls.append(request)
        if timeout:raise httpx.ReadTimeout('private details')
        return httpx.Response(401,json={'message':'private details'})
    mock_provider(monkeypatch,handler)
    result=asyncio.run(demo_contact.notify('HOLDING_CHEST','User needs help'))
    assert result['status']==('unknown' if timeout else 'failed')
    assert len(calls)==1 and 'test-only-secret' not in str(result) and 'private details' not in str(result)

def test_missing_settings_or_emergency_short_codes_never_send(monkeypatch):
    configure(monkeypatch);monkeypatch.setenv('DEMO_EMERGENCY_PHONE','911')
    mock_provider(monkeypatch,lambda request:pytest.fail('Unexpected contact'))
    assert demo_contact.configuration()['ready'] is False
    assert asyncio.run(demo_contact.notify('HOLDING_CHEST','test'))['status']=='not_configured'


def test_trial_template_is_explicit_and_errors_are_redacted(monkeypatch):
    configure(monkeypatch);monkeypatch.setenv('TWILIO_SMS_TEMPLATE','sms_internal_alerts')
    def handler(request):
        assert parse_qs(request.content.decode())['Body']==['sms_internal_alerts']
        return httpx.Response(201,json={'sid':'SM'+'b'*32,'status':'queued'})
    mock_provider(monkeypatch,handler)
    result=asyncio.run(demo_contact.notify('HOLDING_CHEST','private symptom'))
    assert result['template_only'] and 'custom BAYMAX alert details are not included' in result['message']
    result=demo_contact.failure_details(httpx.Response(400,json={'code':572006,'message':'private phone or token'}))
    assert result['error_code']==572006 and 'predefined' in result['message']
    assert 'private phone' not in str(result)


def test_choking_requests_one_sms_immediately_without_user_response(monkeypatch):
    configure(monkeypatch);calls=[]
    def handler(request):
        calls.append(request);assert request.method=='POST' and request.url.path.endswith('/Messages.json')
        return httpx.Response(201,json={'sid':'SM'+'b'*32,'status':'queued'})
    mock_provider(monkeypatch,handler)
    with TestClient(app) as client:
        identifier=str(uuid4());body={'id':identifier,'action':'POSSIBLE_CHOKING','held_ms':3200,'confidence':90}
        client.post('/api/check-ins',json=body)
        for _ in range(10):
            reply=client.get('/api/check-ins/'+identifier).json()
            if reply['status']=='CONTACT_ACCEPTED':break
        assert reply['status']=='CONTACT_ACCEPTED' and len(calls)==1
        client.post('/api/check-ins',json=body);assert len(calls)==1
        assert identifier not in checkins.tasks
