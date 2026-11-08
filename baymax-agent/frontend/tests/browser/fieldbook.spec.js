import {test,expect} from '@playwright/test';
test('fieldbook labels visible joints and follows the Skeleton toggle',async({page})=>{
 await page.route(/\/src\/vision(?:\.js)?(?:\?.*)?$/,r=>r.fulfill({contentType:'application/javascript',body:`export async function loadModels(){return {device:'cpu'}};export async function detectFrame(){const points=Array.from({length:17},()=>[0,0,0]);for(const [i,x,y] of [[0,300,70],[5,220,120],[6,380,120],[7,180,190],[8,420,190],[9,160,260],[10,440,260],[11,230,270],[12,370,270],[15,230,340],[16,370,340]])points[i]=[x,y,.95];return {person:{conf:.95,x1:150,y1:40,x2:450,y2:350},points,objects:[]}};export function drawOverlay(){}`}));
 await page.goto('/');await expect(page.locator('.cameraAnnotations text')).toHaveText(['HEAD','POSTURE','HAND']);
 await page.getByRole('checkbox',{name:'Skeleton'}).uncheck();await expect(page.locator('.cameraAnnotations')).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Observation notes'})).toBeVisible();
});
