# Crucix showcase site / Bemutató weboldal

A single-page, bilingual (HU/EN) presentation of what Crucix is, why it is useful and what it can do.
Egyoldalas, kétnyelvű (HU/EN) bemutató: mi a Crucix, miért jó használni és mit tud.

## Open it / Megnyitás

Double-click [index.html](index.html), or serve the `docs` folder (the screenshots live in `docs/*.png`):

```bash
npx serve docs        # then open http://localhost:3000/site/
```

It needs no build step and makes **no external requests**: every script, font and image is a local file, so it also works offline and from `file://`. / Nem kell hozzá build, és **nem küld külső kérést**: minden szkript, betűtípus és kép helyi fájl.

## What is in it / Felépítés

| Path | Purpose |
|------|---------|
| `index.html` | Page skeleton and the `data-i18n` hooks |
| `assets/site.css` | Styles; the palette and fonts match the dashboard (`jarvis.html`) |
| `assets/content.js` | All copy in Hungarian and English plus the shared data (domains, features, pipeline, risk weights) |
| `assets/app.js` | Language switch, GSAP/ScrollTrigger scroll choreography, interactive demos, globe scroll states |
| `src/globe.js` | three.js source of the holographic globe (land dots are rasterised from the dashboard's own world geometry) |
| `assets/globe.bundle.js` | Built from `src/globe.js` (esbuild, three.js tree-shaken) |
| `assets/vendor/` | d3, topojson-client, world geometry, GSAP (+ScrollTrigger, ScrambleText), IBM Plex Mono and Space Grotesk, with their licences |

Screenshots are referenced from `../dashboard.png`, `../globe.png`, `../map.png` and `../boot.png`.

## Rebuild the globe bundle / A glóbusz-csomag újraépítése

Only needed after editing `src/globe.js`:

```bash
mkdir /tmp/globe-build && cd /tmp/globe-build && npm init -y && npm i three esbuild
NODE_PATH=/tmp/globe-build/node_modules /tmp/globe-build/node_modules/.bin/esbuild \
  <repo>/docs/site/src/globe.js --bundle --minify --format=iife --target=es2020 \
  --legal-comments=none --outfile=<repo>/docs/site/assets/globe.bundle.js
```

The bundle was built with three.js 0.186.1 and GSAP 3.15.0 (GSAP's "no charge" licence; three.js is MIT, d3 and topojson-client ISC, the fonts OFL).

## Keeping it honest / Hitelesség

The numbers on the page come from the repository: 52 sources in 8 domains (`lib/domains.mjs`), the country-risk weights (`lib/intelligence/risk.mjs`), the alert-engine kinds and threat levels (README, "Alert engine"). The sweep log in the hero and the demo values are labelled as illustrations. If a feature changes, update `assets/content.js`.
