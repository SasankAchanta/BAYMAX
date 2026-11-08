import React from 'react';
export default function BaymaxIcon({speaking=false,small=false,light='idle'}){
 return <span className={'baymaxIcon '+(small?'small ':'')+(speaking?'isSpeaking ':'')+'light-'+light} aria-hidden="true"><span className="baymaxFace"><i/><b/><i/></span></span>
}
