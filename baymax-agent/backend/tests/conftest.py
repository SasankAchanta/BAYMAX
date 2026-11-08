import pytest
from backend import decision_log

@pytest.fixture(autouse=True)
def isolate_decision_logs(tmp_path,monkeypatch):
    from backend import checkins
    checkins.incidents.clear()
    monkeypatch.setenv('ENABLE_CHATTERBOX','false')
    monkeypatch.setenv('ELEVENLABS_API_KEY','')
    monkeypatch.setenv('ELEVENLABS_VOICE_ID','')
    monkeypatch.setenv('ENABLE_REAL_ALERTS','false')
    monkeypatch.setenv('SPACETIMEDB_TOKEN','')
    monkeypatch.setenv('RAINFOREST_API_KEY','')
    monkeypatch.setattr(decision_log,'LOG_PATH',tmp_path/'baymax_decisions.txt')

    yield
    checkins.incidents.clear()
