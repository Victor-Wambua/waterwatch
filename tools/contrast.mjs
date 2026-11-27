import { chromium } from 'playwright';import fs from 'fs';
const T=JSON.parse(fs.readFileSync('design/design-tokens.json','utf8'));
const lin=c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4};const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const L=h=>{const [r,g,b]=rgb(h);return .2126*lin(r)+.7152*lin(g)+.0722*lin(b)};const cr=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
const pairs=[['ink','paper',4.5],['ink','surface',4.5],['ink-2','paper',4.5],['ink-2','surface',4.5],['ink-2','sunken',4.5],['on-brand','brand',4.5],['on-brand-soft','brand-soft',4.5],['brand','surface',4.5],['ink','brand-soft',4.5],['ok','ok-soft',4.5],['warn','warn-soft',4.5],['bad','bad-soft',4.5],['unk','unk-soft',4.5],['contam','contam-soft',4.5],['ok','surface',4.5],['bad','surface',4.5],['warn','surface',4.5],['contam','surface',4.5],['unk','surface',4.5],['line-strong','surface',3],['focus','surface',3],['focus','paper',3],['chart-a','surface',3],['chart-b','surface',3],['ok','sunken',3],['bad','sunken',3],['warn','sunken',3],['contam','sunken',3],['unk','sunken',3],['brand','sunken',3],['line-strong','sunken',3]];
const out=[];let fail=0;for(const th of ['light','dark'])for(const [f,bg,min] of pairs){const r=cr(T[th][f],T[th][bg]);const pass=r>=min;if(!pass)fail++;out.push({theme:th,fg:f,bg,ratio:+r.toFixed(2),min,pass})}
console.log('token pairs',out.length,'fail',fail);out.filter(o=>!o.pass).forEach(o=>console.log(' FAIL',JSON.stringify(o)));
const exe='/Users/<you>/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const b=await chromium.launch({executablePath:exe});const dom=[];
for(const scheme of ['light','dark'])for(const [vn,w,h] of [['desktop',1440,900],['mobile',390,844]]){
 const ctx=await b.newContext({viewport:{width:w,height:h},colorScheme:scheme});const p=await ctx.newPage();
 for(const r of ['','console/map/A-005','console/asset/A-005','console/reports','console/orders','console/sensors','console/analytics','console/audit','report','tech','tech/WO-319']){
  await p.goto('http://localhost:4400/prototype/#/'+r);await p.waitForTimeout(150);
  if(r==='report'){await p.click('[data-k=contam]')}
  const res=await p.evaluate(()=>{
   const parse=c=>{const m=c.match(/[\d.]+/g).map(Number);return{r:m[0],g:m[1],b:m[2],a:m.length>3?m[3]:1}};
   const lin=c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4};const Lm=c=>.2126*lin(c.r)+.7152*lin(c.g)+.0722*lin(c.b);
   const over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
   const bgOf=el=>{const st=[];for(let e=el;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor);if(c.a>0)st.push(c);if(c.a===1)break}let base=parse(getComputedStyle(document.body).backgroundColor);for(let i=st.length-1;i>=0;i--)base=over(st[i],base);return base};
   const bad=[];let n=0;
   const els=[...document.querySelectorAll('body *')];
   for(const el of els){if(el.closest('svg')&&el.tagName!=='text')continue;const tn=[...el.childNodes].filter(x=>x.nodeType===3&&x.textContent.trim()).length;if(!tn)continue;const cs=getComputedStyle(el);if(cs.visibility==='hidden'||+cs.opacity===0||el.closest('.sr')||el.closest('dialog:not([open])'))continue;const rc=el.getBoundingClientRect();if(!rc.width)continue;
    let fill=el.tagName==='text'?cs.fill:cs.color;if(!fill||fill==='none')continue;let opa=1;for(let e=el;e;e=e.parentElement){opa*=+getComputedStyle(e).opacity}
    const bg=el.tagName==='text'?bgOf(el.closest('svg').parentElement):bgOf(el);const f=over(parse(fill),bg);const a=Lm(f),b2=Lm(bg);const ratio=(Math.max(a,b2)+.05)/(Math.min(a,b2)+.05);const fs=parseFloat(cs.fontSize),bold=+cs.fontWeight>=700;const min=(fs>=24||(fs>=18.66&&bold))?3:4.5;n++;if(ratio<min&&opa>.9)bad.push({text:el.textContent.trim().slice(0,30),ratio:+ratio.toFixed(2),min,cls:String(el.className.baseVal??el.className)})}
   return{n,bad}});
  dom.push({scheme,vn,r,n:res.n,bad:res.bad});}
 await ctx.close()}
await b.close();
const total=dom.reduce((s,d)=>s+d.n,0),bad=dom.flatMap(d=>d.bad.map(x=>({...x,scheme:d.scheme,vn:d.vn,route:d.r})));
console.log('DOM text nodes sampled',total,'below threshold',bad.length);const seen=new Set();bad.forEach(x=>{const k=x.scheme+x.cls+x.text;if(!seen.has(k)){seen.add(k);console.log(' ',x.scheme,x.vn,x.route,JSON.stringify(x.text),x.ratio,'/',x.min,x.cls)}});
fs.writeFileSync('design/screenshots/contrast-results.json',JSON.stringify({tokenPairs:out,tokenFailures:fail,domSampled:total,domFailures:bad},null,1));
