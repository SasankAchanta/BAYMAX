import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ActivityTracker,LABELS} from './activity';
import {loadModels,detectFrame,drawOverlay} from './vision';
import './style.css';
const empty={scores:LABELS.map(label=>({label,score:0})),summary:'Starting the camera. Allow camera access in your browser.',lyingSeconds:0,review:false};
function App(){
 const video=useRef(),overlay=useRef(),stream=useRef(),models=useRef(),tracker=useRef(new ActivityTracker()),generation=useRef(0),sourceUrl=useRef(),mounted=useRef(true);
 const [result,setResult]=useState(empty),[status,setStatus]=useState('Starting…'),[error,setError]=useState(''),[running,setRunning]=useState(false),[ready,setReady]=useState(false),[cameraName,setCameraName]=useState('Webcam'),[frames,setFrames]=useState(0),[elapsed,setElapsed]=useState(0),[latency,setLatency]=useState(0),[skeleton,setSkeleton]=useState(true),[cameras,setCameras]=useState([]),[selected,setSelected]=useState('');
 const showSkeleton=useRef(true);useEffect(()=>{showSkeleton.current=skeleton},[skeleton]);
 function stopTracks(){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null}
 function reset(){tracker.current.reset();setResult({...empty,summary:'Waiting for the next frame.'});setFrames(0);setElapsed(0);overlay.current?.getContext('2d').clearRect(0,0,overlay.current.width,overlay.current.height)}
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
   if(document.hidden){tracker.current.reset();timer=setTimeout(tick,300);return}
   if(!v||v.readyState<2||v.paused||v.ended){timer=setTimeout(tick,100);return}
   if(v.currentTime===lastMediaTime){timer=setTimeout(tick,40);return}
   const token=generation.current;const began=performance.now();lastMediaTime=v.currentTime;
   // Uniform scaling keeps camera geometry intact. Video itself stays full rate.
   const scale=Math.min(1,640/v.videoWidth);capture.width=Math.round(v.videoWidth*scale);capture.height=Math.round(v.videoHeight*scale);ctx.drawImage(v,0,0,capture.width,capture.height);
   try{
    const detections=await detectFrame(models.current,capture);
    if(cancelled||token!==generation.current)return;
    const now=v.srcObject?performance.now():v.currentTime*1000;
    const next=tracker.current.update({now,...detections});
    overlay.current.width=capture.width;overlay.current.height=capture.height;
    if(showSkeleton.current)drawOverlay(overlay.current,next);
    setResult(next);setFrames(++count);setElapsed((performance.now()-started)/1000);setLatency(performance.now()-began);setStatus(`YOLO11 · ${models.current.device.toUpperCase()} · local inference`);
   }catch(e){if(!cancelled){tracker.current.reset();setResult({...empty,summary:'Inference failed. No activity classification available.'});setError(`Detection failed: ${e.message||e}`)}}
   if(!cancelled)timer=setTimeout(tick,Math.max(0,100-(performance.now()-began)));
  }
  tick();return()=>{cancelled=true;clearTimeout(timer)};
 },[ready,running,cameraName]);
 const top=result.scores[0];
 return <main><header><h1>BAYMAX <span>/ ACTIVITY MONITOR</span></h1><span className={running?'live':''}>{running?'● CAMERA / VIDEO ON':'○ CAMERA OFF'}</span></header>
 <section className="monitor"><div className="videoWrap"><video ref={video} autoPlay muted playsInline onEnded={()=>{setRunning(false);tracker.current.reset();setResult({...empty,summary:'Video ended. Start the camera or choose another clip.'})}} onError={()=>setError('This video could not be played. Choose a browser-supported MP4 or WebM.')} /><canvas ref={overlay}/>{!running&&<div className="placeholder">{error?'CAMERA UNAVAILABLE':'WAITING FOR CAMERA'}</div>}<div className={'videoLabel '+(result.review?'danger':'')}>{ready&&running?top?.label:'LOADING DETECTOR'}{ready&&running&&<span>{top?.score}%</span>}</div></div>
 <div className="controls"><button onClick={()=>startCamera(selected)}>Start camera</button><button onClick={stop} disabled={!running}>Stop</button>{cameras.length>1&&<select aria-label="Camera" value={selected} onChange={e=>{setSelected(e.target.value);startCamera(e.target.value)}}>{cameras.map(c=><option key={c.deviceId} value={c.deviceId}>{c.label||'Camera'}</option>)}</select>}<label className="fileButton">Test a video<input type="file" accept="video/*" onChange={useClip}/></label><label className="toggle"><input type="checkbox" checked={skeleton} onChange={e=>setSkeleton(e.target.checked)}/> Skeleton</label></div>
 {error&&<p role="alert" className="error">{error}</p>}<p className="summary" aria-live="polite">{result.summary}</p>
 <div className="metrics"><div>TIME<span>{String(Math.floor(elapsed)).padStart(3,'0')} S</span></div><div>FRAMES<span>{String(frames).padStart(4,'0')}</span></div><div>INFERENCE<span>{latency?`${Math.round(latency)} MS`:'—'}</span></div><div>LYING TIMER<span>{result.lyingSeconds.toFixed(1)} / 15 S</span></div></div>
 <div className={'review '+(result.review?'danger':'')} role="status">{result.review?'POSSIBLE FALL · UNDER REVIEW':result.lyingSeconds>0?'LYING / RESTING · OBSERVING':'NO FALL UNDER REVIEW'}<span>{result.review?'Continuous lying exceeds 15 seconds. Check on the person.':'Review requires more than 15 continuous seconds lying down.'}</span></div>
 <div className="ranking">{result.scores.map(({label,score},i)=><div key={label} className={'row '+(i===0?'leading ':'')+(label==='POSSIBLE FALL · REVIEW'&&result.review?'danger':'')}><div className="bar" style={{width:`${score}%`}}/><span>{score.toFixed(1)}%</span><strong>{label}</strong></div>)}</div>
 <div className="bottom"><span>{status}</span><span>{cameraName}</span></div><p className="note">Single-person prototype · Keep your full body in view. Scores measure heuristic evidence, not action probabilities. Holding is inferred from an object near a wrist. Lying still may be resting; sleep cannot be confirmed. Frames stay in this browser. No API key or Python server needed.</p></section></main>
}
createRoot(document.getElementById('root')).render(<App/>);
