import { writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function saveSnapshot(directory, data) {
  const temp = join(directory, `latest.${process.pid}.tmp`);
  writeFileSync(temp, JSON.stringify(data, null, 2));
  renameSync(temp, join(directory, 'latest.json'));
  const date = new Date(data.crucix?.timestamp || Date.now()).toISOString().replace(/[:.]/g, '-');
  // Only our own server snapshots are pruned; user/CLI archives remain untouched.
  writeFileSync(join(directory, `briefing_server_${date}.json`), JSON.stringify(data));
  const owned = readdirSync(directory).filter(name => /^briefing_server_\d{4}-.*\.json$/.test(name)).sort().reverse();
  for (const name of owned.slice(8)) unlinkSync(join(directory, name));
}
