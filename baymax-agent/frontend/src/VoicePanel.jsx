import React,{useEffect,useRef,useState} from 'react';
import {VoiceLoop,dangerState} from './voiceLoop';
export default function VoicePanel({result,mode,running,inspect}){
 const current=useRef();current.current={result,mode,inspect};
 const [voice,setVoice]=useState({state:'IDLE',enabled:false,active:false,message:'Starting hands-free wake listening…'});
 const loop=useRef();
 useEffect(()=>{const controller=new VoiceLoop({host:window,onChange:setVoice,inspect:(request,signal)=>current.current.inspect(request,signal),getVision:()=>{
  const {result,mode}=current.current;const top=result.scores[0];
  return {mode,action:top?.label||'UNKNOWN',confidence:top?.score||0,danger:dangerState(result),summary:result.summary.slice(0,1500)};
 }});loop.current=controller;controller.enable();return()=>controller.destroy()},[]);
 useEffect(()=>{loop.current?.observe(running&&dangerState(result))},[result,running,voice.enabled]);
 return <section className="voicePanel" aria-label="Baymax voice assistant"><div className="voiceHeading"><strong>BAYMAX VOICE</strong><span className={'voiceStatus '+voice.state.toLowerCase()} role="status">● {voice.state}</span></div><p className="voiceMessage" aria-live="polite">{voice.message||({SPEAKING:'Baymax is speaking. Microphone paused.',LISTENING:'Listening to your response…',THINKING:'Baymax is thinking…',IDLE:'Ready for a check-in.'}[voice.state])}</p><div className="voiceButtons"><button onClick={()=>voice.enabled?loop.current.disable():loop.current.enable()}>{voice.enabled?'Pause / Mute Voice':'Resume Voice'}</button><button disabled={!voice.active} onClick={()=>loop.current.end()}>End Conversation</button></div><small>Voice uses your browser’s speech services. Transcripts and recent turns go to the local voice API and NVIDIA. Requested camera frames go to NVIDIA for checkups. Decisions are saved locally to baymax_decisions.txt; audio and images are not saved.</small></section>
}
