const IDS=[0,5,6,7,8,9,10,11,12];
const visible=(p,c=.3)=>p&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[2]>c;
const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const angle=(a,b,c)=>{const u=[a[0]-b[0],a[1]-b[1]],v=[c[0]-b[0],c[1]-b[1]];return Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)||1))))*180/Math.PI};
export const UPPER_ACTIONS=['POSSIBLE_CHOKING','CLENCHING_STOMACH','HOLDING_CHEST','COUGHING','SNEEZING','SUDDEN_FALL'];
// Image-space samples retain camera motion; all distances/velocities use the earlier sample's torso scale.
export class BehaviorTracker {
 constructor(){this.reset()}
 reset(){this.history=[];this.last=null;this.holds={};this.events=[];this.lastBob=-Infinity;this.spikeActive=false;this.latches={};this.drop=null;this.bottomSince=null;this.lyingTimer=0;this.uprightSince=null;this.lyingScore=0;this.faceEpisode=null}
 update({now,person,points:p,frameHeight,lyingProbability},mode,base){
  if(this.last!==null&&now<this.last)this.reset();
  if(this.last!==null&&now-this.last>1200){
   const remaining=Math.max(0,this.lyingTimer-(now-this.last)/1000*.15),lyingScore=this.lyingScore;
   this.reset();this.lyingTimer=remaining;this.lyingScore=lyingScore;this.last=now;
  }
  const dt=this.last===null?0:Math.max(0,(now-this.last)/1000);this.last=now;
  if(this.mode!==mode){this.holds={};this.events=[];this.spikeActive=false;this.faceEpisode=null;for(const key of Object.keys(this.latches))if(key!=='SUDDEN_FALL')delete this.latches[key];this.mode=mode}
  this.history=this.history.filter(s=>now-s.now<=3000);this.events=this.events.filter(t=>now-t<=3000);
  const shoulderOK=person&&[5,6].every(i=>visible(p?.[i]))&&distance(p[5],p[6])>Math.max(4,(frameHeight||400)*.025);
  const noseOK=shoulderOK&&visible(p[0]);
  const shoulder=shoulderOK?mid(p[5],p[6]):null;
  const hips=shoulderOK&&[11,12].every(i=>visible(p[i]))?mid(p[11],p[12]):null;
  const scale=shoulderOK?Math.max(1,hips?distance(shoulder,hips):distance(p[5],p[6])*1.4):null;
  const quality=shoulderOK?Math.round(Math.min(person.conf??1,p[5][2],p[6][2])*100):0;
  const torsoAngle=hips?Math.atan2(Math.abs(shoulder[0]-hips[0]),hips[1]-shoulder[1])*180/Math.PI:null;
  const probability=Number.isFinite(lyingProbability)?Math.max(0,Math.min(1,lyingProbability)):(base.scores.find(s=>s.label==='LYING_DOWN')?.score||0)/100;
  const lying=probability>.2||(torsoAngle!==null&&torsoAngle>55);
  if(lying){this.lyingTimer=Math.round((this.lyingTimer+dt)*1e6)/1e6;this.uprightSince=null;this.lyingScore=Math.max(21,quality,probability*100)}
  else if(torsoAngle!==null&&torsoAngle<30){this.uprightSince??=now;if(now-this.uprightSince>=2000){this.lyingTimer=0;this.lyingScore=0}}
  else{this.uprightSince=null;this.lyingTimer=Math.max(0,this.lyingTimer-dt*.15)}
  const scores=Object.fromEntries(base.scores.map(s=>[s.label,s.score]));
  // The leaky state machine supersedes the old single-frame lying/fall timer.
  delete scores.FALL_DETECTED;delete scores.LYING_TOO_LONG;scores.LYING_DOWN=lying?this.lyingScore:0;
  const triggers={},candidates=[];let summary=base.summary;
  if(mode==='upper'){
   for(const key of Object.keys(scores))if(key!=='LYING_DOWN')scores[key]=0;
   for(const action of UPPER_ACTIONS)scores[action]=0;
   scores[shoulderOK?'UPPER_BODY_NEUTRAL':'NO UPPER BODY VISIBLE']=shoulderOK?quality:100;
   summary=shoulderOK?([9,10].some(i=>visible(p[i]))?'No sustained upper-body behavior yet. Tracking hands, head motion, chest and abdomen.':'Wrists are out of view. Show at least one wrist to detect chest/stomach holding, coughing or sneezing.'):'Move your shoulders and upper body into view.';
  }
  // A rapid drop can be completed by immediate keypoint loss, even without a person box.
  const lost=!person||[0,5,6].every(i=>!visible(p?.[i],.2));
  if(this.drop&&now-this.drop.time<=1600&&lost)this.latches.SUDDEN_FALL={until:now+2500,score:this.drop.score,held:now-this.drop.start,since:this.latches.SUDDEN_FALL?.since??now};
  if(shoulderOK){
   // Use the previous timestamped observation even on slower CPU inference.
   // The old 450ms cutoff made every wrist speed Infinity when inference took longer.
   const old=this.history.filter(s=>now-s.now>0&&now-s.now<=1200).at(-1);
   const speed=i=>visible(p[i])&&old&&visible(old.points[i])?distance(p[i],old.points[i])/old.scale/((now-old.now)/1000):Infinity;
   if(mode==='upper'){
    const neck=[shoulder[0],noseOK?shoulder[1]+(p[0][1]-shoulder[1])*.35:shoulder[1]-.15*scale];
    const neckHands=[9,10].filter(i=>visible(p[i])&&(!noseOK||p[i][1]>p[0][1]+.15*scale)&&p[i][1]<shoulder[1]+.08*scale&&distance(p[i],neck)/scale<.28&&speed(i)<.25);
    if(neckHands.length){
     this.holds.neck??=now;const held=now-this.holds.neck;
     if(held>0){const q=Math.min(quality,...neckHands.map(i=>p[i][2]*100));scores.POSSIBLE_CHOKING=q;candidates.push({label:'POSSIBLE_CHOKING',score:q,held_ms:held,required_ms:3000,issue:held>3000});if(held>3000)triggers.POSSIBLE_CHOKING=held;summary='Hand held near the neck: possible choking gesture; pose alone cannot confirm choking.'}
    }else delete this.holds.neck;
    const chest=[shoulder[0],shoulder[1]+.25*scale],abdomen=[shoulder[0],shoulder[1]+.75*scale];
    for(const [label,target] of [['HOLDING_CHEST',chest],['CLENCHING_STOMACH',abdomen]]){
     let held=0;
     for(const [s,e,w] of [[5,7,9],[6,8,10]]){
      const key=label+w;
      const hunch=(noseOK&&(p[0][1]-shoulder[1])/scale<.35)||([s,e,w].every(i=>visible(p[i]))&&angle(p[s],p[e],p[w])<95);
      const other=label==='HOLDING_CHEST'?abdomen:chest;
      const active=!neckHands.includes(w)&&visible(p[w])&&distance(p[w],target)<=distance(p[w],other)&&distance(p[w],target)/scale<.35&&speed(w)<.15&&hunch;
      if(active){this.holds[key]??=now;held=Math.max(held,now-this.holds[key])}else delete this.holds[key];
     }
     if(held>0){const q=Math.min(quality,...[9,10].filter(i=>visible(p[i])&&distance(p[i],target)/scale<.35).map(i=>p[i][2]*100));scores[label]=q;candidates.push({label,score:q,held_ms:held,required_ms:2000,issue:held>2000});if(held>2000)triggers[label]=held;summary=label==='HOLDING_CHEST'?'Hand held near the chest with low movement and a hunched/bent-arm posture.':'Hand held near the abdomen with low movement and a hunched/bent-arm posture.'}
    }
    const nearFace=noseOK&&[7,8,9,10].some(i=>visible(p[i])&&distance(p[i],p[0])/scale<.4);
    // Detect fresh velocity spikes over the 0.8s window using actual frame intervals.
    const recent=this.history.filter(s=>now-s.now>0&&now-s.now<=800&&visible(s.points[0]));
    const previous=recent.at(-1);
    const velocity=nearFace&&previous?Math.abs(p[0][1]-previous.points[0][1])/previous.scale/((now-previous.now)/1000):0;
    if(velocity<.8)this.spikeActive=false;
    if(nearFace&&velocity>1.2&&!this.spikeActive&&now-this.lastBob>450){
     this.spikeActive=true;this.events.push(now);this.lastBob=now;
     this.faceEpisode??=now;
    }
    // A snap is an observation, not yet an issue: the face-covering episode must last >2s.
    if(!nearFace||!this.events.length){this.faceEpisode=null;this.events=[]}
    if(nearFace&&this.faceEpisode!==null&&this.events.length){
     const label=this.events.length>=2?'COUGHING':'SNEEZING',held=now-this.faceEpisode;
     const q=Math.min(quality,p[0][2]*100,...[7,8,9,10].filter(i=>visible(p[i])&&distance(p[i],p[0])/scale<.4).map(i=>p[i][2]*100));
     scores[label]=q;candidates.push({label,score:q,held_ms:held,required_ms:2000,issue:held>2000});
     if(held>2000)triggers[label]=held;
     summary=label==='COUGHING'?'Repeated sharp head bobs with a hand or elbow near the face: possible coughing.':'Sharp head snap with a hand or elbow near the face: possible sneezing.';
    }

   }
   if(noseOK){
    for(const s of this.history.filter(s=>now-s.now>=300&&now-s.now<=600&&visible(s.points[0]))){
     const seconds=(now-s.now)/1000;
     const velocity=Math.min(shoulder[1]-s.shoulder[1],p[0][1]-s.points[0][1])/s.scale/seconds;
     if(velocity>1.8)this.drop={time:now,start:s.now,score:quality,velocity};
    }
    const bottom=frameHeight>0&&[0,5,6].every(i=>p[i][1]/frameHeight>.75);
    const still=old&&[0,5,6].every(i=>speed(i)<.15);
    if(this.drop&&now-this.drop.time<=2500&&bottom&&still){this.bottomSince??=now;if(now-this.bottomSince>=1000)this.latches.SUDDEN_FALL={until:now+2500,score:this.drop.score,held:now-this.drop.start,since:this.latches.SUDDEN_FALL?.since??now}}else this.bottomSince=null;
   }
   this.history.push({now,scale,shoulder,points:Object.fromEntries(IDS.map(i=>[i,p[i]?[...p[i]]:null]))});
  }else{this.holds={};this.faceEpisode=null;this.events=[]}
  for(const [action,latch] of Object.entries(this.latches)){
   if(now>latch.until){delete this.latches[action];continue}
   if(mode!=='upper'&&action!=='SUDDEN_FALL')continue;
   scores[action]=latch.score;const held=now-(latch.since??=now);candidates.push({label:action,score:latch.score,held_ms:held,required_ms:2000,issue:held>2000});if(held>2000)triggers[action]=Math.max(latch.held,held);
   summary=action==='SUDDEN_FALL'?'Rapid downward head and shoulder movement followed by low stationary posture or keypoint loss.':action==='COUGHING'?'Repeated sharp head movement with a hand or elbow near the face: possible coughing.':'Sharp head movement with a hand or elbow near the face: possible sneezing.';
  }
  if(this.lyingTimer>=15){scores.LYING_DOWN=Math.max(21,this.lyingScore);triggers.LYING_DOWN=this.lyingTimer*1000;summary=`Lying-posture evidence accumulated for ${this.lyingTimer.toFixed(1)} seconds; visual confirmation required.`}
  const triggered=candidates.map(c=>c.label);if(this.lyingTimer>=15)triggered.push('LYING_DOWN');
  if(mode==='upper'&&candidates.length)scores.UPPER_BODY_NEUTRAL=0;
  if(triggered.length)for(const label of Object.keys(scores))if(!triggered.includes(label))scores[label]*=.45;
  const required=mode==='upper'?[0,5,6]:[0,5,6,11,12,15,16];
  const visibility=required.filter(i=>visible(p?.[i])).length/required.length;
  const framingHint=!shoulderOK?'Move back until both shoulders are clearly visible.':mode==='body'&&[11,12,15,16].some(i=>!visible(p?.[i]))?'Step back so your hips and both feet fit in the frame.':mode==='upper'&&![9,10].some(i=>visible(p?.[i]))?'Keep your head, shoulders and at least one wrist in view.':visibility<1?'Improve lighting and face the camera so key joints stay visible.':'Camera framing looks usable.';
  return {...base,framingHint,visibility,person,points:p,scores:Object.entries(scores).map(([label,score])=>({label,score:Math.round(score||0)})).sort((a,b)=>b.score-a.score),summary,lyingSeconds:this.lyingTimer,review:this.lyingTimer>=15,triggerDurations:triggers,behaviorCandidates:candidates.sort((a,b)=>b.held_ms-a.held_ms),temporal:{...base.temporal,drop_velocity:this.drop?.velocity||0,horizontal_ms:this.lyingTimer*1000},normalization:{scale,torsoAngle,lyingProbability:probability}};
 }
}
