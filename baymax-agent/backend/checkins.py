"""Safety check-ins and optional Twilio contact to the configured dummy help number."""
import asyncio
import re
import time
import os
from pathlib import Path
from dotenv import dotenv_values
from contextlib import asynccontextmanager
from uuid import UUID
from fastapi import APIRouter,HTTPException
from pydantic import BaseModel,Field
from .decision_log import log_decision
from . import demo_contact

RESPONSE=re.compile(r'\b(yes|no|yeah|nope|okay|ok|fine|safe|alright|help|hurt|pain|dizzy|dizziness|injur\w*|sick|breath\w*|bleed\w*|cough\w*|sneez\w*|nause\w*|stomach|chest|ankle|leg|arm|head|feel\w*)\b',re.I)
incidents={}
tasks={}
contact_tasks={}

def declines_contact(text):
    return bool(re.search(r"\b(don['’]?t|do not|never|no need to) (call|contact|text|message)\b|\b(no|not) (calls|messages)\b",text,re.I))

def needs_help(text,plain_no=True):
    text=text.lower().strip()
    if declines_contact(text):return False
    if re.search(r"\b(don['’]?t|do not|no) (?:need|want) (?:any )?help\b",text):return False
    return bool(re.search(r"\b(?:i(?:['’]m| am)? )?(?:need help|needs help|not (?:okay|ok|fine|safe)|can(?:not|['’]t) breathe|can(?:not|['’]t) breath|please help|help me|(?:call|contact) (?:my |the )?(?:authorities|authority|help(?: contact| number)?|demo (?:contact|number)|contact))\b",text) or text=='help' or (plain_no and text in {'no','nope'}))

async def dispatch_contact(identifier):
    entry=incidents.get(identifier)
    if not entry or entry.get('contact_attempted'):return
    entry['contact_attempted']=True
    try:
        result=await demo_contact.notify(entry['action'],entry.get('escalation_reason','No relevant response within 60 seconds'))
        entry['contact']=result
        entry['status']='CONTACT_ACCEPTED' if result['status']=='accepted' else 'CONTACT_UNCONFIRMED' if result['status']=='unknown' else 'CONTACT_FAILED'
        log_decision('demo_contact_'+result['status'],symptoms=entry.get('response',''),findings=entry.get('summary',''),next_steps=result['message'])
    finally:contact_tasks.pop(identifier,None)

def escalate(identifier,reason):
    entry=incidents.get(identifier)
    if not entry or entry.get('escalation_reason'):return
    entry['escalation_reason']=reason
    config=demo_contact.configuration()
    if not config['enabled']:
        entry['status']='ESCALATED_DEMO';entry['contact']=demo_contact.unavailable()
        log_decision('demo_escalation',findings=entry.get('summary',''),next_steps=reason+'. Authorities-call escalation SIMULATED; no calls or messages placed.')
    elif not config['ready']:
        entry['status']='CONTACT_FAILED';entry['contact']=demo_contact.unavailable()
        log_decision('demo_contact_not_configured',findings=entry.get('summary',''),next_steps=entry['contact']['message'])
    else:
        entry['status']='CONTACTING';entry['mode']=config['mode']
        log_decision('demo_contact_requested',findings=entry.get('summary',''),next_steps=reason+'. Contacting only the configured demo number; no emergency services dispatched.')
        contact_tasks[identifier]=asyncio.create_task(dispatch_contact(identifier))

def expire(identifier):
    entry=incidents.get(identifier)
    if entry and entry['status']=='AWAITING_RESPONSE' and time.time()*1000>=entry['deadline_ms']:
        escalate(identifier,'60 seconds without a relevant response')

async def wait_for_deadline(identifier):
    try:
        await asyncio.sleep(max(0,(incidents[identifier]['deadline_ms']/1000)-time.time()))
        expire(identifier)
    finally:tasks.pop(identifier,None)

@asynccontextmanager
async def lifespan(app):
    yield
    pending=list(tasks.values())+list(contact_tasks.values())
    for task in pending:task.cancel()
    if pending:await asyncio.gather(*pending,return_exceptions=True)
    tasks.clear();contact_tasks.clear()

router=APIRouter(prefix='/api/check-ins',lifespan=lifespan)
class NewCheck(BaseModel):
    id: UUID
    action: str=Field(min_length=1,max_length=80)
    summary: str=Field(default='',max_length=1500)
class Answer(BaseModel):
    response: str=Field(min_length=1,max_length=2000)

@router.post('')
async def create_check(check:NewCheck):
    identifier=str(check.id)
    if identifier in incidents:return incidents[identifier]
    # Retain recent entries only; never evict an active deadline.
    for key in list(incidents):
        if incidents[key]['status']!='AWAITING_RESPONSE' and time.time()*1000-incidents[key]['deadline_ms']>3600000:incidents.pop(key,None)
    if len(incidents)>=500:raise HTTPException(429,'Too many check-ins')
    entry={'id':identifier,'action':check.action,'summary':check.summary,'deadline_ms':time.time()*1000+60000,'status':'AWAITING_RESPONSE','mode':demo_contact.configuration()['mode'] if demo_contact.configuration()['enabled'] else 'simulation','contact_config':demo_contact.configuration(),'authorities_contacted':False}
    incidents[identifier]=entry
    log_decision('check_in_started',findings=check.summary or check.action,next_steps='Asked whether the user is okay; 60-second response deadline. Escalation contacts the configured demo number only when Twilio is enabled and configured.')
    tasks[identifier]=asyncio.create_task(wait_for_deadline(identifier))
    return entry

@router.get('/config')
async def contact_config():
    result=demo_contact.configuration()
    # Compare only in memory; no credential values are returned to the browser.
    values=dotenv_values(Path(__file__).with_name('.env'),encoding='utf-8-sig')
    defaults={'ENABLE_REAL_ALERTS':'false','TWILIO_ALERT_MODE':'sms'}
    keys=['ENABLE_REAL_ALERTS','TWILIO_SMS_TEMPLATE','TWILIO_ALERT_MODE','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_PHONE_NUMBER','DEMO_EMERGENCY_PHONE']
    result['restart_required']=any(str(values[key]).strip()!=os.getenv(key,defaults.get(key,'')).strip() for key in keys if key in values and values[key] is not None)
    return result

@router.get('/{identifier}')
async def get_check(identifier:UUID):
    key=str(identifier)
    if key not in incidents:raise HTTPException(404,'Check-in not found')
    expire(key)
    return incidents[key]

@router.post('/{identifier}/respond')
async def respond(identifier:UUID,answer:Answer):
    key=str(identifier);entry=incidents.get(key)
    if not entry:raise HTTPException(404,'Check-in not found')
    expire(key)
    if entry['status']!='AWAITING_RESPONSE':return entry
    if not RESPONSE.search(answer.response) and not needs_help(answer.response) and not declines_contact(answer.response):raise HTTPException(422,'A relevant response is required; countdown remains active')
    if needs_help(answer.response,plain_no=entry['action'] not in {'LIMPING','HOPPING','GUARDING_ARM'}):
        entry['response']=answer.response
        task=tasks.pop(key,None)
        if task:task.cancel()
        escalate(key,'User explicitly requested help or said they are not okay')
        return entry
    entry['status']='RESPONDED'
    task=tasks.pop(key,None)
    if task:task.cancel()
    log_decision('check_in_answered',symptoms=answer.response,findings=entry['summary'],next_steps='Relevant response received; simulated unanswered-check-in escalation cancelled.')
    return entry
