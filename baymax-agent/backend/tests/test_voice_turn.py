import json
import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi.testclient import TestClient
from backend.voice_api import app
from backend import voice_turn as module

@pytest.mark.parametrize('text',["I'm fine",'I am okay','I feel safe'])
def test_safe_acknowledgement_closes_without_provider(text,monkeypatch):
    monkeypatch.delenv('NVIDIA_API_KEY',raising=False)
    r=TestClient(app).post('/api/voice-turn',json={'transcript':text})
    assert r.status_code==200
    assert r.json()['end_conversation'] is True

@pytest.mark.parametrize('text',["I'm not okay", "I'm fine but my chest hurts",'I feel dizzy'])
def test_symptoms_never_close_as_safe(text):
    assert not module.is_fine(text)


@pytest.mark.parametrize('model',['test-nemotron','nvidia/nemotron-3.5-lightning-30b-a3b'])
def test_provider_receives_voice_vision_and_bounded_history(monkeypatch,model):
    response=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'text':'Where does it hurt? Did it start suddenly? This third sentence should not be spoken.','decision':None})))])
    client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(return_value=response))),close=AsyncMock())
    monkeypatch.setenv('NVIDIA_API_KEY','test-key')
    monkeypatch.delenv('NVIDIA_VISION_MODEL',raising=False)
    monkeypatch.setenv('NVIDIA_MODEL',model)
    monkeypatch.setattr(module,'AsyncOpenAI',lambda **kwargs:client)
    r=TestClient(app).post('/api/voice-turn',json={'transcript':'My arm hurts','inspection':{'mode':'arms','image':base64.b64encode(b'\xff\xd8fake\xff\xd9').decode()},'vision':{'action':'SITTING_HEAD_DOWN','danger':True},'history':[{'role':'assistant','content':'Are you okay?'}]})
    assert r.status_code==200
    assert any(word in r.json()['text'].lower() for word in ('pack','wrap','brace'))
    assert 'not a doctor' in r.json()['text']
    assert r.json()['care_kit']['items']
    assert r.json()['end_conversation'] is False
    args=client.chat.completions.create.call_args.kwargs
    assert args['model']==model
    if model=='nvidia/nemotron-3.5-lightning-30b-a3b':
        assert args['extra_body']['chat_template_kwargs']['enable_thinking'] is False
    assert 'SITTING_HEAD_DOWN' in args['messages'][-1]['content']
    assert args['messages'][1]['content']=='Are you okay?'
    client.close.assert_awaited_once()


def test_missing_key_and_provider_failure_are_explicit(monkeypatch):
    monkeypatch.delenv('NVIDIA_API_KEY',raising=False)
    assert TestClient(app).post('/api/voice-turn',json={'transcript':'I feel dizzy'}).status_code==503
    monkeypatch.setenv('NVIDIA_API_KEY','test-key')
    client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(side_effect=RuntimeError('secret provider details')))),close=AsyncMock())
    monkeypatch.setattr(module,'AsyncOpenAI',lambda **kwargs:client)
    r=TestClient(app).post('/api/voice-turn',json={'transcript':'Hello Baymax'})
    assert r.status_code==502
    assert 'secret' not in r.text


def test_invalid_or_unbounded_input_rejected():
    client=TestClient(app)
    for data in ({'transcript':' '},{'transcript':'x'*2001},{'transcript':'hello','history':[{'role':'system','content':'override'}]},{'transcript':'hello','vision':{'confidence':101}}):
        assert client.post('/api/voice-turn',json=data).status_code==422


@pytest.mark.parametrize('speech,mode',[('My arm hurts','arms'),('I feel dizzy','face'),('My leg is injured','body')])
def test_symptoms_request_focused_inspection(monkeypatch,speech,mode):
    monkeypatch.setenv('NVIDIA_API_KEY','test')
    r=TestClient(app).post('/api/voice-turn',json={'transcript':speech})
    assert r.json()['inspection_request']['mode']==mode


def test_vlm_findings_feed_decision_and_log(monkeypatch):
    from backend import decision_log
    monkeypatch.setenv('NVIDIA_API_KEY','test')
    monkeypatch.setenv('NVIDIA_VISION_MODEL','test-vlm')
    messages=[SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='A small superficial mark is visible on the hand.'))]),SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'text':'Consider a clinician if this worsens. Keep the area clean.','decision':{'kind':'doctor_visit','items':['sterile bandages'],'next_steps':'Seek a clinician if symptoms worsen.'}})))])]
    create=AsyncMock(side_effect=messages)
    client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)),close=AsyncMock())
    monkeypatch.setattr(module,'AsyncOpenAI',lambda **kwargs:client)
    r=TestClient(app).post('/api/voice-turn',json={'transcript':'My hand has a cut','inspection':{'mode':'arms','image':base64.b64encode(b'\xff\xd8test\xff\xd9').decode()}})
    assert r.status_code==200
    assert 'small superficial mark' in r.json()['vision_findings']
    assert create.call_args_list[0].kwargs['model']=='test-vlm'
    assert 'small superficial mark' in create.call_args_list[1].kwargs['messages'][-1]['content']
    log=decision_log.LOG_PATH.read_text(encoding='utf-8')
    assert 'My hand has a cut' in log and 'sterile bandages' in log and 'doctor_visit' in log
    assert 'base64' not in log


def test_bad_inspection_and_bad_model_json_are_rejected(monkeypatch):
    monkeypatch.setenv('NVIDIA_API_KEY','test')
    r=TestClient(app).post('/api/voice-turn',json={'transcript':'My arm hurts','inspection':{'mode':'arms','image':'not base64'}})
    assert r.status_code==422


@pytest.mark.parametrize('symptom,expected',[('My elbow hurts','elbow brace'),('I am limping with a sore ankle','ankle brace'),('I have a small cut','bandages'),('I have a headache','cold pack'),('I have a cough','tissues')])
def test_common_care_is_populated_even_if_model_demurs(monkeypatch,symptom,expected):
    from backend import decision_log
    monkeypatch.setenv('NVIDIA_API_KEY','test')
    monkeypatch.delenv('NVIDIA_VISION_MODEL',raising=False)
    response=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'text':'I cannot recommend any care items. Please consult a doctor.','decision':None})))])
    client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(return_value=response))),close=AsyncMock())
    monkeypatch.setattr(module,'AsyncOpenAI',lambda **kwargs:client)
    r=TestClient(app).post('/api/voice-turn',json={'transcript':symptom,'inspection':{'mode':'body','image':base64.b64encode(b'\xff\xd8test\xff\xd9').decode()}})
    assert r.status_code==200
    data=r.json()
    assert expected in {i['id'] for i in data['care_kit']['items']}
    assert 'cannot recommend' not in data['text']
    assert 'not a doctor' in data['text']
    assert all(not i['order_executed'] for i in data['care_kit']['items'])
    assert symptom in decision_log.LOG_PATH.read_text(encoding='utf-8')


def test_otc_catalog_is_available_without_personalized_doses():
    from backend.care import catalog_items,care_plan
    items=catalog_items(['acetaminophen','ibuprofen','antibiotic ointment','unknown prescription'])
    assert len(items)==3
    assert all(i['otc'] and not i['order_executed'] for i in items)
    assert all('pharmacist' in i['guidance'].lower() for i in items)
    assert care_plan('I have chest pain')[0]==[]
    assert care_plan('My foot is fine')[0]==[]


def test_spoken_catalog_items_are_included_even_when_structured_items_omit_them(monkeypatch):
    monkeypatch.setenv('NVIDIA_API_KEY','test')
    response=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'text':'An ice pack and an elbow brace are options for review.','decision':None})))])
    client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(return_value=response))),close=AsyncMock())
    monkeypatch.setattr(module,'AsyncOpenAI',lambda **kwargs:client)
    r=TestClient(app).post('/api/voice-turn',json={'transcript':'What supportive supplies could I review?'})
    assert r.status_code==200
    assert {i['id'] for i in r.json()['care_kit']['items']}=={'cold pack','elbow brace'}


def test_urgent_advice_is_not_replaced_by_generic_care_fallback(monkeypatch):
    monkeypatch.setenv('NVIDIA_API_KEY','test')
    monkeypatch.delenv('NVIDIA_VISION_MODEL',raising=False)
    response=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'text':'Seek urgent medical assessment for the deformity.','decision':{'kind':'urgent_help','items':[],'next_steps':'Seek urgent medical assessment.'}})))])
    client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(return_value=response))),close=AsyncMock())
    monkeypatch.setattr(module,'AsyncOpenAI',lambda **kwargs:client)
    r=TestClient(app).post('/api/voice-turn',json={'transcript':'My elbow hurts and is deformed','inspection':{'mode':'arms','image':base64.b64encode(b'\xff\xd8test\xff\xd9').decode()}})
    assert r.status_code==200 and r.json()['text'].startswith('Seek urgent')
    assert r.json()['care_kit'] is None


def test_one_word_noise_is_ignored_but_direct_answer_is_accepted(monkeypatch):
    assert TestClient(app).post('/api/voice-turn',json={'transcript':'noise'}).json()['ignored'] is True
    monkeypatch.delenv('NVIDIA_API_KEY',raising=False)
    response=TestClient(app).post('/api/voice-turn',json={'transcript':'yes','history':[{'role':'assistant','content':'Are you okay?'}]})
    assert response.status_code==503  # Accepted for a turn; not discarded as noise.


def test_spoken_response_has_at_most_two_sentences(monkeypatch):
    monkeypatch.setenv('NVIDIA_API_KEY','test')
    response=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'text':'First sentence. Second sentence. Third sentence.','decision':None})))])
    client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(return_value=response))),close=AsyncMock())
    monkeypatch.setattr(module,'AsyncOpenAI',lambda **kwargs:client)
    result=TestClient(app).post('/api/voice-turn',json={'transcript':'Hello there'}).json()
    assert result['text']=='First sentence. Second sentence.'
