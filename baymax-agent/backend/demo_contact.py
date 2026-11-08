"""Twilio notifications to one server-configured demo help contact; never emergency dispatch."""
import os,re
from xml.sax.saxutils import escape
import httpx

def configuration():
    mode=os.getenv('TWILIO_ALERT_MODE','sms').lower()
    values={key:os.getenv(key,'').strip() for key in ('TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_PHONE_NUMBER','DEMO_EMERGENCY_PHONE')}
    enabled=os.getenv('ENABLE_REAL_ALERTS','false').lower()=='true'
    missing=[key for key,value in values.items() if not value]
    invalid=[]
    for key in ('TWILIO_PHONE_NUMBER','DEMO_EMERGENCY_PHONE'):
        if values[key] and not re.fullmatch(r'\+[1-9]\d{7,14}',values[key]):invalid.append(key)
    if values['TWILIO_ACCOUNT_SID'] and not re.fullmatch(r'AC[a-fA-F0-9]{32}',values['TWILIO_ACCOUNT_SID']):invalid.append('TWILIO_ACCOUNT_SID')
    if mode not in ('sms','call'):invalid.append('TWILIO_ALERT_MODE')
    return {'enabled':enabled,'ready':enabled and not missing and not invalid,'mode':mode,'missing':missing,'invalid':invalid,'sms_template':os.getenv('TWILIO_SMS_TEMPLATE','').strip() or None,'recipient_hint':('ending '+values['DEMO_EMERGENCY_PHONE'][-4:]) if values['DEMO_EMERGENCY_PHONE'] else None}

def unavailable():
    config=configuration()
    return {'mode':'simulation' if not config['enabled'] else config['mode'],'status':'simulated' if not config['enabled'] else 'not_configured','message':'Demo escalation only; no call or message placed.' if not config['enabled'] else 'Demo help contact could not be reached: configure the Twilio credentials and phone numbers in backend/.env.','speech_message':'This is a demo alert. No help message was sent.' if not config['enabled'] else 'I could not send your help request. The help contact is not configured.','authorities_contacted':False}

ERROR_HINTS={
 572002:'This trial sender is not assigned to this recipient. Copy the From number from Twilio Try out SMS for that recipient.',
 572005:'Verify this recipient in Twilio Try out SMS first.',
 572006:'This trial account only allows predefined SMS templates. Set TWILIO_SMS_TEMPLATE=sms_internal_alerts, or upgrade Twilio for custom BAYMAX text.',
 20003:'Twilio authentication failed. Check Account SID and Auth Token.',
 21211:'The destination phone number is invalid. Use its full international format.',
 21606:'The sender is not an SMS-capable Twilio number on this account. Claim a trial sender in Twilio and update TWILIO_PHONE_NUMBER.',
 21608:'The destination is not verified for this Twilio trial account. Verify your own phone in Twilio.',
 21610:'The recipient has opted out of SMS from this sender.',
 21614:'The destination is not a valid SMS-capable number.',
 21661:'The configured sender cannot send SMS. Use an SMS-capable Twilio number.',
 21408:'Messaging to this destination country is not enabled on the Twilio account.',
 30034:'US messaging registration is required for this sender. Complete Twilio messaging registration.',
 30007:'The carrier filtered this message. Check the Twilio messaging setup.',
}
def failure_details(response):
    try:
        data=response.json();code=data.get('code')
        if isinstance(code,bool) or not isinstance(code,int):code=None
    except (ValueError,AttributeError):code=None
    hint=ERROR_HINTS.get(code,'Check the Twilio sender, verified recipient and account messaging settings.')
    return {'speech_message':'I could not send your help request. There is a problem with the messaging service.','http_status':response.status_code,'error_code':code,'error_url':f'https://www.twilio.com/docs/api/errors/{code}' if code else None,'message':f'Twilio rejected the demo contact request (HTTP {response.status_code}'+(f', code {code}' if code else '')+'). '+hint}

async def notify(action,reason):
    config=configuration()
    if not config['ready']:return unavailable()
    sid=os.environ['TWILIO_ACCOUNT_SID'].strip();token=os.environ['TWILIO_AUTH_TOKEN'].strip()
    text=f'BAYMAX DEMO HELP REQUEST. Trigger: {action.replace("_"," ")}. {reason}. Please check on the demo participant. This is a prototype notification, not an emergency-services dispatch.'
    data={'From':os.environ['TWILIO_PHONE_NUMBER'].strip(),'To':os.environ['DEMO_EMERGENCY_PHONE'].strip()}
    if config['mode']=='call':data.update(Twiml='<Response><Say>'+escape(text)+'</Say></Response>',Timeout='25')
    else:data['Body']=config['sms_template'] or text
    resource='Calls' if config['mode']=='call' else 'Messages'
    base={'mode':config['mode'],'recipient_hint':config['recipient_hint'],'authorities_contacted':False,'template_only':bool(config['mode']=='sms' and config['sms_template'])}
    try:
        async with httpx.AsyncClient(timeout=12,follow_redirects=False) as client:
            response=await client.post(f'https://api.twilio.com/2010-04-01/Accounts/{sid}/{resource}.json',auth=(sid,token),data=data)
            if not response.is_success:
                return {**base,'status':'failed',**failure_details(response)}
            result=response.json();identifier=str(result.get('sid',''))
            if not re.fullmatch(r'(SM|MM|CA)[a-fA-F0-9]{32}',identifier):raise ValueError()
            status=result.get('status','queued')
            if status in ('failed','undelivered','canceled','busy','no-answer'):
                return {**base,'status':'failed','speech_message':'Your help request could not be completed.','provider_status':status,'message':'Twilio could not complete the demo contact request.'}
            notice=' Trial template only: custom BAYMAX alert details are not included.' if base['template_only'] else ''
            return {**base,'status':'accepted','speech_message':'Your help message has been submitted. Delivery is not yet confirmed.' if config['mode']=='sms' else 'Your help call has been requested. An answer is not yet confirmed.','provider_status':str(status)[:40],'sid':identifier,'message':f'Twilio accepted the {config["mode"]} request for your demo help contact; delivery or answer is not yet confirmed.'+notice}
    except httpx.TimeoutException:
        return {**base,'status':'unknown','speech_message':'I could not confirm your help request. I have not sent it again.','message':'Twilio did not confirm before timeout. The request may have reached Twilio; no automatic retry was made.'}
    except (httpx.HTTPError,ValueError,TypeError,AttributeError):
        return {**base,'status':'unknown','speech_message':'I could not confirm your help request. I have not sent it again.','message':'The demo contact request could not be confirmed. No automatic retry was made.'}


async def delivery(identifier):
    """Read-only delivery lookup. Never retries an outbound send."""
    if not re.fullmatch(r'(SM|MM)[a-fA-F0-9]{32}',identifier):return None
    sid=os.getenv('TWILIO_ACCOUNT_SID','').strip();token=os.getenv('TWILIO_AUTH_TOKEN','').strip()
    try:
        async with httpx.AsyncClient(timeout=8,follow_redirects=False) as client:
            response=await client.get(f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages/{identifier}.json',auth=(sid,token))
            if not response.is_success:return None
            result=response.json();state=result.get('status')
            if state not in ('accepted','scheduled','queued','sending','sent','delivered','read','failed','undelivered','canceled'):return None
            code=result.get('error_code')
            return {'provider_status':state,'error_code':code if type(code) is int else None}
    except (httpx.HTTPError,ValueError,AttributeError):return None
