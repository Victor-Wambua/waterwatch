import { chromium } from 'playwright';import fs from 'fs';
const exe='/Users/<you>/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const b=await chromium.launch({executablePath:exe});
const set=process.argv[2]||'all';
const routes=[['home',''],['map','console/map/A-005'],['reports','console/reports'],['orders','console/orders'],['asset','console/asset/A-005'],['sensors','console/sensors'],['analytics','console/analytics'],['audit','console/audit'],['report','report'],['tech','tech'],['job','tech/WO-319']];
for(const scheme of ['light','dark'])for(const [vn,w,h,m] of [['desktop',1440,900,false],['mobile',390,844,true]]){
 const ctx=await b.newContext({viewport:{width:w,height:h},colorScheme:scheme,isMobile:m,hasTouch:m});const p=await ctx.newPage();
 for(const [n,r] of routes){await p.goto('http://localhost:4400/prototype/#/'+r);await p.waitForTimeout(200);await p.screenshot({path:`design/screenshots/${n}-${vn}-${scheme}.png`,fullPage:vn==='desktop'&&['analytics','sensors','reports','audit'].includes(n)})}
 await ctx.close()}
await b.close();
