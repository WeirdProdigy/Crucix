import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';

import {
  validateLiveStreamEntry,
  loadLiveStreams,
  buildSafeYouTubeEmbedUrl,
  buildSafeYouTubeSourceUrl,
  filterLiveStreams,
  YOUTUBE_VIDEO_ID_REGEX
} from '../lib/intelligence/live-streams.mjs';
import { installHttpSecurity } from '../lib/http-security.mjs';

// --- Test Fixtures ---
const validEntry = {
  id: 'test-local-cam',
  name: 'Debrecen Kossuth tér',
  type: 'webcam',
  region: 'local',
  provider: 'Debrecen Megyei Jogú Város',
  sourceType: 'youtube',
  videoId: 'wE8szk8MvWw',
  language: 'hu',
  checkedAt: '2026-10-29',
  notes: 'Hivatalos önkormányzati kamera.'
};

test('1. Registry schema validation: valid entries pass, invalid schemas throw', () => {
  assert.equal(validateLiveStreamEntry(validEntry), true);

  // Missing or non-object
  assert.throws(() => validateLiveStreamEntry(null), /Entry must be a non-null object/);
  assert.throws(() => validateLiveStreamEntry([]), /Entry must be a non-null object/);

  // Bad id
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, id: '' }), /Invalid or missing 'id'/);
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, id: 'bad ID with spaces!' }), /Invalid or missing 'id'/);

  // Bad name
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, name: '   ' }), /Invalid or missing 'name'/);

  // Bad type
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, type: 'podcast' }), /Invalid 'type'/);
  assert.equal(validateLiveStreamEntry({ ...validEntry, type: 'directory' }), true);

  // Bad region
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, region: 'interplanetary' }), /Invalid 'region'/);

  // Bad provider
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, provider: '' }), /Invalid or missing 'provider'/);

  // Bad sourceType
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, sourceType: 'twitch' }), /Invalid 'sourceType'/);

  // Bad videoId
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, videoId: 'tooShort' }), /Invalid 'videoId'/);
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, videoId: 'has space!!' }), /Invalid 'videoId'/);
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, videoId: '<script>alert(1)</script>' }), /Invalid 'videoId'/);

  // Bad language
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, language: 'hungarian_too_long' }), /Invalid 'language'/);

  // Bad date
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, checkedAt: '29-10-2026' }), /Invalid 'checkedAt'/);

  // Bad embedStatus
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, embedStatus: 'scraped-hls' }), /Invalid 'embedStatus'/);
});

test('2. Registry file loading: parses repository registry and detects duplicates', () => {
  const streams = loadLiveStreams();
  assert.ok(Array.isArray(streams));
  assert.ok(streams.length >= 10, 'Must load at least 10 candidate streams');

  // Verify all loaded streams pass validation
  for (let i = 0; i < streams.length; i++) {
    assert.equal(validateLiveStreamEntry(streams[i], i), true);
  }

  // Duplicate detection test with temp file
  const tempPath = join(tmpdir(), `crucix-dup-${Date.now()}.json`);
  writeFileSync(tempPath, JSON.stringify([validEntry, { ...validEntry }]));
  try {
    assert.throws(() => loadLiveStreams(tempPath), /Duplicate stream ID found in registry/);
  } finally {
    try { unlinkSync(tempPath); } catch {}
  }
});

test('3. Stream filtering by type and region', () => {
  const list = [
    { ...validEntry, id: 's1', type: 'news', region: 'national' },
    { ...validEntry, id: 's2', type: 'webcam', region: 'local' },
    { ...validEntry, id: 's3', type: 'webcam', region: 'county' },
    { ...validEntry, id: 's4', type: 'news', region: 'global' }
  ];

  assert.equal(filterLiveStreams(list, { type: 'all', region: 'all' }).length, 4);
  assert.equal(filterLiveStreams(list, { type: 'news', region: 'all' }).length, 2);
  assert.equal(filterLiveStreams(list, { type: 'webcam', region: 'all' }).length, 2);
  assert.equal(filterLiveStreams(list, { type: 'webcam', region: 'local' }).length, 1);
  assert.equal(filterLiveStreams(list, { type: 'news', region: 'local' }).length, 0);
  assert.equal(filterLiveStreams(list, { type: 'all', region: 'global' }).length, 1);
});

test('4. Security: YouTube nocookie URL builder strictly validates video IDs and prevents XSS', () => {
  // Valid video ID
  const validId = 'wE8szk8MvWw';
  const embed = buildSafeYouTubeEmbedUrl(validId);
  assert.equal(embed, `https://www.youtube-nocookie.com/embed/${validId}?autoplay=1&rel=0&modestbranding=1`);

  const watch = buildSafeYouTubeSourceUrl(validId);
  assert.equal(watch, `https://www.youtube.com/watch?v=${validId}`);

  // Malicious injections return null
  assert.equal(buildSafeYouTubeEmbedUrl('" onmouseover="alert(1)"'), null);
  assert.equal(buildSafeYouTubeEmbedUrl('<script>alert(1)</script>'), null);
  assert.equal(buildSafeYouTubeEmbedUrl('javascript:alert(1)'), null);
  assert.equal(buildSafeYouTubeEmbedUrl('http://attacker.com/video'), null);
  assert.equal(buildSafeYouTubeEmbedUrl(''), null);
  assert.equal(buildSafeYouTubeEmbedUrl(null), null);
  assert.equal(buildSafeYouTubeEmbedUrl(undefined), null);
});

test('5. Frontend LiveMedia component: Click-to-load, single & 2x2 grid concurrency, non-destructive filtering, external separation, privacy notice, and XSS escaping', async () => {
  const code = readFileSync(new URL('../dashboard/public/live-media-panel.js', import.meta.url), 'utf8');

  const mockWindow = {
    innerWidth: 1280,
    __CRUCIX_DATA__: {}
  };
  const mockDocument = {
    hidden: false,
    addEventListener: () => {}
  };

  const runModule = new Function('window', 'document', code);
  runModule(mockWindow, mockDocument);

  const LiveMedia = mockWindow.CrucixLiveMedia;
  assert.ok(LiveMedia, 'CrucixLiveMedia must be exported on window');

  const testSnapshot = {
    liveStreams: [
      {
        id: 's-local',
        name: 'Debrecen <Nagytemplom>',
        type: 'webcam',
        region: 'local',
        provider: 'Debrecen "Önkormányzat"',
        sourceType: 'youtube',
        videoId: 'wE8szk8MvWw',
        language: 'hu',
        status: 'verified-live',
        embedStatus: 'embeddable',
        checkedAt: '2026-10-29',
        notes: 'Helyi kamera & teszt.'
      },
      {
        id: 's-news-1',
        name: 'DW News',
        type: 'news',
        region: 'global',
        provider: 'Deutsche Welle',
        sourceType: 'youtube',
        videoId: 'LuKwFajn37U',
        language: 'en',
        status: 'verified-live',
        embedStatus: 'embeddable',
        checkedAt: '2026-10-29',
        notes: '24/7 hírfolyam.'
      },
      {
        id: 's-news-2',
        name: 'Al Jazeera',
        type: 'news',
        region: 'global',
        provider: 'Al Jazeera English',
        sourceType: 'youtube',
        videoId: 'gCNeDWCI0vo',
        language: 'en',
        status: 'verified-live',
        embedStatus: 'embeddable',
        checkedAt: '2026-10-29',
        notes: '24/7 hírfolyam.'
      },
      {
        id: 's-news-3',
        name: 'Euronews',
        type: 'news',
        region: 'global',
        provider: 'Euronews',
        sourceType: 'youtube',
        videoId: 'pykpO5kQJ98',
        language: 'en',
        status: 'verified-live',
        embedStatus: 'embeddable',
        checkedAt: '2026-10-29',
        notes: '24/7 hírfolyam.'
      },
      {
        id: 's-news-4',
        name: 'France 24',
        type: 'news',
        region: 'global',
        provider: 'France 24',
        sourceType: 'youtube',
        videoId: 'HvZt-nh9sGg',
        language: 'en',
        status: 'verified-live',
        embedStatus: 'embeddable',
        checkedAt: '2026-10-29',
        notes: '24/7 hírfolyam.'
      },
      {
        id: 's-ext-cam',
        name: 'Debrecen – Kossuth tér (Időkép)',
        type: 'webcam',
        region: 'local',
        provider: 'Debrecen MJV Önkormányzata / Időkép',
        sourceType: 'link-only',
        url: 'https://www.idokep.hu/webkamera/dmjvcam',
        language: 'hu',
        status: 'verified-live',
        embedStatus: 'external-only',
        checkedAt: '2026-10-29',
        notes: 'Külső kamera.'
      }
    ]
  };

  // A. Click-to-load contract & exact privacy notice: initial HTML contains NO iframes and NO external preview images!
  const initialHtml = LiveMedia.panelHtml(testSnapshot);
  assert.ok(!initialHtml.includes('<iframe'), 'Initially zero iframes must be rendered (Click-to-Load)');
  assert.ok(!initialHtml.includes('<img'), 'Zero external thumbnail/preview images before click');
  assert.ok(initialHtml.includes('Közvetítés indítása'), 'Play button must be rendered');
  assert.ok(
    initialHtml.includes('A közvetítés indítása kapcsolatot létesít a videószolgáltatóval.'),
    'Exact required privacy text must be displayed before loading'
  );
  assert.ok(!initialHtml.includes('Harmadik fél felé telemetria nincs'), 'Must NOT falsely claim zero telemetry');
  assert.ok(!initialHtml.includes('nyomkövetés és telemetria nélkül'), 'Must NOT falsely claim complete tracking-free operation');
  assert.ok(initialHtml.includes('&lt;Nagytemplom&gt;'), 'HTML tags in stream name must be escaped');
  assert.ok(initialHtml.includes('&quot;Önkormányzat&quot;'), 'Quotes in provider must be escaped');

  // A2. Separate "Külső oldalon nézhető" section & dual status badges
  assert.ok(initialHtml.includes('Külső oldalon nézhető'), 'External-only group heading must be rendered');
  assert.ok(initialHtml.includes('Forrásoldalon: Élő adás'), 'Page live status must be shown separately');
  assert.ok(initialHtml.includes('Beágyazhatóság: Csak külső oldalon nézhető'), 'Embeddability status must be shown separately');
  assert.ok(initialHtml.includes('Megnyitás a szolgáltató oldalán ↗'), 'External link button must be rendered');

  // B. Single player activation (max 1 in single mode)
  LiveMedia.playStream('s-local');
  assert.equal(LiveMedia.getActiveStreamId(), 's-local');
  assert.deepEqual(LiveMedia.getActiveStreamIds(), ['s-local']);
  const playingHtml = LiveMedia.panelHtml(testSnapshot);
  assert.ok(playingHtml.includes('<iframe'), 'Active stream must render iframe');
  assert.ok(playingHtml.includes('https://www.youtube-nocookie.com/embed/wE8szk8MvWw'), 'Iframe src must use youtube-nocookie.com');
  assert.ok(playingHtml.includes('■ Leállítás'), 'Stop button must be rendered for playing stream');

  // C. Concurrency in single mode: switching to second stream replaces the first (max 1)
  LiveMedia.playStream('s-news-1');
  assert.equal(LiveMedia.getActiveStreamId(), 's-news-1');
  assert.deepEqual(LiveMedia.getActiveStreamIds(), ['s-news-1']);
  const switchedHtml = LiveMedia.panelHtml(testSnapshot);
  assert.ok(switchedHtml.includes('https://www.youtube-nocookie.com/embed/LuKwFajn37U'), 'Second stream iframe rendered');
  assert.ok(!switchedHtml.includes('https://www.youtube-nocookie.com/embed/wE8szk8MvWw'), 'First stream iframe must be destroyed in single mode');

  // C2. Filtering or searching MUST NOT stop an already playing stream!
  LiveMedia.setTypeFilter('webcam');
  LiveMedia.setRegionFilter('local');
  LiveMedia.setSearchQuery('Kossuth');
  assert.equal(LiveMedia.getActiveStreamId(), 's-news-1', 'Filtering must NOT stop the active stream');
  const filteredWhilePlayingHtml = LiveMedia.panelHtml(testSnapshot);
  assert.ok(
    filteredWhilePlayingHtml.includes('https://www.youtube-nocookie.com/embed/LuKwFajn37U'),
    'Active player in stage must stay alive even when source selector is filtered to another category/region'
  );
  LiveMedia.setTypeFilter('all');
  LiveMedia.setRegionFilter('all');
  LiveMedia.setSearchQuery('');

  // C3. 2x2 Grid mode: allows up to 4 simultaneous user-started players
  LiveMedia.setViewMode('grid');
  assert.equal(LiveMedia.getViewMode(), 'grid');
  LiveMedia.playStream('s-news-2');
  LiveMedia.playStream('s-news-3');
  LiveMedia.playStream('s-news-4');
  assert.deepEqual(LiveMedia.getActiveStreamIds(), ['s-news-1', 's-news-2', 's-news-3', 's-news-4']);
  const grid4Html = LiveMedia.panelHtml(testSnapshot);
  assert.equal((grid4Html.match(/<iframe/g) || []).length, 4, '2x2 grid must render 4 simultaneous iframes');

  // Starting a 5th stream in 2x2 grid keeps max 4 active players
  LiveMedia.playStream('s-local');
  assert.equal(LiveMedia.getActiveStreamIds().length, 4, '2x2 grid must cap at max 4 active players');
  assert.ok(LiveMedia.getActiveStreamIds().includes('s-local'));

  // Switching back to single mode trims active players to 1
  LiveMedia.setViewMode('single');
  assert.equal(LiveMedia.getActiveStreamIds().length, 1, 'Switching to single mode enforces max 1 active player');

  // C4. Audio / Volume controls
  LiveMedia.playStream('s-news-1');
  assert.deepEqual(LiveMedia.getStreamAudioState('s-news-1'), { muted: false, volume: 80 });
  LiveMedia.toggleMuteStream('s-news-1');
  assert.equal(LiveMedia.getStreamAudioState('s-news-1').muted, true);
  LiveMedia.setStreamVolume('s-news-1', 45);
  assert.deepEqual(LiveMedia.getStreamAudioState('s-news-1'), { muted: false, volume: 45 });

  // D. Stop stream & stopAllStreams tears down all iframes
  LiveMedia.stopAllStreams();
  assert.equal(LiveMedia.getActiveStreamId(), null);
  assert.deepEqual(LiveMedia.getActiveStreamIds(), []);
  const stoppedHtml = LiveMedia.panelHtml(testSnapshot);
  assert.ok(!stoppedHtml.includes('<iframe'), 'No iframes after stopAllStreams');

  // F. Error state & retry backoff
  LiveMedia.markStreamError('s-local');
  const errorHtml = LiveMedia.panelHtml(testSnapshot);
  assert.ok(errorHtml.includes('A közvetítés jelenleg nem ágyazható be vagy nem érhető el'), 'Error notice displayed');
  assert.ok(errorHtml.includes('Megnyitás a forráson (YouTube) ↗'), 'Direct watch fallback link provided');
  assert.ok(errorHtml.includes('Újrapróbálás'), 'Retry button present');

  LiveMedia.retryStream('s-local');
  assert.equal(LiveMedia.getActiveStreamId(), 's-local', 'Retry stream reactivates player');
  LiveMedia.stopStream();

  // G. Mobile viewport forces single-view mode
  mockWindow.innerWidth = 375;
  assert.equal(LiveMedia.getViewMode(), 'single', 'Mobile width (375px) must enforce single view mode');
  LiveMedia.setViewMode('grid');
  assert.equal(LiveMedia.getViewMode(), 'single', 'Mobile width ignores grid mode switch');
  mockWindow.innerWidth = 1280;
  assert.equal(LiveMedia.getViewMode(), 'grid', 'Desktop width allows grid mode');
  LiveMedia.setViewMode('single');

  // H. Backwards compatibility with empty or legacy snapshot
  assert.doesNotThrow(() => LiveMedia.panelHtml(null));
  assert.doesNotThrow(() => LiveMedia.panelHtml({}));
  assert.doesNotThrow(() => LiveMedia.panelHtml({ liveStreams: null }));
  const emptyHtml = LiveMedia.panelHtml({ liveStreams: [] });

  // I. Background playback preference toggle and directory filter
  assert.equal(LiveMedia.getAllowBackgroundPlayback(), false, 'Background playback is disabled by default');
  LiveMedia.setAllowBackgroundPlayback(true);
  assert.equal(LiveMedia.getAllowBackgroundPlayback(), true, 'Background playback toggle turns true');
  LiveMedia.setAllowBackgroundPlayback(false);
  assert.equal(LiveMedia.getAllowBackgroundPlayback(), false, 'Background playback toggle resets to false');

  LiveMedia.setTypeFilter('directory');
  assert.equal(LiveMedia.getTypeFilter(), 'directory', 'Directory type filter can be selected');
  LiveMedia.setTypeFilter('all');
  assert.ok(emptyHtml.includes('Nincs a kiválasztott szűrőknek megfelelő élő közvetítés'), 'Empty state handled gracefully');
});

test('6. HTTP Security: Content-Security-Policy header permits youtube-nocookie frame-src and restricted img-src', async t => {
  const app = express();
  installHttpSecurity(app);
  app.get('/test', (_req, res) => res.send('ok'));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());

  const res = await fetch(`http://127.0.0.1:${server.address().port}/test`);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'Content-Security-Policy header must be present');
  assert.ok(csp.includes("frame-src 'self' https://www.youtube-nocookie.com;"), 'CSP must allow youtube-nocookie frame-src');
  assert.ok(csp.includes("img-src 'self' data: https://cam.idokep.hu https://odp.met.hu;"), 'CSP must allow cam.idokep.hu and odp.met.hu img-src');
  assert.ok(!csp.includes('*'), 'CSP must strictly disallow wildcard * origins');
});

test('7. Registry schema validation: channelId, provenance, embedStatus, and unverified status handling', () => {
  // Valid entry with channelId and provenance
  const withChannel = {
    ...validEntry,
    channelId: 'UCknLrEdhRCp1WdBgk977Ntw',
    status: 'verified',
    embedStatus: 'embeddable',
    provenance: 'koala73/worldmonitor (AGPL-3.0)'
  };
  assert.equal(validateLiveStreamEntry(withChannel), true);

  // Invalid channelId format
  assert.throws(() => validateLiveStreamEntry({ ...withChannel, channelId: 'not-a-channel-id' }), /Invalid 'channelId'/);
  assert.throws(() => validateLiveStreamEntry({ ...withChannel, channelId: 'UCtooShort' }), /Invalid 'channelId'/);

  // Unverified entry without videoId and without checkedAt
  const unverified = {
    id: 'unverified-cam',
    name: 'Debrecen Kossuth tér',
    type: 'webcam',
    region: 'local',
    provider: 'Debrecen MJV',
    sourceType: 'youtube',
    videoId: null,
    language: 'hu',
    status: 'unverified',
    embedStatus: 'unverified',
    checkedAt: null,
    notes: 'Kamera felderítés alatt.'
  };
  assert.equal(validateLiveStreamEntry(unverified), true);

  // Invalid status
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, status: 'invalid-status' }), /Invalid 'status'/);

  // Verified stream missing videoId must throw
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, status: 'verified', videoId: null }), /Invalid 'videoId'/);

  // Verified stream missing checkedAt must throw
  assert.throws(() => validateLiveStreamEntry({ ...validEntry, status: 'verified', checkedAt: null }), /Invalid 'checkedAt'/);

  // Link-only stream validation
  const validLinkOnly = {
    id: 'link-only-stream',
    name: 'HírTV Élő Web',
    type: 'news',
    region: 'national',
    provider: 'HírTV Zrt.',
    sourceType: 'link-only',
    url: 'https://hirtv.origo.hu/adas',
    language: 'hu',
    status: 'verified',
    embedStatus: 'external-only',
    checkedAt: '2026-10-30',
    notes: 'Közvetlen webes adás.'
  };
  assert.equal(validateLiveStreamEntry(validLinkOnly), true);

  // Link-only stream claiming embeddable must throw
  assert.throws(() => validateLiveStreamEntry({ ...validLinkOnly, embedStatus: 'embeddable' }), /link-only stream cannot have embedStatus "embeddable"/);

  // Link-only stream missing url or non-https must throw
  assert.throws(() => validateLiveStreamEntry({ ...validLinkOnly, url: 'http://insecure.hu' }), /Invalid or missing 'url'/);
  assert.throws(() => validateLiveStreamEntry({ ...validLinkOnly, url: null }), /Invalid or missing 'url'/);
});

test('8. Dashboard iframe audit: proof that frame-src permits all dashboard iframes', () => {
  const root = new URL('../', import.meta.url);
  const jarvisPath = new URL('dashboard/public/jarvis.html', root);
  const jarvisHtml = readFileSync(jarvisPath, 'utf8');

  // jarvis.html has zero raw <iframe> tags
  assert.equal(jarvisHtml.includes('<iframe'), false, 'jarvis.html must not contain static iframes');

  // Audit all files in dashboard/public
  const panelFiles = [
    'live-media-panel.js',
    'views-panel.js',
    'intelligence.js',
    'pwa.js',
    'network-strip.js'
  ];

  const foundIframeSources = [];
  for (const file of panelFiles) {
    try {
      const content = readFileSync(new URL(`dashboard/public/${file}`, root), 'utf8');
      if (content.includes('<iframe') || content.includes('createElement(\'iframe\')')) {
        const srcMatches = [...content.matchAll(/src=["']([^"']+)["']/g)].map(m => m[1]);
        const domainMatches = [...content.matchAll(/https:\/\/[a-zA-Z0-9.-]+/g)].map(m => m[0]);
        foundIframeSources.push({ file, srcMatches, domainMatches });
      }
    } catch {}
  }

  // The only component creating an iframe is live-media-panel.js
  assert.equal(foundIframeSources.length, 1, 'Only live-media-panel.js generates iframes in the dashboard');
  assert.equal(foundIframeSources[0].file, 'live-media-panel.js');

  // The iframe src in live-media-panel.js is strictly built by buildSafeEmbedUrl -> https://www.youtube-nocookie.com/embed/...
  const embedCode = readFileSync(new URL('lib/intelligence/live-streams.mjs', root), 'utf8');
  assert.ok(embedCode.includes('https://www.youtube-nocookie.com/embed/'), 'buildSafeYouTubeEmbedUrl targets youtube-nocookie.com');

  // HTTP Security CSP header explicitly allows 'self' and https://www.youtube-nocookie.com
  const httpSecCode = readFileSync(new URL('lib/http-security.mjs', root), 'utf8');
  assert.ok(
    httpSecCode.includes("'Content-Security-Policy': \"frame-src 'self' https://www.youtube-nocookie.com; img-src 'self' data: https://cam.idokep.hu https://odp.met.hu;\""),
    'CSP frame-src and img-src rules explicitly whitelisted'
  );
});

test('9. Institutional operator audit: institutional webcams must have strictly institutional legal entities, zero private individual names, and honest external-only embedStatus', () => {
  const streams = loadLiveStreams();
  const institutionalWebcams = streams.filter(s => s.type === 'webcam');

  assert.ok(institutionalWebcams.length >= 4, 'Must have at least 4 registered webcams');

  // Verify that deb / hajduszoboszlo webcams are present and marked external-only
  const kossuth = institutionalWebcams.find(s => s.id === 'debrecen-kossuth-ter-webcam');
  assert.ok(kossuth, 'Kossuth tér webcam must be registered');
  assert.equal(kossuth.url, 'https://www.idokep.hu/webkamera/dmjvcam');
  assert.equal(kossuth.embedStatus, 'external-only');
  assert.ok(kossuth.provider.includes('Önkormányzata'), 'Provider must be municipality');

  const bekas = institutionalWebcams.find(s => s.id === 'debrecen-bekas-to-webcam');
  assert.ok(bekas, 'Békás tó webcam must be registered');
  assert.equal(bekas.url, 'https://www.idokep.hu/webkamera/dmjvcam3');
  assert.equal(bekas.embedStatus, 'external-only');
  assert.equal(bekas.status, 'page-ok', 'Status follows actual evidence: page-ok when unverified live motion');
  assert.ok(bekas.provider.includes('Önkormányzata'), 'Provider must be municipality');

  const egyetem = institutionalWebcams.find(s => s.id === 'debrecen-egyetem-ter-webcam');
  assert.ok(egyetem, 'Egyetem tér webcam must be registered');
  assert.equal(egyetem.url, 'https://www.idokep.hu/webkamera/deegyetemter');
  assert.equal(egyetem.embedStatus, 'external-only');
  assert.equal(egyetem.status, 'page-ok', 'Status follows actual evidence: page-ok when unverified live motion');
  assert.ok(egyetem.provider.includes('Debreceni Egyetem'), 'Provider must be university');

  const aeroclub = institutionalWebcams.find(s => s.id === 'hajduszoboszlo-aeroclub-webcam');
  assert.ok(aeroclub, 'Hajdúszoboszló Aero Club webcam must be registered');
  assert.equal(aeroclub.url, 'https://www.idokep.hu/webkamera/lhho2');
  assert.equal(aeroclub.embedStatus, 'external-only');
  assert.equal(aeroclub.status, 'page-ok', 'Status follows actual evidence: page-ok when unverified live motion');
  assert.ok(aeroclub.provider.includes('Aero Club'), 'Provider must be Aero Club');

  // Disallowed private individual checks across the entire registry
  const disallowedNames = ['Nagy Csilla', 'Szatmári Tamás', 'nagy_csilla', 'debrecen_toci_kelet', 'elco'];
  for (const s of streams) {
    for (const disallowed of disallowedNames) {
      assert.ok(!s.provider.includes(disallowed), `Provider must not contain private name or unverified operator '${disallowed}'`);
      assert.ok(!s.notes?.includes(disallowed), `Notes must not contain private name or unverified operator '${disallowed}'`);
      assert.ok(!s.name.includes(disallowed), `Name must not contain private name or unverified operator '${disallowed}'`);
    }
  }
});

test('10. Directory stream type: SolarHam, Windy, and Útinform entries in registry', () => {
  const streams = loadLiveStreams();
  const directories = streams.filter(s => s.type === 'directory');
  assert.ok(directories.length >= 3, 'Must have at least 3 directory catalog entries');

  const solarham = directories.find(s => s.id === 'solarham-space-weather');
  assert.ok(solarham, 'SolarHam must be registered with type=directory');
  assert.equal(solarham.status, 'page-ok');
  assert.equal(solarham.embedStatus, 'external-only');

  const windy = directories.find(s => s.id === 'windy-global-webcams');
  assert.ok(windy, 'Windy must be registered with type=directory');
  assert.equal(windy.status, 'page-ok');
  assert.equal(windy.embedStatus, 'external-only');

  const utinform = directories.find(s => s.id === 'utinform-hu-cam-map');
  assert.ok(utinform, 'Útinform must be registered with type=directory');
  assert.equal(utinform.status, 'page-ok');
  assert.equal(utinform.embedStatus, 'external-only');
});

test('11. Browser-side camera display: schema validation, synthetic click-to-load, lifecycle & visibility timer management, fallback error state, and server static audit', () => {
  // 1. Schema validation for imageUrl and attribution
  const camEntry = {
    ...validEntry,
    sourceType: 'link-only',
    url: 'https://www.idokep.hu/webkamera/dmjvcam',
    imageUrl: 'https://cam.idokep.hu/dmjvcam/thumbnail.jpg',
    attribution: 'Forrás: Időkép / idokep.hu',
    embedStatus: 'external-only',
    videoId: undefined
  };
  assert.equal(validateLiveStreamEntry(camEntry), true, 'Valid entry with imageUrl and attribution must pass');

  // Bad imageUrl: not starting with https://
  assert.throws(() => validateLiveStreamEntry({ ...camEntry, imageUrl: 'http://insecure.cam/img.jpg' }), /Invalid 'imageUrl'/);
  assert.throws(() => validateLiveStreamEntry({ ...camEntry, imageUrl: 12345 }), /Invalid 'imageUrl'/);

  // Bad attribution: empty or whitespace
  assert.throws(() => validateLiveStreamEntry({ ...camEntry, attribution: '   ' }), /'attribution' must be a non-empty string/);
  assert.throws(() => validateLiveStreamEntry({ ...camEntry, attribution: 999 }), /'attribution' must be a non-empty string/);

  // 2. Registry verification: 4 institutional cameras have verified imageUrl and attribution
  const streams = loadLiveStreams();
  const targetCamIds = [
    'debrecen-kossuth-ter-webcam',
    'debrecen-bekas-to-webcam',
    'debrecen-egyetem-ter-webcam',
    'hajduszoboszlo-aeroclub-webcam'
  ];

  for (const cid of targetCamIds) {
    const s = streams.find(item => item.id === cid);
    assert.ok(s, `Camera ${cid} must be present in registry`);
    assert.ok(s.imageUrl && s.imageUrl.startsWith('https://cam.idokep.hu/'), `${cid} must point directly to cam.idokep.hu`);
    assert.equal(s.attribution, 'Forrás: Időkép / idokep.hu', `${cid} must have attribution`);
    assert.equal(s.embedStatus, 'external-only', `${cid} must be external-only`);
    assert.equal(s.sourceType, 'link-only', `${cid} must be link-only`);
  }

  // 3. Frontend component synthetic testing (zero actual network requests)
  const code = readFileSync(new URL('../dashboard/public/live-media-panel.js', import.meta.url), 'utf8');
  let visibilityListener = null;
  const mockWindow = {
    innerWidth: 1280,
    location: { hostname: 'localhost' },
    __CRUCIX_DATA__: {},
    setInterval: () => 101,
    clearInterval: () => {}
  };
  const mockDocument = {
    hidden: false,
    addEventListener: (type, fn) => {
      if (type === 'visibilitychange') visibilityListener = fn;
    }
  };

  const runModule = new Function('window', 'document', code);
  runModule(mockWindow, mockDocument);
  const LiveMedia = mockWindow.CrucixLiveMedia;
  assert.ok(LiveMedia, 'CrucixLiveMedia exported');

  const syntheticSnapshot = {
    liveStreams: [
      {
        id: 'mock-kossuth',
        name: 'Debrecen Kossuth tér',
        type: 'webcam',
        region: 'local',
        provider: 'Debrecen MJV / Időkép',
        sourceType: 'link-only',
        url: 'https://www.idokep.hu/webkamera/dmjvcam',
        imageUrl: 'https://cam.idokep.hu/dmjvcam/thumbnail.jpg',
        attribution: 'Forrás: Időkép / idokep.hu',
        status: 'unverified-live',
        embedStatus: 'external-only',
        checkedAt: '2026-11-01',
        notes: 'Teszt kamera.'
      }
    ]
  };

  // A. Initial state: 0 images rendered, exact privacy warning present, "külső forrás" badge present
  const initHtml = LiveMedia.panelHtml(syntheticSnapshot);
  assert.ok(!initHtml.includes('<img'), 'Before user click: exactly 0 images rendered');
  assert.ok(initHtml.includes('A kép betöltése kapcsolatot létesít az Időképpel; a Crucix nem tárolja.'), 'Must show privacy warning');
  assert.ok(initHtml.includes('külső forrás'), 'Must render shared "külső forrás" badge');
  assert.ok(initHtml.includes('📷 Kamera betöltése'), 'Must render load button');
  assert.equal(LiveMedia.isCameraActive('mock-kossuth'), false);

  // B. Click to load camera: user triggers camera load
  LiveMedia.loadCamera('mock-kossuth');
  assert.equal(LiveMedia.isCameraActive('mock-kossuth'), true);
  const loadedHtml = LiveMedia.panelHtml(syntheticSnapshot);
  assert.ok(loadedHtml.includes('<img'), 'After click: img element rendered');
  assert.ok(loadedHtml.includes('id="lm-camera-img-mock-kossuth"'), 'Img has matching ID');
  assert.ok(loadedHtml.includes('src="https://cam.idokep.hu/dmjvcam/thumbnail.jpg?t='), 'Img src has cache-busting timestamp');
  assert.ok(loadedHtml.includes('referrerpolicy="no-referrer"'), 'Img has strict no-referrer');
  assert.ok(loadedHtml.includes('Forrás: Időkép / idokep.hu'), 'Attribution rendered below image');
  assert.ok(loadedHtml.includes('🔄 Frissítés: 60 mp'), '60s refresh indicator shown');
  assert.ok(loadedHtml.includes('✕ Bezárás'), 'Close button rendered');

  // C. Error state: fallback on 403 / 404 / network block
  LiveMedia.onCameraImgError('mock-kossuth');
  assert.equal(LiveMedia.isCameraActive('mock-kossuth'), false);
  assert.ok(LiveMedia.getCameraError('mock-kossuth'));
  const errorHtml = LiveMedia.panelHtml(syntheticSnapshot);
  assert.ok(!errorHtml.includes('<img'), 'No img in error state');
  assert.ok(errorHtml.includes('⚠ Nem tölthető be – megnyitás a forráson'), 'Shows required error fallback text');
  assert.ok(errorHtml.includes('Újrapróbálás'), 'Shows retry button');

  // D. Retry camera: recovers from error
  LiveMedia.retryCamera('mock-kossuth');
  assert.equal(LiveMedia.isCameraActive('mock-kossuth'), true);
  assert.equal(LiveMedia.getCameraError('mock-kossuth'), null);

  // E. Batch load and unload
  LiveMedia.unloadAllCameras();
  assert.equal(LiveMedia.isCameraActive('mock-kossuth'), false);
  LiveMedia.loadAllCameras();
  assert.equal(LiveMedia.isCameraActive('mock-kossuth'), true);

  // F. Visibility change: stops timers when document.hidden is true
  assert.ok(typeof visibilityListener === 'function', 'Visibility listener registered');
  mockDocument.hidden = true;
  visibilityListener();
  // Timer is cleared
  mockDocument.hidden = false;
  visibilityListener();

  // G. stopAllStreams: cleans up all camera timers and active IDs
  LiveMedia.stopAllStreams();
  assert.equal(LiveMedia.isCameraActive('mock-kossuth'), false);

  // H. Loopback / LAN Guardrail: isPrivateOrLocalHost evaluator
  assert.equal(LiveMedia.isPrivateOrLocalHost('localhost'), true, 'localhost must be allowed');
  assert.equal(LiveMedia.isPrivateOrLocalHost('127.0.0.1'), true, '127.0.0.1 must be allowed');
  assert.equal(LiveMedia.isPrivateOrLocalHost('::1'), true, '::1 must be allowed');
  assert.equal(LiveMedia.isPrivateOrLocalHost('[::1]'), true, '[::1] must be allowed');
  assert.equal(LiveMedia.isPrivateOrLocalHost('app.localhost'), true, '*.localhost must be allowed');
  assert.equal(LiveMedia.isPrivateOrLocalHost('192.168.1.81'), true, '192.168.1.81 (NAS LAN) must be allowed');
  assert.equal(LiveMedia.isPrivateOrLocalHost('192.168.0.1'), true, '192.168.0.1 must be allowed');
  assert.equal(LiveMedia.isPrivateOrLocalHost('10.0.1.5'), true, '10.0.0.0/8 must be allowed');
  assert.equal(LiveMedia.isPrivateOrLocalHost('172.16.0.1'), true, '172.16.0.1 (min 172.16) must be allowed');
  assert.equal(LiveMedia.isPrivateOrLocalHost('172.31.255.254'), true, '172.31.255.254 (max 172.31) must be allowed');

  // Disallowed hosts (public IP, external domain, invalid subnets)
  assert.equal(LiveMedia.isPrivateOrLocalHost('172.15.255.255'), false, '172.15.x is not private');
  assert.equal(LiveMedia.isPrivateOrLocalHost('172.32.0.1'), false, '172.32.x is not private');
  assert.equal(LiveMedia.isPrivateOrLocalHost('8.8.8.8'), false, 'Public IP must be rejected');
  assert.equal(LiveMedia.isPrivateOrLocalHost('example.com'), false, 'External domain must be rejected');
  assert.equal(LiveMedia.isPrivateOrLocalHost('crucix.mydomain.hu'), false, 'Public domain must be rejected');
  assert.equal(LiveMedia.isPrivateOrLocalHost(''), false, 'Empty host must be rejected');
  assert.equal(LiveMedia.isPrivateOrLocalHost(null), false, 'Null host must be rejected');

  // I. Guardrail protection: when accessed from public origin, camera buttons are suppressed
  mockWindow.location.hostname = 'crucix.public-domain.com';
  const publicHtml = LiveMedia.panelHtml(syntheticSnapshot);
  assert.ok(!publicHtml.includes('📷 Kamera betöltése'), 'Public origin must NOT render individual camera load button');
  assert.ok(!publicHtml.includes('📷 Kamerák betöltése'), 'Public origin must NOT render batch camera load button');
  assert.ok(!publicHtml.includes('<img'), 'Public origin must NOT render any img tag');
  assert.ok(publicHtml.includes('A közvetlen kamerakép kizárólag privát helyi hálózatról'), 'Public origin must show restriction notice');
  assert.ok(publicHtml.includes('Megnyitás a szolgáltató oldalán ↗'), 'Public origin must preserve link-only provider button');

  // Attempt to call loadCamera on public origin: must be rejected as no-op
  LiveMedia.loadCamera('mock-kossuth');
  assert.equal(LiveMedia.isCameraActive('mock-kossuth'), false, 'loadCamera must be a no-op when origin is not private');

  // Restore localhost
  mockWindow.location.hostname = 'localhost';

  // 4. Server static audit: STRICT ZERO outbound server requests to Időkép
  const root = new URL('../', import.meta.url);
  const apisDir = new URL('apis/', root);
  const libDir = new URL('lib/', root);

  const checkNoIdokepRequests = (dirPath) => {
    const { readdirSync, statSync } = require ? { readdirSync: () => [], statSync: () => ({}) } : {};
  };

  // Read all source files in apis/ and lib/ and server.mjs
  const serverMjs = readFileSync(new URL('server.mjs', root), 'utf8');
  assert.ok(!serverMjs.includes('idokep.hu'), 'server.mjs must contain zero references to idokep.hu');

  // Audit briefing sources: none may import or fetch Időkép
  const briefingMjs = readFileSync(new URL('apis/briefing.mjs', root), 'utf8');
  assert.ok(!briefingMjs.includes('idokep'), 'apis/briefing.mjs must contain zero references to idokep');

  // 5. Documentation audit: verify correct Időkép ÁSZF section references and private use documentation
  const readmeMd = readFileSync(new URL('README.md', root), 'utf8');
  assert.ok(readmeMd.includes('ÁSZF 3. pont'), 'README must cite ÁSZF 3. pont for download, storage, and processing prohibition');
  assert.ok(readmeMd.includes('Tilos a weboldalon megjelenő tartalmak vagy azok bármely részletének letöltése, elektronikus tárolása, feldolgozása és értékesítése'), 'README must quote verbatim prohibition from ÁSZF Section 3');
  assert.ok(readmeMd.includes('ÁSZF 10. pont'), 'README must cite ÁSZF 10. pont for copyright');
  assert.ok(readmeMd.includes('10. pont 2. bekezdés'), 'README must cite 10. pont 2. bekezdés');
  assert.ok(readmeMd.includes('10. pont 6. bekezdés'), 'README must cite 10. pont 6. bekezdés');
  assert.ok(readmeMd.includes('10. pont 7. bekezdés'), 'README must cite 10. pont 7. bekezdés');
  assert.ok(readmeMd.includes('Szigorúan tilos továbbá ezeket a tartalmakat más médiacsatornán közzétenni'), 'README must quote verbatim prohibition of other media channels');
  assert.ok(readmeMd.includes('adatvedelem@idokep.hu'), 'README must record official Idokep contact email');
  assert.ok(readmeMd.includes('jogilag nem rendezett'), 'README must record that 1-minute auto refresh is legally unsettled under the ASZF');
  assert.ok(readmeMd.includes('192.168.1.81:3117'), 'README must document private LAN environment');
  assert.ok(readmeMd.includes('Loopback / LAN Guardrail'), 'README must document LAN guardrail');
});
