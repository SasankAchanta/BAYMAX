import io
import wave
from types import SimpleNamespace, ModuleType
from unittest.mock import Mock
from contextlib import nullcontext
from fastapi.testclient import TestClient
from backend.voice_api import app
from backend import tts


def wav_bytes():
    output=io.BytesIO()
    with wave.open(output,'wb') as audio:
        audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(24000);audio.writeframes(b'\x00\x00'*240)
    return output.getvalue()


def test_audio_endpoint_returns_wav_and_rejects_unbounded_text(monkeypatch):
    generate=Mock(return_value=wav_bytes())
    monkeypatch.setattr(tts.service,'generate',generate)
    client=TestClient(app)
    response=client.post('/api/tts',json={'text':'Hello, I am Baymax.'})
    assert response.status_code==200
    assert response.headers['content-type']=='audio/wav'
    assert response.content[:4]==b'RIFF'
    assert response.headers['cache-control']=='no-store'
    for text in ('',' ','x'*501):
        assert client.post('/api/tts',json={'text':text}).status_code==422
    generate.assert_called_once_with('Hello, I am Baymax.')


def test_unavailable_or_busy_returns_browser_fallback(monkeypatch):
    monkeypatch.setattr(tts.service,'generate',lambda text:None)
    response=TestClient(app).post('/api/tts',json={'text':'Hello'})
    assert response.status_code==200
    assert response.json()['fallback']=='browser'


def test_startup_loads_once_and_selects_device(monkeypatch,tmp_path):
    monkeypatch.setenv('ENABLE_CHATTERBOX','true')
    reference=tmp_path/'reference.wav';reference.write_bytes(wav_bytes())
    monkeypatch.setenv('TTS_REFERENCE_PATH',str(reference))
    fake=Mock(return_value=SimpleNamespace(sr=24000))
    import sys
    monkeypatch.setitem(sys.modules,'torch',SimpleNamespace(cuda=SimpleNamespace(is_available=lambda:True)))
    monkeypatch.setitem(sys.modules,'chatterbox',ModuleType('chatterbox'))
    monkeypatch.setitem(sys.modules,'chatterbox.tts_turbo',SimpleNamespace(ChatterboxTurboTTS=SimpleNamespace(from_pretrained=fake)))
    service=tts.TTSService();service.load();service.load()
    fake.assert_called_once_with(device='cuda')
    assert service.status=='ready' and service.reference==reference


def test_generation_error_and_lock_do_not_break_voice(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules,'torch',SimpleNamespace(inference_mode=nullcontext))
    monkeypatch.setitem(sys.modules,'torchaudio',SimpleNamespace())
    service=tts.TTSService();service.status='ready';service.model=SimpleNamespace(generate=Mock(side_effect=RuntimeError('failed')))
    assert service.generate('hello') is None
    assert not service.inference_lock.locked()
    service.inference_lock.acquire()
    try: assert service.generate('hello') is None
    finally: service.inference_lock.release()
