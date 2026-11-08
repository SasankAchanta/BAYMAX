import pytest
from backend import decision_log

@pytest.fixture(autouse=True)
def isolate_decision_logs(tmp_path,monkeypatch):
    monkeypatch.setattr(decision_log,'LOG_PATH',tmp_path/'baymax_decisions.txt')
