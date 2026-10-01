import { exportRecords } from './export.mjs';
import { HistoryValidationError, isEventId } from './history.mjs';

const filtersOf = query => {
  if (Object.keys(query).some(key => !['q', 'kind', 'source', 'from', 'to', 'limit', 'offset', 'format'].includes(key))) throw new HistoryValidationError('Unknown query parameter', 'query');
  return Object.fromEntries(['q', 'kind', 'source', 'from', 'to', 'limit', 'offset'].filter(key => Object.hasOwn(query, key)).map(key => [key, query[key]]));
};

/** Installed after the application's authentication middleware. */
export function installIntelligenceRoutes(app, { getSnapshot, history, language = 'en' }) {
  const handle = fn => (req, res) => {
    try { fn(req, res); }
    catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message, code: error.code, field: error.field });
      console.error('[History] Request failed:', error.message);
      res.status(503).json({ error: 'History temporarily unavailable' });
    }
  };
  app.get('/api/events/:id', handle((req, res) => {
    if (!isEventId(req.params.id)) return res.status(400).json({ error: 'Invalid event ID' });
    const event = getSnapshot()?.events?.find(item => item.id === req.params.id) || history?.get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  }));
  if (!history) return;
  app.get('/api/history', handle((req, res) => res.json(history.query(filtersOf(req.query)))));
  app.get('/api/export', handle((req, res) => {
    const filters = filtersOf(req.query);
    delete filters.limit; delete filters.offset;
    // Validate once before the bounded page walk. Never expose a raw snapshot.
    const first = history.query({ ...filters, limit: 200, offset: 0 });
    const items = [...first.items];
    while (items.length < Math.min(first.total, 2000)) {
      const page = history.query({ ...filters, limit: 200, offset: items.length });
      if (!page.items.length) break;
      items.push(...page.items);
    }
    const exported = exportRecords(items, req.query.format || 'json', { total: first.total, language, filters });
    res.set('X-Export-Total', String(first.total));
    res.set('X-Export-Count', String(items.length));
    res.set('X-Export-Truncated', String(first.total > items.length));
    res.set('Content-Disposition', `${req.query.format === 'html' ? 'inline' : 'attachment'}; filename="crucix-history.${exported.extension}"`);
    if (req.query.format === 'html') res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.type(exported.contentType).send(exported.body);
  }));
}
