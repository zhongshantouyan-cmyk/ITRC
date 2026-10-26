import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mainToolsRedirects, oldToolsRedirects } from './legacy-tools.mjs';

const mainPath = fileURLToPath(new URL('../client/vercel.json', import.meta.url));
const oldPath = fileURLToPath(new URL('../legacy-tools/vercel.json', import.meta.url));
const main = JSON.parse(readFileSync(mainPath, 'utf8'));
const managed = new Set(mainToolsRedirects().map(rule => rule.source));
main.redirects = [...(main.redirects || []).filter(rule => !managed.has(rule.source)), ...mainToolsRedirects()];
writeFileSync(mainPath, `${JSON.stringify(main, null, 2)}\n`);
writeFileSync(oldPath, `${JSON.stringify({ redirects: oldToolsRedirects() }, null, 2)}\n`);
console.log('Updated explicit redirects for 9 known tools; original source stays in legacy-tools.');
