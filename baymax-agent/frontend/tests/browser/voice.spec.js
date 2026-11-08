import {test,expect} from '@playwright/test';
test('hands-free wake, visual checkup and pause work without a chatbot',async({page})=>{
 await page.addInitScript(()=>{
  window.__spoken=[];window.__recognizers=[];
  class Utterance{constructor(text){this.text=text}}
  class Recognition{constructor(){window.__recognizers.push(this)}start(){this.started=true}abort(){this.aborted=true}}
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});
  Object.defineProperty(window,'SpeechRecognition',{value:Recognition,configurable:true});
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{speaking:false,cancel(){this.speaking=false},getVoices(){return []},speak(u){this.speaking=true;window.__spoken.push(u)}}});
 });
 await page.route(/\/src\/vision(?:\.js)?(?:\?.*)?$/,r=>r.fulfill({contentType:'application/javascript',body:`export async function loadModels(){return {device:'cpu'}}; export async function detectFrame(){return {person:null,points:null,objects:[]}};export function drawOverlay(){}`}));
 await page.route(/\/src\/activity(?:\.js)?(?:\?.*)?$/,r=>r.fulfill({contentType:'application/javascript',body:`export const LABELS=['STANDING'];export class ActivityTracker{reset(){}update(){return {scores:[{label:'STANDING',score:95}],summary:'Standing.',review:false,lyingSeconds:0}}}`}));
 const bodies=[];
 await page.route('**/api/voice-turn',async r=>{
  const body=r.request().postDataJSON();bodies.push(body);
  await r.fulfill({json:body.transcript==="I'm fine"?{text:'Glad you are okay.',end_conversation:true}:!body.inspection?{text:'Inspecting',end_conversation:false,inspection_request:{mode:'arms'}}:{text:'I can see your hand. What happened?',end_conversation:false}});
 });
 await page.goto('/');
 await expect(page.locator('header')).toContainText('CAMERA / VIDEO ON',{timeout:20000});
 await expect.poll(()=>page.evaluate(()=>window.__recognizers.length)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>window.__recognizers[0].continuous&&window.__recognizers[0].interimResults)).toBe(true);
 await page.evaluate(()=>window.__recognizers[0].onresult({results:[[{transcript:'hey baymax'}]],resultIndex:0}));
 await expect(page.locator('.voiceStatus')).toContainText('SPEAKING');
 expect(await page.evaluate(()=>window.__spoken[0].text)).toBe('Hello, I am Baymax. How can I help?');
 expect(await page.evaluate(()=>window.__recognizers[0].aborted)).toBe(true);
 const finish=()=>page.evaluate(()=>{window.speechSynthesis.speaking=false;window.__spoken.at(-1).onend()});
 await finish();await expect(page.locator('.voiceStatus')).toContainText('LISTENING');
 await page.evaluate(()=>window.__recognizers.at(-1).onresult({results:[[{transcript:'My arm hurts'}]]}));
 await expect(page.locator('.voiceStatus')).toContainText('SPEAKING');
 expect(bodies.length).toBe(2);expect(bodies[1].inspection.mode).toBe('arms');expect(bodies[1].inspection.image.length).toBeGreaterThan(100);
 await expect(page.locator('.modeStatus')).toContainText('Arm / Hand');
 await finish();await page.evaluate(()=>window.__recognizers.at(-1).onresult({results:[[{transcript:"I'm fine"}]]}));
 await expect(page.locator('.voiceStatus')).toContainText('SPEAKING');await finish();
 await expect(page.locator('.voiceStatus')).toContainText('IDLE');
 await expect.poll(()=>page.evaluate(()=>window.__recognizers.at(-1).continuous)).toBe(true);
 await page.getByRole('button',{name:'Pause / Mute Voice'}).click();
 expect(await page.evaluate(()=>window.__recognizers.at(-1).aborted)).toBe(true);
 await expect(page.getByRole('button',{name:'Resume Voice'})).toBeVisible();
 expect(await page.locator('input[type=text],textarea').count()).toBe(0);
});
