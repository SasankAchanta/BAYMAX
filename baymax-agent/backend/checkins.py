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
from pydantic import BaseModel,Field,model_validator
from .decision_log import log_decision,save_incident,active_incidents
from . import demo_contact

RESPONSE=re.compile(r'\b(yes|no|yeah|nope|okay|ok|fine|safe|alright|help|hurt|pain|dizzy|dizziness|injur\w*|sick|breath\w*|bleed\w*|cough\w*|sneez\w*|nause\w*|stomach|chest|ankle|leg|arm|head|feel\w*)\b',re.I)
incidents={}
tasks={}
contact_tasks={}

def declines_contact(text):
    return bool(re.search(r"\b(don['’]?t|do not|never|no need to) (call|contact|text|message|send)\b|\b(no|not) (calls|messages)\b",text,re.I))

def needs_help(text,plain_no=True):
    text=text.lower().strip()
    if declines_contact(text):return False
    if re.search(r"\b(don['’]?t|do not|no) (?:need|want) (?:any )?help\b",text):return False
    return bool(re.search(r"\b(?:i(?:['’]m| am)? )?(?:need help|needs help|not (?:okay|ok|fine|safe)|can(?:not|['’]t) breathe|can(?:not|['’]t) breath|please help|help me|(?:call|contact) (?:my |the )?(?:authorities|authority|help(?: contact| number)?|demo (?:contact|number)|contact))\b",text) or re.fullmatch(r'(?:baymax[, ]+)?(?:please )?send (?:me )?(?:a |the )?(?:text|sms)(?: message)?[.!]?',text) or text=='help' or (plain_no and text in {'no','nope'}))

async def dispatch_contact(identifier):
    entry=incidents.get(identifier)
    if not entry or entry.get('contact_attempted'):return
    entry['contact_attempted']=True
    try:
        result=await demo_contact.notify(entry['action'],entry.get('escalation_reason','No relevant response within 60 seconds'))
        entry['contact']=result
        entry['status']='CONTACT_ACCEPTED' if result['status']=='accepted' else 'CONTACT_UNCONFIRMED' if result['status']=='unknown' else 'CONTACT_FAILED'
        save_incident(entry)
        log_decision('demo_contact_'+result['status'],symptoms=entry.get('response',''),findings=entry.get('summary',''),next_steps=result['message'],action=entry['action'],confidence=entry.get('confidence'),status=result['status'],incident_id=identifier)
        if result['status']=='accepted' and result['mode']=='sms':
            result['delivery_pending']=True
            save_incident(entry)
            for _ in range(20):
                await asyncio.sleep(3)
                update=await demo_contact.delivery(result['sid'])
                if update:result.update(update)
                state=result.get('provider_status')
                if state in ('delivered','read','failed','undelivered','canceled'):
                    result['delivery_pending']=False
                    delivered=state in ('delivered','read')
                    entry['status']='CONTACT_DELIVERED' if delivered else 'CONTACT_FAILED'
                    result['status']='delivered' if delivered else 'failed'
                    result['message']='Your help message was delivered to your demo contact.' if delivered else 'Your help message could not be delivered. It was not sent again.'
                    result['speech_message']=result['message']
                    save_incident(entry)
                    log_decision('sms_'+result['status'],findings=entry.get('summary',''),next_steps=result['message'],action=entry['action'],status=state,incident_id=identifier)
                    break
            else:
                result['delivery_pending']=False
                entry['status']='CONTACT_UNCONFIRMED'
                result['message']='Your help message was submitted, but delivery has not been confirmed. It was not sent again.'
                result['speech_message']=result['message']
                save_incident(entry)
                log_decision('sms_delivery_unconfirmed',next_steps=result['message'],action=entry['action'],status='unconfirmed',incident_id=identifier)
    finally:contact_tasks.pop(identifier,None)

def escalate(identifier,reason):
    entry=incidents.get(identifier)
    if not entry or entry.get('escalation_reason'):return
    entry.setdefault('id',identifier)
    entry['escalation_reason']=reason
    config=demo_contact.configuration()
    if not config['enabled']:
        entry['status']='ESCALATED_DEMO';entry['contact']=demo_contact.unavailable()
        log_decision('demo_escalation',findings=entry.get('summary',''),next_steps=reason+'. Authorities-call escalation SIMULATED; no calls or messages placed.',action=entry['action'],confidence=entry.get('confidence'),status='simulation',incident_id=identifier)
    elif not config['ready']:
        entry['status']='CONTACT_FAILED';entry['contact']=demo_contact.unavailable()
        log_decision('demo_contact_not_configured',findings=entry.get('summary',''),next_steps=entry['contact']['message'],action=entry['action'],confidence=entry.get('confidence'),status='not_configured',incident_id=identifier)
    else:
        entry['status']='CONTACTING';entry['mode']=config['mode']
        log_decision('demo_contact_requested',findings=entry.get('summary',''),next_steps=reason+'. Contacting only the configured demo number; no emergency services dispatched.',action=entry['action'],confidence=entry.get('confidence'),status='requested',incident_id=identifier)
        contact_tasks[identifier]=asyncio.create_task(dispatch_contact(identifier))
    save_incident(entry)

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
    for entry in active_incidents():
        identifier=entry['id']
        if identifier in incidents:continue
        incidents[identifier]=entry
        if entry['status']=='AWAITING_RESPONSE':tasks[identifier]=asyncio.create_task(wait_for_deadline(identifier))
        else:
            # Restart after an outbound request is ambiguous: never send a duplicate.
            entry['status']='CONTACT_UNCONFIRMED'
            entry['contact']={**entry.get('contact',{}),'delivery_pending':False,'message':'The API restarted after a contact request. No automatic resend was made; check the delivery history.'}
            save_incident(entry)
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
    confidence: float | None=Field(default=None,ge=0,le=100,allow_inf_nan=False)
    held_ms: float=Field(default=0,ge=0,le=60000,allow_inf_nan=False)
    @model_validator(mode='after')
    def choking_threshold(self):
        if self.action=='POSSIBLE_CHOKING' and self.held_ms<=3000:raise ValueError('Possible choking requires more than 3 seconds of evidence')
        return self
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
    entry={'id':identifier,'action':check.action,'confidence':check.confidence,'summary':check.summary,'deadline_ms':time.time()*1000+60000,'status':'AWAITING_RESPONSE','mode':demo_contact.configuration()['mode'] if demo_contact.configuration()['enabled'] else 'simulation','contact_config':demo_contact.configuration(),'authorities_contacted':False}
    incidents[identifier]=entry
    save_incident(entry)
    log_decision('check_in_started',findings=check.summary or check.action,next_steps='Asked whether the user is okay; 60-second response deadline. Escalation contacts the configured demo number only when Twilio is enabled and configured.',action=check.action,confidence=check.confidence,status='awaiting_response',incident_id=identifier)
    if check.action=='POSSIBLE_CHOKING':
        for old_id,old in incidents.items():
            if old_id!=identifier and old['status']=='AWAITING_RESPONSE':
                old['status']='SUPERSEDED';task=tasks.pop(old_id,None)
                if task:task.cancel()
                save_incident(old)
        escalate(identifier,'Possible choking gesture persisted for more than 3 seconds; immediate demo help requested')
    else:tasks[identifier]=asyncio.create_task(wait_for_deadline(identifier))
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
    save_incident(entry)
    task=tasks.pop(key,None)
    if task:task.cancel()
    log_decision('check_in_answered',symptoms=answer.response,findings=entry['summary'],next_steps='Relevant response received; unanswered-check-in escalation cancelled.',action=entry['action'],confidence=entry.get('confidence'),status='responded',incident_id=key)
    return entry
