export const CHECK_IN="Hey, are you okay? I noticed you've been down for a bit.";
export function dangerState(result){return !!result?.review||(result?.scores||[]).some(s=>['CLENCHING_STOMACH','HOLDING_CHEST','COUGHING','SNEEZING','SUDDEN_FALL','FALL_DETECTED','LYING_TOO_LONG','SITTING_HEAD_DOWN','LIMPING','HOPPING','GUARDING_ARM'].includes(s.label)&&s.score>0)}
export class VoiceLoop {
 constructor({host=globalThis,onChange=()=>{},getVision=()=>({}),inspect=async()=>{throw new Error("Camera capture is unavailable.")},requestTurn,requestAudio,onConversationStart=()=>{},onCareKit=()=>{},onTranscript=()=>{}}={}){
  this.onTranscript=onTranscript;this.onCareKit=onCareKit;this.onConversationStart=onConversationStart;this.requestAudio=requestAudio||(host.Audio&&host.fetch?((text,signal)=>this.fetchAudio(text,signal)):null);this.inspect=inspect;this.host=host;this.onChange=onChange;this.getVision=getVision;
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
  if(!this.enabled||this.active||(this.host.speechSynthesis.speaking||this.audio))return;
  this.stopRecognition();const epoch=this.epoch;
  const Recognition=this.host.SpeechRecognition||this.host.webkitSpeechRecognition;
  const r=new Recognition();this.recognition=r;r.lang='en-US';r.continuous=true;r.interimResults=true;
  this.setState('IDLE','Listening for Hey Baymax.');
  r.onresult=e=>{if(epoch!==this.epoch||this.active||!this.enabled)return;const text=Array.from(e.results).slice(e.resultIndex||0).map(x=>x[0].transcript).join(' ');if(/\b(?:hey\s+)?bay\s*max\b/i.test(text))this.start('Hello, I am Baymax. How can I help?')};
  r.onend=()=>{if(epoch===this.epoch&&!this.active&&this.enabled){this.recognition=null;this.scheduleWake()}};
  r.onerror=e=>{if(epoch!==this.epoch)return;if(e.error==='no-speech'||e.error==='aborted')return;this.enabled=false;this.end('Wake listening unavailable. Allow microphone access, then use Resume Voice. ('+e.error+')')};
  try{r.start()}catch{this.enabled=false;this.end('Browser blocked automatic listening. Use Resume Voice to authorize microphone access.')}
 }
 safetyCheckIn(text,interrupt=true){
  if(!this.enabled||!this.supported()){this.report('Safety check-in needs a response. Voice is muted or unavailable; allow microphone access to respond by voice.');return false}
  if(!interrupt&&this.active&&['SPEAKING','THINKING'].includes(this.state)){this.pendingSafetyMessage=text;return true}
  this.pendingSafetyMessage=null;this.epoch++;this.abort?.abort();this.abort=null;clearTimeout(this.deadline);
  this.active=true;this.onConversationStart();this.speak(text);return true;
 }
 confirmedCheckIn(event){
  if(!event?.confirmed||event.is_dangerous!==true||event.needs_help!==true||event.confidence<75||!event.check_in||this.lastConfirmation===event.id)return false;
  this.lastConfirmation=event.id;
  if(!this.enabled||this.active)return false;
  this.start(event.check_in);return true;
 }

 start(opening="Hello, I'm Baymax. How are you feeling?"){
  if(!this.enabled||this.active||!this.supported())return;
  this.active=true;this.history=[];this.epoch++;this.onConversationStart();this.speak(opening);
 }
 stopRecognition(){
  clearTimeout(this.retry);this.retry=null;
  if(this.recognition){const r=this.recognition;this.recognition=null;r.onresult=r.onend=r.onerror=r.onstart=null;try{r.abort()}catch{}}
 }
 end(message='Conversation ended.'){
  this.pendingSafetyMessage=null;this.epoch++;this.active=false;clearTimeout(this.deadline);this.abort?.abort();this.abort=null;
  this.stopRecognition();
  if(this.utterance){this.utterance.onend=this.utterance.onerror=null;this.utterance=null}
  this.stopPlayback();this.host.speechSynthesis?.cancel();this.history=[];this.setState('IDLE',message);this.scheduleWake();
 }
 stopPlayback(){
  this.playbackId=(this.playbackId||0)+1;
  clearTimeout(this.ttsTimeout);this.ttsAbort?.abort();this.ttsAbort=null;
  if(this.audio){this.audio.onended=this.audio.onerror=null;this.audio.pause();this.audio.removeAttribute?.('src');this.audio.load?.();this.audio=null}
  if(this.audioUrl){this.host.URL.revokeObjectURL(this.audioUrl);this.audioUrl=null}
 }
 async fetchAudio(text,signal){
  const response=await this.host.fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal});
  if(!response.ok||!response.headers.get('content-type')?.includes('audio/wav'))return null;
  const blob=await response.blob();return blob.size?blob:null;
 }
 speak(text,closeAfter=false){
  if(!this.active)return;
  this.stopRecognition();this.stopPlayback();this.host.speechSynthesis.cancel();
  const epoch=this.epoch,playbackId=this.playbackId;
  const current=()=>epoch===this.epoch&&this.active&&playbackId===this.playbackId;
  this.allowShort=/\b(are you|did you|do you|can you|have you|is it|does it|would you|were you)\b[^?]*\?\s*$/i.test(text.trim());
  this.history.push({role:'assistant',content:text});this.history=this.history.slice(-12);
  const finish=()=>{if(!current())return;this.stopPlayback();if(this.pendingSafetyMessage){const next=this.pendingSafetyMessage;this.pendingSafetyMessage=null;this.speak(next);return}if(closeAfter)this.end('Baymax is here if you need anything else.');else this.listen()};
  const browser=()=>{
   if(!current())return;
   if(this.audio){this.audio.onended=this.audio.onerror=null;this.audio.pause();this.audio=null}
   if(this.audioUrl){this.host.URL.revokeObjectURL(this.audioUrl);this.audioUrl=null}
   const u=new this.host.SpeechSynthesisUtterance(text);this.utterance=u;u.lang='en-US';u.rate=.95;
   const voices=this.host.speechSynthesis.getVoices?.()||[];
   u.voice=voices.find(v=>v.lang==='en-US'&&/guy|david|mark/i.test(v.name))||voices.find(v=>v.lang==='en-US')||null;
   this.setState('SPEAKING','Baymax is speaking (browser fallback).');
   u.onend=()=>{if(!current())return;this.utterance=null;finish()};
   u.onerror=()=>{if(current()){this.enabled=false;this.end('Browser blocked speech playback. Use Resume Voice to enable it.')}};
   this.host.speechSynthesis.speak(u);
  };
  if(!this.requestAudio){browser();return}
  this.setState('THINKING','Preparing Baymax voice…');
  const controller=new AbortController();this.ttsAbort=controller;
  const timer=setTimeout(()=>controller.abort(),45000);this.ttsTimeout=timer;
  Promise.resolve().then(()=>this.requestAudio(text,controller.signal)).then(blob=>{
   clearTimeout(timer);if(!current())return;
   this.ttsAbort=null;
   if(!blob){browser();return}
   this.audioUrl=this.host.URL.createObjectURL(blob);
   const audio=new this.host.Audio(this.audioUrl);this.audio=audio;
   audio.onended=finish;
   let failed=false;const fallback=()=>{if(failed||!current())return;failed=true;browser()};
   audio.onerror=fallback;
   this.setState('SPEAKING','Baymax is speaking (cloned voice).');
   Promise.resolve(audio.play()).catch(fallback);
  }).catch(()=>{clearTimeout(timer);if(current())browser()});
 }

 listen(manual=false){
  if(!this.active||!this.enabled||(this.host.speechSynthesis.speaking||this.audio))return;
  this.stopRecognition();const epoch=this.epoch;
  const Recognition=this.host.SpeechRecognition||this.host.webkitSpeechRecognition;
  const r=new Recognition();this.recognition=r;r.lang='en-US';r.continuous=manual;r.interimResults=false;this.manual=manual;this.manualText='';
  this.setState('LISTENING');
  r.onresult=e=>{if(epoch!==this.epoch||!this.active||this.state!=='LISTENING')return;const transcript=Array.from(e.results).filter(x=>x.isFinal!==false).map(x=>x[0].transcript).join(' ').trim();if(transcript){if(manual)this.manualText=transcript;else this.acceptTranscript(transcript)}};
  r.onerror=e=>{if(epoch!==this.epoch||!this.active)return;if(e.error==='no-speech')return;if(e.error==='aborted')return;this.enabled=false;this.end(e.error==='not-allowed'||e.error==='service-not-allowed'?'Microphone or speech recognition permission denied. Allow microphone access and retry.':`Speech recognition failed (${e.error}). Say Hey Baymax to retry.`)};
  r.onend=()=>{if(epoch!==this.epoch||!this.active||this.state!=='LISTENING')return;this.recognition=null;if(manual){this.manual=false;if(this.manualText)this.acceptTranscript(this.manualText);else this.listen();return}this.retry=setTimeout(()=>this.listen(),600)};
  try{r.start()}catch{this.enabled=false;this.end('Microphone could not start. Check browser permission and retry.')}
 }
 acceptTranscript(text){
  const words=text.trim().split(/\s+/).filter(Boolean);
  if(words.length<2&&!(this.allowShort&&/^(yes|no|yeah|nope|okay|ok|fine|sure|help)[.!]?$/i.test(text.trim()))){this.report('Short/noisy transcript ignored; listening…');return}
  this.turn(text);
 }
 startPushToTalk(){
  if(!this.enabled||!this.supported()||this.state==='THINKING')return;
  if(this.utterance){this.utterance.onend=this.utterance.onerror=null;this.utterance=null}
  this.stopPlayback();this.host.speechSynthesis.cancel();this.stopRecognition();
  if(!this.active){this.active=true;this.history=[];this.epoch++;this.onConversationStart()}
  this.listen(true);this.report('Push-to-talk: release Space to send.');
 }
 stopPushToTalk(){if(!this.manual||!this.recognition)return;try{this.recognition.stop()}catch{this.recognition.onend?.()}}
 async fetchTurn(body,signal){
  const response=await this.host.fetch('/api/voice-turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  if(!response.ok){let detail='Voice backend unavailable. Start the FastAPI voice server and check NVIDIA settings.';try{const data=await response.json();if(typeof data.detail==='string')detail=data.detail}catch{}throw new Error(detail)}
  const result=await response.json();if(!result.ignored&&(typeof result.text!=='string'||!result.text.trim()||typeof result.end_conversation!=='boolean'))throw new Error('Voice backend returned an invalid response.');return result;
 }
 async turn(transcript){
  if(/^(?:(?:hey )?baymax[, ]+)?(?:end (?:the )?conversation|stop (?:talking|listening)|goodbye|that(?:'s| is) all)[.!]?$/i.test(transcript.trim())){this.end('Listening for Hey Baymax.');return}

  if(this.onTranscript(transcript)==='help_requested')return;
  this.stopRecognition();this.setState('THINKING');const epoch=this.epoch;
  const body={transcript:transcript.slice(0,2000),vision:this.getVision(),history:this.history.slice(-12)};
  this.history.push({role:'user',content:body.transcript});this.history=this.history.slice(-12);
  const abort=new AbortController();this.abort=abort;
  this.deadline=setTimeout(()=>abort.abort(),65000);
  try{
   let reply=await this.requestTurn(body,abort.signal);
   if(reply.ignored){if(epoch===this.epoch&&this.active){this.history.pop();this.listen()}return}
   if(reply.inspection_request){
    if(epoch!==this.epoch||!this.active)return;
    if(reply.care_kit)this.onCareKit(reply.care_kit);
    this.report('Switching focus and inspecting the current camera frame…');
    const inspection=await this.inspect(reply.inspection_request,abort.signal);
    if(epoch!==this.epoch||!this.active)return;
    reply=await this.requestTurn({...body,vision:this.getVision(),inspection},abort.signal);
    if(reply.inspection_request)throw new Error('Repeated inspection request rejected. Please describe what you see.');
   }
   if(epoch!==this.epoch||!this.active)return;
   if(reply.care_kit)this.onCareKit(reply.care_kit);
   clearTimeout(this.deadline);this.speak(reply.text,reply.end_conversation);
  }catch(e){if(epoch===this.epoch&&this.active)this.end(e.name==='AbortError'?'Voice request timed out. Say Hey Baymax to retry.':e.message||'Voice request failed.')}
  finally{if(epoch===this.epoch){clearTimeout(this.deadline);this.abort=null}}
 }
 destroy(){this.enabled=false;this.end();this.onChange=()=>{}}
}
