import {test,expect} from '@playwright/test';
async function setup(page,confirmed,realUpper=false){
 page.on('pageerror',error=>console.log('BROWSER ERROR:',error.stack));
 page.on('console',message=>{if(message.type()==='error')console.log('CONSOLE ERROR:',message.text())});
 await page.context().grantPermissions(['camera','microphone']);
 await page.route('**/api/check-ins**',r=>r.fulfill({json:{deadline_ms:Date.now()+60000,status:r.request().url().endsWith('/respond')?'RESPONDED':'AWAITING_RESPONSE',authorities_contacted:false}}));
 await page.addInitScript(()=>{
  window.__recognitions=[];window.__spoken=[];window.__candidate=false;window.__audioAmp=.001;
  class AudioContext{constructor(){this.state='running'}createMediaStreamSource(){return {connect(){},disconnect(){}}}createAnalyser(){return {fftSize:2048,getFloatTimeDomainData(a){a.fill(window.__audioAmp)}}}resume(){return Promise.resolve()}close(){this.state='closed';return Promise.resolve()}}
  Object.defineProperty(window,'AudioContext',{value:AudioContext,configurable:true});
  class Recognition{constructor(){window.__recognitions.push(this)}start(){}abort(){this.aborted=true}stop(){this.onend?.()}}
  Object.defineProperty(window,'SpeechRecognition',{value:Recognition,configurable:true});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text}},configurable:true});
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{speaking:false,cancel(){this.speaking=false},getVoices(){return []},speak(u){this.speaking=true;window.__spoken.push(u)}}});
 });
 await page.route(/\/src\/vision(?:\.js)?(?:\?.*)?$/,r=>r.fulfill({contentType:'application/javascript',body:`export async function loadModels(){return {device:'cpu'}};export async function detectFrame(){return {person:null,points:null,objects:[]}};export function drawOverlay(){}`}));
 await page.route(/\/src\/activity(?:\.js)?(?:\?.*)?$/,r=>r.fulfill({contentType:'application/javascript',body:`export const LABELS=['STANDING'];export class ActivityTracker{reset(){}update(){return {scores:[{label:window.__candidate?'SITTING_HEAD_DOWN':'STANDING',score:95}],summary:'Temporal pose evidence.',temporal:{drop_velocity:0,horizontal_ms:0},review:false,lyingSeconds:0}}}`}));
 if(!realUpper)await page.route(/\/src\/behavior(?:\.js)?(?:\?.*)?$/,r=>r.fulfill({contentType:'application/javascript',body:`export class BehaviorTracker{reset(){}update(raw,mode,base){return base}}`}));
 await page.route('**/api/tts',r=>r.fulfill({json:{fallback:'browser'}}));
 const requests=[];
 await page.route('**/api/verify-pose',async r=>{requests.push(r.request().postDataJSON());await r.fulfill({json:{action:confirmed?'sitting_head_down':'normal',confidence:89,is_dangerous:confirmed,needs_help:confirmed,confirmed,summary:confirmed?'Head-down posture corroborated.':'Normal bending, no help indicated.',check_in:confirmed?'Your head has been down for a while. Are you feeling okay?':null}})});
 if(realUpper){
 await page.route(/\/src\/vision(?:\.js)?(?:\?.*)?$/,r=>r.fulfill({contentType:'application/javascript',body:`export async function loadModels(){return {device:'cpu'}};export async function detectFrame(){const points=Array.from({length:17},()=>[0,0,0]);const kind=window.__behavior||'chest';window.__poseStart??=performance.now();const t=performance.now()-window.__poseStart;const y=kind==='coughing'?70+18*Math.sin(t/100):kind==='sneezing'&&t>500?90:70;points[0]=[100,y,.95];points[5]=[75,100,.95];points[6]=[125,100,.95];points[7]=[70,140,.95];points[9]=[100,kind==='stomach'?152.5:['coughing','sneezing'].includes(kind)?y:118,.95];return {person:{conf:.95,x1:40,x2:160,y1:40,y2:250},points,objects:[]}};export function drawOverlay(){}`}));
 await page.route('**/api/verify-pose',async r=>{const body=r.request().postDataJSON();requests.push(body);await r.fulfill({json:{action:body.action.toLowerCase(),confidence:90,is_dangerous:true,needs_help:true,confirmed:true,summary:'Hand held at chest.',check_in:'Are you having chest discomfort?'}})});
 }
 await page.goto('/');return requests;
}
test('camera is the only landing view and buffered VLM confirmation starts tailored speech',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const requests=await setup(page,true);
 await expect(page.getByRole('region',{name:'Camera / Activity Monitor',exact:true})).toBeVisible();
 expect(await page.getByRole('region',{name:'Main Dashboard'}).count()).toBe(0);
 expect(await page.getByRole('button',{name:'Open Camera / Activity Monitor'}).count()).toBe(0);
 await expect.poll(()=>page.evaluate(()=>document.querySelector('video').srcObject?.active)).toBe(true);
 await page.evaluate(()=>window.__candidate=true);
 await page.waitForTimeout(900);expect(requests.length).toBe(0);expect(await page.evaluate(()=>window.__spoken.length)).toBe(0);
 await expect(page.getByRole('region',{name:'Current behavior'})).toContainText('sitting head down');
 await expect(page.getByRole('region',{name:'Agent Status'})).toHaveCount(0);
 await expect(page.locator('.voiceStatus')).toContainText('SPEAKING');
 await expect.poll(()=>requests.length).toBe(1);expect(requests[0].held_ms).toBeGreaterThanOrEqual(1800);expect(requests[0].image.length).toBeGreaterThan(100);
 expect(await page.evaluate(()=>window.__spoken[0].text)).toContain('head has been down');
 await expect(page.locator('.baymaxIcon:visible')).toHaveClass(/isSpeaking/);
 await page.screenshot({path:'tests/fixtures/always-on-desktop.png',fullPage:true});
 expect(errors).toEqual([]);
});
test('normal VLM result cancels verification while local danger check-in and Space remain available',async({page})=>{
 await page.setViewportSize({width:390,height:844});const requests=await setup(page,false);
 await expect.poll(()=>page.evaluate(()=>document.querySelector('video').srcObject?.active)).toBe(true);
 await page.evaluate(()=>window.__candidate=true);
 await expect.poll(()=>requests.length,{timeout:10000}).toBe(1);
 await page.waitForTimeout(300);
 await expect(page.getByRole('region',{name:'Current behavior'})).toContainText('sitting head down');
 expect(requests.length).toBe(1);expect(await page.evaluate(()=>window.__spoken.length)).toBe(1);
 await expect(page.locator('.safetyBanner')).toContainText('Respond within');
 await page.getByRole('button',{name:'Full Body',exact:true}).click();
 await page.keyboard.down('Space');await expect(page.locator('.voiceStatus')).toContainText('LISTENING');
 expect(await page.evaluate(()=>window.__recognitions.at(-1).continuous)).toBe(true);
 await page.route('**/api/voice-turn',r=>r.fulfill({json:{text:'Are you feeling dizzy?',end_conversation:false}}));
 await page.evaluate(()=>window.__recognitions.at(-1).onresult({results:[[{transcript:'I feel dizzy'}]]}));
 await page.keyboard.up('Space');await expect(page.locator('.voiceStatus')).toContainText('SPEAKING');
 await page.screenshot({path:'tests/fixtures/always-on-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('real torso-normalized upper-body hold reaches verification without visible hips',async({page})=>{
 const requests=await setup(page,true,true);
 await expect(page.getByRole('button',{name:'Upper Body',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('group',{name:'Focus mode'}).getByRole('button')).toHaveCount(2);
 await expect(page.getByRole('region',{name:'Current behavior'})).toContainText('holding chest',{timeout:10000});
 await expect(page.getByRole('log')).toContainText('Confirmed holding_chest',{timeout:10000});
 await expect(page.locator('.voiceStatus')).toContainText('SPEAKING');
 expect(requests[0].action).toBe('HOLDING_CHEST');expect(requests[0].held_ms).toBeGreaterThan(2000);
});

for(const [scenario,action] of [['stomach','CLENCHING_STOMACH'],['coughing','COUGHING'],['sneezing','SNEEZING']]){
 test(`upper-body classification ${scenario} shows live behavior and waits >2s before verification`,async({page})=>{
  await page.addInitScript(value=>window.__behavior=value,scenario);
  const requests=await setup(page,true,true);
  const label=action.replaceAll('_',' ').toLowerCase();
  await expect(page.locator('.behaviorPrimary')).toContainText(label,{timeout:10000});
  await expect.poll(()=>requests.some(r=>r.action===action),{timeout:12000}).toBe(true);
  expect(requests.find(r=>r.action===action).held_ms).toBeGreaterThan(2000);
  await expect(page.getByRole('log')).toContainText(`Confirmed ${action.toLowerCase()}`);
 });
}

test('red chest-hold asks locally even when VLM rejects and silence triggers only demo escalation at 60s',async({page})=>{
 await page.clock.install();await setup(page,false,true);
 await page.route('**/api/verify-pose',r=>r.fulfill({json:{action:'normal',confidence:95,is_dangerous:false,needs_help:false,confirmed:false,summary:'Normal posture.'}}));
 await expect(page.locator('.safetyBanner')).toContainText('Respond within',{timeout:15000});
 expect(await page.evaluate(()=>window.__spoken[0].text)).toContain('holding your chest');
 await page.getByRole('button',{name:'Stop',exact:true}).click();
 await page.clock.fastForward(60001);
 await expect(page.locator('.safetyBanner')).toContainText('authorities-call escalation simulated');
 await expect(page.locator('.safetyBanner')).toContainText('No authorities have been contacted');
});

test('spoken yes cancels the check-in deadline before any model reply',async({page})=>{
 await page.clock.install();await setup(page,true,true);
 await page.route('**/api/voice-turn',r=>r.fulfill({json:{text:'Glad you are okay.',end_conversation:true}}));
 await expect(page.locator('.safetyBanner')).toContainText('Respond within',{timeout:15000});
 await page.evaluate(()=>{window.speechSynthesis.speaking=false;window.__spoken.at(-1).onend()});
 await page.evaluate(()=>window.__recognitions.at(-1).onresult({results:[[{transcript:'yes'}]]}));
 await expect(page.locator('.safetyBanner')).toContainText('countdown cancelled');
 await page.getByRole('button',{name:'Stop',exact:true}).click();await page.clock.fastForward(60001);
 await expect(page.locator('.safetyBanner')).not.toContainText('escalation simulated');
});

test('three microphone spikes trigger a sound safety check without fabricating a cough diagnosis',async({page})=>{
 await setup(page,true);
 await expect(page.getByRole('region',{name:'Microphone loudness'})).toContainText('dBFS',{timeout:10000});
 await page.waitForTimeout(2500);
 for(let i=0;i<3;i++){await page.evaluate(()=>window.__audioAmp=.5);await page.waitForTimeout(200);await page.evaluate(()=>window.__audioAmp=.001);await page.waitForTimeout(1000)}
 await expect(page.locator('.safetyBanner')).toContainText('Respond within');
 expect(await page.evaluate(()=>window.__spoken[0].text)).toBe('I heard several loud sounds. Are you okay?');
 await expect(page.getByRole('log')).toContainText('Stage 1 (Audio)');
});

async function fakeHelpContact(page,failed=false){
 await page.route('**/api/check-ins**',r=>{
  const message=failed?'Twilio rejected the demo contact request.':'Twilio accepted the SMS request for your demo help contact; delivery is not yet confirmed.';
  if(r.request().method()==='POST'&&!r.request().url().endsWith('/respond'))return r.fulfill({json:{deadline_ms:Date.now()+60000,status:'AWAITING_RESPONSE',mode:'sms',contact_config:{ready:true,enabled:true,mode:'sms'}}});
  if(r.request().method()==='POST')return r.fulfill({json:{status:'CONTACTING'}});
  return r.fulfill({json:{status:failed?'CONTACT_FAILED':'CONTACT_ACCEPTED',contact:{status:failed?'failed':'accepted',message,mode:'sms'}}});
 });
}
test('explicit spoken help immediately requests the demo contact without waiting for Nemotron',async({page})=>{
 await setup(page,true,true);await fakeHelpContact(page);let voiceRequests=0;
 await page.route('**/api/voice-turn',r=>{voiceRequests++;return r.fulfill({json:{text:'Unneeded',end_conversation:false}})});
 await expect(page.locator('.safetyBanner')).toContainText('Respond within',{timeout:12000});
 await page.evaluate(()=>{window.speechSynthesis.speaking=false;window.__spoken.at(-1).onend()});
 await page.evaluate(()=>window.__recognitions.at(-1).onresult({results:[[{transcript:"I'm not okay and I need help"}]]}));
 await expect(page.locator('.safetyBanner')).toContainText('Twilio accepted');
 expect(voiceRequests).toBe(0);expect(await page.evaluate(()=>window.__spoken.some(u=>u.text.includes('configured demo contact now')))).toBe(true);
 await expect(page.locator('.safetyBanner')).toContainText('delivery is not yet confirmed');
});
test('silence for one minute requests the configured demo contact and shows actual acceptance',async({page})=>{
 await page.clock.install();await setup(page,true,true);await fakeHelpContact(page);
 await expect(page.locator('.safetyBanner')).toContainText('Respond within',{timeout:12000});
 await page.getByRole('button',{name:'Stop',exact:true}).click();await page.clock.fastForward(60001);await page.clock.fastForward(1200);
 await expect(page.locator('.safetyBanner')).toContainText('Twilio accepted');
});
test('help button displays Twilio failure rather than claiming someone is coming',async({page})=>{
 await setup(page,true,true);await fakeHelpContact(page,true);
 await expect(page.locator('.safetyBanner')).toContainText('Respond within',{timeout:12000});await page.getByRole('button',{name:'I need help',exact:true}).click();
 await expect(page.locator('.safetyBanner')).toContainText('Demo contact request failed');await expect(page.locator('.safetyBanner')).toContainText('Twilio rejected');
});
