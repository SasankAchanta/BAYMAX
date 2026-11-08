import {test,expect} from '@playwright/test';
async function prepare(page){
 await page.addInitScript(()=>{window.SpeechRecognition=class{start(){}abort(){}}});
 await page.route(/\/src\/vision(?:\.js)?(?:\?.*)?$/,r=>r.fulfill({contentType:'application/javascript',body:`export async function loadModels(){return {device:'cpu'}};export async function detectFrame(){return {person:null,points:null,objects:[]}};export function drawOverlay(){}`}));
}
const baseRow={id:'acetaminophen',name:'Tylenol / acetaminophen',price_cents:-1,currency:'USD',reason:'Starter catalog item; not yet recommended by Baymax.',buy_url:'https://www.amazon.com/s?k=Tylenol',price_status:'api_key_required',provider:'Retailer search',product_name:'',recommended:false,guidance:'Check the label and suitability with a pharmacist.',updated_at:'2026-11-07T12:00:00Z',price_checked_at:''};
function payload(items=[baseRow],configured=false){return {items,database:{connected:true,engine:'SpacetimeDB',message:'Connected'},shopping:{configured}}}

test('right arrow opens the saved-item table and returning keeps the same camera stream',async({page})=>{
 await prepare(page);await page.route('**/api/care-database',r=>r.fulfill({json:payload()}));await page.goto('/');
 await expect.poll(()=>page.evaluate(()=>document.querySelector('video').srcObject?.active)).toBe(true);
 const streamId=await page.evaluate(()=>document.querySelector('video').srcObject.id);
 const frames=Number(await page.locator('.metrics>div').nth(1).locator('span').textContent());
 await page.getByRole('button',{name:'Open Care Kit database',exact:true}).click();
 const view=page.getByRole('region',{name:'Care Kit database',exact:true});await expect(view).toBeVisible();
 for(const column of ['Name','Price','Reason to buy','Where to buy'])await expect(view.getByRole('columnheader',{name:column,exact:true})).toBeVisible();
 await expect(view).toContainText('Tylenol');await expect(view).toContainText('Price unavailable');
 await expect(view.getByRole('link',{name:'Search retailer'})).toHaveAttribute('href','https://www.amazon.com/s?k=Tylenol');
 await expect(view.getByRole('button',{name:'Refresh prices'})).toBeDisabled();
 await expect.poll(async()=>Number(await page.locator('.metrics>div').nth(1).locator('span').textContent())).toBeGreaterThan(frames);
 await page.screenshot({path:'tests/fixtures/database-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Return to camera monitor'}).click();
 expect(await page.evaluate(()=>document.querySelector('video').srcObject.id)).toBe(streamId);
});

test('new recommendations and actual quotes update the table without a page reload',async({page})=>{
 await prepare(page);let recommended=false;
 await page.route('**/api/care-database',r=>r.fulfill({json:payload([{...baseRow,...(recommended?{recommended:true,reason:'Baymax suggested discussing OTC pain relief with a pharmacist.',price_cents:799,price_status:'live_quote',provider:'Rainforest / Amazon',product_name:'Tylenol tablets 24 count',buy_url:'https://www.amazon.com/dp/B000000003',price_checked_at:new Date().toISOString()}: {})}],true)}));
 await page.goto('/');await page.getByRole('button',{name:'Open Care Kit database',exact:true}).click();
 await expect(page.getByRole('table')).toContainText('Price unavailable');recommended=true;
 await expect(page.getByRole('table')).toContainText('$7.99',{timeout:8000});
 await expect(page.getByRole('table')).toContainText('Baymax suggested discussing');
 await expect(page.getByRole('link',{name:'View product'})).toHaveAttribute('href','https://www.amazon.com/dp/B000000003');
 await page.getByRole('button',{name:/Baymax recommendations/}).click();await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
});

test('mobile table stays contained and rejects unsafe purchase links',async({page})=>{
 await page.setViewportSize({width:390,height:844});await prepare(page);
 await page.route('**/api/care-database',r=>r.fulfill({json:payload([{...baseRow,buy_url:'javascript:alert(1)'}])}));
 await page.goto('/');await page.getByRole('button',{name:'Open Care Kit database',exact:true}).click();
 await expect(page.getByRole('table')).toContainText('Link unavailable');expect(await page.getByRole('table').getByRole('link').count()).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'tests/fixtures/database-mobile.png',fullPage:true});
});

test('Add item saves a personal entry with manual price and updates the table immediately',async({page})=>{
 await prepare(page);let items=[baseRow],posted;
 await page.route('**/api/care-database',r=>r.fulfill({json:payload(items)}));
 await page.route('**/api/care-database/items',async r=>{posted=r.request().postDataJSON();const item={...baseRow,id:'custom-0123456789abcdef01234567',name:posted.name,reason:posted.reason,price_cents:1250,buy_url:posted.url,provider:'Added by you',price_status:'manual_entry'};items=[...items,item];await r.fulfill({status:201,json:{saved:true,item}})});
 await page.goto('/');await page.getByRole('button',{name:'Open Care Kit database',exact:true}).click();
 await page.getByRole('button',{name:'+ Add item',exact:true}).click();
 const form=page.getByRole('form',{name:'Add Care Kit item'});
 await form.getByLabel('Item name').fill('Gauze pads');await form.getByLabel('Price (USD, optional)').fill('12.50');
 await form.getByLabel('Reason to buy').fill('Restock my kit');await form.getByLabel('Retailer link (optional)').fill('https://www.cvs.com/shop/gauze');
 await form.getByRole('button',{name:'Save item',exact:true}).click();
 await expect(page.getByRole('table')).toContainText('Gauze pads');await expect(page.getByRole('table')).toContainText('$12.50');
 await expect(page.getByRole('table')).toContainText('Added by you');await expect(page.getByRole('table')).toContainText('Price entered by you');
 await expect(page.getByRole('link',{name:'View retailer'})).toHaveAttribute('href','https://www.cvs.com/shop/gauze');
 expect(posted.price).toBe('12.50');await expect(form).toHaveCount(0);
});

test('failed save preserves manual form entries and reports the failure on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});await prepare(page);
 await page.route('**/api/care-database',r=>r.fulfill({json:payload()}));
 await page.route('**/api/care-database/items',r=>r.fulfill({status:503,json:{detail:'Database unavailable; try again.'}}));
 await page.goto('/');await page.getByRole('button',{name:'Open Care Kit database',exact:true}).click();await page.getByRole('button',{name:'+ Add item',exact:true}).click();
 const form=page.getByRole('form',{name:'Add Care Kit item'});await form.getByLabel('Item name').fill('Gauze pads');await form.getByLabel('Reason to buy').fill('My kit');
 await form.getByRole('button',{name:'Save item',exact:true}).click();
 await expect(form.getByRole('alert')).toContainText('Database unavailable');await expect(form.getByLabel('Item name')).toHaveValue('Gauze pads');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
