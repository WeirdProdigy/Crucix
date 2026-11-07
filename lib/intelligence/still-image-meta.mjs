/**
 * lib/intelligence/still-image-meta.mjs
 *
 * Dedicated in-memory cached metadata service for still-image streams.
 * Prevents SSRF by strictly restricting lookups to registered still-image stream IDs.
 * Performs lightweight HEAD requests with 5s timeout and caches Last-Modified for 5 minutes.
 * Strictly zero disk writes, zero content downloads.
 */

export const DEFAULT_META_TIMEOUT_MS = 5000;
export const DEFAULT_META_CACHE_TTL_MS = 5 * 60 * 1000; // 5 perc

export class StillImageMetaService {
  constructor(options = {}) {
    this.registryGetter = options.getRegistry || (() => []);
    this.timeoutMs = options.timeoutMs || DEFAULT_META_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs || DEFAULT_META_CACHE_TTL_MS;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.cache = new Map();
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheSize() {
    return this.cache.size;
  }

  async getMetadata(streamId, options = {}) {
    if (!streamId || typeof streamId !== 'string') {
      return { ok: false, error: 'A streamId azonosító megadása kötelező.', status: 400 };
    }

    const registry = typeof this.registryGetter === 'function' ? this.registryGetter() : [];
    const stream = registry.find(s => s && s.id === streamId && s.sourceType === 'still-image');

    if (!stream) {
      return { ok: false, error: `Ismeretlen vagy nem still-image típusú katalógus-azonosító: ${streamId}`, status: 404 };
    }

    if (!stream.imageUrl || (!stream.imageUrl.startsWith('http://') && !stream.imageUrl.startsWith('https://'))) {
      return { ok: false, error: 'A katalógusbejegyzés nem tartalmaz érvényes kép-URL-t.', status: 500 };
    }

    const now = options.now ? new Date(options.now).getTime() : Date.now();
    const cached = this.cache.get(streamId);
    if (cached && cached.expiresAt > now) {
      return {
        ok: true,
        streamId,
        lastModified: cached.lastModified,
        checkedAt: cached.checkedAt,
        cached: true,
        status: 200
      };
    }

    const timeout = options.timeoutMs || this.timeoutMs;
    const fetchFn = options.fetchFn || this.fetchFn;

    try {
      const res = await fetchFn(stream.imageUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(timeout)
      });

      const checkedAt = new Date(now).toISOString();
      const lastModified = res.headers ? res.headers.get('last-modified') : null;

      if (!res.ok && res.status >= 400) {
        return {
          ok: false,
          streamId,
          error: `A távoli forrás HTTP ${res.status} hibát adott.`,
          status: 502,
          checkedAt
        };
      }

      const entry = {
        lastModified: lastModified || null,
        checkedAt,
        expiresAt: now + (options.cacheTtlMs || this.cacheTtlMs)
      };
      this.cache.set(streamId, entry);

      return {
        ok: true,
        streamId,
        lastModified: entry.lastModified,
        checkedAt: entry.checkedAt,
        cached: false,
        status: 200
      };
    } catch (err) {
      const checkedAt = new Date(now).toISOString();
      const isTimeout = err?.name === 'TimeoutError' || err?.code === 23 || /timeout/i.test(err?.message || '');
      const errMsg = isTimeout
        ? `Időtúllépés (${timeout} ms) a forrás fejlécének lekérdezésekor.`
        : `Hálózati hiba a forrás lekérdezésekor: ${err?.message || String(err)}`;

      return {
        ok: false,
        streamId,
        error: errMsg,
        status: 502,
        checkedAt
      };
    }
  }
}
