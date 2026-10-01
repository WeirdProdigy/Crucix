import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { verifyAssets } from './verify-assets.mjs';
let count = 0;
function check(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'runs', 'output'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) check(path);
    else if (entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status) throw new Error(result.stderr);
      count++;
    } else if (entry.name.endsWith('.html')) {
      const html = readFileSync(path, 'utf8');
      for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
        if (!match[1].trim()) continue;
        new vm.Script(match[1], { filename: path });
        count++;
      }
    } else if (path.includes('locales') && path.endsWith('.json')) JSON.parse(readFileSync(path, 'utf8'));
  }
}
check('.');
verifyAssets();
console.log(`Syntax and locale checks passed (${count} JavaScript programs).`);
