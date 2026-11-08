export const SAFETY_OPENINGS={
 SITTING_HEAD_DOWN:'Your head has been down for a while. Are you feeling okay?',
 LIMPING:"I noticed you're limping. Did you hurt your leg or ankle?",
 HOPPING:"I noticed you're hopping on one foot. Did you hurt your foot or ankle?",
 GUARDING_ARM:"It looks like you're holding your arm close. Did you hurt your arm or elbow?",
 FALL_DETECTED:'I noticed a sudden drop and a possible fall. Are you okay?',
 LYING_TOO_LONG:"You've been lying down for a while. Are you okay?",
 CLENCHING_STOMACH:"I noticed you're holding your stomach. Are you okay?",
 HOLDING_CHEST:"I noticed you're holding your chest. Are you okay?",
 COUGHING:'I noticed what may be repeated coughing. Are you okay?',
 SNEEZING:'I noticed what may be repeated sneezing. Are you okay?',
 SUDDEN_FALL:'I noticed a sudden drop. Are you okay?',
 LYING_DOWN:"You've been lying down for a while. Are you okay?",
 REPEATED_LOUD_SOUNDS:'I heard several loud sounds. Are you okay?'
};
export function properResponse(text){return /\b(yes|no|yeah|nope|okay|ok|fine|safe|alright|help|hurt|pain|dizzy|dizziness|injur\w*|sick|breath\w*|bleed\w*|cough\w*|sneez\w*|nause\w*|stomach|chest|ankle|leg|arm|head|feel\w*)\b/i.test(text)}
export function declinesContact(text){return /\b(don['’]?t|do not|never|no need to) (call|contact|text|message)\b|\b(no|not) (calls|messages)\b/i.test(text)}
export function needsHelp(text,plainNo=true){
 const value=text.toLowerCase().trim();if(declinesContact(text))return false;if(/\b(don['’]?t|do not|no) (need|want) (any )?help\b/.test(value))return false;
 return /\b(need help|needs help|not (okay|ok|fine|safe)|can(not|['’]t) breathe|please help|help me|(call|contact) (my |the )?(authorities|authority|help( contact| number)?|demo (contact|number)|contact))\b/.test(value)||value==='help'||(plainNo&&['no','nope'].includes(value));
}
export async function safetyRequest(path,body){
 let response;
 try{response=await fetch('/api/check-ins'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)})}
 catch(error){throw new Error(error.name==='TimeoutError'?'Safety API timed out on port 8000. Check that FastAPI is running.':'Cannot reach the safety API. Start FastAPI on 127.0.0.1:8000.')}
 if(!response.ok){let detail='';try{const data=await response.json();detail=typeof data.detail==='string'?data.detail:Array.isArray(data.detail)?'Invalid check-in data. Refresh BAYMAX to load the latest app.':''}catch{}const error=new Error(`Safety API HTTP ${response.status}${detail?': '+detail:'. Check the backend terminal.'}`);error.status=response.status;throw error}
 try{return await response.json()}catch{throw new Error('Safety API returned a non-JSON response. Check the Vite proxy and backend on port 8000.')}
}
export class SafetyCheck {
 constructor({onChange=()=>{},onPrompt=()=>{},onLog=()=>{},onEscalate=()=>{},request=safetyRequest,clock=()=>Date.now(),setTimer=(callback,delay)=>setTimeout(callback,delay),clearTimer=timer=>clearTimeout(timer)}={}){Object.assign(this,{onChange,onPrompt,onLog,onEscalate,request,clock,setTimer,clearTimer});this.incident=null;this.seen=new Set();this.lastAction=new Map();this.closed=false}
 emit(){if(!this.closed)this.onChange(this.incident?{...this.incident,remaining:Math.max(0,Math.ceil((this.incident.deadline-this.clock())/1000))}:null)}
 log(message){this.onLog({stage:'Safety check-in',message,time:new Date().toISOString()})}
 start(event){
  if(this.closed||this.seen.has(event.id)||['AWAITING_RESPONSE','CONTACTING'].includes(this.incident?.status)||(event.action!=='USER_REQUESTED_HELP'&&this.clock()-(this.lastAction.get(event.action)??-Infinity)<60000))return false;
  this.seen.add(event.id);this.lastAction.set(event.action,this.clock());const id=globalThis.crypto?.randomUUID?.()||`check-${this.clock()}-${Math.random().toString(36).slice(2)}`;
  const incident={id,action:event.action,summary:event.summary||'',status:'AWAITING_RESPONSE',deadline:this.clock()+60000,logged:false};this.incident=incident;
  this.log(`${event.action}: asking if you are okay. 60 seconds for a relevant response; escalation targets only the configured demo help number.`);
  this.emit();if(event.action!=='USER_REQUESTED_HELP')this.onPrompt(SAFETY_OPENINGS[event.action]||'I noticed unusual movement. Are you okay?');this.tick();
  this.registration=this.register(incident,event);
  return true;
 }
 async register(incident,event,attempt=0){
  try{
   const reply=await this.request('',{id:incident.id,action:event.action,summary:incident.summary});
   if(this.closed||this.incident!==incident)return reply;
   incident.logged=true;incident.logError=false;incident.registrationError='';
   if(Number.isFinite(reply.deadline_ms))incident.deadline=Math.min(incident.deadline,reply.deadline_ms);
   incident.mode=reply.mode||'simulation';incident.contact_config=reply.contact_config;this.emit();return reply;
  }catch(error){
   if(this.closed||this.incident!==incident)return;
   incident.logError=true;incident.registrationError=error.message||'Safety API unavailable.';
   this.log('Check-in not registered: '+incident.registrationError);this.emit();
   if(attempt<2&&this.clock()<incident.deadline&&!(error.status>=400&&error.status<500&&error.status!==429)){
    await new Promise(resolve=>{this.registrationTimer=this.setTimer(resolve,1500*(attempt+1))});
    if(!this.closed&&this.incident===incident)return this.register(incident,event,attempt+1);
   }
  }
 }
 tick(){this.clearTimer(this.timer);if(this.closed||this.incident?.status!=='AWAITING_RESPONSE')return;if(this.clock()>=this.incident.deadline){this.expire();return}this.emit();this.timer=this.setTimer(()=>this.tick(),250)}
 settle(incident){
  this.clearTimer(this.settleTimer);
  this.settleTimer=this.setTimer(()=>{if(this.incident===incident&&!['AWAITING_RESPONSE','CONTACTING'].includes(incident.status))this.dismiss()},8000);
 }
 applyContact(reply,incident){
  if(this.closed||this.incident!==incident||!reply?.status)return;
  if(reply.status==='AWAITING_RESPONSE'){this.poll(incident);return}
  const changed=incident.status!==reply.status||incident.contact?.status!==reply.contact?.status;
  incident.status=reply.status;incident.contact=reply.contact;this.emit();
  if(reply.status==='CONTACTING'){this.poll(incident);return}
  this.settle(incident);
  if(changed&&reply.contact?.message){this.log(reply.contact.message);this.onEscalate(reply.contact.message,{final:true})}
 }
 poll(incident){
  this.clearTimer(this.pollTimer);if(this.closed||this.incident!==incident)return;
  if((incident.pollCount=(incident.pollCount||0)+1)>80){incident.status='CONTACT_UNCONFIRMED';this.settle(incident);incident.contact={message:'The demo contact request could not be confirmed. No automatic resend was made.'};this.emit();return}
  this.pollTimer=this.setTimer(()=>{Promise.resolve(this.registration).then(()=>this.request('/'+incident.id)).then(reply=>this.applyContact(reply,incident)).catch(()=>{if(this.incident===incident){incident.status='CONTACT_UNCONFIRMED';this.settle(incident);incident.contact={message:'Backend unavailable; no demo call or message could be confirmed.'};this.log(incident.contact.message);this.emit();this.onEscalate(incident.contact.message,{final:true})}})},1000);
 }
 expire(){
  if(this.closed||this.incident?.status!=='AWAITING_RESPONSE')return;
  const incident=this.incident;this.clearTimer(this.timer);
  incident.status=incident.mode==='simulation'||!incident.mode?'ESCALATED_DEMO':'CONTACTING';
  this.log('60 seconds without a relevant response. Requesting escalation to the demo contact.');this.emit();
  this.onEscalate(incident.status==='ESCALATED_DEMO'?'I have not received a response. This is a simulated emergency alert; no authorities have been contacted.':"I haven't received a response. I will request help from your configured demo contact now.");
  this.poll(incident);
 }
 respond(text){
  const help=needsHelp(text,this.incident?.status==='AWAITING_RESPONSE'&&!['LIMPING','HOPPING','GUARDING_ARM'].includes(this.incident?.action));
  if(help&&(!this.incident||this.incident.status==='RESPONDED'))this.start({id:'spoken-help-'+this.clock(),action:'USER_REQUESTED_HELP',summary:'User explicitly requested help.'});
  if(help&&this.incident?.status?.startsWith('CONTACT')){this.onEscalate(this.incident.contact?.message||'Your demo contact request is already being processed.');return true}
  if(this.incident?.status!=='AWAITING_RESPONSE'||(!help&&!properResponse(text)&&!declinesContact(text)))return false;
  if(this.clock()>=this.incident.deadline){this.expire();return false}
  const incident=this.incident;incident.status=help?'CONTACTING':'RESPONDED';incident.response=text;this.clearTimer(this.timer);this.emit();if(!help)this.settle(incident);
  this.log(help?'User needs help; requesting the configured demo contact immediately.':'Relevant response received; unanswered-check-in countdown cancelled.');
  if(help)this.onEscalate('Okay. I will request help from your configured demo contact now.');
  Promise.resolve(this.registration).then(()=>this.request('/'+incident.id+'/respond',{response:text})).then(reply=>{if(help)this.applyContact(reply,incident)}).catch(()=>{if(help){incident.status='CONTACT_UNCONFIRMED';this.settle(incident);incident.contact={message:'Backend unavailable; no call or message could be confirmed.'};this.emit();this.onEscalate(incident.contact.message,{final:true})}else this.log('Response recorded locally; backend response logging unavailable.')});
  return true;
 }
 dismiss(){if(this.incident?.status==='CONTACTING')return;this.clearTimer(this.pollTimer);this.clearTimer(this.registrationTimer);this.clearTimer(this.settleTimer);this.incident=null;this.emit()}
 destroy(){this.closed=true;this.clearTimer(this.timer);this.clearTimer(this.pollTimer);this.clearTimer(this.registrationTimer);this.clearTimer(this.settleTimer)}
}
