import { inlineJson } from './html.mjs';

/** A shell contains UI/locale only, never a current or embedded intelligence snapshot. */
export function renderOfflineShell(template, locale, { offline = true } = {}) {
  if ((template.match(/^(let|const) D = .*;\s*$/gm) || []).length !== 1) throw new Error('Offline template must have exactly one replaceable snapshot');
  const empty = { meta: { timestamp: null, sourcesQueried: 0, sourcesOk: 0 }, events: [], newsFeed: [], news: [], health: [], ideas: [] };
  return template.replace(/^(let|const) D = .*;\s*$/m, () => `let D = ${inlineJson(empty)};`)
    .replace('</head>', `<script>window.__CRUCIX_OFFLINE_SHELL__=${offline};window.__CRUCIX_LOCALE__=${inlineJson(locale)};</script>\n</head>`);
}
