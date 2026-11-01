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

test('6. HTTP Security: Content-Security-Policy header permits youtube-nocookie frame-src', async t => {
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
    httpSecCode.includes("'Content-Security-Policy': \"frame-src 'self' https://www.youtube-nocookie.com;\""),
    'CSP frame-src rule explicitly whitelists https://www.youtube-nocookie.com'
  );
});

test('9. Institutional operator audit: verified-live webcams must have strictly institutional legal entities, zero private individual names, and honest external-only embedStatus', () => {
  const streams = loadLiveStreams();
  const verifiedWebcams = streams.filter(s => s.type === 'webcam' && s.status === 'verified-live');

  assert.ok(verifiedWebcams.length >= 4, 'Must have at least 4 verified-live webcams');

  // Verify that deb / hajduszoboszlo webcams are present and marked external-only
  const kossuth = verifiedWebcams.find(s => s.id === 'debrecen-kossuth-ter-webcam');
  assert.ok(kossuth, 'Kossuth tér webcam must be registered and verified-live');
  assert.equal(kossuth.url, 'https://www.idokep.hu/webkamera/dmjvcam');
  assert.equal(kossuth.embedStatus, 'external-only');
  assert.ok(kossuth.provider.includes('Önkormányzata'), 'Provider must be municipality');

  const bekas = verifiedWebcams.find(s => s.id === 'debrecen-bekas-to-webcam');
  assert.ok(bekas, 'Békás tó webcam must be registered and verified-live');
  assert.equal(bekas.url, 'https://www.idokep.hu/webkamera/dmjvcam3');
  assert.equal(bekas.embedStatus, 'external-only');
  assert.ok(bekas.provider.includes('Önkormányzata'), 'Provider must be municipality');

  const egyetem = verifiedWebcams.find(s => s.id === 'debrecen-egyetem-ter-webcam');
  assert.ok(egyetem, 'Egyetem tér webcam must be registered and verified-live');
  assert.equal(egyetem.url, 'https://www.idokep.hu/webkamera/deegyetemter');
  assert.equal(egyetem.embedStatus, 'external-only');
  assert.ok(egyetem.provider.includes('Debreceni Egyetem'), 'Provider must be university');

  const aeroclub = verifiedWebcams.find(s => s.id === 'hajduszoboszlo-aeroclub-webcam');
  assert.ok(aeroclub, 'Hajdúszoboszló Aero Club webcam must be registered and verified-live');
  assert.equal(aeroclub.url, 'https://www.idokep.hu/webkamera/lhho2');
  assert.equal(aeroclub.embedStatus, 'external-only');
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
