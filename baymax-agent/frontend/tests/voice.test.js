import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceLoop,CHECK_IN,dangerState} from '../src/voiceLoop.js';
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
 loop.enable();loop.observe(true,0);assert.equal(spoken[0].text,CHECK_IN);assert.equal(loop.state,'SPEAKING');assert.equal(recognitions.length,0);
 loop.observe(true,1);assert.equal(spoken.length,1);finish();assert.equal(loop.state,'LISTENING');
 const r=recognitions[0];r.onresult({results:[[{transcript:'I feel dizzy'}]]});await new Promise(r=>setImmediate(r));
 assert.equal(r.aborted,true);assert.equal(loop.state,'SPEAKING');assert.equal(body.transcript,'I feel dizzy');assert.equal(body.vision.action,'SITTING_HEAD_DOWN');assert.equal(body.history[0].role,'assistant');
 assert.equal(recognitions.length,1);finish();assert.equal(loop.state,'LISTENING');assert.equal(recognitions.length,2);loop.destroy();
});
test('safe response closes after spoken acknowledgement and same danger does not retrigger',async()=>{
 const {loop,finish}=setup(async()=>({text:'Glad you are okay.',end_conversation:true}));loop.enable();loop.observe(true,0);finish();await loop.turn("I'm fine");assert.equal(loop.state,'SPEAKING');finish();assert.equal(loop.active,false);loop.observe(true,10);assert.equal(loop.active,false);loop.observe(false,20);loop.observe(false,5020);loop.observe(true,5030);assert.equal(loop.active,true);loop.destroy();
});
test('End Conversation ignores stale speech callbacks and aborts pending API request',async()=>{
 let resolve,signal;const {loop,spoken,finish,recognitions}=setup((_,s)=>{signal=s;return new Promise(r=>resolve=r)});loop.enable();loop.start();const stale=spoken[0].onend;loop.end();stale();assert.equal(recognitions.length,0);
 loop.start();finish();const pending=loop.turn('Pain');assert.equal(loop.state,'THINKING');loop.end();assert.equal(signal.aborted,true);resolve({text:'Late reply',end_conversation:false});await pending;assert.equal(loop.state,'IDLE');assert.equal(spoken.length,2);loop.destroy();
});
test('permission denial stops retry loop, unsupported browsers remain idle',()=>{
 const {loop,finish,recognitions}=setup();loop.enable();loop.start();finish();recognitions[0].onerror({error:'not-allowed'});assert.equal(loop.state,'IDLE');assert.equal(loop.active,false);assert.match(loop.message,/permission denied/);loop.destroy();
 const unsupported=new VoiceLoop({host:{}});unsupported.enable();assert.equal(unsupported.enabled,false);assert.equal(unsupported.state,'IDLE');
});
test('backend failures end safely; detector danger can be a secondary scored action',async()=>{
 const {loop,finish}=setup(async()=>{throw new Error('Backend unavailable')});loop.enable();loop.start();finish();await loop.turn('I feel dizzy');assert.equal(loop.state,'IDLE');assert.equal(loop.message,'Backend unavailable');loop.destroy();
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
