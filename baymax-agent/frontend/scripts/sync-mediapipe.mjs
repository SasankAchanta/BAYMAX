import {mkdir,cp} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
await mkdir(new URL('public/mediapipe/',root),{recursive:true});
await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm/',root),new URL('public/mediapipe/',root),{recursive:true});
console.log('Synced matching MediaPipe WASM assets.');
