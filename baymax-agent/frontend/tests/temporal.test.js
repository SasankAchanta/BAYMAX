import test from 'node:test';
import assert from 'node:assert/strict';
import {TemporalPose,AnomalyGate} from '../src/temporal.js';
import {VerificationPipeline} from '../src/verification.js';
const person={x1:0,y1:0,x2:100,y2:350};
function points(drop=0,horizontal=false){const p=Array.from({length:17},()=>[100,30+drop,.95]);p[5]=[80,80+drop,.95];p[6]=[120,80+drop,.95];p[11]=[horizontal?210:80,horizontal?100+drop:220+drop,.95];p[12]=[horizontal?250:120,horizontal?100+drop:220+drop,.95];return p}
const box=horizontal=>horizontal?{x1:0,y1:0,x2:330,y2:120}:person;
test('rapid drop plus horizontal hold differs from a slow descent',()=>{
 for(const fast of [true,false]){const t=new TemporalPose();let r;for(let now=0;now<=4000;now+=100){const progress=Math.min(1,Math.max(0,(now-600)/(fast?300:2800)));r=t.update(now,box(progress>.8),points(progress*240,progress>.8))}assert.equal(r.fall,fast);assert.equal(r.lying,true)}
});
test('a single bad pose frame and brief horizontal posture do not signal fall',()=>{const t=new TemporalPose();for(let now=0;now<=800;now+=100)t.update(now,person,points());const bad=t.update(900,box(true),points(250,true));assert.equal(bad.fall,false);assert.equal(bad.lying,false);assert.equal(t.update(1000,person,points()).fall,false)});
test('anomaly buffer resets on gaps and interruption',()=>{const g=new AnomalyGate(),r={scores:[{label:'LIMPING',score:90}]};assert.equal(g.update(r,0),null);assert.equal(g.update(r,900),null);assert.equal(g.update(r,1800).action,'LIMPING');g.update({scores:[]},1900);assert.equal(g.update(r,2000),null);assert.equal(g.update(r,4000),null)});
test('normal verification cancels silently and confirmed verification reaches voice once',async()=>{
 for(const confirmed of [false,true]){let clock=0,calls=0,voice=0;const logs=[];const p=new VerificationPipeline({clock:()=>clock,capture:async()=>({image:'jpeg'}),verify:async()=>{calls++;return {confirmed,is_dangerous:confirmed,needs_help:confirmed,action:confirmed?'limping':'normal',confidence:90,summary:'Visible result'}},onLog:l=>logs.push(l),onConfirmed:()=>voice++});const r={scores:[{label:'LIMPING',score:90}]};for(clock=0;clock<=2000;clock+=100)p.observe(r,clock);clock=2000;await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(voice,Number(confirmed));assert.ok(logs.some(l=>l.message.includes(confirmed?'Confirmed':'Cancelled')));p.observe(r,2100);assert.equal(calls,1);p.cancel()}
});
test('pose recovery invalidates an in-flight VLM response',async()=>{let resolve,voice=0,clock=0;const p=new VerificationPipeline({clock:()=>clock,capture:async()=>({image:'jpeg'}),verify:()=>new Promise(r=>resolve=r),onConfirmed:()=>voice++});const r={scores:[{label:'FALL_DETECTED',score:90}]};for(clock=0;clock<=2000;clock+=100)p.observe(r,clock);await new Promise(r=>setImmediate(r));clock=2100;p.observe({scores:[]},clock);resolve({confirmed:true,action:'fall_detected',confidence:90,summary:'Late'});await new Promise(r=>setImmediate(r));assert.equal(voice,0);p.cancel()});

test('brief sneeze events can finish while their captured-frame verification is pending',async()=>{
 let resolve,voice=0,clock=0;
 const p=new VerificationPipeline({clock:()=>clock,capture:async()=>({image:'jpeg'}),verify:()=>new Promise(r=>resolve=r),onConfirmed:()=>voice++});
 p.observe({scores:[{label:'SNEEZING',score:90}],triggerDurations:{SNEEZING:200}},0);
 await new Promise(r=>setImmediate(r));clock=500;p.observe({scores:[]},clock);
 resolve({confirmed:true,action:'sneezing',confidence:90,is_dangerous:true,needs_help:true,summary:'Corroborated event'});
 await new Promise(r=>setImmediate(r));assert.equal(voice,1);p.cancel();
});
