// Copies Leaflet (BSD-2-Clause) from node_modules into public/vendor so the app has no CDN dependency.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
const src = 'node_modules/leaflet/dist';
const dst = 'public/vendor/leaflet';
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const f of ['leaflet.js', 'leaflet.css']) cpSync(`${src}/${f}`, `${dst}/${f}`);
cpSync(`${src}/images`, `${dst}/images`, { recursive: true });
cpSync('node_modules/leaflet/LICENSE', `${dst}/LICENSE`);
console.log('Leaflet vendored to', dst);
