import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';

const JSON_BODY_LIMIT = '8kb';

export function installHttpSecurity(app, { user = '', password = '' } = {}) {
  if (Boolean(user) !== Boolean(password)) throw new Error('Set both AUTH_USER and AUTH_PASSWORD, or neither.');
  if (user.includes(':')) throw new Error('AUTH_USER cannot contain a colon.');
  const digest = value => createHash('sha256').update(value).digest();
  const expected = user ? digest(`${user}:${password}`) : null;
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    next();
  });
  // Readiness probes expose no intelligence, credentials, or configuration.
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  if (!expected) return;
  app.use((req, res, next) => {
    const match = /^Basic ([A-Za-z0-9+/]+=*)$/i.exec(req.get('authorization') || '');
    const credentials = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
    if (match && timingSafeEqual(expected, digest(credentials))) return next();
    res.set('WWW-Authenticate', 'Basic realm="Crucix", charset="UTF-8"');
    res.status(401).json({ error: 'Authentication required' });
  });
}

const refuse = (res, status, code, error) => res.status(status).json({ error, code, field: null });

// The page's own origin. The https form of the same host is accepted too: behind a TLS-terminating reverse proxy the
// server itself sees plain http while the browser sends its https origin.
function isSameOrigin(req, origin) {
  const host = req.get('host')?.toLowerCase();
  return host !== undefined && (origin === `${req.protocol}://${host}` || origin === `https://${host}`);
}

/**
 * Guard for state-changing routes. A browser re-sends cached Basic credentials with any page's requests, so the
 * authentication alone does not stop a cross-site request. Here the body must be JSON (415), a request with an
 * `Origin` must come from this origin and one with `Sec-Fetch-Site` from `same-origin` or `none` (403); then the body
 * is parsed: at most 8 KB (413) and well-formed JSON (400). Every refusal is JSON and comes before the route runs.
 * A request with neither header (curl, scripts) passes on its JSON Content-Type: a browser cannot send that cross-site
 * without a CORS preflight, which this server never grants.
 * @returns {import('express').RequestHandler}
 */
export function requireSameOriginJson() {
  const parse = express.json({ limit: JSON_BODY_LIMIT, type: 'application/json' });
  return (req, res, next) => {
    const type = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return refuse(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
    const origin = req.get('origin');
    const site = req.get('sec-fetch-site');
    if ((origin !== undefined && !isSameOrigin(req, origin)) || (site !== undefined && site !== 'same-origin' && site !== 'none')) {
      return refuse(res, 403, 'CROSS_ORIGIN', 'Cross-origin request refused');
    }
    parse(req, res, error => {
      if (!error) return next();
      if (error.status === 413) return refuse(res, 413, 'BODY_TOO_LARGE', 'The request body is larger than 8 KB');
      if (error.status === 415) return refuse(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported body encoding or charset');
      refuse(res, 400, 'INVALID_JSON', 'The request body is not valid JSON');
    });
  };
}
