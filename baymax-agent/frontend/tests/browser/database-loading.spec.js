import {test,expect} from '@playwright/test';
test('database accepts responses slower than its polling interval',async({page})=>{
 await page.route(/\/src\/vision(?:\.js)?(?:\?.*)?$/,r=>r.fulfill({contentType:'application/javascript',body:`export async function loadModels(){return {device:'cpu'}};export async function detectFrame(){return {person:null,points:null,objects:[]}};export function drawOverlay(){}`}));
 await page.route('**/api/decisions',r=>r.fulfill({json:{items:[]}}));
 let calls=0;
 await page.route('**/api/care-database',async r=>{calls++;await new Promise(resolve=>setTimeout(resolve,4200));await r.fulfill({json:{items:[{id:'bandages',name:'Bandages',reason:'Starter',price_cents:-1,buy_url:'https://www.amazon.com/s?k=bandages'}],database:{connected:true,name:'test-cloud'},shopping:{configured:false}}})});
 await page.goto('/');await page.getByRole('button',{name:'Open Care Kit database'}).click();await page.getByRole('button',{name:'Care History',exact:false}).click();
 await expect(page.locator('.databaseConnection')).toContainText('Connecting');
 await expect(page.locator('.databaseConnection')).toContainText('SpacetimeDB connected',{timeout:10000});
 await expect(page.locator('.databaseTable:visible')).toContainText('Bandages');expect(calls).toBe(1);
});
