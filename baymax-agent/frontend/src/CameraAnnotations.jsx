import React from 'react';
// Presentation only: label visible joints already produced by the detector.
export default function CameraAnnotations({points,width,height}){
 if(!points||!width||!height)return null;
 const visible=p=>p&&p[2]>.3&&Number.isFinite(p[0])&&Number.isFinite(p[1]);
 const shoulder=[points[5],points[6]].every(visible)?[(points[5][0]+points[6][0])/2,(points[5][1]+points[6][1])/2,1]:null;
 const wrist=[points[9],points[10]].find(visible);
 return <svg className="cameraAnnotations" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  {[[points[0],'HEAD',-1],[shoulder,'POSTURE',1],[wrist,'HAND',-1]].filter(([p])=>visible(p)).map(([p,label,side])=>{
   const endX=Math.max(65,Math.min(width-65,p[0]+side*100)),endY=Math.max(25,Math.min(height-25,p[1]-35));
   return <g key={label}><circle cx={p[0]} cy={p[1]} r="4"/><path d={`M ${p[0]} ${p[1]} L ${endX-side*20} ${endY} H ${endX}`}/><text x={endX} y={endY-8} textAnchor={side<0?'start':'end'}>{label}</text></g>
  })}
 </svg>;
}
