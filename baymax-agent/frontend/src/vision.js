import {YOLO} from '@ultralytics/yolo';
import wasmUrl from '@ultralytics/yolo/pkg/ultralytics_inference_web_bg.wasm?url';
let loading;
export function loadModels(onStatus=()=>{}){
 if(!loading)loading=(async()=>{
  const options={wasmUrl,ortBaseUrl:new URL('/runtime/',location.origin).href};
  onStatus('Loading YOLO11 pose model…');
  const pose=await YOLO.load('/models/yolo11n-pose.onnx',options);
  try{
   onStatus('Loading YOLO11 object model…');
   const objects=await YOLO.load('/models/yolo11n.onnx',options);
   return {pose,objects,device:pose.device};
  }catch(error){pose.free();throw error}
 })().catch(error=>{loading=null;throw error});
 return loading;
}
export async function detectFrame(models,frame){
 // Both models see the exact same captured frame, not two video instants.
 const pose=await models.pose.predict(frame,{conf:.35});
 const objects=await models.objects.predict(frame,{conf:.4});
 let index=-1,area=0;
 pose.boxes.forEach((b,i)=>{const a=(b.x2-b.x1)*(b.y2-b.y1);if(a>area){area=a;index=i}});
 return {person:index<0?null:pose.boxes[index],points:index<0?null:pose.keypoints[index]?.points,objects:objects.boxes};
}
export function drawOverlay(canvas,result){
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
 const {person,points,held}=result;if(!person)return;
 ctx.lineWidth=2;ctx.strokeStyle=result.review?'#ff4545':'#b6f5bb';
 ctx.strokeRect(person.x1,person.y1,person.x2-person.x1,person.y2-person.y1);
 const edges=[[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];
 for(const [a,b] of edges){if(points?.[a]?.[2]>.4&&points?.[b]?.[2]>.4){ctx.beginPath();ctx.moveTo(...points[a].slice(0,2));ctx.lineTo(...points[b].slice(0,2));ctx.stroke()}}
 for(const p of points||[]){if(p[2]>.4){ctx.beginPath();ctx.arc(p[0],p[1],3,0,Math.PI*2);ctx.fillStyle='#d9ffdc';ctx.fill()}}
 if(held){ctx.strokeStyle='#f2ce65';ctx.strokeRect(held.x1,held.y1,held.x2-held.x1,held.y2-held.y1);ctx.fillStyle='#f2ce65';ctx.font='16px monospace';ctx.fillText(held.name,held.x1,Math.max(18,held.y1-8))}
}
