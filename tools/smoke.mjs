import { chromium } from 'playwright';
const exe=process.env.CHROME||'/Users/<you>/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const b=await chromium.launch({executablePath:exe});const p=await b.newPage({viewport:{width:1440,height:900}});
const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
for(const r of ['','console/map','console/map/A-005','console/asset/A-005','console/reports','console/orders','console/sensors','console/analytics','console/audit','report','tech','tech/WO-319']){await p.goto('http://localhost:4400/prototype/#/'+r);await p.waitForTimeout(150);const t=await p.evaluate(()=>document.body.innerText.length);console.log(r||'home',t)}
console.log('errors',errs);await b.close();
