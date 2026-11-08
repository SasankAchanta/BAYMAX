import test from 'node:test';
import assert from 'node:assert/strict';
import {SafetyCheck} from '../src/safety.js';
function setup(request){let now=100000,prompts=[],escalations=[],logs=[];const check=new SafetyCheck({clock:()=>now,setTimer:()=>1,clearTimer:()=>{},request:request|| (async()=>({deadline_ms:now+60000})),onPrompt:t=>prompts.push(t),onEscalate:t=>escalations.push(t),onLog:l=>logs.push(l)});return {check,prompts,escalations,logs,advance:ms=>{now+=ms;check.tick()}}}
test('local danger prompts immediately without VLM and repetition cannot extend 60-second deadline',async()=>{
 const x=setup();assert.equal(x.check.start({id:1,action:'HOLDING_CHEST'}),true);assert.match(x.prompts[0],/Are you okay/);await new Promise(r=>setImmediate(r));
 x.advance(30000);assert.equal(x.check.start({id:2,action:'HOLDING_CHEST'}),false);x.advance(29999);assert.equal(x.escalations.length,0);x.advance(1);assert.equal(x.check.incident.status,'ESCALATED_DEMO');assert.equal(x.escalations.length,1);assert.match(x.escalations[0],/no authorities have been contacted/);x.check.destroy();
});
test('irrelevant noise leaves deadline active; relevant symptoms or explicit acknowledgement cancel it',async()=>{
 for(const answer of ["I'm okay",'I have chest pain']){const x=setup();x.check.start({id:1,action:'CLENCHING_STOMACH'});await new Promise(r=>setImmediate(r));assert.equal(x.check.respond('random background chatter'),false);assert.equal(x.check.incident.status,'AWAITING_RESPONSE');assert.equal(x.check.respond(answer),true);x.advance(60000);assert.equal(x.escalations.length,0);assert.equal(x.check.incident.status,'RESPONDED');x.check.destroy()}
});
test('late VLM confirmation cannot restart a just-answered same-action check-in',()=>{
 const x=setup();x.check.start({id:'pose-1',action:'HOLDING_CHEST'});x.check.respond("I'm okay");assert.equal(x.check.start({id:'verified-9',action:'HOLDING_CHEST'}),false);assert.equal(x.prompts.length,1);x.check.destroy();
});
test('local demo deadline remains active if the API is unavailable; late response cannot erase escalation',async()=>{
 const x=setup(async()=>{throw new Error('offline')});x.check.start({id:1,action:'REPEATED_LOUD_SOUNDS'});await new Promise(r=>setImmediate(r));assert.equal(x.check.incident.logError,true);x.advance(60000);assert.equal(x.check.respond("I'm okay"),false);assert.equal(x.check.incident.status,'ESCALATED_DEMO');x.check.destroy();
});

test('explicit help requests escalate immediately rather than merely cancelling the timer',async()=>{
 for(const phrase of ["I'm not okay and I need help",'help me','no']){
  const requests=[];const x=setup(async(path,body)=>{requests.push({path,body});return path?{status:'CONTACTING'}:{deadline_ms:160000,mode:'sms'}});
  x.check.start({id:1,action:'HOLDING_CHEST'});await new Promise(r=>setImmediate(r));
  assert.equal(x.check.respond(phrase),true);await new Promise(r=>setImmediate(r));
  assert.equal(x.check.incident.status,'CONTACTING');assert.equal(x.escalations.length,1);assert.ok(requests.some(r=>r.body?.response===phrase));x.check.destroy();
 }
});
test('declining help and answering no to an injury question do not contact anyone',async()=>{
 for(const [action,phrase] of [['HOLDING_CHEST',"I don't need help"],['HOLDING_CHEST','Do not call anyone'],['LIMPING','no']]){const x=setup();x.check.start({id:1,action});await new Promise(r=>setImmediate(r));x.check.respond(phrase);assert.equal(x.check.incident.status,'RESPONDED');assert.equal(x.escalations.length,0);x.check.destroy()}
});

test('no outside an unanswered safety question is not treated as a request to call',()=>{
 const x=setup();assert.equal(x.check.respond('no'),false);assert.equal(x.check.incident,null);x.check.destroy();
});


test('completed SMS clears automatically and cannot block the next incident',async()=>{
 let now=100000;const timers=[];
 const check=new SafetyCheck({clock:()=>now,setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimer:()=>{},request:async()=>({deadline_ms:now+60000})});
 check.start({id:'first',action:'HOLDING_CHEST'});await new Promise(r=>setImmediate(r));
 const first=check.incident;
 check.applyContact({status:'CONTACT_ACCEPTED',contact:{status:'accepted',message:'Accepted'}},first);
 assert.ok(timers.some(t=>t.ms===8000));
 assert.equal(check.start({id:'second',action:'CLENCHING_STOMACH'}),true);
 timers.find(t=>t.ms===8000).fn();assert.equal(check.incident.action,'CLENCHING_STOMACH');
 check.respond("I'm okay");timers.filter(t=>t.ms===8000).at(-1).fn();assert.equal(check.incident,null);
 check.destroy();
});
