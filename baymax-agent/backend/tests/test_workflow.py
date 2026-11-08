"""Complete workflow with deterministic external providers; no real SMS or health uploads."""
import json,time,base64
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4
from fastapi.testclient import TestClient
from backend.voice_api import app
from backend import care_database,voice_turn,verification,shopping,demo_contact
from backend.tests.test_care_database import MemoryStore

def test_pose_conversation_care_price_history_and_delivery(monkeypatch):
    memory=MemoryStore();monkeypatch.setattr(care_database,'store',memory)
    monkeypatch.setenv('NVIDIA_API_KEY','test-only');monkeypatch.setenv('NVIDIA_VISION_MODEL','test-vision')
    async def complete(**kwargs):
        visual=kwargs['messages'][0]['role']=='user'
        data={'action':'holding_chest','confidence':89,'is_dangerous':True,'needs_help':True,'summary':'Hand held near chest.'} if visual else {'text':'Consider a wrapped cold pack and elbow support after checking suitability. Is there swelling?','decision':{'kind':'care_kit','items':['cold pack','elbow brace'],'next_steps':'Supportive care and professional review if worsening.'}}
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(data)))])
    provider=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=complete)),close=AsyncMock())
    monkeypatch.setattr(voice_turn,'AsyncOpenAI',lambda **kwargs:provider);monkeypatch.setattr(verification,'AsyncOpenAI',lambda **kwargs:provider)
    with TestClient(app) as client:
        image=base64.b64encode(b'\xff\xd8test\xff\xd9').decode()
        confirmed=client.post('/api/verify-pose',json={'action':'HOLDING_CHEST','confidence':90,'held_ms':2500,'image':image})
        assert confirmed.status_code==200 and confirmed.json()['confirmed']
        reply=client.post('/api/voice-turn',json={'transcript':'My elbow hurts','inspection_unavailable':True,'vision':{'action':'HOLDING_CHEST','confidence':90}})
        assert reply.status_code==200 and reply.json()['care_kit']['database_sync']['saved']
        assert memory.rows['elbow brace']['recommended']
        monkeypatch.setattr(shopping,'configured',lambda:True)
        monkeypatch.setattr(shopping,'lookup',AsyncMock(return_value={'price_cents':1595,'currency':'USD','buy_url':'https://www.amazon.com/dp/B012345678','provider':'Test provider','product_name':'Reusable cold pack','price_status':'live_quote'}))
        assert client.post('/api/care-database/refresh').status_code==200
        assert memory.rows['cold pack']['price_cents']==1595
        sent=[]
        async def notify(*args):sent.append(args);return {'status':'accepted','mode':'sms','sid':'SM'+'b'*32,'provider_status':'queued','message':'Accepted'}
        monkeypatch.setattr(demo_contact,'notify',notify);monkeypatch.setattr(demo_contact,'delivery',AsyncMock(return_value={'provider_status':'delivered','error_code':None}))
        for key,value in {'ENABLE_REAL_ALERTS':'true','TWILIO_ACCOUNT_SID':'AC'+'a'*32,'TWILIO_AUTH_TOKEN':'test','TWILIO_PHONE_NUMBER':'+15555550100','DEMO_EMERGENCY_PHONE':'+15555550101'}.items():monkeypatch.setenv(key,value)
        identifier=str(uuid4());assert client.post('/api/check-ins',json={'id':identifier,'action':'HOLDING_CHEST','confidence':90}).status_code==200
        assert client.post('/api/check-ins/'+identifier+'/respond',json={'response':'send a text'}).status_code==200
        for _ in range(80):
            if client.get('/api/check-ins/'+identifier).json()['status']=='CONTACT_DELIVERED':break
            time.sleep(.05)
        else:raise AssertionError('Delivery not tracked')
        assert len(sent)==1
        rows=client.get('/api/decisions').json()['items']
        assert {'vision_confirmed','care_kit','sms_delivered'} <= {row['kind'] for row in rows}
        assert 'cold pack' in client.get('/api/decisions/export').text.lower()
