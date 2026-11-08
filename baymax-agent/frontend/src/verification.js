import {AnomalyGate} from './temporal.js';
const transient=action=>['COUGHING','SNEEZING','SUDDEN_FALL'].includes(action);
export class VerificationPipeline {
 constructor({capture,verify,onLog=()=>{},onConfirmed=()=>{},clock=()=>performance.now()}){Object.assign(this,{capture,verify,onLog,onConfirmed,clock});this.gate=new AnomalyGate();this.handled=new Set();this.lastAttempt=new Map();this.pending=null;this.latest=null;this.token=0}
 log(stage,message){this.onLog({stage,message,time:new Date().toISOString()})}
 cancel(reason='Observation interrupted'){
  this.token++;if(this.pending){this.pending.abort();this.log('Stage 2',reason+'; pending verification cancelled.')}this.pending=null;this.latest=null;this.gate.reset();this.handled.clear();
 }
 observe(result,sampleTime){
  const candidate=this.gate.update(result,sampleTime);this.latest=candidate;this.lastObservation=this.clock();
  if(this.pending&&((!candidate&&!transient(this.pendingAction))||(candidate&&candidate.id!==this.pendingId))){this.pending.abort();this.pending=null;this.token++;this.log('Stage 2','Pose changed before confirmation; discarded pending check.')}
  if(!candidate||this.pending||this.handled.has(candidate.id))return;
  const last=this.lastAttempt.get(candidate.action)??-Infinity;
  if(this.clock()-last<30000)return;
  this.lastAttempt.set(candidate.action,this.clock());this.handled.add(candidate.id);this.pendingId=candidate.id;this.pendingAction=candidate.action;
  const controller=new AbortController();this.pending=controller;const token=++this.token;
  this.log('Stage 1 (Pose)',`${candidate.action}: ${(candidate.held_ms/1000).toFixed(1)}s temporal evidence (${candidate.confidence}% heuristic score).`);
  this.log('Stage 2 (Nemotron VL)','Capturing current webcam frame and requesting verification…');
  const timeout=setTimeout(()=>controller.abort(),30000);
  Promise.resolve().then(()=>this.capture(candidate,controller.signal)).then(frame=>this.verify({...candidate,...frame,held_ms:Math.min(candidate.held_ms,60000)},controller.signal)).then(reply=>{
   if(token!==this.token||controller.signal.aborted||(this.latest?.id!==candidate.id&&!(transient(candidate.action)&&!this.latest))||this.clock()-this.lastObservation>1200)return;
   const confirmed=reply.confirmed&&reply.action===candidate.action.toLowerCase()&&reply.confidence>=75&&reply.is_dangerous===true&&reply.needs_help===true;
   this.log('Stage 2 (Nemotron VL)',`${confirmed?'Confirmed':'Cancelled'} ${reply.action} (${reply.confidence}%): ${reply.summary}`);
   if(confirmed){this.log('Voice','Visual confirmation received; duplicate check-ins are suppressed.');this.onConfirmed({...reply,id:token,pose_action:candidate.action})}
  }).catch(error=>{if(token===this.token){this.log('Stage 2 (Nemotron VL)',controller.signal.aborted?'Visual verification timed out; local check-in remains independent.':`Unavailable: ${error.message}. Local check-in remains independent.`);this.handled.delete(candidate.id);this.lastAttempt.set(candidate.action,this.clock()-15000)}}).finally(()=>{clearTimeout(timeout);if(token===this.token)this.pending=null});
 }
}
export async function verifyPose(payload,signal){
 const {id,...body}=payload;
 const response=await fetch('/api/verify-pose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
 if(!response.ok){let detail='Verification API unavailable';try{const json=await response.json();if(typeof json.detail==='string')detail=json.detail}catch{}throw new Error(detail)}
 const result=await response.json();
 if(typeof result.confirmed!=='boolean'||typeof result.confidence!=='number'||typeof result.summary!=='string')throw new Error('Invalid verification response');
 return result;
}
