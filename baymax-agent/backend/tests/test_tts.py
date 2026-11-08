from types import SimpleNamespace
from unittest.mock import Mock
from fastapi.testclient import TestClient
from backend.voice_api import app
from backend import tts

def test_audio_endpoint_returns_mp3_and_rejects_unbounded_text(monkeypatch):
    generate=Mock(return_value=b'ID3test-audio');monkeypatch.setattr(tts.service,'generate',generate)
    client=TestClient(app);response=client.post('/api/tts',json={'text':'Hello, I am Baymax.'})
    assert response.status_code==200 and response.headers['content-type']=='audio/mpeg'
    assert response.content==b'ID3test-audio' and response.headers['cache-control']=='no-store'
    for text in ('',' ','x'*501):assert client.post('/api/tts',json={'text':text}).status_code==422
    generate.assert_called_once_with('Hello, I am Baymax.')

def test_unavailable_or_busy_returns_browser_fallback(monkeypatch):
    monkeypatch.setattr(tts.service,'generate',lambda text:None)
    assert TestClient(app).post('/api/tts',json={'text':'Hello'}).json()['fallback']=='browser'

def test_startup_initializes_once_and_conversion_uses_requested_settings(monkeypatch):
    monkeypatch.setenv('ELEVENLABS_API_KEY','test-only-secret');monkeypatch.setenv('ELEVENLABS_VOICE_ID','test-voice')
    convert=Mock(return_value=iter([b'ID3',b'audio']));factory=Mock(return_value=SimpleNamespace(text_to_speech=SimpleNamespace(convert=convert)))
    monkeypatch.setattr(tts,'ElevenLabs',factory)
    service=tts.TTSService();service.load();service.load()
    factory.assert_called_once_with(api_key='test-only-secret',timeout=5)
    assert service.generate('Hello')==b'ID3audio'
    assert convert.call_args.kwargs=={'voice_id':'test-voice','text':'Hello','model_id':'eleven_flash_v2_5','output_format':'mp3_44100_128','request_options':{'max_retries':0,'timeout_in_seconds':5}}

def test_api_failure_empty_audio_and_busy_lock_fall_back(monkeypatch):
    service=tts.TTSService();service.status='ready';convert=Mock(side_effect=RuntimeError('secret provider message'))
    service.client=SimpleNamespace(text_to_speech=SimpleNamespace(convert=convert));service.voice_id='test-voice'
    assert service.generate('Hello') is None and not service.inference_lock.locked()
    convert.side_effect=None;convert.return_value=iter([]);assert service.generate('Hello') is None
    service.inference_lock.acquire()
    try:assert service.generate('Hello') is None
    finally:service.inference_lock.release()

def test_missing_configuration_never_initializes_sdk(monkeypatch):
    factory=Mock();monkeypatch.setattr(tts,'ElevenLabs',factory)
    monkeypatch.delenv('ELEVENLABS_API_KEY',raising=False);service=tts.TTSService();service.load();assert service.status=='disabled'
    monkeypatch.setenv('ELEVENLABS_API_KEY','test');monkeypatch.delenv('ELEVENLABS_VOICE_ID',raising=False);service=tts.TTSService();service.load();assert service.status=='not_configured'
    factory.assert_not_called()


def test_real_sdk_contract_consumes_mp3_iterator_without_network():
    import httpx,json
    from elevenlabs.client import ElevenLabs
    def handler(request):
        assert request.url.path.endswith('/text-to-speech/test-voice')
        assert request.url.params['output_format']=='mp3_44100_128'
        body=json.loads(request.content);assert body['model_id']=='eleven_flash_v2_5' and body['text']=='Hello'
        return httpx.Response(200,content=b'ID3sample',headers={'Content-Type':'audio/mpeg'})
    with httpx.Client(transport=httpx.MockTransport(handler)) as transport:
        service=tts.TTSService();service.client=ElevenLabs(api_key='test-only',httpx_client=transport,timeout=5);service.voice_id='test-voice';service.status='ready'
        assert service.generate('Hello')==b'ID3sample'
