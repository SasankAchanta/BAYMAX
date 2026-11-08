import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ActivityTracker,LABELS} from './activity';
import {FocusTracker} from './focus';
import {BehaviorTracker} from './behavior';
import {loadModels,detectFrame,drawOverlay} from './vision';
import './style.css';
import './dashboard.css';
import VoicePanel from './VoicePanel';
import SoundMonitor from './SoundMonitor';
import CareDatabase from './CareDatabase';
import BaymaxIcon from './BaymaxIcon';
import {VerificationPipeline,verifyPose} from './verification';
const empty={scores:LABELS.map(label=>({label,score:0})),summary:'Starting the camera. Allow camera access in your browser.',lyingSeconds:0,review:false};
function App(){
 const voiceControl=useRef();
 const video=useRef(),overlay=useRef(),stream=useRef(),models=useRef(),tracker=useRef(new ActivityTracker()),generation=useRef(0),sourceUrl=useRef(),mounted=useRef(true);
 const [result,setResult]=useState(empty),[status,setStatus]=useState('Starting…'),[error,setError]=useState(''),[running,setRunning]=useState(false),[ready,setReady]=useState(false),[cameraName,setCameraName]=useState('Webcam'),[frames,setFrames]=useState(0),[elapsed,setElapsed]=useState(0),[latency,setLatency]=useState(0),[skeleton,setSkeleton]=useState(true),[cameras,setCameras]=useState([]),[selected,setSelected]=useState('');
 const [careKit,setCareKit]=useState({items:[]}),[soundDanger,setSoundDanger]=useState(null);
 const [voice,setVoice]=useState({state:'IDLE',active:false,enabled:false});
 const speaking=voice.state==='SPEAKING';
 const [mode,setMode]=useState('upper'),[view,setView]=useState('monitor');
 const behavior=useRef(new BehaviorTracker()),latest=useRef(empty),pipeline=useRef();
 const [verified,setVerified]=useState(null),[agentLogs,setAgentLogs]=useState([]);
 const recordEvent=entry=>{console.info(`[BAYMAX ${entry.stage}] ${entry.message}`);setAgentLogs(old=>[...old,entry].slice(-12))};
 const focus=useRef(new FocusTracker());
 const modeName={body:'Full Body',upper:'Upper Body'}[mode];
 async function inspectForVoice(request,signal){
  if(!['body','upper','arms','face'].includes(request.mode))throw new Error('Invalid inspection mode.');
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  const v=video.current;
  if(!v?.srcObject||v.readyState<2||!stream.current?.active)throw new Error('A live webcam is required for a visual checkup. Start the camera and try again.');
  changeMode(request.mode==='body'?'body':'upper');
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  const canvas=document.createElement('canvas'),scale=Math.min(1,960/v.videoWidth);canvas.width=Math.round(v.videoWidth*scale);canvas.height=Math.round(v.videoHeight*scale);canvas.getContext('2d').drawImage(v,0,0,canvas.width,canvas.height);
  return {mode:request.mode,image:canvas.toDataURL('image/jpeg',.8).split(',')[1]};
 }
 function changeMode(next){if(next===mode)return;generation.current++;focus.current.reset();pipeline.current?.cancel('Focus mode changed');setError('');setMode(next)}
 const detectorReady=ready;
 const showSkeleton=useRef(true);useEffect(()=>{showSkeleton.current=skeleton},[skeleton]);
 useEffect(()=>{
  const verifier=new VerificationPipeline({verify:verifyPose,onLog:recordEvent,onConfirmed:setVerified,capture:(candidate,signal)=>{
   const v=video.current;if(signal.aborted)throw new DOMException('Cancelled','AbortError');
   if(!v?.srcObject||!stream.current?.active||v.readyState<2)throw new Error('Live webcam required for verification');
   const frame=document.createElement('canvas'),scale=Math.min(1,960/v.videoWidth);frame.width=Math.round(v.videoWidth*scale);frame.height=Math.round(v.videoHeight*scale);frame.getContext('2d').drawImage(v,0,0,frame.width,frame.height);
   const local=latest.current.monitoring||latest.current;
   return {image:frame.toDataURL('image/jpeg',.8).split(',')[1],drop_velocity:Math.min(100,local.temporal?.drop_velocity||0),horizontal_ms:Math.min(3600000,local.temporal?.horizontal_ms||0),pose_summary:local.summary.slice(0,1200)};
  }});pipeline.current=verifier;
  const visibility=()=>{if(document.hidden)verifier.cancel('Tab suspended')};document.addEventListener('visibilitychange',visibility);
  return()=>{verifier.cancel('Monitor closed');document.removeEventListener('visibilitychange',visibility)};
 },[]);
 useEffect(()=>{latest.current=result;if(running)pipeline.current?.observe(result.monitoring||result,performance.now());else pipeline.current?.cancel('Camera stopped')},[result,running]);
 function stopTracks(){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null}
 function reset(){pipeline.current?.cancel('Camera source reset');tracker.current.reset();focus.current.reset();behavior.current.reset();setResult({...empty,summary:'Waiting for the next frame.'});setFrames(0);setElapsed(0);overlay.current?.getContext('2d').clearRect(0,0,overlay.current.width,overlay.current.height)}
 async function startCamera(deviceId=''){
  const token=++generation.current;stopTracks();setRunning(false);setError('');reset();
  try{
   const media=await navigator.mediaDevices.getUserMedia({video:{...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:'user'}),width:{ideal:960},height:{ideal:540}},audio:false});
   if(!mounted.current||token!==generation.current){media.getTracks().forEach(t=>t.stop());return}
   stream.current=media;video.current.pause();video.current.removeAttribute('src');video.current.srcObject=media;video.current.loop=false;
   if(sourceUrl.current){URL.revokeObjectURL(sourceUrl.current);sourceUrl.current=null}
   await video.current.play();setRunning(true);setCameraName(media.getVideoTracks()[0].label||'Webcam');
   const devices=await navigator.mediaDevices.enumerateDevices();setCameras(devices.filter(d=>d.kind==='videoinput'));setSelected(media.getVideoTracks()[0].getSettings().deviceId||'');
  }catch(e){if(token===generation.current)setError(e.name==='NotAllowedError'?'Camera permission denied. Allow camera access beside the address bar, then click Start camera.':e.name==='NotReadableError'?'Camera is busy. Close other camera apps, then click Start camera.':`Camera could not start: ${e.message}`)}
 }
 function stop(){++generation.current;stopTracks();video.current?.pause();if(video.current)video.current.srcObject=null;setRunning(false);reset();setStatus('Camera stopped')}
 async function useClip(event){const file=event.target.files?.[0];if(!file)return;generation.current++;stopTracks();reset();setError('');setRunning(false);video.current.srcObject=null;if(sourceUrl.current)URL.revokeObjectURL(sourceUrl.current);sourceUrl.current=URL.createObjectURL(file);video.current.src=sourceUrl.current;video.current.loop=false;setCameraName(file.name);try{await video.current.play();setRunning(true)}catch(e){setError(e.message)}event.target.value=''}
 useEffect(()=>{mounted.current=true;startCamera();loadModels(s=>{if(mounted.current)setStatus(s)}).then(m=>{models.current=m;if(mounted.current){setReady(true);setStatus(`YOLO11 · ${m.device.toUpperCase()} · local inference`)}}).catch(e=>{if(mounted.current){setStatus('Model loading failed');setError(`YOLO could not load: ${e.message||e}. Camera preview stays available. Reload to retry.`)}});return()=>{mounted.current=false;generation.current++;stopTracks();if(sourceUrl.current)URL.revokeObjectURL(sourceUrl.current)}},[]);
 useEffect(()=>{
  if(!ready||!running)return;
  let cancelled=false,timer;const capture=document.createElement('canvas');const ctx=capture.getContext('2d',{willReadFrequently:true});const started=performance.now();let count=0,lastMediaTime=-1;
  async function tick(){
   if(cancelled)return;
   const v=video.current;
   if(document.hidden){tracker.current.reset();focus.current.reset();behavior.current.reset();timer=setTimeout(tick,300);return}
   if(!v||v.readyState<2||v.paused||v.ended){timer=setTimeout(tick,100);return}
   if(v.currentTime===lastMediaTime){timer=setTimeout(tick,40);return}
   const token=generation.current;const began=performance.now();lastMediaTime=v.currentTime;
   // Uniform scaling keeps camera geometry intact. Video itself stays full rate.
   const scale=Math.min(1,640/v.videoWidth);capture.width=Math.round(v.videoWidth*scale);capture.height=Math.round(v.videoHeight*scale);ctx.drawImage(v,0,0,capture.width,capture.height);
   const now=v.srcObject?performance.now():v.currentTime*1000;
   try{
    let next;
    const detections=models.current?await detectFrame(models.current,capture):{person:null,points:null,objects:[]};
    if(cancelled||token!==generation.current)return;
    const raw={now,...detections,frameHeight:capture.height};
    const base=tracker.current.update(raw),body=focus.current.update(raw,'body',base);
    next=behavior.current.update(raw,mode,body);
    overlay.current.width=capture.width;overlay.current.height=capture.height;
    if(showSkeleton.current)drawOverlay(overlay.current,next,mode==='upper'?'upper':'body');
    setResult(next);setFrames(++count);setElapsed((performance.now()-started)/1000);setLatency(performance.now()-began);setStatus(`YOLO11 · ${models.current.device.toUpperCase()} · local inference`);
   }catch(e){if(!cancelled){tracker.current.reset();focus.current.reset();behavior.current.reset();setResult({...empty,summary:'Inference failed. No activity classification available.'});setError(`Detection failed: ${e.message||e}`)}}
   if(!cancelled)timer=setTimeout(tick,0);
  }
  tick();return()=>{cancelled=true;clearTimeout(timer)};
 },[ready,running,cameraName,mode]);
 const top=result.scores[0];
 const behaviorReady=running&&detectorReady&&top?.score>0;
 const behaviorLabel=!running?'Camera paused':!detectorReady?'Loading detector':top?.score>0?top.label.replaceAll('_',' ').toLowerCase():'Observing';
 const currentCandidate=result.behaviorCandidates?.find(c=>c.label===top?.label);
 const behaviorAlert=behaviorReady&&(top?.label!=='LYING_DOWN'||result.review)&&(!currentCandidate||currentCandidate.issue)&&['SUDDEN_FALL','CLENCHING_STOMACH','HOLDING_CHEST','COUGHING','SNEEZING','LYING_DOWN','LIMPING','HOPPING','SITTING_HEAD_DOWN'].includes(top.label);

 return <main className="appShell monitorOnly">
 <div className="ambientGlow" aria-hidden="true"/>
 <div className="pageViewport" data-view={view}><section className={"cameraView slidePage "+(view==='monitor'?'current':'')} inert={view!=='monitor'} aria-hidden={view!=='monitor'} aria-label="Camera / Activity Monitor">
  <header className="cameraHeader"><div><span className="eyebrow">BAYMAX / YOUR SPACE</span><h1>Camera & activity<span className={running?'live':''}>{running?'● CAMERA / VIDEO ON':'○ CAMERA OFF'}</span></h1></div><div className="monitorNavigation"><button className="databaseArrow" onClick={()=>setView('database')} aria-label="Open Care Kit database" title="Open Care Kit database">Database →</button><VoicePanel controlRef={voiceControl} soundDanger={soundDanger} result={result} mode={mode} running={running} inspect={inspectForVoice} onVoiceChange={setVoice} onCareKit={setCareKit} verified={verified} onAgentLog={recordEvent}/></div></header>
  <section className="monitor">
   <div className="cameraCard"><div className="cameraCardTitle"><h2>Live monitor</h2><span>Focus on what matters</span></div>
    <div className="focusModes" role="group" aria-label="Focus mode">{[['upper','Upper Body'],['body','Full Body']].map(([key,name])=><button key={key} aria-pressed={mode===key} onClick={()=>changeMode(key)}>{name}</button>)}</div>
    <div className="modeStatus">ACTIVE MODE: {modeName}</div>
    <div className="videoWrap"><video ref={video} autoPlay muted playsInline onEnded={()=>{setRunning(false);tracker.current.reset();setResult({...empty,summary:'Video ended. Start the camera or choose another clip.'})}} onError={()=>setError('This video could not be played. Choose a browser-supported MP4 or WebM.')} /><canvas ref={overlay}/>{!running&&<div className="placeholder">{error?'CAMERA UNAVAILABLE':'WAITING FOR CAMERA'}</div>}<div className={'videoLabel '+(result.review?'danger':'')}>{modeName.toUpperCase()} / {detectorReady&&running?top?.label:'LOADING DETECTOR'}{detectorReady&&running&&<span>{top?.score}%</span>}</div></div>
    <div className="controls"><button onClick={()=>startCamera(selected)}>Start camera</button><button onClick={stop} disabled={!running}>Stop</button>{cameras.length>1&&<select aria-label="Camera" value={selected} onChange={e=>{setSelected(e.target.value);startCamera(e.target.value)}}>{cameras.map(c=><option key={c.deviceId} value={c.deviceId}>{c.label||'Camera'}</option>)}</select>}<label className="fileButton">Test a video<input type="file" accept="video/*" onChange={useClip}/></label><label className="toggle"><input type="checkbox" checked={skeleton} onChange={e=>setSkeleton(e.target.checked)}/> Skeleton</label></div>
    {error&&<p role="alert" className="error">{error}</p>}

   </div>
   <section className={'behaviorCard '+(behaviorAlert?'behaviorAlert':'')} aria-label="Current behavior">
    <div className="cameraCardTitle"><h2>Behavior & status</h2><span>{modeName}</span></div>
    <div className="behaviorPrimary" role="status" aria-live="polite" aria-atomic="true">
     <h3>{behaviorLabel}</h3>{currentCandidate&&!currentCandidate.issue&&<p className="observingBehavior">Observing · not an issue yet</p>}
     {behaviorReady&&<div className="behaviorConfidence"><strong>{Math.round(top.score)}<span>%</span></strong><span>Detection confidence</span></div>}
    </div>
    {behaviorReady&&<div className="behaviorMeter" aria-hidden="true"><span style={{width:`${top.score}%`}}/></div>}
    <p className="behaviorDescription">{!running?'Start the camera to see live activity.':result.summary}</p>
    
    {<div className="behaviorProgress" aria-label="Upper body behavior tracking">{['CLENCHING_STOMACH','HOLDING_CHEST','COUGHING','SNEEZING'].map(label=>{const candidate=result.behaviorCandidates?.find(c=>c.label===label);return <div key={label} className={candidate?'observed':''}><span>{label.replaceAll('_',' ').toLowerCase()}</span><strong>{candidate?`${(candidate.held_ms/1000).toFixed(1)}s / >2s`:'—'}</strong><small>{candidate?(candidate.issue?'Awaiting visual verification':'Observing · not an issue yet'):'Not observed'}</small></div>})}</div>}
   </section>
   <aside className="activityCard"><div className="cameraCardTitle"><h2>Activity insights</h2><span className="liveDot"/></div><p className="summary" aria-live="polite">{result.summary}</p>
    <div className="metrics"><div>INFERENCE<span>{latency?`${Math.round(latency)} MS`:'—'}</span></div><div>LYING TIMER<span>{result.lyingSeconds.toFixed(1)} / 15 S</span></div></div>
    {<div className={'review '+(result.review?'danger':'')} role="status">{result.review?'PROLONGED LYING · AWAITING VERIFICATION':result.lyingSeconds>0?'LYING DOWN · OBSERVING':'LOCAL MONITORING ACTIVE'}<span>{result.review?'Check-in requested; Stage 2 verifies the visual evidence in parallel.':'Watching posture and movement.'}</span></div>}
    <div className="ranking">{result.scores.filter(s=>s.score>0).slice(0,3).map(({label,score},i)=><div key={label} className={'row '+(i===0?'leading ':'')+(score>0&&(label==='FALL_DETECTED'||label==='LYING_TOO_LONG')?'danger':'')}><div className="bar" style={{width:`${score}%`}}/><span>{score.toFixed(1)}%</span><strong>{label}</strong></div>)}</div>
    <div className="bottom sensorBar"><span>{status}</span><span>{cameraName}</span></div>
   </aside>
  </section>
 </section>
 <CareDatabase active={view==='database'} logs={agentLogs} revision={careKit} speaking={speaking} onBack={()=>setView('monitor')}/></div>
 <SoundMonitor paused={!voice.enabled} speaking={speaking} running={running} onDanger={setSoundDanger} onLog={recordEvent}/>
 <footer className="adminFooter"><span>ADMIN</span><button onClick={()=>voice.enabled?voiceControl.current?.disable():voiceControl.current?.enable()}>{voice.enabled?'Stop listening':'Resume listening'}</button></footer>
 </main>;

}
createRoot(document.getElementById('root')).render(<App/>);

