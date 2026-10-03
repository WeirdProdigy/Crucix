// The JSON error handler of the whole /api: what no route answered itself. Express's own error page is HTML and, outside
// production, carries the stack and file paths; an API client must get JSON and nothing of the server's internals.
//
// Install it once, after every /api route. An Express error handler only sees what the layers before it passed on, and this one
// is mounted on /api: a route registered after it, and every path outside /api, keep Express's own handling. The routes that
// answer their own failures (the alert API, the history and sweep routes' `handle`) never reach it; it is for what they cannot
// catch: a path parameter that is not valid percent-encoding (a router failure before the handler runs) and anything that a
// route lets escape, a rejected promise of an async handler included (Express 5 passes it on).

// First line only and capped: a log line is not the place for a stack, or for a text that can fake further log lines.
function describe(error) {
  try { return String(error instanceof Error ? error.message : error).split('\n')[0].slice(0, 200); } catch { return 'an error that cannot be printed'; }
}

/** @param {import('express').Express} app */
export function installApiErrorHandler(app) {
  app.use('/api', (error, _req, res, next) => {
    // Part of the answer is out already: only Express's default handler can end it (it closes the connection).
    if (res.headersSent) return next(error);
    if (error instanceof URIError) return res.status(400).json({ error: 'Invalid path parameter', code: 'INVALID_FILTER', field: 'id' });
    console.error(`[API] Request failed: ${describe(error)}`);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  });
}
