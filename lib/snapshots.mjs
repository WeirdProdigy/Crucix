import { writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function stripMemoryOnlySources(data) {
  if (!data || typeof data !== 'object') return data;
  let changed = false;
  let clone = data;
  if (data.sources && ('OVF-Gauges' in data.sources || 'ovfGauges' in data.sources)) {
    clone = { ...clone, sources: { ...clone.sources } };
    delete clone.sources['OVF-Gauges'];
    delete clone.sources['ovfGauges'];
    changed = true;
  }
  if ('ovfGauges' in clone || 'OVF-Gauges' in clone) {
    if (!changed) clone = { ...clone };
    delete clone['ovfGauges'];
    delete clone['OVF-Gauges'];
  }
  return clone;
}

export function saveSnapshot(directory, data) {
  const sanitized = stripMemoryOnlySources(data);
  const temp = join(directory, `latest.${process.pid}.tmp`);
  writeFileSync(temp, JSON.stringify(sanitized, null, 2));
  renameSync(temp, join(directory, 'latest.json'));
  const date = new Date(sanitized.crucix?.timestamp || Date.now()).toISOString().replace(/[:.]/g, '-');
  // Only our own server snapshots are pruned; user/CLI archives remain untouched.
  writeFileSync(join(directory, `briefing_server_${date}.json`), JSON.stringify(sanitized));
  const owned = readdirSync(directory).filter(name => /^briefing_server_\d{4}-.*\.json$/.test(name)).sort().reverse();
  for (const name of owned.slice(8)) unlinkSync(join(directory, name));
}
