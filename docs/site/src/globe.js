// Crucix site: the holographic globe behind the whole page.
// Source module; `assets/globe.bundle.js` is built from it (see ../README.md).
// The land is rasterised from the dashboard's own world geometry (no image file), so the page also works from file://.
import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, SphereGeometry, ShaderMaterial, Mesh, BufferGeometry,
  Float32BufferAttribute, Points, LineSegments, Line, AdditiveBlending, BackSide, FrontSide, Color, Vector3,
  QuadraticBezierCurve3, MathUtils,
} from 'three';

const MINT = new Color('#64f0c8');
const CYAN = new Color('#44ccff');
const AMBER = new Color('#ffb84c');
const RED = new Color('#ff5f63');
const VIOLET = new Color('#a98bff');

const R = 1;
const toVec = (lat, lon, r = R) => {
  const la = MathUtils.degToRad(lat);
  const lo = MathUtils.degToRad(lon);
  return new Vector3(r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo));
};

// Watched places: chokepoints, nuclear sites, hubs and the operator's home (Budapest).
const HOTSPOTS = [
  ['Hormuz', 26.5, 56.3, AMBER], ['Suez', 30.0, 32.5, AMBER], ['Bab el-Mandeb', 12.6, 43.3, AMBER],
  ['Malacca', 2.5, 101.0, AMBER], ['Taiwan', 24.0, 119.5, RED], ['Panama', 9.1, -79.7, AMBER],
  ['Bosphorus', 41.1, 29.0, AMBER], ['Kyiv', 50.4, 30.5, RED], ['Budapest', 47.5, 19.0, MINT],
  ['Zaporizhzhia', 47.5, 34.6, VIOLET], ['Fukushima', 37.4, 141.0, VIOLET], ['Gulf of Aden', 12.0, 48.0, RED],
  ['Washington', 38.9, -77.0, CYAN], ['London', 51.5, -0.1, CYAN], ['Tokyo', 35.7, 139.7, CYAN],
  ['Singapore', 1.35, 103.8, CYAN], ['Dubai', 25.2, 55.3, CYAN], ['Sao Paulo', -23.5, -46.6, CYAN],
  ['Johannesburg', -26.2, 28.0, CYAN], ['Sydney', -33.9, 151.2, CYAN], ['Seoul', 37.6, 127.0, RED],
  ['Cairo', 30.0, 31.2, RED], ['Delhi', 28.6, 77.2, CYAN], ['Lagos', 6.5, 3.4, CYAN],
  ['Moscow', 55.7, 37.6, CYAN], ['Beijing', 39.9, 116.4, CYAN], ['Mexico City', 19.4, -99.1, CYAN],
  ['Cape of Good Hope', -34.4, 18.5, AMBER], ['Strait of Gibraltar', 36.0, -5.6, AMBER], ['Reykjavik', 64.1, -21.9, CYAN],
];
const ARCS = [
  [8, 12], [8, 13], [8, 24], [12, 14], [12, 25], [16, 4], [14, 19], [13, 17], [8, 16], [16, 22],
  [22, 0], [21, 18], [8, 7], [24, 25], [26, 12], [10, 14], [17, 18], [13, 29], [5, 26], [8, 21],
];

function landMask(W, H) {
  const geo = window.__CRUCIX_WORLD_GEOMETRY__;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const land = window.topojson.feature(geo, geo.objects.countries);
  const proj = window.d3.geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
  ctx.fillStyle = '#fff'; ctx.beginPath();
  window.d3.geoPath(proj, ctx)(land);
  ctx.fill();
  const data = ctx.getImageData(0, 0, W, H).data;
  return (lat, lon) => {
    const x = Math.min(W - 1, Math.max(0, Math.round(((lon + 180) / 360) * (W - 1))));
    const y = Math.min(H - 1, Math.max(0, Math.round(((90 - lat) / 180) * (H - 1))));
    return data[(y * W + x) * 4] > 127;
  };
}

const POINT_VERT = `
  attribute float aSeed; attribute vec3 aColor;
  uniform float uTime, uSize, uPx, uOpacity; varying vec3 vColor; varying float vA;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * wp;
    vec3 n = normalize(wp.xyz - (modelMatrix * vec4(0.,0.,0.,1.)).xyz);
    float facing = dot(n, normalize(cameraPosition - wp.xyz));
    float front = smoothstep(-0.12, 0.38, facing);
    float tw = 0.62 + 0.38 * sin(uTime * 1.4 + aSeed * 40.0);
    float sweep = exp(-pow((position.y - sin(uTime * 0.42) * 0.95) * 5.5, 2.0));
    vColor = mix(aColor, vec3(0.85, 1.0, 0.97), sweep * 0.8);
    vA = (mix(0.16, 1.0, front) * tw + sweep * 0.7) * uOpacity;
    gl_PointSize = uSize * uPx * (0.75 + aSeed * 0.5 + sweep * 0.9) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const POINT_FRAG = `
  varying vec3 vColor; varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vColor, a * vA);
  }`;

const PING_VERT = `
  attribute float aPhase; attribute vec3 aColor;
  uniform float uTime, uSize, uPx, uOpacity; varying vec3 vColor; varying float vA; varying float vT;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * wp;
    vec3 n = normalize(wp.xyz - (modelMatrix * vec4(0.,0.,0.,1.)).xyz);
    float facing = dot(n, normalize(cameraPosition - wp.xyz));
    float t = fract(uTime * 0.45 + aPhase);
    vT = t; vColor = aColor;
    vA = smoothstep(-0.05, 0.25, facing) * (1.0 - t) * uOpacity;
    gl_PointSize = uSize * uPx * (0.25 + t * 1.5) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const PING_FRAG = `
  varying vec3 vColor; varying float vA; varying float vT;
  void main(){
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float ring = smoothstep(0.12, 0.0, abs(d - 0.82)) * 1.2;
    float core = smoothstep(0.34, 0.0, d) * (1.0 - vT * 0.5);
    gl_FragColor = vec4(vColor, (ring + core) * vA);
  }`;

const ARC_VERT = `
  attribute float aProg; attribute float aOff; attribute float aSpeed;
  uniform float uTime, uOpacity; varying float vP; varying float vHead; varying float vFacing;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(wp.xyz - (modelMatrix * vec4(0.,0.,0.,1.)).xyz);
    vFacing = smoothstep(-0.3, 0.3, dot(n, normalize(cameraPosition - wp.xyz))) * uOpacity;
    vP = aProg; vHead = fract(uTime * aSpeed + aOff);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const ARC_FRAG = `
  uniform vec3 uColor; varying float vP; varying float vHead; varying float vFacing;
  void main(){
    float d = vHead - vP; if (d < 0.0) d += 1.0;
    float trail = d < 0.22 ? pow(1.0 - d / 0.22, 2.0) : 0.0;
    float base = 0.07 + sin(vP * 3.14159) * 0.08;
    gl_FragColor = vec4(mix(uColor, vec3(0.9, 1.0, 0.98), trail), (base + trail * 0.95) * vFacing);
  }`;

const BODY_VERT = `varying vec3 vN; varying vec3 vV;
  void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const BODY_FRAG = `uniform float uOpacity; varying vec3 vN; varying vec3 vV;
  void main(){ float rim = pow(1.0 - max(dot(vN, vV), 0.0), 2.6);
    vec3 c = mix(vec3(0.008, 0.035, 0.05), vec3(0.1, 0.9, 0.75), rim * 0.55);
    gl_FragColor = vec4(c, (0.82 + rim * 0.3) * uOpacity); }`;
// Back faces of the larger sphere: a = 0 at its outer edge, ~0.56 at the planet's limb, 1 in the middle (hidden, so no glow there).
const ATMO_FRAG = `uniform float uOpacity; varying vec3 vN; varying vec3 vV;
  void main(){ float a = -dot(vN, vV); float i = a > 0.563 ? smoothstep(0.98, 0.563, a) : pow(a / 0.563, 2.2);
    gl_FragColor = vec4(0.25, 0.95, 0.8, 1.0) * i * uOpacity * 0.55; }`;

export function initGlobe(canvas, { reduced = false } = {}) {
  const small = Math.min(window.innerWidth, window.innerHeight) < 640 || window.innerWidth < 900;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  const px = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
  renderer.setPixelRatio(px);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0, 4.6);

  const root = new Group();
  const earth = new Group();
  root.add(earth);
  scene.add(root);

  const uni = { uTime: { value: 0 }, uPx: { value: px * (small ? 0.9 : 1) }, uOpacity: { value: 1 } };

  // body + atmosphere
  const body = new Mesh(new SphereGeometry(R * 0.992, 64, 48), new ShaderMaterial({
    vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, transparent: true, depthWrite: false, side: FrontSide,
    uniforms: { uOpacity: uni.uOpacity },
  }));
  earth.add(body);
  const atmo = new Mesh(new SphereGeometry(R * 1.2, 64, 48), new ShaderMaterial({
    vertexShader: BODY_VERT, fragmentShader: ATMO_FRAG, transparent: true, depthWrite: false, side: BackSide, blending: AdditiveBlending,
    uniforms: { uOpacity: uni.uOpacity },
  }));
  root.add(atmo);

  // land dots
  const isLand = landMask(1440, 720);
  const step = small ? 1.7 : 1.15;
  const pos = []; const seed = []; const col = [];
  for (let lat = -84; lat <= 84; lat += step) {
    const n = Math.max(1, Math.round((360 / step) * Math.cos(MathUtils.degToRad(lat))));
    for (let i = 0; i < n; i++) {
      const lon = -180 + (i + (Math.round(lat / step) % 2) * 0.5) * (360 / n);
      if (!isLand(lat, lon)) continue;
      const v = toVec(lat, lon);
      pos.push(v.x, v.y, v.z); seed.push(Math.random());
      const m = Math.random();
      const c = m > 0.93 ? CYAN : MINT;
      col.push(c.r, c.g, c.b);
    }
  }
  const landGeo = new BufferGeometry();
  landGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  landGeo.setAttribute('aSeed', new Float32BufferAttribute(seed, 1));
  landGeo.setAttribute('aColor', new Float32BufferAttribute(col, 3));
  const land = new Points(landGeo, new ShaderMaterial({
    vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    uniforms: { ...uni, uSize: { value: small ? 10 : 12.5 } },
  }));
  earth.add(land);

  // graticule
  const grat = window.d3.geoGraticule10();
  const gp = [];
  for (const line of grat.coordinates) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = toVec(line[i][1], line[i][0], R * 1.002); const b = toVec(line[i + 1][1], line[i + 1][0], R * 1.002);
      gp.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const gg = new BufferGeometry();
  gg.setAttribute('position', new Float32BufferAttribute(gp, 3));
  gg.setAttribute('aProg', new Float32BufferAttribute(new Array(gp.length / 3).fill(0), 1));
  gg.setAttribute('aOff', new Float32BufferAttribute(new Array(gp.length / 3).fill(0), 1));
  gg.setAttribute('aSpeed', new Float32BufferAttribute(new Array(gp.length / 3).fill(0), 1));
  const gratMat = new ShaderMaterial({
    vertexShader: ARC_VERT, fragmentShader: `uniform vec3 uColor; varying float vFacing; void main(){ gl_FragColor = vec4(uColor, 0.07 * vFacing); }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: uni.uTime, uOpacity: uni.uOpacity, uColor: { value: CYAN } },
  });
  earth.add(new LineSegments(gg, gratMat));

  // hotspot pings
  const hp = []; const hc = []; const hph = [];
  HOTSPOTS.forEach(([, lat, lon, c], i) => {
    const v = toVec(lat, lon, R * 1.004); hp.push(v.x, v.y, v.z); hc.push(c.r, c.g, c.b); hph.push((i * 0.6180339) % 1);
  });
  const pg = new BufferGeometry();
  pg.setAttribute('position', new Float32BufferAttribute(hp, 3));
  pg.setAttribute('aColor', new Float32BufferAttribute(hc, 3));
  pg.setAttribute('aPhase', new Float32BufferAttribute(hph, 1));
  earth.add(new Points(pg, new ShaderMaterial({
    vertexShader: PING_VERT, fragmentShader: PING_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    uniforms: { ...uni, uSize: { value: small ? 120 : 150 } },
  })));
  // bright cores
  const cg = new BufferGeometry();
  cg.setAttribute('position', new Float32BufferAttribute(hp, 3));
  cg.setAttribute('aColor', new Float32BufferAttribute(hc, 3));
  cg.setAttribute('aSeed', new Float32BufferAttribute(hph, 1));
  earth.add(new Points(cg, new ShaderMaterial({
    vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    uniforms: { ...uni, uSize: { value: small ? 30 : 38 } },
  })));

  // flight / signal arcs with travelling pulses
  const ap = []; const aprog = []; const aoff = []; const aspd = [];
  const SEG = 56;
  ARCS.forEach(([a, b], idx) => {
    const A = toVec(HOTSPOTS[a][1], HOTSPOTS[a][2]); const B = toVec(HOTSPOTS[b][1], HOTSPOTS[b][2]);
    const lift = 1 + Math.min(0.55, A.distanceTo(B) * 0.32);
    const mid = A.clone().add(B).multiplyScalar(0.5).normalize().multiplyScalar(lift);
    const curve = new QuadraticBezierCurve3(A, mid, B);
    const pts = curve.getPoints(SEG);
    const off = (idx * 0.37) % 1; const spd = 0.12 + ((idx * 7) % 5) * 0.03;
    for (let i = 0; i < SEG; i++) {
      for (const k of [i, i + 1]) {
        ap.push(pts[k].x, pts[k].y, pts[k].z); aprog.push(k / SEG); aoff.push(off); aspd.push(spd);
      }
    }
  });
  const ag = new BufferGeometry();
  ag.setAttribute('position', new Float32BufferAttribute(ap, 3));
  ag.setAttribute('aProg', new Float32BufferAttribute(aprog, 1));
  ag.setAttribute('aOff', new Float32BufferAttribute(aoff, 1));
  ag.setAttribute('aSpeed', new Float32BufferAttribute(aspd, 1));
  earth.add(new LineSegments(ag, new ShaderMaterial({
    vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    uniforms: { uTime: uni.uTime, uOpacity: uni.uOpacity, uColor: { value: MINT } },
  })));

  // orbits: satellites that do not rotate with the earth
  const orbits = new Group(); root.add(orbits);
  const sats = [];
  [[1.28, 52, 20], [1.42, 98, 140], [1.2, 28, 260]].forEach(([r, inc, node], i) => {
    const g = new Group(); g.rotation.set(MathUtils.degToRad(inc), MathUtils.degToRad(node), 0);
    const ring = []; const N = 160;
    for (let k = 0; k < N; k++) {
      const t1 = (k / N) * Math.PI * 2; const t2 = ((k + 1) / N) * Math.PI * 2;
      ring.push(Math.cos(t1) * r, 0, Math.sin(t1) * r, Math.cos(t2) * r, 0, Math.sin(t2) * r);
    }
    const rg = new BufferGeometry(); rg.setAttribute('position', new Float32BufferAttribute(ring, 3));
    g.add(new LineSegments(rg, new ShaderMaterial({
      vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uOpacity; void main(){ gl_FragColor = vec4(0.27, 0.8, 1.0, 0.1 * uOpacity); }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uOpacity: uni.uOpacity },
    })));
    const sg = new BufferGeometry(); sg.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
    sg.setAttribute('aSeed', new Float32BufferAttribute([0.5], 1)); sg.setAttribute('aColor', new Float32BufferAttribute([1, 1, 1], 3));
    const sat = new Points(sg, new ShaderMaterial({
      vertexShader: `uniform float uSize, uPx; uniform float uOpacity; varying float vA; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = uSize*uPx/-mv.z; vA = uOpacity; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-0.5); gl_FragColor = vec4(0.8,1.0,0.95, smoothstep(0.5,0.0,d)*vA); }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uSize: { value: 46 }, uPx: uni.uPx, uOpacity: uni.uOpacity },
    }));
    g.add(sat); orbits.add(g); sats.push({ sat, r, speed: 0.22 + i * 0.07, phase: i * 2.1 });
  });

  // stars
  const sp = []; const ss = []; const sc = [];
  for (let i = 0; i < (small ? 500 : 1100); i++) {
    const v = new Vector3().randomDirection().multiplyScalar(14 + Math.random() * 10);
    sp.push(v.x, v.y, v.z); ss.push(Math.random()); const w = 0.5 + Math.random() * 0.5; sc.push(w, w, 1);
  }
  const stg = new BufferGeometry();
  stg.setAttribute('position', new Float32BufferAttribute(sp, 3));
  stg.setAttribute('aSeed', new Float32BufferAttribute(ss, 1));
  stg.setAttribute('aColor', new Float32BufferAttribute(sc, 3));
  const stars = new Points(stg, new ShaderMaterial({
    vertexShader: `attribute float aSeed; attribute vec3 aColor; uniform float uTime, uPx; varying vec3 vC; varying float vA;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vC = aColor; vA = 0.25 + 0.5 * (0.5 + 0.5 * sin(uTime * (0.4 + aSeed) + aSeed * 50.0));
      gl_PointSize = (1.2 + aSeed * 2.4) * uPx * 3.0 / -mv.z * 6.0; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); gl_FragColor = vec4(vC, smoothstep(0.5,0.0,d)*vA); }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uTime: uni.uTime, uPx: uni.uPx },
  }));
  scene.add(stars);

  // ---- state / loop ----
  const target = { x: 0, y: 0, s: 1, o: 1, rot: 0 };
  const cur = { x: 0, y: 0, s: 1, o: 1, rot: 0 };
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let w = 1; let h = 1; let running = true; let last = performance.now(); let t = 0;

  function resize() {
    w = canvas.clientWidth || window.innerWidth; h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = w / h < 0.8 ? 6.4 : 4.6;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => { pointer.x = (e.clientX / window.innerWidth) * 2 - 1; pointer.y = (e.clientY / window.innerHeight) * 2 - 1; }, { passive: true });
  document.addEventListener('visibilitychange', () => { running = !document.hidden; last = performance.now(); if (running) requestAnimationFrame(frame); });

  function render(dt) {
    t += dt;
    uni.uTime.value = t;
    const k = 1 - Math.pow(0.0015, dt); // frame-rate independent damping
    for (const key of ['x', 'y', 's', 'o', 'rot']) cur[key] += (target[key] - cur[key]) * k;
    pointer.sx += (pointer.x - pointer.sx) * k * 0.6; pointer.sy += (pointer.y - pointer.sy) * k * 0.6;
    const halfH = Math.tan(MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    root.position.set(cur.x * halfH * camera.aspect, cur.y * halfH, 0);
    root.scale.setScalar(cur.s * (w / h < 0.8 ? 0.95 : 1));
    uni.uOpacity.value = cur.o;
    earth.rotation.y = -(reduced ? 0.9 : t * 0.07) - cur.rot;
    earth.rotation.x = 0.34 + pointer.sy * 0.12;
    earth.rotation.z = pointer.sx * -0.05;
    orbits.rotation.y = t * 0.05;
    sats.forEach(({ sat, r, speed, phase }) => { const a = reduced ? phase : t * speed + phase; sat.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); });
    stars.rotation.y = t * 0.004 + cur.rot * 0.05;
    renderer.render(scene, camera);
  }
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    render(reduced ? 0 : dt);
    if (!reduced) requestAnimationFrame(frame);
  }
  render(0);
  if (!reduced) requestAnimationFrame(frame);

  return {
    set(next) { Object.assign(target, next); if (reduced) { Object.assign(cur, next); render(0); } },
    snap(next) { Object.assign(target, next); Object.assign(cur, next); },
  };
}

window.CrucixGlobe = { init: initGlobe };
