import {test,expect} from '@playwright/test';
import {runtimeFiles} from '../../scripts/sync-runtime.mjs';
test('all runtime modules and binaries are served as real assets',async({request})=>{
 for(const file of runtimeFiles){
  const response=await request.get('/runtime/'+file);
  expect(response.ok(),file).toBe(true);
  expect(response.headers()['content-type'],file).not.toContain('text/html');
  const body=await response.body();
  if(file.endsWith('.wasm'))expect(body.subarray(0,4).toString('hex')).toBe('0061736d');
  else expect(body.toString()).not.toContain('<!doctype html>');
 }
});
test('camera, browser YOLO inference, stop and restart work without backend',async({page},testInfo)=>{
 const failedAssets=[];
 page.on('response',r=>{if(r.url().includes('/runtime/')&&!r.ok())failedAssets.push(r.url())});
 const faults=[];page.on('pageerror',e=>faults.push(e.message));
 await page.goto('/');
 await expect(page.locator('header')).toContainText('CAMERA / VIDEO ON',{timeout:20000});
 await expect(page.locator('.bottom')).toContainText('local inference',{timeout:90000});
 await expect.poll(async()=>Number(await page.locator('.metrics>div').nth(1).locator('span').textContent()),{timeout:60000}).toBeGreaterThan(0);
 await expect(page.locator('.summary')).toContainText('No person detected');
 await page.screenshot({path:'tests/fixtures/browser-monitor.png',fullPage:true});
 await page.getByRole('button',{name:'Stop',exact:true}).click();
 await expect(page.locator('header')).toContainText('CAMERA OFF');
 await page.getByRole('button',{name:'Start camera',exact:true}).click();
 await expect(page.locator('header')).toContainText('CAMERA / VIDEO ON');
 const detections=await page.evaluate(async()=>{
  const {loadModels,detectFrame}=await import('/src/vision.js');
  const image=new Image();image.src='/tests/fixtures/person.jpg';await image.decode();
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=Math.round(image.height*640/image.width);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const models=await loadModels();const result=await detectFrame(models,canvas);
  return {device:models.device,adapter:!!(await navigator.gpu?.requestAdapter()),person:!!result.person,keypoints:result.points?.length,objects:result.objects.map(o=>o.name)};
 });
 expect(detections.person).toBe(true);expect(detections.keypoints).toBe(17);
 expect(faults).toEqual([]);
 expect(failedAssets).toEqual([]);
 if(testInfo.project.name==='webgpu'){
  expect(detections.device).toBe(detections.adapter?'webgpu':'cpu');
  if(!detections.adapter)testInfo.annotations.push({type:'environment',description:'No WebGPU adapter available; verified automatic CPU fallback.'});
 }else expect(detections.device).toBe('cpu');
});


test('WebGPU distribution loads asyncify modules and executes WASM inference',async({page})=>{
 const loaded=[];
 page.on('response',r=>{if(r.url().includes('/runtime/')&&r.ok())loaded.push(r.url())});
 // An image document avoids initializing the application's CPU runtime first.
 await page.goto('/tests/fixtures/person.jpg');
 await page.addScriptTag({url:'/runtime/ort.webgpu.min.js'});
 const result=await page.evaluate(async()=>{
  ort.env.wasm.wasmPaths=new URL('/runtime/',location.origin).href;
  ort.env.wasm.numThreads=1;
  const session=await ort.InferenceSession.create('/models/yolo11n.onnx',{executionProviders:['wasm']});
  try{
   const outputs=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',new Float32Array(1*3*640*640),[1,3,640,640])});
   return Object.values(outputs).map(t=>t.dims);
  }finally{await session.release()}
 });
 expect(result.length).toBeGreaterThan(0);
 expect(loaded.some(url=>url.endsWith('ort-wasm-simd-threaded.asyncify.mjs'))).toBe(true);
 expect(loaded.some(url=>url.endsWith('ort-wasm-simd-threaded.asyncify.wasm'))).toBe(true);
});


test('focus modes switch without restarting camera and real face blendshapes run',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const faceRequests=[];page.on('request',r=>{if(r.url().includes('face_landmarker.task'))faceRequests.push(r.url())});
 await page.goto('/');
 await expect(page.locator('.bottom')).toContainText('local inference',{timeout:90000});
 expect(faceRequests).toEqual([]);
 await page.getByRole('button',{name:'Arm / Hand',exact:true}).click();
 await expect(page.locator('.modeStatus')).toContainText('Arm / Hand');
 await expect(page.locator('.videoLabel')).toContainText('ARM / HAND');
 await page.getByRole('button',{name:'Face / Head',exact:true}).click();
 await expect(page.locator('.bottom')).toContainText('MediaPipe Face',{timeout:60000});
 await expect(page.locator('.summary')).toContainText('Move your face into view',{timeout:20000});
 expect(faceRequests.length).toBeGreaterThan(0);
 const detected=await page.evaluate(async()=>{
  const {loadFaceModel}=await import('/src/face.js');
  const image=new Image();image.src='/tests/fixtures/face.jpg';await image.decode();
  const model=await loadFaceModel();const result=model.detectForVideo(image,performance.now()+1);
  return {landmarks:result.faceLandmarks[0]?.length,blendshapes:result.faceBlendshapes[0]?.categories.map(c=>c.categoryName)};
 });
 expect(detected.landmarks).toBeGreaterThan(400);
 expect(detected.blendshapes).toEqual(expect.arrayContaining(['eyeBlinkLeft','eyeBlinkRight','mouthSmileLeft','mouthFrownRight','browInnerUp']));
 await page.getByRole('button',{name:'Full Body',exact:true}).click();
 await expect(page.locator('.bottom')).toContainText('YOLO11',{timeout:20000});
 await expect(page.locator('header')).toContainText('CAMERA / VIDEO ON');
 expect(errors).toEqual([]);
});
