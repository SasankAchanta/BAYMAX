import {test,expect} from '@playwright/test';

test('streamlined monitor uses the head for hands-free voice feedback',async({page})=>{
 await page.addInitScript(()=>{
  window.__spoken=[];window.__recognizers=[];
  class Utterance{constructor(text){this.text=text}}
  class Recognition{constructor(){window.__recognizers.push(this)}start(){}abort(){this.aborted=true}}
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});
  Object.defineProperty(window,'SpeechRecognition',{value:Recognition,configurable:true});
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{speaking:false,cancel(){this.speaking=false},getVoices(){return []},speak(u){this.speaking=true;window.__spoken.push(u)}}});
 });
 await page.route(/\/src\/vision(?:\.js)?(?:\?.*)?$/,r=>r.fulfill({contentType:'application/javascript',body:`export async function loadModels(){return {device:'cpu'}};export async function detectFrame(){return {person:null,points:null,objects:[]}};export function drawOverlay(){}`}));
 await page.route('**/api/tts',r=>r.fulfill({json:{fallback:'browser'}}));
 let release;
 await page.route('**/api/voice-turn',async r=>{await new Promise(resolve=>{release=resolve});await r.fulfill({json:{text:'How are you feeling now?',end_conversation:false}})});
 await page.goto('/');
 await expect(page.locator('.voiceBeacon .light-idle')).toBeVisible();
 await expect(page.locator('.careKitCard,.soundMonitor,.verificationLog,.behaviorFooter,.voicePanel')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Dismiss alert'})).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>window.__recognizers.length)).toBeGreaterThan(0);
 await page.evaluate(()=>window.__recognizers.at(-1).onresult({results:[[{transcript:'hey baymax'}]],resultIndex:0}));
 await expect(page.locator('.voiceBeacon .light-speaking')).toBeVisible();
 expect(await page.evaluate(()=>window.__recognizers[0].aborted)).toBe(true);
 await page.evaluate(()=>{window.speechSynthesis.speaking=false;window.__spoken.at(-1).onend()});
 await expect(page.locator('.voiceBeacon .light-listening')).toBeVisible();
 await page.evaluate(()=>window.__recognizers.at(-1).onresult({results:[[{transcript:'My arm hurts'}]]}));
 await expect(page.locator('.voiceBeacon .light-received')).toBeVisible();
 await expect.poll(()=>Boolean(release)).toBe(true);release();
 await expect(page.locator('.voiceBeacon .light-speaking')).toBeVisible();
 await page.evaluate(()=>{window.speechSynthesis.speaking=false;window.__spoken.at(-1).onend()});
 let finishContact;
 await page.route('**/api/check-ins',r=>r.fulfill({json:{deadline_ms:Date.now()+60000,mode:'sms'}}));
 await page.route('**/api/check-ins/*/respond',async r=>{await new Promise(resolve=>{finishContact=resolve});await r.fulfill({json:{status:'CONTACT_ACCEPTED',contact:{status:'accepted',message:'Twilio accepted the demo SMS; delivery is not confirmed.'}}})});
 await page.evaluate(()=>window.__recognizers.at(-1).onresult({results:[[{transcript:'I need help'}]]}));
 await expect(page.locator('.voiceBeacon .light-sending')).toBeVisible();
 await expect.poll(()=>Boolean(finishContact)).toBe(true);finishContact();
 await expect(page.locator('.voiceBeacon .light-sending')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>window.__spoken.at(-1)?.text)).toContain('request help');
 await page.evaluate(()=>{window.speechSynthesis.speaking=false;window.__spoken.at(-1).onend()});
 await expect.poll(()=>page.evaluate(()=>window.__spoken.at(-1)?.text)).toContain('Twilio accepted');
 await page.evaluate(()=>{window.speechSynthesis.speaking=false;window.__spoken.at(-1).onend()});
 await expect(page.locator('.voiceBeacon .light-listening')).toBeVisible();
 await page.evaluate(()=>window.__recognizers.at(-1).onresult({results:[[{transcript:'My arm still hurts'}]]}));
 await expect(page.locator('.voiceBeacon .light-received')).toBeVisible();
 release();await expect(page.locator('.voiceBeacon .light-speaking')).toBeVisible();
 await page.evaluate(()=>{window.speechSynthesis.speaking=false;window.__spoken.at(-1).onend()});
 await page.evaluate(()=>window.__recognizers.at(-1).onresult({results:[[{transcript:'end conversation'}]]}));
 await expect(page.locator('.voiceBeacon .light-idle')).toBeVisible();
 await page.screenshot({path:'tests/fixtures/streamlined-monitor.png',fullPage:true});
});
