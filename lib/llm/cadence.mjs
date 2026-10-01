import { boundedInteger } from './budgets.mjs';
import { resolveIdeas } from './rule-ideas.mjs';

// Per-process idea cache only. Delta alerts are evaluated separately every sweep.
export class IdeaCadence {
  constructor({ everyNSweeps = 1, now = () => Date.now() } = {}) {
    this.everyNSweeps = boundedInteger(everyNSweeps, 1, 'everyNSweeps', 1, 96);
    this.sweepCount = 0;
    this._now = now;
    this._cachedLlm = null;
  }

  async resolve(provider, data, delta = null, previous = [], language = 'en') {
    this.sweepCount++;
    const due = this.sweepCount === 1 || this.sweepCount % this.everyNSweeps === 0;
    if (provider?.isConfigured && !due && this._cachedLlm) {
      return { ...structuredClone(this._cachedLlm), ideasCached: true };
    }
    // Missing cache or disabled provider: evaluate current rules without an extra LLM call.
    const result = await resolveIdeas(due ? provider : null, data, delta, previous, language);
    const fresh = {
      ...result,
      ideasGeneratedAt: result.ideas.length ? new Date(this._now()).toISOString() : null,
      ideasCached: false,
    };
    // A failed model call must not replace a successful cache with rules or a new timestamp.
    if (fresh.ideasSource === 'llm') this._cachedLlm = structuredClone(fresh);
    return fresh;
  }
}
