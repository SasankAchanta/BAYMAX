const CORE=[0,5,6,11,12,15,16];
const good=p=>p&&p[2]>=.4;
const median=v=>{const a=[...v].sort((a,b)=>a-b);return a[Math.floor(a.length/2)]};
export class TemporalPose {
 constructor(){this.reset()}
 reset(){this.history=[];this.filtered=[];this.last=null;this.horizontalSince=null;this.rapidUntil=0;this.fallen=false;this.lastDropVelocity=0}
 update(now,person,raw){
  if(!person||![5,6,11,12].every(i=>good(raw?.[i]))){this.reset();return {points:raw,lying:false,fall:false,dropVelocity:0,horizontalMs:0}}
  if(this.last!==null&&(now<this.last||now-this.last>1200))this.reset();this.last=now;
  this.history.push({now,points:Object.fromEntries(CORE.map(i=>[i,raw[i]?[...raw[i]]:null]))});
  this.history=this.history.filter(s=>now-s.now<=2000);
  const recent=this.history.slice(-3),points=raw.map(p=>[...p]);
  for(const i of CORE){const valid=recent.map(s=>s.points[i]).filter(good);if(valid.length>=2&&good(raw[i]))points[i]=[median(valid.map(p=>p[0])),median(valid.map(p=>p[1])),Math.min(...valid.map(p=>p[2]))]}
  const shoulder=[(points[5][0]+points[6][0])/2,(points[5][1]+points[6][1])/2];
  const hip=[(points[11][0]+points[12][0])/2,(points[11][1]+points[12][1])/2];
  const scale=Math.max(30,Math.hypot(shoulder[0]-hip[0],shoulder[1]-hip[1]));
  this.filtered.push({now,shoulder:shoulder[1],hip:hip[1],scale});this.filtered=this.filtered.filter(s=>now-s.now<=2000);
  let dropVelocity=0;
  if(this.filtered.length>=3){for(const old of this.filtered){const seconds=(now-old.now)/1000;if(seconds<.15||seconds>.95)continue;const shoulderDrop=(shoulder[1]-old.shoulder)/old.scale,hipDrop=(hip[1]-old.hip)/old.scale;const velocity=Math.min(shoulderDrop,hipDrop)/seconds;if(Math.min(shoulderDrop,hipDrop)>.28&&velocity>.75){this.rapidUntil=now+2500;this.lastDropVelocity=Math.max(this.lastDropVelocity,velocity);dropVelocity=Math.max(dropVelocity,velocity)}}}
  const tilt=Math.abs(shoulder[0]-hip[0])/scale;
  const lying=tilt>.75&&((person.x2-person.x1)/Math.max(1,person.y2-person.y1)>.95||tilt>.9);
  if(lying)this.horizontalSince??=now;else{this.horizontalSince=null;this.fallen=false}
  const horizontalMs=this.horizontalSince===null?0:now-this.horizontalSince;
  if(lying&&horizontalMs>=400&&now<this.rapidUntil)this.fallen=true;
  return {points,lying,fall:this.fallen&&lying,dropVelocity:this.fallen?this.lastDropVelocity:dropVelocity,horizontalMs};
 }
}
export const ANOMALIES=['SUDDEN_FALL','LYING_DOWN','HOLDING_CHEST','CLENCHING_STOMACH','COUGHING','SNEEZING','FALL_DETECTED','SITTING_HEAD_DOWN','LIMPING','HOPPING','GUARDING_ARM','LYING_TOO_LONG'];
export class AnomalyGate {
 constructor(){this.reset()}
 reset(){this.timers=new Map();this.last=null;this.episode=0}
 update(result,now){
  if(this.last!==null&&(now<this.last||now-this.last>1200))this.timers.clear();this.last=now;
  const matured=ANOMALIES.find(action=>Number.isFinite(result.triggerDurations?.[action]));
  for(const action of this.timers.keys())if(!result.scores?.some(s=>s.label===action&&s.score>0))this.timers.delete(action);
  if(matured){const action=matured;if(!this.timers.has(action))this.timers.set(action,{since:now,id:++this.episode});const timer=this.timers.get(action);return {action,id:timer.id,confidence:result.scores.find(s=>s.label===action)?.score||0,held_ms:result.triggerDurations[action]}}
  const active=ANOMALIES.filter(action=>!['LYING_DOWN','HOLDING_CHEST','CLENCHING_STOMACH','COUGHING','SNEEZING','SUDDEN_FALL'].includes(action)&&result.scores?.some(s=>s.label===action&&s.score>0));
  for(const action of this.timers.keys())if(!active.includes(action))this.timers.delete(action);
  for(const action of active)if(!this.timers.has(action))this.timers.set(action,{since:now,id:++this.episode});
  for(const action of ANOMALIES){const timer=this.timers.get(action);if(timer&&now-timer.since>=1800)return {action,id:timer.id,confidence:result.scores.find(s=>s.label===action).score,held_ms:now-timer.since}}
  return null;
 }
}
