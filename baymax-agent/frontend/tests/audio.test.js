import test from 'node:test';
import assert from 'node:assert/strict';
import {LoudnessDetector} from '../src/audioMonitor.js';
const samples=db=>new Float32Array(256).fill(10**(db/20));
function feed(detector,start,end,db,options={}){let r;for(let n=start;n<=end;n+=50)r=detector.update(samples(db),n,options);return r}
test('three distinct peaks spanning >2s trigger; one sneeze or constant loud sound does not',()=>{
 const d=new LoudnessDetector();feed(d,0,2400,-60);let r;
 for(const at of [2500,3700,4900]){r=d.update(samples(-8),at);d.update(samples(-8),at+50);feed(d,at+100,at+500,-60)}
 assert.equal(r.count,3);assert.equal(r.danger,true);assert.ok(Math.abs(r.db+8)<.001);
 d.reset();feed(d,0,2400,-60);r=feed(d,2500,9000,-8);assert.equal(r.count,1);assert.equal(r.danger,false);
});
test('Baymax playback is excluded, quiet reset is required, old spikes expire',()=>{
 const d=new LoudnessDetector();feed(d,0,2400,-60);
 let r=feed(d,2500,4000,-8,{suppressed:true});assert.equal(r.count,0);assert.equal(r.danger,false);
 r=d.update(samples(-8),4050);assert.equal(r.count,0);feed(d,4100,4450,-60);
 r=d.update(samples(-8),4500);assert.equal(r.count,1);feed(d,4550,5000,-60);r=feed(d,5050,14600,-60);assert.equal(r.count,0);
});
test('noise floor adaptation rejects a steady noisy room and level is explicitly dBFS',()=>{
 const d=new LoudnessDetector();let r=feed(d,0,5000,-16);assert.equal(r.danger,false);assert.ok(r.threshold>-10);assert.ok(Math.abs(r.db+16)<.001);
});

