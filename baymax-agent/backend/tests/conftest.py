import pytest
from backend import decision_log

@pytest.fixture(autouse=True)
def isolate_decision_logs(tmp_path,monkeypatch):
    monkeypatch.setenv('ENABLE_CHATTERBOX','false')
    monkeypatch.setenv('ENABLE_REAL_ALERTS','false')
    monkeypatch.setenv('SPACETIMEDB_TOKEN','')
    monkeypatch.setenv('RAINFOREST_API_KEY','')
    monkeypatch.setattr(decision_log,'LOG_PATH',tmp_path/'baymax_decisions.txt')
