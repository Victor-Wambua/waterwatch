import { writeFileSync } from 'node:fs';
import { openapi } from '../src/web/openapi.ts';
writeFileSync('docs/openapi.json', JSON.stringify(openapi, null, 2) + '\n');
console.log('docs/openapi.json written');
