import {defineConfig} from '@playwright/test';
const cameraArgs=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'];
export default defineConfig({
 testDir:'./tests/browser',timeout:120000,workers:1,
 use:{baseURL:'http://127.0.0.1:5173',channel:'chrome',headless:true,viewport:{width:1100,height:1000},permissions:['camera']},
 projects:[
  {name:'cpu',use:{launchOptions:{args:[...cameraArgs,'--disable-gpu']}}},
  {name:'webgpu',use:{launchOptions:{args:[...cameraArgs,'--enable-unsafe-webgpu','--use-angle=swiftshader']}}},
 ],
 webServer:{command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:true,timeout:30000},
});
