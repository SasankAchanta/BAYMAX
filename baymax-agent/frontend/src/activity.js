// Activity scores are heuristic evidence scores, not a trained action classifier.
export const LABELS = ['USING AN OBJECT', 'WALKING', 'STANDING', 'SITTING', 'LYING / RESTING', 'POSSIBLE FALL · REVIEW', 'UNCLEAR / OTHER', 'NO PERSON VISIBLE'];
const clamp = v => Math.max(0, Math.min(100, v));
const mid = (a,b) => [(a[0]+b[0])/2,(a[1]+b[1])/2,Math.min(a[2],b[2])];
const dist = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const visible = p => p && p[2]>=.4;
function angle(a,b,c){
 const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]];
 return Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)||1))))*180/Math.PI;
}
export class ActivityTracker {
 constructor(){this.reset()}
 reset(){this.history=[];this.lyingSince=null;this.lastTime=null;this.previous=null;this.lastObject=null;this.holdSince=null;this.holdName=null}
 update({now,person,points,objects=[]}){
  const scores=Object.fromEntries(LABELS.map(l=>[l,0]));
  const gap=this.lastTime!==null&&(now-this.lastTime>2500||now<this.lastTime);
  if(gap){this.history=[];this.lyingSince=null;this.previous=null;this.holdSince=null}
  this.lastTime=now;
  const finish=(summary,extra={})=>({scores:Object.entries(scores).map(([label,score])=>({label,score:Math.round(clamp(score))})).sort((a,b)=>b.score-a.score),summary,lyingSeconds:this.lyingSince===null?0:(now-this.lyingSince)/1000,review:false,...extra});
  if(!person){this.history=[];this.lyingSince=null;this.previous=null;this.holdSince=null;this.holdName=null;scores['NO PERSON VISIBLE']=100;return finish('No person detected. Move into the camera view.')}
  if(!points||![5,6,11,12].every(i=>visible(points[i]))){this.lyingSince=null;this.history=[];this.holdSince=null;this.holdName=null;scores['UNCLEAR / OTHER']=100;return finish('Person visible; shoulders or hips are obscured. Show more of your body.')}
  const shoulder=mid(points[5],points[6]),hip=mid(points[11],points[12]);
  const torso=Math.max(25,dist(shoulder,hip)),height=person.y2-person.y1,width=person.x2-person.x1;
  const center=[(person.x1+person.x2)/2,(person.y1+person.y2)/2];
  // A large jump may indicate a different person. Never inherit their timer.
  if(this.previous&&(dist(center,this.previous.center)>Math.max(height,this.previous.height)*.7||height/this.previous.height>1.8||height/this.previous.height<.55)){
   this.history=[];this.lyingSince=null;this.holdSince=null;
  }
  this.previous={center,height};
  const quality=Math.min(person.conf,...[5,6,11,12].map(i=>points[i][2]))*100;
  const tilt=Math.abs(shoulder[0]-hip[0])/torso;
  const lying=tilt>.72 && (width/Math.max(1,height)>.95 || tilt>.9);
  if(lying){if(this.lyingSince===null)this.lyingSince=now}else this.lyingSince=null;
  this.history.push({now,hip:hip.slice(0,2),left:visible(points[15])?points[15][0]-hip[0]:null,right:visible(points[16])?points[16][0]-hip[0]:null});
  this.history=this.history.filter(p=>now-p.now<=1800);
  const span=this.history.length>1?now-this.history[0].now:0;
  const travel=span>=600?dist(hip,this.history[0].hip)/torso:0;
  const foot=this.history.filter(p=>p.left!==null&&p.right!==null).map(p=>(p.left-p.right)/torso);
  let reversals=0,lastSign=0;
  for(const v of foot){const sign=Math.abs(v)>.12?Math.sign(v):0;if(sign&&lastSign&&sign!==lastSign)reversals++;if(sign)lastSign=sign}
  const walking=!lying&&span>=600&&((reversals>=1&&travel>.05)||travel>.30);
  const legAngles=[[11,13,15],[12,14,16]].filter(ids=>ids.every(i=>visible(points[i]))).map(ids=>angle(...ids.map(i=>points[i])));
  const bent=legAngles.some(a=>a<135);
  const standing=!lying&&legAngles.length>0&&legAngles.every(a=>a>150)&&hip[1]>shoulder[1];
  const sitting=!lying&&bent;
  if(lying)scores['LYING / RESTING']=quality;
  else if(walking)scores['WALKING']=Math.min(quality,65+travel*50+reversals*8);
  else if(sitting)scores['SITTING']=quality;
  else if(standing)scores['STANDING']=quality;
  else scores['UNCLEAR / OTHER']=Math.max(55,quality);
  let held=null;
  // Only portable COCO objects; a hand overlapping a sofa is not holding it.
  const portable=new Set(['sports ball','bottle','cup','wine glass','fork','knife','spoon','bowl','banana','apple','sandwich','orange','carrot','hot dog','pizza','donut','cake','cell phone','book','scissors','teddy bear','remote','toothbrush','hair drier','tennis racket','baseball bat','frisbee','handbag','umbrella']);
  for(const object of objects){
   if(!portable.has(object.name)||object.conf<.4)continue;
   const pad=torso*.16;
   const near=[9,10].some(i=>visible(points[i])&&points[i][0]>=object.x1-pad&&points[i][0]<=object.x2+pad&&points[i][1]>=object.y1-pad&&points[i][1]<=object.y2+pad);
   if(near&&(!held||object.conf>held.conf))held=object;
  }
  if(held){
   if(this.holdName!==held.name){this.holdName=held.name;this.holdSince=now}
   if(now-this.holdSince>=400){
    scores['USING AN OBJECT']=Math.min(quality,held.conf*100);
    // Holding is the primary activity while posture remains a secondary score.
    if(!lying&&!walking){scores['STANDING']*=.55;scores['SITTING']*=.55}
   }
  }else{this.holdSince=null;this.holdName=null}
  const seconds=this.lyingSince===null?0:(now-this.lyingSince)/1000;
  const review=lying&&seconds>15;
  if(review){scores['POSSIBLE FALL · REVIEW']=quality;scores['LYING / RESTING']=Math.min(quality,49)}
  let summary=lying?`Horizontal posture. Lying / resting for ${seconds.toFixed(1)} seconds.`:walking?'Movement across frames is consistent with walking.':sitting?'Bent knees and upright torso are consistent with sitting.':standing?'Upright torso and extended legs are consistent with standing.':'Posture unclear. Keep shoulders, hips, knees and feet in view.';
  if(held&&scores['USING AN OBJECT'])summary+=` Possible holding / using: ${held.name}.`;
  if(review)summary+=' More than 15 continuous seconds lying down: possible fall, under review.';
  return finish(summary,{review,held:held&&scores['USING AN OBJECT']?held:null,person,points});
 }
}
