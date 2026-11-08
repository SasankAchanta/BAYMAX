import base64,json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi.testclient import TestClient
from backend.voice_api import app
from backend import verification,decision_log

IMAGE=base64.b64encode(b'\xff\xd8test\xff\xd9').decode()
BODY={'action':'LIMPING','confidence':90,'held_ms':1900,'image':IMAGE}
@pytest.mark.parametrize('patch,expected',[({},True),({'action':'normal'},False),({'is_dangerous':False},False),({'needs_help':False},False),({'confidence':74},False),({'action':'hopping'},False)])
def test_confirmation_requires_matching_action_confidence_danger_and_help(monkeypatch,patch,expected):
    monkeypatch.setenv('NVIDIA_API_KEY','test');monkeypatch.setenv('NVIDIA_VISION_MODEL','test-vlm')
    result={'action':'limping','confidence':89,'is_dangerous':True,'needs_help':True,'summary':'Asymmetric stance corroborates the temporal evidence.',**patch}
    create=AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(result)))]))
    client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)),close=AsyncMock())
    monkeypatch.setattr(verification,'AsyncOpenAI',lambda **kwargs:client)
    response=TestClient(app).post('/api/verify-pose',json=BODY)
    assert response.status_code==200
    assert response.json()['confirmed'] is expected
    assert bool(response.json()['check_in']) is expected
    assert ('vision_confirmed' if expected else 'vision_cancelled') in decision_log.LOG_PATH.read_text(encoding='utf-8')
    assert create.call_args.kwargs['response_format']=={'type':'json_object'}
    client.close.assert_awaited_once()


def test_invalid_json_and_unconfigured_vlm_never_confirm(monkeypatch):
    monkeypatch.delenv('NVIDIA_VISION_MODEL',raising=False)
    assert TestClient(app).post('/api/verify-pose',json=BODY).status_code==503
    monkeypatch.setenv('NVIDIA_API_KEY','test');monkeypatch.setenv('NVIDIA_VISION_MODEL','test-vlm')
    create=AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='not JSON'))]))
    client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)),close=AsyncMock())
    monkeypatch.setattr(verification,'AsyncOpenAI',lambda **kwargs:client)
    assert TestClient(app).post('/api/verify-pose',json=BODY).status_code==502
    assert 'verification_unavailable' in decision_log.LOG_PATH.read_text(encoding='utf-8')


def test_buffer_and_image_limits_are_validated():
    client=TestClient(app)
    assert client.post('/api/verify-pose',json={**BODY,'held_ms':500}).status_code==422
    assert client.post('/api/verify-pose',json={**BODY,'image':'garbage'}).status_code==422

@pytest.mark.parametrize('action,held', [('CLENCHING_STOMACH',2100),('HOLDING_CHEST',2100),('COUGHING',2100),('SNEEZING',2100),('SUDDEN_FALL',2100),('LYING_DOWN',15000)])
def test_new_actions_confirm_and_produce_tailored_checkins(monkeypatch,action,held):
    monkeypatch.setenv('NVIDIA_API_KEY','test');monkeypatch.setenv('NVIDIA_VISION_MODEL','test-vlm')
    result={'action':action.lower(),'confidence':90,'is_dangerous':True,'needs_help':True,'summary':'Visible posture corroborates the temporal candidate.'}
    create=AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(result)))]))
    client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)),close=AsyncMock())
    monkeypatch.setattr(verification,'AsyncOpenAI',lambda **kwargs:client)
    reply=TestClient(app).post('/api/verify-pose',json={**BODY,'action':action,'held_ms':held})
    assert reply.status_code==200
    assert reply.json()['confirmed'] is True
    assert reply.json()['check_in']==verification.CHECK_INS[action]
    assert 'vision_confirmed' in decision_log.LOG_PATH.read_text(encoding='utf-8')

@pytest.mark.parametrize('action,held',[('HOLDING_CHEST',2000),('CLENCHING_STOMACH',2000),('LYING_DOWN',14999),('SUDDEN_FALL',2000),('COUGHING',2000),('SNEEZING',2000)])
def test_new_action_temporal_minima_are_enforced(action,held):
    assert TestClient(app).post('/api/verify-pose',json={**BODY,'action':action,'held_ms':held}).status_code==422
