"""Append-only user-visible decisions; no images, audio, or model reasoning."""
from datetime import datetime
from pathlib import Path
from threading import Lock
from zoneinfo import ZoneInfo

LOG_PATH = Path(__file__).resolve().parents[2] / 'baymax_decisions.txt'
_lock = Lock()
def clean(value):
    return ' '.join(str(value).split())[:4000]

def log_decision(kind, symptoms='', findings='', items=None, next_steps=''):
    timestamp = datetime.now(ZoneInfo('America/Chicago')).isoformat(timespec='seconds')
    entry = (f'[{timestamp}] {clean(kind)}\n'
             f'User symptoms: {clean(symptoms) or "Not provided"}\n'
             f'Vision findings: {clean(findings) or "Not inspected"}\n'
             f'Recommended items (review only): {clean(", ".join(items or [])) or "None"}\n'
             f'Next steps: {clean(next_steps) or "None"}\n' + '-'*72 + '\n')
    with _lock:
        with LOG_PATH.open('a', encoding='utf-8') as output:
            output.write(entry)
