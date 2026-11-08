import React,{useEffect,useRef,useState} from 'react';
import {MicrophoneMonitor} from './audioMonitor';
export default function SoundMonitor({paused,speaking,running,onDanger,onLog}){
 const current=useRef();current.current={speaking,onDanger,onLog};
 const [level,setLevel]=useState({status:'off'}),[threshold,setThreshold]=useState(-24),[enabled,setEnabled]=useState(true);
 const monitor=useRef(),lastEpisode=useRef(null),lastUpdate=useRef(0);
 useEffect(()=>{
  const mic=new MicrophoneMonitor({threshold,isSuppressed:()=>current.current.speaking,onLevel:value=>{
   if(value.status!=='active'||performance.now()-lastUpdate.current>150){setLevel(value);lastUpdate.current=performance.now()}
   if(value.danger){const id=mic.detector.events[0]?.time;if(id!==lastEpisode.current){lastEpisode.current=id;current.current.onLog?.({stage:'Stage 1 (Audio)',message:`${value.count} distinct loud spikes / 10s; peak ${value.peak.toFixed(1)} dBFS. Requesting a safety check-in, not a sound diagnosis.`,time:new Date().toISOString()});current.current.onDanger({id:'audio-'+id,action:'REPEATED_LOUD_SOUNDS',summary:`${value.count} loud microphone spikes over ${(value.held_ms/1000).toFixed(1)}s, peak ${value.peak.toFixed(1)} dBFS`})}}
  }});monitor.current=mic;
  if(enabled&&!paused&&running)mic.start();else setLevel({status:'off'});
  return()=>mic.stop();
 },[paused,running,enabled,threshold]);
 const active=level.status==='active';
 return null;
}
