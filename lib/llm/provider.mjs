// Base LLM Provider — all providers implement this interface

import { getLLMBudget, requestOptions } from './budgets.mjs';

export class LLMProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = 'base';
    // Validate at configuration time instead of silently masking invalid budgets.
    getLLMBudget(config, 'ideas');
    getLLMBudget(config, 'alerts');
    getLLMBudget(config, 'briefing');
  }

  requestOptions(opts, defaults) { return requestOptions(opts, defaults); }

  /**
   * Complete a prompt with system + user messages
   * @returns {{ text: string, usage: { inputTokens: number, outputTokens: number }, model: string }}
   */
  async complete(systemPrompt, userMessage, opts = {}) {
    throw new Error(`${this.name}: complete() not implemented`);
  }

  get isConfigured() { return false; }
}
