import http from 'http';import fs from 'fs';import path from 'path';
const root=path.resolve(process.argv[2]||'../design'),port=+process.argv[3]||4400;
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
http.createServer((q,r)=>{let p=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!p.startsWith(root)){r.writeHead(403);return r.end()}
if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');
fs.readFile(p,(e,d)=>{if(e){r.writeHead(404);return r.end('nf')}r.writeHead(200,{'content-type':T[path.extname(p)]||'application/octet-stream'});r.end(d)})}).listen(port,()=>console.log('serving',root,port));
