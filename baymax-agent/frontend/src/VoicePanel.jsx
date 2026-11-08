import React,{useEffect,useRef,useState} from 'react';
import BaymaxIcon from './BaymaxIcon';
import {VoiceLoop,dangerState} from './voiceLoop';
import {AnomalyGate} from './temporal';
import {SafetyCheck,SAFETY_OPENINGS,needsHelp} from './safety';
export default function VoicePanel({soundDanger,result,mode,running,inspect,onVoiceChange,onConversationStart,onCareKit,verified,onAgentLog}){
 const current=useRef();current.current={result,mode,inspect,onVoiceChange,onConversationStart,onCareKit,onAgentLog};
 const [voice,setVoice]=useState({state:'IDLE',enabled:false,active:false,message:'Starting hands-free wake listening…'});
 const loop=useRef(),safety=useRef(),gate=useRef(new AnomalyGate()),sourceEpoch=useRef(0),wasRunning=useRef(false);
 const [checkIn,setCheckIn]=useState(null);
 useEffect(()=>{const checks=new SafetyCheck({onChange:setCheckIn,onLog:entry=>current.current.onAgentLog?.(entry),onPrompt:text=>loop.current?.safetyCheckIn(text),onEscalate:(text,options)=>loop.current?.safetyCheckIn(text,!options?.final)});safety.current=checks;const controller=new VoiceLoop({host:window,onTranscript:text=>{const help=needsHelp(text,checks.incident?.status==='AWAITING_RESPONSE'&&!['LIMPING','HOPPING','GUARDING_ARM'].includes(checks.incident?.action));checks.respond(text);return help?'help_requested':false},onChange:state=>{setVoice(state);current.current.onVoiceChange?.(state)},onConversationStart:()=>current.current.onConversationStart?.(),onCareKit:kit=>current.current.onCareKit?.(kit),inspect:(request,signal)=>current.current.inspect(request,signal),getVision:()=>{
  const {result,mode}=current.current;const top=result.scores[0];
  return {mode,action:top?.label||'UNKNOWN',confidence:top?.score||0,danger:dangerState(result),summary:result.summary.slice(0,1500)};
 }});loop.current=controller;controller.enable();return()=>{checks.destroy();controller.destroy()}},[]);
 useEffect(()=>{
  if(!running){if(wasRunning.current)sourceEpoch.current++;wasRunning.current=false;gate.current.reset();return}
  wasRunning.current=true;
  const candidate=gate.current.update(result.monitoring||result,performance.now());
  if(candidate)safety.current?.start({id:'pose-'+sourceEpoch.current+'-'+candidate.id,action:candidate.action,summary:result.summary});
 },[result,running]);
 useEffect(()=>{if(soundDanger)safety.current?.start(soundDanger)},[soundDanger]);
 useEffect(()=>{if(verified?.confirmed)safety.current?.start({id:'verified-'+verified.id,action:verified.pose_action,summary:verified.summary})},[verified]);
 useEffect(()=>{if(voice.enabled&&safety.current?.incident?.status==='AWAITING_RESPONSE')loop.current?.safetyCheckIn(SAFETY_OPENINGS[safety.current.incident.action]||'Are you okay?')},[voice.enabled]);
 useEffect(()=>{
  const editable=e=>e.target?.closest?.('input,textarea,select,[contenteditable=true]');
  const down=e=>{if(e.code==='Space'&&!e.repeat&&!editable(e)&&!e.altKey&&!e.ctrlKey&&!e.metaKey){e.preventDefault();loop.current?.startPushToTalk()}};
  const up=e=>{if(e.code==='Space'&&!editable(e)){e.preventDefault();loop.current?.stopPushToTalk()}};
  const blur=()=>loop.current?.stopPushToTalk();window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);
  return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur)};
 },[]);
 const sending=checkIn?.status==='CONTACTING';
 const light=sending?'sending':!voice.active?'idle':voice.state==='LISTENING'?'listening':voice.state==='THINKING'?'received':'speaking';
 const status=sending?'Sending help request':voice.active?({LISTENING:'Listening to you',THINKING:'Response received',SPEAKING:'Baymax is speaking'}[voice.state]||'Here with you'):'Say “Hey Baymax”';
 const blocked=!voice.enabled;
 return <div className="voiceBeacon" aria-label="Baymax voice assistant">
  <BaymaxIcon speaking={voice.state==='SPEAKING'} light={light}/>
  <span className="beaconStatus" role="status" aria-live="polite">{status}</span>
  {blocked&&<button className="voicePermission" onClick={()=>loop.current?.enable()}>Enable microphone</button>}
  <span className="srOnly" aria-live="polite">{checkIn?.contact?.message||voice.message}</span>
 </div>;
}
