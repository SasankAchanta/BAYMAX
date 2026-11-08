"""Append-only user-visible decisions; no images, audio, or model reasoning."""
import json,sqlite3,re,hashlib
from contextlib import contextmanager
from uuid import uuid4
from fastapi import APIRouter,Query
from fastapi.responses import PlainTextResponse
from datetime import datetime
from pathlib import Path
from threading import Lock
from zoneinfo import ZoneInfo

LOG_PATH = Path(__file__).resolve().parents[2] / 'baymax_decisions.txt'
_lock = Lock()
def clean(value):
    return ' '.join(str(value).split())[:4000]

@contextmanager
def database():
    connection=sqlite3.connect(str(LOG_PATH.with_suffix('.sqlite3')),timeout=10)
    connection.execute('CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, timestamp TEXT, kind TEXT, symptoms TEXT, findings TEXT, items TEXT, next_steps TEXT, action TEXT, confidence REAL, status TEXT, incident_id TEXT)')
    try:
        with connection:yield connection
    finally:connection.close()

def log_decision(kind, symptoms='', findings='', items=None, next_steps='', *, action='', confidence=None, status='', incident_id=''):

    timestamp = datetime.now(ZoneInfo('America/Chicago')).isoformat(timespec='seconds')
    entry = (f'[{timestamp}] {clean(kind)}\n'
             f'User symptoms: {clean(symptoms) or "Not provided"}\n'
             f'Vision findings: {clean(findings) or "Not inspected"}\n'
             f'Recommended items (review only): {clean(", ".join(items or [])) or "None"}\n'
             f'Next steps: {clean(next_steps) or "None"}\n' + '-'*72 + '\n')
    with _lock:
        with database() as db:
            db.execute('INSERT INTO decisions VALUES (?,?,?,?,?,?,?,?,?,?,?)',(str(uuid4()),timestamp,clean(kind),clean(symptoms),clean(findings),json.dumps([clean(i) for i in (items or [])]),clean(next_steps),clean(action),confidence if isinstance(confidence,(float,int)) and not isinstance(confidence,bool) and 0<=confidence<=100 else None,clean(status) or clean(kind),clean(incident_id)))
        with LOG_PATH.open('a', encoding='utf-8') as output:
            output.write(entry)


router=APIRouter(prefix='/api/decisions')
@router.get('')
def history(limit:int=Query(default=500,ge=1,le=2000)):
    with _lock, database() as db:
        # Import older plain-text entries once, without inventing missing metadata.
        db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT)')
        if LOG_PATH.exists() and not db.execute("SELECT 1 FROM metadata WHERE key='legacy_imported'").fetchone():
            content=LOG_PATH.read_text(encoding='utf-8')
            for block in content.split('-'*72):
                match=re.match(r'\s*\[([^\]]+)\] ([^\n]+)\nUser symptoms: ([^\n]*)\nVision findings: ([^\n]*)\nRecommended items \(review only\): ([^\n]*)\nNext steps: ([^\n]*)',block)
                if not match:continue
                timestamp,kind,symptoms,findings,items,next_steps=match.groups()
                if db.execute('SELECT 1 FROM decisions WHERE timestamp=? AND kind=? AND next_steps=?',(timestamp,kind,next_steps)).fetchone():continue
                identifier='legacy-'+hashlib.sha256(block.strip().encode()).hexdigest()
                db.execute('INSERT OR IGNORE INTO decisions VALUES (?,?,?,?,?,?,?,?,?,?,?)',(identifier,timestamp,kind,symptoms,findings,json.dumps([] if items=='None' else items.split(', ')),next_steps,'',None,'legacy',''))
            db.execute("INSERT OR REPLACE INTO metadata VALUES ('legacy_imported','1')")
        db.row_factory=sqlite3.Row
        rows=[dict(row) for row in db.execute('SELECT * FROM decisions ORDER BY datetime(timestamp) DESC,rowid DESC LIMIT ?', (limit,))]
    for row in rows:row['items']=json.loads(row['items'])
    return {'items':rows,'persistent':True,'storage':'Local decision history','limit':limit}

@router.get('/export',response_class=PlainTextResponse)
def export_history():
    return PlainTextResponse(LOG_PATH.read_text(encoding='utf-8') if LOG_PATH.exists() else '',headers={'Content-Disposition':'attachment; filename="baymax_decisions.txt"'})


def save_incident(entry):
    with _lock, database() as db:
        db.execute('CREATE TABLE IF NOT EXISTS checkins (id TEXT PRIMARY KEY, payload TEXT)')
        db.execute('INSERT OR REPLACE INTO checkins VALUES (?,?)',(entry['id'],json.dumps(entry)))

def active_incidents():
    with _lock, database() as db:
        db.execute('CREATE TABLE IF NOT EXISTS checkins (id TEXT PRIMARY KEY, payload TEXT)')
        return [json.loads(row[0]) for row in db.execute('SELECT payload FROM checkins') if json.loads(row[0]).get('status') in ('AWAITING_RESPONSE','CONTACTING','CONTACT_ACCEPTED')]
