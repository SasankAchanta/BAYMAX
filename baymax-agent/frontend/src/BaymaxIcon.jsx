import React from 'react';
export default function BaymaxIcon({speaking=false,small=false,light='idle',level=null}){
 return <span className={'baymaxIcon '+(small?'small ':'')+(speaking?'isSpeaking ':'')+'light-'+light} style={level===null?undefined:{'--voice-level':Math.max(0,Math.min(1,level))}} data-audio-level={level===null?undefined:'live'} aria-hidden="true"><span className="baymaxFace"><i/><b/><i/></span></span>
}
