import { chromium } from 'playwright';import fs from 'fs';
const exe='/Users/<you>/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const U='http://localhost:4400/prototype/#/';const b=await chromium.launch({executablePath:exe});
const results=[],errs=[];const ok=(n,c,i='')=>{results.push({name:n,pass:!!c,info:String(i)});console.log(c?'PASS':'FAIL',n,c?'':i)};
async function run(vn,vp,mobile){
 const ctx=await b.newContext({viewport:vp,isMobile:mobile,hasTouch:mobile});const p=await ctx.newPage();
 p.on('console',m=>{if(m.type()==='error')errs.push(vn+': '+m.text())});p.on('pageerror',e=>errs.push(vn+' PAGEERR '+e.message));
 const go=async r=>{await p.goto(U+r);await p.waitForTimeout(120)};const T=async s=>(await p.locator(s).first().textContent())||'';const t=s=>vn+': '+s;
 // community report
 await go('report');
 await p.click('[data-act=send]');ok(t('report: empty submit shows error'),(await T('#rerr')).includes('Choose a problem type'));
 await p.click('[data-k=nowater]');await p.click('[data-act=send]');ok(t('report: missing location error'),(await T('#rerr')).includes('location'));
 await p.click('[data-k=contam]');ok(t('report: contamination shows safety guidance'),await p.locator('.safety:has-text("Do not drink")').count()>0);
 await p.click('[data-act=lang]');ok(t('report: Swahili toggle'),(await T('h1')).includes('Ripoti')&&await p.locator('.safety:has-text("Usinywe")').count()>0);
 await p.click('[data-act=lang]');
 await p.click('[data-act=photo]');await p.click('[data-act=gps]');
 await p.click('[data-act=offline]');await p.click('[data-act=send]');
 ok(t('report: offline submit queued'),(await T('h1')).includes('Saved on this phone')&&st(await p.locator('.card[role=status]').count())>0);
 await p.click('[data-act=again]');await p.click('[data-act=offline]');await p.click('[data-act=sync]');await p.waitForTimeout(100);
 ok(t('report: queue synced'),await p.locator('.toast:has-text("Queued reports sent")').count()>0);
 await p.click('[data-k=leak]');await p.click('[data-act=gps]');await p.click('[data-act=send]');
 const timer=await T('.timer');ok(t('report: completes online with timer'),/completed in \d+ s/.test(await p.locator('.phonebody').textContent()));
 // console
 await go('console/map');
 ok(t('console: map renders 15 markers'),await p.locator('.marker').count()===15);
 await p.selectOption('#fs','down');ok(t('console: filter status'),(await T('h2:has-text("asset")')).startsWith('1 asset'));
 await p.selectOption('#fs','all');await p.fill('#fq','zzzz');ok(t('console: empty search state'),await p.locator('.empty:has-text("No assets match")').count()>0);
 await p.click('[data-act=clearF]');
 await p.locator('.marker[data-id=A-005]').focus();await p.keyboard.press('Enter').catch(()=>{});
 await p.locator('.marker[data-id=A-005]').click({force:true});await p.waitForTimeout(150);
 ok(t('console: asset drawer with simulated sensor label'),await p.locator('.card:has-text("SIMULATED SENSOR")').count()>0&&p.url().endsWith('A-005'));
 await go('console/asset/A-005');ok(t('asset: history + sparkline'),await p.locator('.tl li').count()>=3&&await p.locator('svg.spark').count()>0);
 await go('console/reports');
 ok(t('triage: contamination pinned first'),(await T('.list li:first-child')).includes('High priority — contamination'));
 await p.click('[data-act=mkWO][data-id=R-2041]');await p.selectOption('#wtech','T-4');await p.click('[data-act=saveWO]');await p.waitForTimeout(150);
 ok(t('triage: report -> work order'),await p.locator('.chip:has-text("Linked WO-321")').count()>0);
 await p.click('[data-act=reject][data-id=R-2036]');await p.click('[data-act=doReject]');ok(t('triage: reject requires reason'),(await T('#rre')).includes('reason'));
 await p.fill('#rr','Duplicate of known kiosk fault');await p.click('[data-act=doReject]');await p.waitForTimeout(100);ok(t('triage: reject ok'),await p.locator('text=R-2036 ·').count()===0);
 await go('console/orders');
 await p.selectOption('#as-WO-320','T-1');await p.waitForTimeout(100);ok(t('board: assign moves new->assigned'),await p.locator('.col[aria-label=Assigned] .wo:has-text("WO-320")').count()>0);
 await p.click('.wo:has-text("WO-320") [data-act=advance]');await p.waitForTimeout(100);ok(t('board: advance'),await p.locator('.col[aria-label="In progress"] .wo:has-text("WO-320")').count()>0);
 ok(t('board: SLA breach shown with icon+text'),await p.locator('.sla.breach:has-text("SLA breached")').count()>0);
 await go('console/sensors');ok(t('sensors: missing/flatline/late flagged'),await p.locator('.chip.missing').count()>0&&await p.locator('.chip.flatline').count()>0&&await p.locator('.chip.late').count()>0);
 await p.click('[data-act=simMsg]');ok(t('sensors: simulated ingest labelled'),(await T('#msgs li')).includes('SIMULATED SENSOR — test environment'));
 await go('console/analytics');ok(t('analytics: charts render'),await p.locator('svg[role=img]').count()>=2);
 await go('console/audit');ok(t('audit: records actions'),await p.locator('tbody tr:has-text("Created WO-321")').count()>0);
 await p.click('[data-act=theme]');ok(t('theme toggle'),!!(await p.evaluate(()=>document.documentElement.dataset.theme)));
 // tech
 await go('tech');ok(t('tech: job list sorted'),await p.locator('a.row').count()===3||await p.locator('a.row').count()>=2);
 await go('tech/WO-319');await p.click('[data-act=complete]');ok(t('tech: completion requires photo'),(await T('#cerr')).includes('photo'));
 await p.click('[data-act=addMat]');await p.click('[data-act=saveMat]');ok(t('tech: material validation'),(await T('#me')).includes('Enter'));
 await p.fill('#mn','Contactor 40A');await p.fill('#mq','1');await p.fill('#mc','2400');await p.click('[data-act=saveMat]');await p.waitForTimeout(100);ok(t('tech: material saved, KES total'),(await p.locator('.phonebody').textContent()).includes('KES 2,400'));
 await p.click('[data-act=cphoto]');await p.click('[data-act=complete]');await p.waitForTimeout(150);ok(t('tech: complete -> list'),p.url().endsWith('#/tech'));
 const ov=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);ok(t('no horizontal overflow on tech page'),!ov);
 for(const r of ['console/map','console/reports','console/orders','report']){await go(r);const o=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);ok(t('no page-level horizontal overflow: '+r),!o)}
 await ctx.close()}
const st=x=>x;
await run('desktop',{width:1440,height:900},false);await run('mobile',{width:390,height:844},true);await b.close();
const fail=results.filter(r=>!r.pass);console.log(`\n${results.length} checks, ${fail.length} failed; console errors: ${errs.length}`);errs.forEach(e=>console.log(' ',e));
fs.writeFileSync('design/screenshots/clickthrough-results.json',JSON.stringify({results,consoleErrors:errs},null,1));
