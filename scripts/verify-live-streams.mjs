#!/usr/bin/env node
/**
 * scripts/verify-live-streams.mjs
 *
 * Official keyless live-stream identifier verification utility for Crucix.
 * Checks embeddability and video status for all registered YouTube streams
 * against YouTube's official oEmbed API without HTML scraping or private APIs.
 *
 * Usage:
 *   node scripts/verify-live-streams.mjs [--strict]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '../data/live-streams.json');

async function checkOEmbed(videoId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Crucix-LiveStream-Verifier/2.0' },
      signal: AbortSignal.timeout(10000)
    });
    return {
      status: res.status,
      ok: res.ok,
      data: res.ok ? await res.json() : null
    };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

export async function verifyAllStreams(options = {}) {
  const raw = readFileSync(REGISTRY_PATH, 'utf8');
  const streams = JSON.parse(raw);
  const results = [];

  console.log(`[Crucix Live Stream Verifier] Checking ${streams.length} registered streams...`);

  for (const stream of streams) {
    if (stream.sourceType === 'youtube' && stream.videoId) {
      const check = await checkOEmbed(stream.videoId);
      const isExpectedOk = stream.embedStatus === 'embeddable';
      const actualAuthor = check.data?.author_name || null;
      const actualTitle = check.data?.title || null;
      const authorMatch = !stream.provider || !actualAuthor ||
        actualAuthor.toLowerCase().includes(stream.provider.toLowerCase()) ||
        stream.provider.toLowerCase().includes(actualAuthor.toLowerCase());
      const isConsistent = check.ok === isExpectedOk && authorMatch;
      results.push({
        id: stream.id,
        name: stream.name,
        videoId: stream.videoId,
        embedStatus: stream.embedStatus,
        status: stream.status,
        httpStatus: check.status,
        isConsistent,
        authorMatch,
        title: actualTitle,
        author: actualAuthor
      });
      const icon = isConsistent ? '✔' : '⚠';
      console.log(`  ${icon} [${stream.id}] videoId=${stream.videoId} -> HTTP ${check.status} | Author: "${actualAuthor || '—'}" | Title: "${actualTitle || 'Unavailable'}"`);
    } else {
      results.push({
        id: stream.id,
        name: stream.name,
        type: stream.type,
        sourceType: stream.sourceType,
        embedStatus: stream.embedStatus,
        status: stream.status,
        isConsistent: true,
        notes: stream.notes
      });
      console.log(`  ℹ [${stream.id}] ${stream.type} (${stream.sourceType}) -> ${stream.status}`);
    }
  }

  const failures = results.filter(r => !r.isConsistent);
  if (failures.length > 0) {
    console.warn(`[Crucix Live Stream Verifier] ⚠ ${failures.length} stream(s) have inconsistent embed status!`);
  } else {
    console.log('[Crucix Live Stream Verifier] ✔ All streams verified and consistent.');
  }

  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyAllStreams().catch(err => {
    console.error('[Crucix Live Stream Verifier] Fatal error:', err);
    process.exit(1);
  });
}
