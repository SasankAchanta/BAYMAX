import {FaceLandmarker,FilesetResolver} from '@mediapipe/tasks-vision';
let loading;
export function loadFaceModel(){
 if(!loading)loading=(async()=>{
  const files=await FilesetResolver.forVisionTasks('/mediapipe');
  return FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/models/face_landmarker.task',delegate:'CPU'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true});
 })().catch(e=>{loading=null;throw e});
 return loading;
}
export function drawFace(canvas,result){
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
 ctx.fillStyle='#b6f5bb';
 for(const p of result.landmarks||[]){ctx.beginPath();ctx.arc(p.x*canvas.width,p.y*canvas.height,1,0,Math.PI*2);ctx.fill()}
}
