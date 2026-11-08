import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BehaviorTracker} from '../src/behavior.js';
import {AnomalyGate} from '../src/temporal.js';
const base={scores:[{label:'STANDING',score:90}],summary:'Standing',lyingSeconds:0};
function pose({zoom=1,hips=true,wrist='chest',dy=0,tilt=0}={}){
 const points=Array.from({length:17},()=>[0,0,0]);
 const set=(i,x,y,c=.95)=>points[i]=[x*zoom,(y+dy)*zoom,c];
 set(0,100,70);set(5,75,100);set(6,125,100);set(11,75+tilt,200,hips?.95:0);set(12,125+tilt,200,hips?.95:0);
 set(7,60,145);set(8,140,145);set(9,wrist==='chest'?100:wrist==='abdomen'?100:55,wrist==='chest'?125:wrist==='abdomen'?175:210);set(10,150,210);
 return {person:{conf:.95,x1:40*zoom,x2:160*zoom,y1:40*zoom,y2:300*zoom},points,frameHeight:400*zoom};
}
const step=(tracker,now,p=pose(),mode='upper',extra={})=>tracker.update({now,...p,...extra},mode,base);
const score=(r,a)=>r.scores.find(s=>s.label===a)?.score||0;
test('stationary chest/abdomen holds require more than 2s, scale consistently with camera size',()=>{
 for(const wrist of ['chest','abdomen'])for(const zoom of [.5,1,2]){
 const t=new BehaviorTracker();let r;for(let n=0;n<=2000;n+=100)r=step(t,n,pose({zoom,wrist}));assert.equal(Object.keys(r.triggerDurations).length,0);
 r=step(t,2200,pose({zoom,wrist}));assert.ok(score(r,wrist==='chest'?'HOLDING_CHEST':'CLENCHING_STOMACH')>0);
 assert.ok(r.normalization.scale>0);assert.equal(t.history.length,22);
 }
});
test('shoulder width fallback works without hips; moving wrist does not count as held',()=>{
 const t=new BehaviorTracker();let r;for(let n=0;n<=2400;n+=100)r=step(t,n,pose({hips:false}));assert.equal(r.normalization.scale,70);assert.ok(score(r,'HOLDING_CHEST')>0);
 t.reset();for(let n=0;n<=2400;n+=100){const p=pose();p.points[9][0]+=n%200===0?20:-20;r=step(t,n,p)}assert.equal(score(r,'HOLDING_CHEST'),0);
});
test('single hand-to-face snap is sneezing; separated repeated bobs count as coughing',()=>{
 const t=new BehaviorTracker();let r;
 for(let n=0;n<=1600;n+=100){const p=pose({wrist:'none'});p.points[0][1]=(n===400||n===1200)?95:70;p.points[9]=[100,p.points[0][1],.95];r=step(t,n,p);if(n===400)assert.ok(score(r,'SNEEZING')>0);assert.equal(r.triggerDurations.SNEEZING,undefined)}
 assert.ok(score(r,'COUGHING')>0);
 t.reset();for(let n=0;n<=1600;n+=100){const p=pose({wrist:'none'});p.points[0][1]=n===400?95:70;r=step(t,n,p)}assert.equal(score(r,'SNEEZING'),0);
});
test('fast nose/shoulder drop followed by keypoint loss triggers; slow descent does not',()=>{
 for(const fast of [true,false]){
 const t=new BehaviorTracker();for(let n=0;n<=600;n+=100)step(t,n,pose({dy:fast?n*.25:n*.05}));
 const r=step(t,700,{person:null,points:null,frameHeight:400});assert.equal(score(r,'SUDDEN_FALL')>0,fast);
 }
});
test('rapid drop followed by 1s stationary at frame bottom confirms local fall evidence',()=>{
 const t=new BehaviorTracker();let r;
 for(let n=0;n<=2200;n+=100)r=step(t,n,pose({dy:n<600?n*.4:240}));
 assert.ok(score(r,'SUDDEN_FALL')>0);
});
test('lying timer uses >20%, leaky occlusion, 2s upright reset, and no extra gate delay at 15s',()=>{
 const t=new BehaviorTracker();let r;
 for(let n=0;n<=15000;n+=100)r=step(t,n,pose(), 'upper',{lyingProbability:.21});
 assert.ok(r.lyingSeconds>=14.99);assert.ok(r.triggerDurations.LYING_DOWN>=14999);
 const gate=new AnomalyGate();assert.equal(gate.update(r,15000).action,'LYING_DOWN');
 r=step(t,15100,{person:null,points:null},'upper');assert.ok(r.lyingSeconds>14.9);
 for(let n=15200;n<=17000;n+=100)r=step(t,n);assert.ok(r.lyingSeconds>0);
 r=step(t,17200);assert.equal(r.lyingSeconds,0);
 t.reset();for(let n=0;n<=16000;n+=100)r=step(t,n,pose(),'body',{lyingProbability:.2});assert.equal(r.lyingSeconds,0);
});
test('torso angle above 55 degrees accumulates in both modes; history is bounded to 3s',()=>{
 for(const mode of ['upper','body']){const t=new BehaviorTracker();let r;for(let n=0;n<=5000;n+=100)r=step(t,n,pose({tilt:160}),mode);assert.ok(r.lyingSeconds>=4.9);assert.ok(r.normalization.torsoAngle>55);assert.equal(t.history[0].now,2000)}
});

test('long observation gaps decay the lying bucket instead of erasing it or counting unseen time',()=>{
 const t=new BehaviorTracker();let r;for(let n=0;n<=10000;n+=100)r=step(t,n,pose({tilt:160}));
 r=step(t,13000,{person:null,points:null});assert.ok(Math.abs(r.lyingSeconds-9.55)<.001);assert.equal(t.history.length,0);
});

test('slow CPU observations still detect chest holds and enforce strict >2s issue timing',()=>{
 const t=new BehaviorTracker();let r;
 for(let n=0;n<=2500;n+=500){r=step(t,n,pose());assert.equal(r.triggerDurations.HOLDING_CHEST,undefined)}
 assert.ok(score(r,'HOLDING_CHEST')>0);assert.ok(r.behaviorCandidates.some(c=>c.label==='HOLDING_CHEST'&&!c.issue));
 r=step(t,3000,pose());assert.equal(r.triggerDurations.HOLDING_CHEST,2500);
});
test('a hand-to-face snap is visible immediately but requires a >2s face-covering episode to become an issue',()=>{
 const t=new BehaviorTracker();let r;
 for(let n=0;n<=2600;n+=100){const p=pose({wrist:'none'});p.points[0][1]=n>=400?95:70;p.points[9]=[100,p.points[0][1],.95];r=step(t,n,p);if(n<=2400)assert.equal(r.triggerDurations.SNEEZING,undefined)}
 assert.ok(r.triggerDurations.SNEEZING>2000);
 const p=pose({wrist:'none'});r=step(t,2700,p);assert.equal(score(r,'SNEEZING'),0);assert.equal(r.triggerDurations.SNEEZING,undefined);
});
test('early candidate labels do not bypass the Stage 1 issue threshold',()=>{
 const gate=new AnomalyGate(),t=new BehaviorTracker();let r;
 for(let n=0;n<=2100;n+=100){r=step(t,n);assert.equal(gate.update(r,n),null)}
 r=step(t,2200);assert.equal(gate.update(r,2200).action,'HOLDING_CHEST');
});
