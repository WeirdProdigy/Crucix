import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function verifyAssets(root = fileURLToPath(new URL('../dashboard/public/', import.meta.url))) {
  const ledger = JSON.parse(readFileSync(join(root, 'vendor/manifest.json'), 'utf8'));
  if (ledger.schema !== 1 || !Array.isArray(ledger.assets) || ledger.assets.length < 20) throw new Error('Invalid vendor ledger');
  for (const asset of ledger.assets) {
    if (typeof asset.path !== 'string' || !/^\/vendor\/[a-zA-Z0-9./_-]+$/.test(asset.path) || asset.path.includes('..') || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid asset record');
    const data = readFileSync(join(root, asset.path.slice(1)));
    if (createHash('sha256').update(data).digest('hex') !== asset.sha256 || data.byteLength !== asset.bytes) throw new Error(`Asset mismatch: ${asset.path}`);
  }
  return ledger.assets.length;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) console.log(`Verified ${verifyAssets()} pinned dashboard assets.`);
