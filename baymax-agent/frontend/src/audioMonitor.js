// Relative digital level, not calibrated sound-pressure dB. No microphone samples leave this module.
export class LoudnessDetector {
 constructor({threshold=-24,spikes=3,windowMs=10000}={}){Object.assign(this,{threshold,spikes,windowMs});this.reset()}
 reset(){this.events=[];this.above=false;this.lowSince=null;this.lastSpike=-Infinity;this.baseline=-65;this.started=null;this.last=null}
 update(samples,now,{suppressed=false}={}){
  if(this.last!==null&&(now<this.last||now-this.last>1500))this.reset();this.last=now;this.started??=now;
  let sum=0;for(const sample of samples)sum+=sample*sample;
  const db=Math.max(-100,Math.min(0,20*Math.log10(Math.max(1e-5,Math.sqrt(sum/Math.max(1,samples.length))))));
  this.events=this.events.filter(e=>now-e.time<=this.windowMs);
  if(suppressed){this.events=[];this.above=true;this.lowSince=null;return {db,threshold:this.threshold,count:0,danger:false,suppressed:true,calibrating:false}}
  const calibrating=now-this.started<2000;
  if(calibrating)this.baseline=Math.min(-15,this.baseline*.85+db*.15);
  const threshold=Math.min(-3,Math.max(this.threshold,this.baseline+12));
  if(db>threshold){
   this.lowSince=null;
   if(!this.above&&now-this.lastSpike>=350&&!calibrating){this.events.push({time:now,db});this.lastSpike=now}
   this.above=true;
  }else{
   this.lowSince??=now;if(now-this.lowSince>=200)this.above=false;
   if(!calibrating)this.baseline=this.baseline*.99+db*.01;
  }
  const span=this.events.length?now-this.events[0].time:0;
  return {db,threshold,count:this.events.length,peak:this.events.length?Math.max(...this.events.map(e=>e.db)):db,danger:this.events.length>=this.spikes&&span>2000,held_ms:span,calibrating,suppressed:false};
 }
}
export class MicrophoneMonitor {
 constructor({host=globalThis,onLevel=()=>{},isSuppressed=()=>false,threshold=-24}={}){Object.assign(this,{host,onLevel,isSuppressed});this.detector=new LoudnessDetector({threshold});this.token=0}
 async start(){
  this.stop();const token=this.token;
  try{
   const media=await this.host.navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:false,autoGainControl:false},video:false});
   if(token!==this.token){media.getTracks().forEach(t=>t.stop());return}
   this.media=media;const AudioContext=this.host.AudioContext||this.host.webkitAudioContext;
   this.context=new AudioContext();this.source=this.context.createMediaStreamSource(media);this.analyser=this.context.createAnalyser();this.analyser.fftSize=2048;this.source.connect(this.analyser);
   await this.context.resume();if(token!==this.token)return;
   const samples=new Float32Array(this.analyser.fftSize);
   this.timer=setInterval(()=>{
    if(this.context.state!=='running'){this.onLevel({status:'paused',message:'Click Enable sound monitoring to activate microphone analysis.'});return}
    this.analyser.getFloatTimeDomainData(samples);const suppressed=this.isSuppressed();
    this.onLevel({status:'active',...this.detector.update(samples,performance.now(),{suppressed})});
   },50);
  }catch(error){if(token===this.token){this.stop();this.onLevel({status:'error',message:'Sound monitoring unavailable. Allow microphone access and click Enable sound monitoring.'})}}
 }
 stop(){this.token++;clearInterval(this.timer);this.timer=null;this.source?.disconnect();this.source=null;this.media?.getTracks().forEach(t=>t.stop());this.media=null;this.context?.close().catch(()=>{});this.context=null;this.detector.reset()}
}
