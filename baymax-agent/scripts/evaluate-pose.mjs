// Offline replay: node scripts/evaluate-pose.mjs path/to/trace.json
// Trace format: {mode:"upper"|"body", expected:["HOLDING_CHEST"],frames:[{now,person,points,frameHeight,frameWidth}]}
import {readFileSync} from 'node:fs';
import {ActivityTracker} from '../frontend/src/activity.js';
import {FocusTracker} from '../frontend/src/focus.js';
import {BehaviorTracker} from '../frontend/src/behavior.js';
const input=process.argv[2];
if(!input){console.error('Usage: node scripts/evaluate-pose.mjs trace.json');process.exit(2)}
const trace=JSON.parse(readFileSync(input,'utf8')),activity=new ActivityTracker(),focus=new FocusTracker(),behavior=new BehaviorTracker(),found=new Map();
if(!Array.isArray(trace.frames)||!trace.frames.length)throw new Error('Trace must contain timestamped frames');
let previous=-Infinity;
for(const frame of trace.frames){
 if(!Number.isFinite(frame.now)||frame.now<previous)throw new Error('Frames must have increasing millisecond timestamps');previous=frame.now;
 const base=focus.update(frame,'body',activity.update(frame));const result=behavior.update(frame,trace.mode||'upper',base);
 for(const action of Object.keys(result.triggerDurations))if(!found.has(action))found.set(action,frame.now);
}
const expected=trace.expected||[],detected=[...found.keys()];
const report={frames:trace.frames.length,duration_ms:previous-trace.frames[0].now,expected,detected,first_trigger_ms:Object.fromEntries(found),missed:expected.filter(x=>!found.has(x)),unexpected:detected.filter(x=>!expected.includes(x)),note:'Pose replay checks heuristic triggers; it does not measure YOLO image detection accuracy.'};
console.log(JSON.stringify(report,null,2));if(report.missed.length||report.unexpected.length)process.exitCode=1;
