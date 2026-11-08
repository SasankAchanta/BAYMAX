const visible=p=>p&&p[2]>=.4;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const mean=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
const range=v=>Math.max(...v)-Math.min(...v);
const oscillations=v=>{let turns=0,last=0;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],sign=Math.abs(d)>.018?Math.sign(d):0;if(sign&&last&&sign!==last)turns++;if(sign)last=sign}return turns};
const ranked=s=>Object.entries(s).map(([label,score])=>({label,score:Math.round(Math.max(0,Math.min(100,score)))})).sort((a,b)=>b.score-a.score);
export class FocusTracker {
 constructor(){this.reset()}
 reset(){this.last=null;this.history=[];this.headSince=null;this.guardSince={};this.previous=null}
 update({now,person,points},mode,base){
  if(this.last!==null&&(now<this.last||now-this.last>2500))this.reset();
  this.last=now;
  const arm=mode==='arms';
  const required=arm?[5,6]:[5,6,11,12];
  if(!person||!required.every(i=>visible(points?.[i]))){this.reset();return arm?{...base,scores:[{label:person?'ARMS UNCLEAR':'NO PERSON VISIBLE',score:100}],summary:'Show shoulders, elbows and wrists to the camera.',review:false,lyingSeconds:0}:base}
  const shoulders=mean(points[5],points[6]);
  const size=Math.max(30,distance(points[5],points[6]));
  if(this.previous&&(distance(shoulders,this.previous.shoulders)>size*2||size/this.previous.size>1.8||size/this.previous.size<.55)){this.reset();this.last=now}
  this.previous={shoulders,size};
  const hip=visible(points[11])&&visible(points[12])?mean(points[11],points[12]):null;
  const torso=hip?Math.max(size,distance(shoulders,hip)):size*1.5;
  const headIds=[0,3,4].filter(i=>visible(points[i]));
  const head=headIds.length?headIds.reduce((sum,i)=>sum+points[i][1],0)/headIds.length:null;
  const legs=[11,12,15,16].every(i=>visible(points[i]));
  this.history.push({now,head:head===null?null:(head-shoulders[1])/torso,center:shoulders.map(v=>v/torso),left:legs?(points[15][1]-points[11][1])/torso:null,right:legs?(points[16][1]-points[12][1])/torso:null,lh:legs?points[11][1]/torso:null,rh:legs?points[12][1]/torso:null,la:legs?points[15][1]/torso:null,ra:legs?points[16][1]/torso:null,hy:hip?hip[1]/torso:null});
  this.history=this.history.filter(h=>now-h.now<=2500);
  const quality=Math.min(person.conf,...required.map(i=>points[i][2]))*100;
  if(arm){
   const scores={'GUARDING_ARM':0,'ARM_RAISED':0,'ARMS_RELAXED':0,'ARMS UNCLEAR':0};
   let guarding=false,raised=false,complete=false,guardQuality=quality;
   for(const [side,elbow,wrist] of [['left',7,9],['right',8,10]]){
    if(!visible(points[elbow])||!visible(points[wrist])){delete this.guardSince[side];continue}
    complete=true;
    const chest=[shoulders[0],shoulders[1]+torso*.30];
    const near=distance(points[wrist],chest)<torso*.45&&points[wrist][1]>shoulders[1]-torso*.1;
    if(near){this.guardSince[side]??=now;if(now-this.guardSince[side]>1500){guarding=true;guardQuality=Math.min(guardQuality,points[wrist][2]*100,points[elbow][2]*100)}}else delete this.guardSince[side];
    if(points[wrist][1]<shoulders[1]-size*.3)raised=true;
   }
   scores[guarding?'GUARDING_ARM':raised?'ARM_RAISED':complete?'ARMS_RELAXED':'ARMS UNCLEAR']=guarding?guardQuality:quality;
   return {...base,scores:ranked(scores),review:false,lyingSeconds:0,summary:guarding?'Wrist held near the chest / torso for over 1.5 seconds. Guarding-arm posture; this does not establish pain or injury.':raised?'Wrist raised above shoulder height.':complete?'Visible arms are not in a sustained guarding posture.':'Elbows or wrists are obscured. Move them into view.'};
  }
  const scores=Object.fromEntries(base.scores.map(s=>[s.label,s.score]));scores.SITTING_HEAD_DOWN=0;scores.LIMPING=0;scores.HOPPING=0;
  const seated=(scores.SITTING||0)>0;
  const validHeads=this.history.filter(h=>h.head!==null);
  const stationary=validHeads.length>=1&&validHeads.length===this.history.length&&range(validHeads.map(h=>h.head))<.08&&range(this.history.map(h=>h.center[0]))<.10&&range(this.history.map(h=>h.center[1]))<.10;
  if(seated&&head!==null&&head>=shoulders[1]-.08*torso&&stationary){this.headSince??=now}else this.headSince=null;
  let summary=base.summary;
  if(this.headSince!==null&&now-this.headSince>3000){scores.SITTING_HEAD_DOWN=Math.min(quality,...headIds.map(i=>points[i][2]*100));scores.SITTING*=.5;summary+=' Head held near / below shoulder height while seated and stationary for over 3 seconds.'}
  const samples=this.history.filter(h=>h.left!==null&&h.right!==null);
  const span=samples.length?now-samples[0].now:0;
  if(legs&&samples.length>=6&&samples.length===this.history.length&&span>=2400&&!base.review){
   const left=range(samples.map(h=>h.left)),right=range(samples.map(h=>h.right));
   const lHip=range(samples.map(h=>h.lh)),rHip=range(samples.map(h=>h.rh));
   const elevated=samples.map(h=>h.ra-h.la);
   const leftRaised=elevated.filter(d=>d>.15).length/samples.length>.85;
   const rightRaised=elevated.filter(d=>d<-.15).length/samples.length>.85;
   const support=samples.map(h=>leftRaised?h.ra:h.la),hips=samples.map(h=>h.hy);
   const hopping=(leftRaised||rightRaised)&&range(support)>.07&&range(hips)>.08&&oscillations(hips)>=3&&oscillations(support)>=2;
   const gaitQuality=Math.min(quality,...[11,12,15,16].map(i=>points[i][2]*100));
   if(hopping){scores.HOPPING=gaitQuality;scores.WALKING*=.4;summary+=' One ankle stays raised while the hips and supporting leg repeatedly bounce: hopping pattern.'}
   else if((scores.WALKING||0)>0){
    const half=Math.floor(samples.length/2),windows=[samples.slice(0,half),samples.slice(half)];
    const consistent=windows.every(w=>{const a=range(w.map(h=>h.left)),b=range(w.map(h=>h.right));return Math.max(a,b)>.04&&((a>b)===(left>right))&&Math.abs(a-b)/Math.max(a,b)>.35});
    const ankleAsym=Math.abs(left-right)/Math.max(left,right,.001),hipAsym=Math.abs(lHip-rHip)/Math.max(lHip,rHip,.001);
    if((Math.max(left,right)>.10&&ankleAsym>.5&&consistent)||(Math.max(lHip,rHip)>.1&&hipAsym>.55&&windows.every(w=>range(w.map(h=>h.lh))>.04||range(w.map(h=>h.rh))>.04))){scores.LIMPING=gaitQuality;scores.WALKING*=.4;summary+=' Consistent asymmetric hip/ankle movement over a 2.5-second rolling window: possible limping.'}
   }
  }
  return {...base,scores:ranked(scores),summary};
 }
}
export class FaceTracker {
 constructor(){this.reset()}
 reset(){this.closedSince=null;this.last=null;this.center=null}
 update(now,result){
  if(this.last!==null&&(now<this.last||now-this.last>1000))this.reset();this.last=now;
  const landmarks=result.faceLandmarks?.[0],categories=result.faceBlendshapes?.[0]?.categories;
  if(!landmarks?.length||!categories?.length){this.reset();return {scores:[{label:'NO FACE VISIBLE',score:100}],summary:'Move your face into view.',review:false,lyingSeconds:0,eyesSeconds:0,expression:null}}
  const center=landmarks[1];if(this.center&&Math.hypot(center.x-this.center.x,center.y-this.center.y)>.25)this.closedSince=null;this.center=center;
  const b=Object.fromEntries(categories.map(c=>[c.categoryName,c.score]));
  const required=['eyeBlinkLeft','eyeBlinkRight','mouthSmileLeft','mouthSmileRight','mouthFrownLeft','mouthFrownRight','browInnerUp'];
  if(!required.every(k=>Number.isFinite(b[k]))){this.reset();return {scores:[{label:'FACE SIGNAL UNAVAILABLE',score:0}],summary:'Required blendshapes are missing.',review:false,lyingSeconds:0,eyesSeconds:0,expression:null}}
  const blink=Math.min(b.eyeBlinkLeft,b.eyeBlinkRight);
  if(blink>.6)this.closedSince??=now;else this.closedSince=null;
  const eyesSeconds=this.closedSince===null?0:(now-this.closedSince)/1000;
  const happy=(b.mouthSmileLeft+b.mouthSmileRight)/2;
  const sad=((b.mouthFrownLeft+b.mouthFrownRight)/2)*.75+b.browInnerUp*.25;
  const expression=happy>.35&&happy>sad?'HAPPY':sad>.30&&sad>happy?'SAD':'NEUTRAL';
  const confidence=(expression==='HAPPY'?happy:expression==='SAD'?sad:1-Math.max(happy,sad))*100;
  // Sustained eye closure is the primary action; retain full expression confidence separately.
  const scores={[expression]:eyesSeconds>1.5?confidence*.5:confidence,'EYES_CLOSED':eyesSeconds>1.5?blink*100:0};
  const summary=`${expression.toLowerCase()} facial expression estimate (${Math.round(confidence)}%). `+(eyesSeconds>1.5?'Both eyes closed for over 1.5 seconds.':blink>.6?'Eyes closing; waiting for 1.5 seconds of continuous evidence.':'No sustained eye closure.')+' Expression does not establish mood.';
  return {scores:ranked(scores),summary,eyesSeconds,expression,expressionConfidence:Math.round(confidence),review:false,lyingSeconds:0,landmarks};
 }
}
