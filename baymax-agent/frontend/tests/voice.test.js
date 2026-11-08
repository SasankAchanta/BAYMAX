import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceLoop,CHECK_IN,dangerState} from '../src/voiceLoop.js';
const confirmation=id=>({id,confirmed:true,is_dangerous:true,needs_help:true,confidence:90,check_in:CHECK_IN});
function setup(requestTurn=async()=>({text:'Where does it hurt?',end_conversation:false})){
 const recognitions=[],spoken=[],states=[];
 class Recognition{constructor(){recognitions.push(this)}start(){this.started=true}abort(){this.aborted=true}}
 class Utterance{constructor(text){this.text=text}}
 const speech={speaking:false,cancel(){this.speaking=false},speak(u){this.speaking=true;spoken.push(u)},getVoices(){return []}};
 const host={SpeechRecognition:Recognition,SpeechSynthesisUtterance:Utterance,speechSynthesis:speech};
 const loop=new VoiceLoop({host,onChange:s=>states.push(s.state),getVision:()=>({action:'SITTING_HEAD_DOWN'}),requestTurn});
 function finish(){speech.speaking=false;spoken.at(-1).onend?.()}
 return {loop,recognitions,spoken,states,finish};
}
test('danger speaks once, recognition starts only after speech ends, response loops',async()=>{
 let body;const x=setup(async b=>{body=b;return {text:'Are you feeling dizzy?',end_conversation:false}});
 const {loop,spoken,recognitions,finish}=x;
 loop.enable();loop.confirmedCheckIn(confirmation(1));assert.equal(spoken[0].text,CHECK_IN);assert.equal(loop.state,'SPEAKING');assert.equal(recognitions.length,0);
 loop.confirmedCheckIn(confirmation(1));assert.equal(spoken.length,1);finish();assert.equal(loop.state,'LISTENING');
 const r=recognitions[0];r.onresult({results:[[{transcript:'I feel dizzy'}]]});await new Promise(r=>setImmediate(r));
 assert.equal(r.aborted,true);assert.equal(loop.state,'SPEAKING');assert.equal(body.transcript,'I feel dizzy');assert.equal(body.vision.action,'SITTING_HEAD_DOWN');assert.equal(body.history[0].role,'assistant');
 assert.equal(recognitions.length,1);finish();assert.equal(loop.state,'LISTENING');assert.equal(recognitions.length,2);loop.destroy();
});
test('safe response closes after spoken acknowledgement and same danger does not retrigger',async()=>{
 const {loop,finish}=setup(async()=>({text:'Glad you are okay.',end_conversation:true}));loop.enable();loop.confirmedCheckIn(confirmation(1));finish();await loop.turn("I'm fine");assert.equal(loop.state,'SPEAKING');finish();assert.equal(loop.active,false);loop.confirmedCheckIn(confirmation(1));assert.equal(loop.active,false);loop.confirmedCheckIn(confirmation(2));assert.equal(loop.active,true);loop.destroy();
});
test('End Conversation ignores stale speech callbacks and aborts pending API request',async()=>{
 let resolve,signal;const {loop,spoken,finish,recognitions}=setup((_,s)=>{signal=s;return new Promise(r=>resolve=r)});loop.enable();loop.start();const stale=spoken[0].onend;loop.end();stale();assert.equal(recognitions.length,0);
 loop.start();finish();const pending=loop.turn('Pain');assert.equal(loop.state,'THINKING');loop.end();assert.equal(signal.aborted,true);resolve({text:'Late reply',end_conversation:false});await pending;assert.equal(loop.state,'IDLE');assert.equal(spoken.length,2);loop.destroy();
});
test('permission denial stops retry loop, unsupported browsers remain idle',()=>{
 const {loop,finish,recognitions}=setup();loop.enable();loop.start();finish();recognitions[0].onerror({error:'not-allowed'});assert.equal(loop.state,'IDLE');assert.equal(loop.active,false);assert.match(loop.message,/permission denied/);loop.destroy();
 const unsupported=new VoiceLoop({host:{}});unsupported.enable();assert.equal(unsupported.enabled,false);assert.equal(unsupported.state,'IDLE');
});
test('backend failures recover into listening; detector danger can be a secondary scored action',async()=>{
 const {loop,finish}=setup(async()=>{throw new Error('Backend unavailable')});loop.enable();loop.start();finish();await loop.turn('I feel dizzy');assert.equal(loop.state,'SPEAKING');finish();assert.equal(loop.state,'LISTENING');loop.destroy();
 assert.equal(dangerState({scores:[{label:'SITTING',score:90},{label:'SITTING_HEAD_DOWN',score:70}]}),true);assert.equal(dangerState({scores:[{label:'SITTING_HEAD_DOWN',score:0}]}),false);
});


test('idle wake listener uses continuous/interim recognition and pauses for greeting',()=>{
 const {loop,recognitions,spoken,finish}=setup();loop.enable();loop.wake();
 const wake=recognitions[0];assert.equal(wake.continuous,true);assert.equal(wake.interimResults,true);
 wake.onresult({resultIndex:0,results:[[{transcript:'hey baymax'}]]});
 assert.equal(wake.aborted,true);assert.equal(loop.state,'SPEAKING');assert.equal(spoken[0].text,'Hello, I am Baymax. How can I help?');
 finish();assert.equal(loop.state,'LISTENING');assert.equal(recognitions[1].continuous,false);loop.disable();assert.equal(loop.enabled,false);assert.equal(recognitions[1].aborted,true);loop.destroy();
});
test('visual request captures once and resubmits same turn with focused frame',async()=>{
 const x=setup();const calls=[];x.loop.inspect=async(request,signal)=>{assert.equal(request.mode,'arms');assert.equal(signal.aborted,false);return {mode:'arms',image:'jpeg'}};
 x.loop.requestTurn=async body=>{calls.push(body);return calls.length===1?{text:'Inspecting',inspection_request:{mode:'arms'},end_conversation:false}:{text:'What happened to your arm?',end_conversation:false}};
 x.loop.enable();x.loop.start();x.finish();await x.loop.turn('My arm hurts');
 assert.equal(calls.length,2);assert.equal(calls[1].inspection.image,'jpeg');assert.equal(calls[0].transcript,calls[1].transcript);assert.equal(x.loop.state,'SPEAKING');x.loop.destroy();
});


test('MP3 playback gates microphone until audio.onended and releases URL',async()=>{
 const audios=[],revoked=[],recognizers=[];
 class Recognition{constructor(){recognizers.push(this)}start(){}abort(){this.aborted=true}}
 class Audio{constructor(url){this.url=url;audios.push(this)}play(){return Promise.resolve()}pause(){this.paused=true}removeAttribute(){}load(){}}
 const host={Audio,SpeechRecognition:Recognition,SpeechSynthesisUtterance:class{},speechSynthesis:{speaking:false,cancel(){},speak(){throw new Error('Unexpected browser fallback')}},URL:{createObjectURL:()=> 'blob:voice',revokeObjectURL:url=>revoked.push(url)}};
 const loop=new VoiceLoop({host,requestAudio:async()=>new Blob(['mp3'],{type:'audio/mpeg'})});
 loop.enable();loop.start();await new Promise(r=>setImmediate(r));
 assert.equal(loop.state,'SPEAKING');assert.equal(recognizers.length,0);assert.equal(audios.length,1);
 audios[0].onended();assert.equal(loop.state,'LISTENING');assert.equal(recognizers.length,1);assert.deepEqual(revoked,['blob:voice']);
 loop.speak('Another turn');await new Promise(r=>setImmediate(r));const stale=audios[1].onended;loop.disable();stale();assert.equal(loop.state,'IDLE');assert.equal(audios[1].paused,true);loop.destroy();
});
test('TTS fetch failure uses browser speech without listening through it',async()=>{
 const x=setup();x.loop.requestAudio=async()=>{throw new Error('TTS unavailable')};x.loop.enable();x.loop.start();await new Promise(r=>setImmediate(r));assert.equal(x.loop.state,'SPEAKING');assert.equal(x.recognitions.length,0);assert.equal(x.spoken.length,1);x.finish();assert.equal(x.loop.state,'LISTENING');x.loop.destroy();
});


test('late TTS response after ending cannot play or reopen the microphone',async()=>{
 const x=setup();let resolve;x.loop.requestAudio=()=>new Promise(r=>resolve=r);x.loop.enable();x.loop.start();await new Promise(r=>setImmediate(r));x.loop.end();resolve(null);await new Promise(r=>setImmediate(r));assert.equal(x.spoken.length,0);assert.equal(x.recognitions.length,0);assert.equal(x.loop.state,'IDLE');x.loop.destroy();
});


test('voice care recommendations are delivered to review-only UI callback',async()=>{
 const x=setup(async()=>({text:'Try a wrapped cold pack.',end_conversation:false,care_kit:{items:[{id:'cold pack',order_executed:false}],order_executed:false}}));let kit;x.loop.onCareKit=value=>kit=value;x.loop.enable();x.loop.start();x.finish();await x.loop.turn('My elbow hurts');assert.equal(kit.items[0].id,'cold pack');assert.equal(kit.order_executed,false);x.loop.destroy();
});


test('noisy one-word transcripts are ignored unless answering a direct yes/no question',async()=>{
 let calls=0;const x=setup(async()=>{calls++;return {text:'How do you feel?',end_conversation:false}});x.loop.enable();x.loop.start('How can I help?');x.finish();x.loop.acceptTranscript('noise');await new Promise(r=>setImmediate(r));assert.equal(calls,0);assert.equal(x.loop.state,'LISTENING');x.loop.speak('Are you okay?');x.finish();x.loop.acceptTranscript('yes');await new Promise(r=>setImmediate(r));assert.equal(calls,1);x.loop.destroy();
});
test('push-to-talk interrupts playback, captures while held and sends on release',async()=>{
 let calls=0;const x=setup(async()=>{calls++;return {text:'Are you hurt?',end_conversation:false}});x.loop.enable();x.loop.start();x.loop.startPushToTalk();const r=x.recognitions.at(-1);assert.equal(x.loop.state,'LISTENING');assert.equal(r.continuous,true);r.onresult({results:[[{transcript:'My ankle hurts'}]]});assert.equal(calls,0);x.loop.stopPushToTalk();await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(x.loop.state,'SPEAKING');x.loop.destroy();
});
test('raw or non-dangerous visual candidates cannot directly start a check-in',()=>{
 const x=setup();x.loop.enable();assert.equal(x.loop.confirmedCheckIn({...confirmation(1),confirmed:false}),false);assert.equal(x.loop.confirmedCheckIn({...confirmation(2),is_dangerous:false}),false);assert.equal(x.spoken.length,0);x.loop.destroy();
});

test('a local safety prompt interrupts an active conversation and listens after speech ends',()=>{
 const x=setup();x.loop.enable();x.loop.start('What can I help with?');
 assert.equal(x.loop.safetyCheckIn('I noticed you holding your chest. Are you okay?'),true);
 assert.equal(x.spoken.length,2);assert.equal(x.recognitions.length,0);x.finish();assert.equal(x.loop.state,'LISTENING');
 let reply;x.loop.onTranscript=t=>reply=t;x.loop.requestTurn=async()=>({text:'Glad you are okay.',end_conversation:true});x.loop.acceptTranscript('yes');assert.equal(reply,'yes');x.loop.destroy();
});


test('push-to-talk interrupts an in-flight model turn and ignores its stale reply',async()=>{
 let resolve,signal;const x=setup((_,s)=>{signal=s;return new Promise(r=>resolve=r)});
 x.loop.enable();x.loop.start();x.finish();const turn=x.loop.turn('My arm hurts');
 x.loop.startPushToTalk();assert.equal(signal.aborted,true);assert.equal(x.loop.state,'LISTENING');
 resolve({text:'Stale reply',end_conversation:false});await turn;assert.equal(x.spoken.length,1);x.loop.destroy();
});


test('camera capture failure falls back to a verbal checkup without ending the conversation',async()=>{
 const bodies=[];const x=setup(async body=>{bodies.push(body);return body.inspection_unavailable?{text:'Please describe your arm.',end_conversation:false}:{text:'Inspecting',end_conversation:false,inspection_request:{mode:'arms'}}});
 x.loop.inspect=async()=>{throw new Error('Camera unavailable')};x.loop.enable();x.loop.start();x.finish();await x.loop.turn('My arm hurts');
 assert.equal(bodies.length,2);assert.equal(bodies[1].inspection_unavailable,true);assert.equal(x.loop.active,true);x.finish();assert.equal(x.loop.state,'LISTENING');x.loop.destroy();
});


test('MP3 responses are accepted and non-audio fallback signals are ignored',async()=>{
 const loop=new VoiceLoop({host:{fetch:async()=>({ok:true,headers:{get:()=> 'audio/mpeg'},blob:async()=>new Blob(['ID3mp3'],{type:'audio/mpeg'})})}});
 assert.equal((await loop.fetchAudio('Hello')).type,'audio/mpeg');
 loop.host.fetch=async()=>({ok:true,headers:{get:()=> 'application/json'}});
 assert.equal(await loop.fetchAudio('Hello'),null);
});
