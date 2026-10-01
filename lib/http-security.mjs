import { createHash, timingSafeEqual } from 'node:crypto';

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
