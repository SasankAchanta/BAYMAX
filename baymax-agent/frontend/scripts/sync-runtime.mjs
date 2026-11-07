// Keep every artifact on the same distribution as the Ultralytics ort-web bridge.
// Mixing the npm ONNX Runtime binaries with this bridge can break its WASM ABI.
import {mkdir,writeFile} from 'node:fs/promises';
export const runtimeFiles = [
 'ort.wasm.min.js', 'ort.webgpu.min.js',
 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm',
 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm',
 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm',
];
export const runtimeBase = 'https://cdn.pyke.io/0/pyke:ort-rs/web@1.30.0/';
if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\','/').split('/').pop())) {
 const destination=new URL('../public/runtime/',import.meta.url);
 await mkdir(destination,{recursive:true});
 for(const file of runtimeFiles){
  const response=await fetch(runtimeBase+file);
  if(!response.ok)throw new Error(`${file}: HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(file.endsWith('.wasm')&&bytes.subarray(0,4).toString('hex')!=='0061736d')throw new Error(`${file}: not WASM`);
  await writeFile(new URL(file,destination),bytes);
  console.log(`Synced ${file} (${bytes.length} bytes)`);
 }
}
