export const CHECK_IN="Hey, are you okay? I noticed you've been down for a bit.";
export function dangerState(result){return !!result?.review||(result?.scores||[]).some(s=>['FALL_DETECTED','LYING_TOO_LONG','SITTING_HEAD_DOWN','POSSIBLE FALL · REVIEW'].includes(s.label)&&s.score>0)}
export class VoiceLoop {
 constructor({host=globalThis,onChange=()=>{},getVision=()=>({}),inspect=async()=>{throw new Error("Camera capture is unavailable.")},requestTurn}={}){
  this.inspect=inspect;this.host=host;this.onChange=onChange;this.getVision=getVision;
  this.requestTurn=requestTurn||((body,signal)=>this.fetchTurn(body,signal));
  this.enabled=false;this.active=false;this.state='IDLE';this.history=[];this.epoch=0;this.dangerLatched=false;this.clearSince=null;
 }
 supported(){return !!(this.host.speechSynthesis&&this.host.SpeechSynthesisUtterance&&(this.host.SpeechRecognition||this.host.webkitSpeechRecognition))}
 report(message=''){this.message=message;this.onChange({state:this.state,enabled:this.enabled,active:this.active,message,supported:this.supported()})}
 setState(state,message=''){this.state=state;this.report(message)}
 enable(){if(!this.supported()){this.report('Voice requires a browser with speech synthesis and SpeechRecognition, such as Chrome or Edge.');return}this.enabled=true;this.report('Listening for Hey Baymax.');this.scheduleWake()}
 disable(){this.enabled=false;this.end('Voice paused. Microphone and speaker are off.');}
 scheduleWake(){clearTimeout(this.retry);if(this.enabled&&!this.active)this.retry=setTimeout(()=>this.wake(),600)}
 wake(){
  if(!this.enabled||this.active||this.host.speechSynthesis.speaking)return;
  this.stopRecognition();const epoch=this.epoch;
  const Recognition=this.host.SpeechRecognition||this.host.webkitSpeechRecognition;
  const r=new Recognition();this.recognition=r;r.lang='en-US';r.continuous=true;r.interimResults=true;
  this.setState('IDLE','Listening for Hey Baymax.');
  r.onresult=e=>{if(epoch!==this.epoch||this.active||!this.enabled)return;const text=Array.from(e.results).slice(e.resultIndex||0).map(x=>x[0].transcript).join(' ');if(/\b(?:hey\s+)?bay\s*max\b/i.test(text))this.start('Hello, I am Baymax. How can I help?')};
  r.onend=()=>{if(epoch===this.epoch&&!this.active&&this.enabled){this.recognition=null;this.scheduleWake()}};
  r.onerror=e=>{if(epoch!==this.epoch)return;if(e.error==='no-speech'||e.error==='aborted')return;this.enabled=false;this.end('Wake listening unavailable. Allow microphone access, then use Resume Voice. ('+e.error+')')};
  try{r.start()}catch{this.enabled=false;this.end('Browser blocked automatic listening. Use Resume Voice to authorize microphone access.')}
 }
 observe(danger,now=Date.now()){
  if(!danger){this.clearSince??=now;if(now-this.clearSince>=5000)this.dangerLatched=false;return}
  this.clearSince=null;
  if(this.enabled&&!this.active&&!this.dangerLatched){this.dangerLatched=true;this.start(CHECK_IN)}
 }
 start(opening="Hello, I'm Baymax. How are you feeling?"){
  if(!this.enabled||this.active||!this.supported())return;
  this.active=true;this.history=[];this.epoch++;this.speak(opening);
 }
 stopRecognition(){
  clearTimeout(this.retry);this.retry=null;
  if(this.recognition){const r=this.recognition;this.recognition=null;r.onresult=r.onend=r.onerror=r.onstart=null;try{r.abort()}catch{}}
 }
 end(message='Conversation ended.'){
  this.epoch++;this.active=false;clearTimeout(this.deadline);this.abort?.abort();this.abort=null;
  this.stopRecognition();
  if(this.utterance){this.utterance.onend=this.utterance.onerror=null;this.utterance=null}
  this.host.speechSynthesis?.cancel();this.history=[];this.setState('IDLE',message);this.scheduleWake();
 }
 speak(text,closeAfter=false){
  if(!this.active)return;
  this.stopRecognition();this.host.speechSynthesis.cancel();
  const epoch=this.epoch,u=new this.host.SpeechSynthesisUtterance(text);
  this.utterance=u;u.lang='en-US';u.rate=.95;
  const voices=this.host.speechSynthesis.getVoices?.()||[];
  u.voice=voices.find(v=>v.lang==='en-US'&&/guy|david|mark/i.test(v.name))||voices.find(v=>v.lang==='en-US')||null;
  this.history.push({role:'assistant',content:text});this.history=this.history.slice(-12);
  this.setState('SPEAKING');
  u.onend=()=>{if(epoch!==this.epoch||!this.active)return;this.utterance=null;if(closeAfter)this.end('Baymax is here if you need anything else.');else this.listen()};
  u.onerror=()=>{if(epoch===this.epoch&&this.active){this.enabled=false;this.end('Browser blocked speech playback. Use Resume Voice to enable it.');}};
  this.host.speechSynthesis.speak(u);
 }
 listen(){
  if(!this.active||!this.enabled||this.host.speechSynthesis.speaking)return;
  this.stopRecognition();const epoch=this.epoch;
  const Recognition=this.host.SpeechRecognition||this.host.webkitSpeechRecognition;
  const r=new Recognition();this.recognition=r;r.lang='en-US';r.continuous=false;r.interimResults=false;
  this.setState('LISTENING');
  r.onresult=e=>{if(epoch!==this.epoch||!this.active||this.state!=='LISTENING')return;const transcript=Array.from(e.results).filter(x=>x.isFinal!==false).map(x=>x[0].transcript).join(' ').trim();if(transcript)this.turn(transcript)};
  r.onerror=e=>{if(epoch!==this.epoch||!this.active)return;if(e.error==='no-speech')return;if(e.error==='aborted')return;this.enabled=false;this.end(e.error==='not-allowed'||e.error==='service-not-allowed'?'Microphone or speech recognition permission denied. Allow microphone access and retry.':`Speech recognition failed (${e.error}). Say Hey Baymax to retry.`)};
  r.onend=()=>{if(epoch!==this.epoch||!this.active||this.state!=='LISTENING')return;this.recognition=null;this.retry=setTimeout(()=>this.listen(),600)};
  try{r.start()}catch{this.enabled=false;this.end('Microphone could not start. Check browser permission and retry.')}
 }
 async fetchTurn(body,signal){
  const response=await this.host.fetch('/api/voice-turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  if(!response.ok){let detail='Voice backend unavailable. Start the FastAPI voice server and check NVIDIA settings.';try{const data=await response.json();if(typeof data.detail==='string')detail=data.detail}catch{}throw new Error(detail)}
  const result=await response.json();if(typeof result.text!=='string'||!result.text.trim()||typeof result.end_conversation!=='boolean')throw new Error('Voice backend returned an invalid response.');return result;
 }
 async turn(transcript){
  this.stopRecognition();this.setState('THINKING');const epoch=this.epoch;
  const body={transcript:transcript.slice(0,2000),vision:this.getVision(),history:this.history.slice(-12)};
  this.history.push({role:'user',content:body.transcript});this.history=this.history.slice(-12);
  const abort=new AbortController();this.abort=abort;
  this.deadline=setTimeout(()=>abort.abort(),65000);
  try{
   let reply=await this.requestTurn(body,abort.signal);
   if(reply.inspection_request){
    if(epoch!==this.epoch||!this.active)return;
    this.report('Switching focus and inspecting the current camera frame…');
    const inspection=await this.inspect(reply.inspection_request,abort.signal);
    if(epoch!==this.epoch||!this.active)return;
    reply=await this.requestTurn({...body,vision:this.getVision(),inspection},abort.signal);
    if(reply.inspection_request)throw new Error('Repeated inspection request rejected. Please describe what you see.');
   }
   if(epoch!==this.epoch||!this.active)return;
   clearTimeout(this.deadline);this.speak(reply.text,reply.end_conversation);
  }catch(e){if(epoch===this.epoch&&this.active)this.end(e.name==='AbortError'?'Voice request timed out. Say Hey Baymax to retry.':e.message||'Voice request failed.')}
  finally{if(epoch===this.epoch){clearTimeout(this.deadline);this.abort=null}}
 }
 destroy(){this.enabled=false;this.end();this.onChange=()=>{}}
}
