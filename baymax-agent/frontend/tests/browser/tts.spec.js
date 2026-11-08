import {test,expect} from '@playwright/test';
function silentWav(){
 const frames=12000,header=Buffer.alloc(44),data=Buffer.alloc(frames*2);
 header.write('RIFF');header.writeUInt32LE(36+data.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);
 return Buffer.concat([header,data]);
}
test('TTS WAV is decoded by real browser Audio and mic resumes only on ended',async({page})=>{
 await page.goto('/tests/fixtures/person.jpg');
 await page.route('**/api/tts',route=>route.fulfill({status:200,contentType:'audio/wav',body:silentWav()}));
 await page.evaluate(async()=>{
  window.__recognitions=[];window.__states=[];
  class Recognition{constructor(){window.__recognitions.push(this)}start(){}abort(){}}
  const {VoiceLoop}=await import('/src/voiceLoop.js');
  const host={Audio:window.Audio,URL:window.URL,fetch:window.fetch.bind(window),SpeechRecognition:Recognition,SpeechSynthesisUtterance:window.SpeechSynthesisUtterance,speechSynthesis:window.speechSynthesis};
  window.__voice=new VoiceLoop({host,onChange:s=>window.__states.push(s.state)});
  window.__voice.enable();
 });
 // Explicit page click permits actual audio playback under normal browser policy.
 await page.locator('body').click();
 await page.evaluate(()=>window.__voice.start());
 await expect.poll(()=>page.evaluate(()=>window.__voice.state)).toBe('SPEAKING');
 expect(await page.evaluate(()=>window.__recognitions.length)).toBe(0);
 await expect.poll(()=>page.evaluate(()=>window.__voice.state)).toBe('LISTENING');
 expect(await page.evaluate(()=>window.__recognitions.length)).toBe(1);
 expect(await page.evaluate(()=>window.__states)).toContain('SPEAKING');
 await page.evaluate(()=>window.__voice.destroy());
});
