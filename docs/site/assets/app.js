/* Crucix site — behaviour: i18n, GSAP scroll choreography, interactive demos, globe state machine */
(function () {
  'use strict';
  const C = window.CRUCIX_CONTENT; const D = window.CRUCIX_DATA;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasHover = window.matchMedia('(hover: hover)').matches;
  const gs = window.gsap;
  if (gs && window.ScrollTrigger) gs.registerPlugin(window.ScrollTrigger, window.ScrambleTextPlugin);
  const rand = (a, b) => a + Math.random() * (b - a);
  const NS = 'http://www.w3.org/2000/svg';

  /* ---------------- language ---------------- */
  let lang = 'hu';
  try { const s = localStorage.getItem('crucix-site-lang'); if (s === 'hu' || s === 'en') lang = s; } catch (e) { /* storage blocked */ }
  const t = (k) => C[lang][k];
  const binders = [];
  const bind = (el, fn) => { binders.push([el, fn]); fn(el); return el; };
  const pick = (o) => o[lang];

  function applyLang() {
    document.documentElement.lang = lang; document.documentElement.dataset.lang = lang;
    document.title = t('title');
    $$('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === lang)));
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    $$('[data-i18n-list]').forEach((el) => { el.innerHTML = t(el.dataset.i18nList).map((x) => `<li>${x}</li>`).join(''); });
    binders.forEach(([el, fn]) => fn(el));
  }
  $$('[data-set-lang]').forEach((b) => b.addEventListener('click', () => {
    lang = b.dataset.setLang; try { localStorage.setItem('crucix-site-lang', lang); } catch (e) { /* ignore */ }
    applyLang();
  }));

  /* ---------------- icons ---------------- */
  const IC = {
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    alerts: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    risk: '<path d="M12 21a9 9 0 1 1 9-9"/><path d="M12 12l5-5"/><circle cx="12" cy="12" r="1.2"/>',
    briefing: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    inspector: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
    palette: '<path d="M4 17l6-6-6-6M12 19h8"/>',
    replay: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    health: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    export: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    bots: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
    llm: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/><rect x="9" y="9" width="6" height="6"/>',
    pwa: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    profiles: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
    feather: '<path d="M20 4c-6 0-12 4-12 12v4M20 4l-4 12H8M8 20l4-8"/>',
    'eye-off': '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3 3.6M6.6 6.6C3.7 8.4 2 12 2 12s4 6 10 6c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    scale: '<path d="M12 3v18M5 7h14M5 7l-3 8a4 4 0 0 0 6 0zM19 7l-3 8a4 4 0 0 0 6 0z"/>',
    code: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16"/>',
  };
  const icon = (n) => `<span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[n]}</svg></span>`;

  /* ---------------- marquee ---------------- */
  const allSources = D.domains.flatMap((d) => d.sources);
  const track = $('#marquee');
  const mq = allSources.map((s) => `<span>${s}</span>`).join('');
  track.innerHTML = mq + mq;

  /* ---------------- why: tiny SVG vizzes ---------------- */
  (function () {
    const sc = $('.viz-scatter'); const cv = $('.viz-converge');
    let a = ''; let b = '';
    for (let i = 0; i < 34; i++) a += `<circle cx="${rand(6, 194).toFixed(1)}" cy="${rand(6, 84).toFixed(1)}" r="${rand(1.4, 3.2).toFixed(1)}" fill="${['#64f0c8', '#44ccff', '#ffb84c', '#ff5f63', '#a98bff'][i % 5]}" opacity=".75"><animate attributeName="cx" values="${rand(6, 194).toFixed(0)};${rand(6, 194).toFixed(0)};${rand(6, 194).toFixed(0)}" dur="${rand(6, 12).toFixed(1)}s" repeatCount="indefinite"/><animate attributeName="cy" values="${rand(6, 84).toFixed(0)};${rand(6, 84).toFixed(0)};${rand(6, 84).toFixed(0)}" dur="${rand(6, 12).toFixed(1)}s" repeatCount="indefinite"/></circle>`;
    sc.innerHTML = a;
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2; const x = 100 + Math.cos(ang) * 92; const y = 45 + Math.sin(ang) * 40;
      b += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="100" y2="45" stroke="#64f0c8" stroke-opacity=".28"/><circle r="2" fill="#64f0c8"><animate attributeName="cx" values="${x.toFixed(1)};100" dur="${rand(1.6, 3).toFixed(1)}s" begin="${rand(0, 2).toFixed(1)}s" repeatCount="indefinite"/><animate attributeName="cy" values="${y.toFixed(1)};45" dur="${rand(1.6, 3).toFixed(1)}s" begin="0s" repeatCount="indefinite"/></circle>`;
    }
    b += '<circle cx="100" cy="45" r="7" fill="#02110c" stroke="#64f0c8" stroke-width="2"/><circle cx="100" cy="45" r="2.5" fill="#64f0c8"/>';
    cv.innerHTML = b;
  })();

  /* ---------------- sources stage ---------------- */
  const stage = $('#stage'); const lensBox = $('#lenses');
  let activeLens = null;
  D.domains.forEach((d) => {
    const g = document.createElement('div'); g.className = 'dgroup'; g.dataset.domain = d.id; g.style.setProperty('--c', d.color);
    g.innerHTML = `<h4><span></span><small>${d.sources.length}</small></h4><ul>${d.sources.map((s) => `<li class="src">${s}</li>`).join('')}</ul>`;
    bind($('h4 span', g), (el) => { el.textContent = pick(d); });
    stage.appendChild(g);
  });
  const mkLens = (id, color) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'lens'; b.dataset.lens = id; b.setAttribute('aria-pressed', 'false');
    b.style.setProperty('--c', color || '#64f0c8'); b.innerHTML = '<i></i><span></span><b></b>'; lensBox.appendChild(b); return b;
  };
  const allLens = mkLens('all'); bind($('span', allLens), (el) => { el.textContent = t('src.all'); }); $('b', allLens).textContent = String(allSources.length);
  D.domains.forEach((d) => { const b = mkLens(d.id, d.color); bind($('span', b), (el) => { el.textContent = pick(d); }); $('b', b).textContent = String(d.sources.length); });
  function setLens(id) {
    activeLens = id === 'all' ? null : id;
    $$('.lens').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.lens === 'all' && !activeLens) || b.dataset.lens === activeLens)));
    $$('.dgroup').forEach((g) => { g.classList.toggle('dim', !!activeLens && g.dataset.domain !== activeLens); g.classList.toggle('hot', !!activeLens && g.dataset.domain === activeLens); });
  }
  $$('.lens').forEach((b) => b.addEventListener('click', () => setLens(b.dataset.lens)));
  setLens('all');

  /* ---------------- bento ---------------- */
  const SPAN = { globe: 7, alerts: 5, risk: 5, briefing: 4, inspector: 4, palette: 4, replay: 6, health: 6, bots: 4, llm: 8, export: 4, pwa: 4, profiles: 4 };
  const sevChip = (c, g, w) => `<span class="sev" style="--c:${c}">${g} ${w}</span>`;
  const VIZ = {
    globe: () => {
      let m = ''; [0, -1.2, -2.4, -3.6, -4.8].forEach((d) => { m += `<ellipse cx="150" cy="150" rx="120" ry="120"><animate attributeName="rx" values="2;120;2" dur="6s" begin="${d}s" repeatCount="indefinite"/></ellipse>`; });
      let l = ''; [-80, -50, -20, 20, 50, 80].forEach((y) => { const rx = Math.sqrt(120 * 120 - (y * 1.4) ** 2) || 1; l += `<ellipse cx="150" cy="${150 + y * 1.4}" rx="${rx.toFixed(1)}" ry="${(rx * .16).toFixed(1)}"/>`; });
      const dots = [[96, 104, '#ff5f63'], [188, 124, '#ffb84c'], [140, 184, '#64f0c8'], [205, 190, '#44ccff'], [110, 150, '#a98bff']].map(([x, y, c], i) => `<circle cx="${x}" cy="${y}" r="3.2" fill="${c}"><animate attributeName="r" values="2;6;2" dur="${2.4 + i * .5}s" repeatCount="indefinite"/></circle>`).join('');
      return `<svg class="globeviz" viewBox="0 0 300 300" aria-hidden="true"><circle cx="150" cy="150" r="120" class="gv-rim"/><g class="gv-m">${m}</g><g class="gv-l">${l}</g>${dots}</svg>${['FIRE', 'AIR', 'RADIATION', 'MARITIME', 'OSINT', 'QUAKES', 'WEATHER', 'SATELLITES'].map((x, i) => sevChip(['#ff5f63', '#64f0c8', '#e8c25a', '#a98bff', '#ffb84c', '#ff8fb1', '#44ccff', '#7ee787'][i], '●', x)).join('')}`;
    },
    alerts: () => [sevChip('#ff5f63', '◆', 'critical'), sevChip('#ffb84c', '▲', 'high'), sevChip('#e8c25a', '●', 'watch'), sevChip('#44ccff', '○', 'info')].join(''),
    risk: () => '<div class="minibars">' + [88, 64, 72, 40, 55].map((w, i) => `<i style="--w:${w}%;animation-delay:${-i * .5}s"></i>`).join('') + '</div>',
    briefing: () => `<div class="bullet" data-viz-briefing></div>`,
    inspector: () => ['j', 'k', 'Enter', '/', 'e', 'Esc'].map((k) => `<span class="kbd">${k}</span>`).join(''),
    palette: () => '<span class="kbd">Ctrl</span><span class="kbd">K</span><span class="fakeinput">Hungary</span>',
    replay: () => '<span class="replaybar">REPLAY</span><div class="slider"><b></b></div>',
    health: () => { let h = '<div class="matrix">'; for (let i = 0; i < 72; i++) { const r = Math.random(); h += `<i class="${r > .95 ? 'e' : r > .88 ? 's' : r > .84 ? 'd' : ''}"></i>`; } return h + '</div>'; },
    export: () => ['JSON', 'CSV', 'HTML', 'STIX 2.1'].map((k) => `<span class="kbd">${k}</span>`).join(''),
    bots: () => '<span class="bubble me">/brief</span><span class="bubble">▲ FLASH · …</span>',
    llm: () => D.llmProviders.map((p) => `<span class="kbd">${p}</span>`).join(''),
    pwa: () => sevChip('#64f0c8', '✓', 'OFFLINE'),
    profiles: () => ['Research', 'Market', 'Infrastructure', '+12'].map((k) => `<span class="kbd">${k}</span>`).join(''),
  };
  const bento = $('#bento');
  D.features.forEach((f) => {
    const a = document.createElement('article'); a.className = 'bcard tilt' + (f.id === 'globe' ? ' r2 big' : ''); a.style.gridColumn = `span ${SPAN[f.id]}`;
    a.innerHTML = `${icon(f.id)}<h3></h3><p></p><div class="bviz">${VIZ[f.id]()}</div>`;
    bind($('h3', a), (el) => { el.textContent = pick(f)[0]; }); bind($('p', a), (el) => { el.textContent = pick(f)[1]; });
    const bv = $('[data-viz-briefing]', a);
    if (bv) bind(bv, (el) => { el.innerHTML = lang === 'hu' ? 'Magas szintű események szaporodása a térségben <span class="cite">[3]</span><span class="cite">[7]</span>' : 'High-level events are rising in the region <span class="cite">[3]</span><span class="cite">[7]</span>'; });
    bento.appendChild(a);
  });

  /* ---------------- pipeline ---------------- */
  const tl = $('#timeline');
  D.pipeline.forEach((p, i) => {
    const s = document.createElement('article'); s.className = 'tl-step card'; s.innerHTML = `<div class="n">STEP ${String(i + 1).padStart(2, '0')}</div><h3></h3><p></p>`;
    bind($('h3', s), (el) => { el.textContent = pick(p)[0]; }); bind($('p', s), (el) => { el.textContent = pick(p)[1]; });
    tl.appendChild(s);
  });

  /* ---------------- deep: alert levels ---------------- */
  const levels = $('#levels'); let curLevel = 4;
  const stripEl = $('#strip');
  function setLevel(n) {
    curLevel = n; const L = D.levels[n - 1];
    $$('.level', levels).forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.n === n)));
    stripEl.style.setProperty('--lc', L.color); $('#stripNum').textContent = String(n); $('#stripGlyph').textContent = L.glyph;
    $('#stripTitle').textContent = pick(L)[0]; $('#stripSub').textContent = pick(L)[1];
    if (gs && !reduced) gs.fromTo(stripEl, { scale: .985 }, { scale: 1, duration: .5, ease: 'elastic.out(1,.5)' });
  }
  D.levels.forEach((L) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'level'; b.dataset.n = L.n; b.setAttribute('role', 'radio'); b.style.setProperty('--c', L.color);
    b.innerHTML = `<span>${L.glyph}</span><b>${L.n}</b>`; b.addEventListener('click', () => setLevel(L.n)); levels.appendChild(b);
  });
  // kinds
  const kindsEl = $('#kinds'); const kindDesc = $('#kindDesc'); let curKind = 'event';
  const showKind = () => { const k = D.kinds.find((x) => x.id === curKind); kindDesc.textContent = pick(k)[1]; $$('.kind', kindsEl).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === curKind))); };
  D.kinds.forEach((k) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'kind'; b.dataset.k = k.id; b.setAttribute('role', 'tab');
    bind(b, (el) => { el.textContent = pick(k)[0]; }); b.addEventListener('click', () => { curKind = k.id; showKind(); }); kindsEl.appendChild(b);
  });
  binders.push([kindDesc, showKind]);

  /* ---------------- deep: risk calculator ---------------- */
  const comps = $('#comps'); const on = {};
  D.risk.forEach((r) => {
    on[r.id] = true;
    const row = document.createElement('label'); row.className = 'comp'; row.innerHTML = `<input type="checkbox" checked><span class="box">✓</span><span class="nm"><span></span><small>${r.w}%</small></span><span class="val">${r.v}</span><span class="bar"><i style="width:${r.v}%"></i></span>`;
    bind($('.nm span', row), (el) => { el.textContent = pick(r); });
    $('input', row).addEventListener('change', (e) => { on[r.id] = e.target.checked; row.classList.toggle('off', !e.target.checked); calc(); });
    comps.appendChild(row);
  });
  const gFg = $('#gFg'); let shown = 0;
  function calc() {
    let tot = 0; let w = 0;
    D.risk.forEach((r) => { if (on[r.id]) { tot += r.w * r.v; w += r.w; } });
    const score = w > 0 ? Math.round(tot / w) : 0; const high = score >= 70;
    const col = high ? '#ff5f63' : score >= 50 ? '#ffb84c' : '#64f0c8';
    gFg.style.stroke = col; gFg.style.color = col;
    $('#gCov').textContent = `${w}%`; $('#gBand').textContent = w === 0 ? '—' : high ? '≥ 70' : '< 70'; $('#gBand').style.color = col;
    if (gs && !reduced) { const o = { v: shown }; gs.to(o, { v: score, duration: .8, ease: 'power3.out', onUpdate() { shown = o.v; $('#gScore').textContent = String(Math.round(o.v)); gFg.style.strokeDashoffset = String(326.7 * (1 - o.v / 100)); } }); } else { shown = score; $('#gScore').textContent = String(score); gFg.style.strokeDashoffset = String(326.7 * (1 - score / 100)); }
  }

  /* ---------------- showcase ---------------- */
  const shotTabs = $('#shotTabs'); const shotScreen = $('#shotScreen'); const shotCap = $('#shotCap'); let curShot = 0;
  D.shots.forEach((s, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'shot-tab'; b.setAttribute('role', 'tab'); bind(b, (el) => { el.textContent = pick(s)[0]; });
    b.addEventListener('click', () => { curShot = i; showShot(); }); shotTabs.appendChild(b);
    const img = document.createElement('img'); img.src = s.src; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; shotScreen.appendChild(img);
    bind(img, (el) => { el.alt = pick(s)[1]; });
  });
  function showShot() {
    $$('.shot-tab', shotTabs).forEach((b, i) => b.setAttribute('aria-selected', String(i === curShot)));
    $$('img', shotScreen).forEach((im, i) => im.classList.toggle('on', i === curShot));
    shotCap.textContent = pick(D.shots[curShot])[1];
    const im = $$('img', shotScreen)[curShot]; const fit = () => { if (im.naturalWidth) shotScreen.style.aspectRatio = `${im.naturalWidth} / ${im.naturalHeight}`; };
    if (im.complete) fit(); else im.addEventListener('load', fit, { once: true });
  }
  binders.push([shotCap, showShot]);

  /* ---------------- principles ---------------- */
  const prin = $('#prin');
  D.principles.forEach((p) => {
    const c = document.createElement('article'); c.className = 'pcard tilt'; c.innerHTML = `${icon(p.icon)}<h3></h3><p></p>`;
    bind($('h3', c), (el) => { el.textContent = pick(p)[0]; }); bind($('p', c), (el) => { el.textContent = pick(p)[1]; });
    prin.appendChild(c);
  });

  /* ---------------- start: terminal ---------------- */
  const termBody = $('#termBody'); let tab = 'node'; let typing = null;
  const lineHTML = (l) => { const [a, b] = l; const txt = (lang === 'en' && b) ? b : a; if (txt === '') return ''; return txt.startsWith('#') ? `<span class="c">${txt}</span>` : `<span class="p">$ </span>${txt}`; };
  function renderTerm(animate) {
    if (typing) { typing.kill(); typing = null; }
    const lines = D.start[tab].map(lineHTML);
    if (!animate || !gs || reduced) { termBody.innerHTML = lines.join('\n') + '\n<span class="cur"></span>'; return; }
    termBody.innerHTML = '<span class="cur"></span>'; const o = { n: 0 };
    typing = gs.to(o, { n: lines.length, duration: Math.min(4.5, lines.length * .38), ease: 'none', onUpdate() { termBody.innerHTML = lines.slice(0, Math.ceil(o.n)).join('\n') + '\n<span class="cur"></span>'; } });
  }
  $$('.term-tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; $$('.term-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b))); renderTerm(true); }));
  binders.push([termBody, () => renderTerm(false)]);
  $('#copyBtn').addEventListener('click', async (e) => {
    const text = D.start[tab].filter((l) => l[0] && !l[0].startsWith('#')).map((l) => l[0]).join('\n'); const btn = e.currentTarget;
    try { await navigator.clipboard.writeText(text); btn.firstElementChild.textContent = t('copied'); } catch (err) { const r = document.createRange(); r.selectNodeContents(termBody); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    setTimeout(() => { btn.firstElementChild.textContent = t('copy'); }, 1600);
  });
  const stepsEl = $('#steps');
  D.steps.forEach((s) => { const li = document.createElement('li'); li.innerHTML = '<strong></strong><p></p>'; bind($('strong', li), (el) => { el.textContent = pick(s)[0]; }); bind($('p', li), (el) => { el.textContent = pick(s)[1]; }); stepsEl.appendChild(li); });
  const keysEl = $('#keys');
  keysEl.innerHTML = '<h4></h4>' + D.keys.items.map((k) => `<span><b>${k[0]}</b><i>${k[1]}</i></span>`).join('');
  bind($('h4', keysEl), (el) => { el.textContent = lang === 'hu' ? D.keys.huTitle : D.keys.enTitle; });

  applyLang();
  setLevel(4); calc();

  /* ---------------- hero sweep log ---------------- */
  const logEl = $('#sweepLog'); let li = 0;
  const pad = (n) => String(n).padStart(2, '0');
  function logLine() {
    const d = new Date(); const ts = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const name = allSources[li % allSources.length]; let cls = 'ok'; let sym = '✓'; let note = 'ok';
    if (li % 19 === 7) { cls = 'w'; sym = '◔'; note = lang === 'hu' ? 'elavult · címkézve' : 'stale · labelled'; }
    else if (li % 29 === 13) { cls = 't'; sym = '–'; note = lang === 'hu' ? 'kulcs nélkül letiltva' : 'disabled · no key'; }
    const row = document.createElement('div'); row.className = 'l'; row.innerHTML = `<span class="t">${ts}</span> <span class="${cls}">${sym}</span> ${name} <span class="t">· ${note}</span>`;
    logEl.appendChild(row); li++;
    const marks = { 51: lang === 'hu' ? '→ delta · riasztások · SSE push' : '→ delta · alerts · SSE push' };
    if (li % 52 === 0) { const m = document.createElement('div'); m.className = 'l n'; m.textContent = marks[51]; logEl.appendChild(m); }
    while (logEl.children.length > 11) logEl.removeChild(logEl.firstChild);
  }
  for (let i = 0; i < 9; i++) logLine();
  if (!reduced) setInterval(() => { if (!document.hidden) logLine(); }, 420);

  /* ---------------- globe wiring ---------------- */
  let globe = null;
  try { globe = window.CrucixGlobe.init($('#globe'), { reduced }); } catch (e) { console.warn('WebGL globe unavailable', e); document.body.classList.add('no-webgl'); }
  const GS = {
    d: { hero: [.42, 0, .88, 1], why: [0, -.05, 1.7, .3], sources: [0, 0, 2.3, .15], features: [0, 0, 2.5, .09], pipeline: [0, 0, 1.8, .2], deep: [0, 0, 2.4, .1], shots: [0, .05, 1.5, .18], principles: [.52, 0, 1.2, .62], start: [0, -.42, 1.5, .45], foot: [0, -.8, 1.8, .5] },
    m: { hero: [0, .36, .95, .62], why: [0, 0, 1.8, .2], sources: [0, 0, 2.3, .1], features: [0, 0, 2.5, .07], pipeline: [0, 0, 1.8, .14], deep: [0, 0, 2.4, .08], shots: [0, .05, 1.5, .14], principles: [0, 0, 1.4, .22], start: [0, -.3, 1.5, .3], foot: [0, -.6, 1.8, .35] },
  };
  const secs = $$('[data-globe]'); let marks = [];
  const measure = () => { marks = secs.map((s) => { const r = s.getBoundingClientRect(); return { k: s.dataset.globe, c: r.top + scrollY + r.height / 2 }; }); };
  const ease = (x) => x * x * (3 - 2 * x);
  function updateGlobe() {
    if (!globe || !marks.length) return;
    const set = GS[innerWidth < 900 ? 'm' : 'd']; const y = scrollY + innerHeight * .5; let a; let b; let u = 0;
    if (y <= marks[0].c) { a = b = set[marks[0].k]; } else if (y >= marks[marks.length - 1].c) { a = b = set[marks[marks.length - 1].k]; } else {
      let i = 0; while (i < marks.length - 2 && y >= marks[i + 1].c) i++;
      a = set[marks[i].k]; b = set[marks[i + 1].k]; u = ease((y - marks[i].c) / (marks[i + 1].c - marks[i].c));
    }
    const m = (j) => a[j] + (b[j] - a[j]) * u;
    globe.set({ x: m(0), y: m(1), s: m(2), o: m(3), rot: scrollY * 0.0012 });
  }
  let ticking = false;
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; updateGlobe(); }); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { measure(); updateGlobe(); });
  measure(); if (globe) { const h = GS[innerWidth < 900 ? 'm' : 'd'].hero; globe.snap({ x: h[0], y: h[1], s: h[2], o: h[3], rot: 0 }); }

  /* ---------------- nav ---------------- */
  const nav = $('#nav');
  const navLinks = $$('.nav-links a');
  const solid = () => nav.classList.toggle('solid', scrollY > 40);
  solid(); window.addEventListener('scroll', solid, { passive: true });

  /* ---------------- pointer tilt + spotlight ---------------- */
  if (hasHover && !reduced) {
    $$('.tilt').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width; const py = (e.clientY - r.top) / r.height;
        el.style.setProperty('--mx', `${px * 100}%`); el.style.setProperty('--my', `${py * 100}%`);
        el.style.setProperty('--rx', `${((.5 - py) * 5).toFixed(2)}deg`); el.style.setProperty('--ry', `${((px - .5) * 7).toFixed(2)}deg`);
      });
      el.addEventListener('pointerleave', () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
    });
    const br = $('#browser');
    br.addEventListener('pointermove', (e) => { const r = br.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width; const py = (e.clientY - r.top) / r.height; br.style.setProperty('--rx', `${((.5 - py) * 4).toFixed(2)}deg`); br.style.setProperty('--ry', `${((px - .5) * 6).toFixed(2)}deg`); });
    br.addEventListener('pointerleave', () => { br.style.setProperty('--rx', '0deg'); br.style.setProperty('--ry', '0deg'); });
  }

  /* ---------------- GSAP choreography ---------------- */
  function boot(done) {
    const el = $('#boot'); const lines = [
      ['CRUCIX // INTELLIGENCE TERMINAL', 'dim'], ['> sweep engine ............... <b class="ok">ready</b>', ''], ['> source adapters ............ <b class="ok">52</b>', ''],
      ['> domain lenses .............. <b class="ok">8</b>', ''], ['> globe renderer ............. <b class="ok">WebGL</b>', ''], ['> telemetry .................. <b class="ok">none</b>', ''], ['> all systems nominal', 'dim'],
    ];
    let skipped = false; let seen = false;
    try { seen = sessionStorage.getItem('crucix-site-boot') === '1'; } catch (e) { /* ignore */ }
    const finish = () => { if (skipped) return; skipped = true; try { sessionStorage.setItem('crucix-site-boot', '1'); } catch (e) { /* ignore */ } el.classList.add('done'); setTimeout(() => el.remove(), 800); done(); };
    if (reduced || seen) { el.remove(); done(); return; }
    const box = $('#bootLines'); let i = 0;
    const tick = () => { if (skipped) return; if (i < lines.length) { const d = document.createElement('div'); d.className = lines[i][1]; d.innerHTML = lines[i][0]; box.appendChild(d); i++; setTimeout(tick, 170); } else setTimeout(finish, 380); };
    tick(); el.addEventListener('click', finish); window.addEventListener('keydown', finish, { once: true });
  }

  function intro() {
    if (!gs) return;
    const tlh = gs.timeline({ defaults: { ease: 'power4.out' } });
    tlh.from('#logoWord', { letterSpacing: '.45em', opacity: 0, filter: 'blur(18px)', duration: 1.7, ease: 'expo.out' }, 0)
      .to('#logoWord', { duration: 1.3, scrambleText: { text: 'CRUCIX', chars: '01░▒▓/<>_', speed: .55, revealDelay: .15 } }, 0)
      .from('.kicker', { y: 20, opacity: 0, duration: .9 }, .15)
      .from('.tagline', { y: 34, opacity: 0, duration: 1 }, .45)
      .from('.lede', { y: 30, opacity: 0, duration: 1 }, .6)
      .from('.cta .btn', { y: 26, opacity: 0, duration: .9, stagger: .12 }, .8)
      .from('.termcard', { x: 60, opacity: 0, duration: 1.2 }, .7)
      .from('.stats li', { y: 40, opacity: 0, duration: .9, stagger: .08 }, 1)
      .from('.scroll-hint', { opacity: 0, duration: 1 }, 1.6);
    $$('.stats b[data-count]').forEach((b) => { const to = +b.dataset.count; const o = { v: 0 }; b.textContent = '0'; gs.to(o, { v: to, duration: 1.8, delay: 1.1, ease: 'power3.out', onUpdate() { b.textContent = String(Math.round(o.v)); } }); });
  }

  function scrollFx() {
    if (!gs || !window.ScrollTrigger) return;
    const ST = window.ScrollTrigger;
    ST.addEventListener('refresh', () => { measure(); updateGlobe(); });
    // sources: scattered streams sort themselves into domains (created first: pin spacing shifts every trigger below it)
    const mm = gs.matchMedia();
    mm.add('(min-width: 1081px)', () => {
      const chips = $$('.src', stage);
      gs.timeline({ scrollTrigger: { trigger: '#pinbox', start: 'top 84px', end: '+=100%', pin: true, scrub: .8, anticipatePin: 1, invalidateOnRefresh: true } })
        .from(chips, { x: () => rand(-700, 700), y: () => rand(-420, 520), rotation: () => rand(-70, 70), scale: .35, opacity: 0, duration: 1, ease: 'power3.out', stagger: { amount: .6, from: 'random' } }, 0);
    });
    mm.add('(max-width: 1080px)', () => {
      ST.batch('.dgroup', { start: 'top 92%', once: true, onEnter: (els) => gs.from(els, { y: 40, opacity: 0, duration: .8, stagger: .08, clearProps: 'transform,opacity' }) });
    });


    gs.to('.progress i', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: .3 } });
    // active nav link
    $$('main > section[id]').forEach((s) => {
      const link = navLinks.find((a) => a.getAttribute('href') === `#${s.id}`);
      if (link) ST.create({ trigger: s, start: 'top 50%', end: 'bottom 50%', onToggle: (self) => link.classList.toggle('on', self.isActive) });
    });
    // eyebrow scramble + h2 reveal + lead
    $$('[data-scramble]').forEach((el) => {
      if (el.closest('.hero')) return;
      ST.create({ trigger: el, start: 'top 90%', once: true, onEnter: () => { const txt = el.textContent; gs.fromTo(el, { scrambleText: { text: '', chars: '01<>/_' } }, { duration: 1.1, scrambleText: { text: txt, chars: '01<>/_', speed: .5 } }); } });
    });
    $$('.h2').forEach((el) => gs.from(el, { y: 60, opacity: 0, filter: 'blur(10px)', duration: 1.1, ease: 'power4.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } }));
    $$('.lead').forEach((el) => gs.from(el, { y: 30, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 90%', once: true } }));
    // generic reveals (cards)
    const reveal = (sel, opts = {}) => ST.batch(sel, { start: 'top 90%', once: true, onEnter: (els) => gs.from(els, { y: 50, opacity: 0, duration: .9, ease: 'power3.out', stagger: .09, clearProps: 'transform,opacity,transition', onStart() { els.forEach((e) => { e.style.transition = 'none'; }); }, ...opts }) });
    reveal('.why-grid .card'); reveal('.bcard'); reveal('.pcard'); reveal('.steps li'); reveal('.panel');
    gs.from('.browser', { y: 80, opacity: 0, duration: 1.2, ease: 'power3.out', clearProps: 'opacity', scrollTrigger: { trigger: '.shots', start: 'top 80%', once: true } });
    gs.from('.warn', { y: 30, opacity: 0, duration: .9, scrollTrigger: { trigger: '.warn', start: 'top 92%', once: true } });

    // timeline
    gs.to('#tlFill', { scaleY: 1, ease: 'none', scrollTrigger: { trigger: '#timeline', start: 'top 60%', end: 'bottom 60%', scrub: .4 } });
    $$('.tl-step').forEach((s, i) => gs.from(s, { x: innerWidth < 700 ? 0 : (i % 2 ? 70 : -70), y: innerWidth < 700 ? 40 : 0, opacity: 0, duration: 1, ease: 'power3.out', clearProps: 'transform,opacity', scrollTrigger: { trigger: s, start: 'top 85%', once: true } }));

    // risk gauge + terminal on enter
    ST.create({ trigger: '#riskPanel', start: 'top 80%', once: true, onEnter: calc });
    ST.create({ trigger: '#term', start: 'top 80%', once: true, onEnter: () => renderTerm(true) });
    renderTerm(false);

  }

  scrollFx();
  boot(() => { intro(); });
  showShot(); setTimeout(() => { if (window.ScrollTrigger) window.ScrollTrigger.refresh(); updateGlobe(); }, 600);
  window.addEventListener('load', () => { if (window.ScrollTrigger) { window.ScrollTrigger.sort(); window.ScrollTrigger.refresh(); } measure(); updateGlobe(); });
}());
