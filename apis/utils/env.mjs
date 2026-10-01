// Load .env file for API keys
// Searches: project root .env first, then apis/.env as fallback
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const paths = process.env.CRUCIX_ENV_FILE ? [resolve(process.env.CRUCIX_ENV_FILE)] : [
  resolve(__dirname, '..', '..', '.env'), // project root
  resolve(__dirname, '..', '.env'),        // apis/.env (legacy)
];

export function parseEnvLine(line) {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match) return null;
  let value = match[2].trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    const end = value.lastIndexOf(quote);
    if (end > 0) value = value.slice(1, end);
  } else value = value.replace(/\s+#.*$/, '').trim();
  return { key: match[1], value };
}

function loadEnv(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    let loaded = 0;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parsed = parseEnvLine(trimmed);
      if (!parsed) continue;
      if (process.env[parsed.key] === undefined) { process.env[parsed.key] = parsed.value; loaded++; }
    }
    return loaded;
  } catch { return -1; }
}

for (const p of paths) {
  if (loadEnv(p) >= 0) break;
}
