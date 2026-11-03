#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fullBriefing } from './briefing.mjs';
import { stripMemoryOnlySources } from '../lib/snapshots.mjs';

function formatTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

const runsDir = join(process.cwd(), 'runs');
await mkdir(runsDir, { recursive: true });

const data = await fullBriefing();
const sanitized = stripMemoryOnlySources(data);
const json = JSON.stringify(sanitized, null, 2);
const timestamp = formatTimestamp(new Date(sanitized.crucix?.timestamp || Date.now()));
const runFile = join(runsDir, `briefing_${timestamp}.json`);
const latestFile = join(runsDir, 'latest.json');

await writeFile(runFile, json, 'utf8');
await writeFile(latestFile, json, 'utf8');

console.error(`[Crucix] Saved UTF-8 briefing to ${runFile}`);
console.log(json);
