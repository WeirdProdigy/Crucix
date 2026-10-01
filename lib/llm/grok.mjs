// Grok Provider - raw fetch, no SDK

import { LLMProvider } from './provider.mjs';
import { completionText } from './openai-compatible.mjs';

export class GrokProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'grok';
    this.apiKey = config.apiKey;
    this.model = config.model || 'grok-4-latest';
  }

  get isConfigured() {
    return !!this.apiKey;
  }

  async complete(systemPrompt, userMessage, opts = {}) {
    const budget = this.requestOptions(opts);
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        max_tokens: budget.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        model: this.model,
        stream: false,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(budget.timeout),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Grok API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const completion = completionText(data, 'Grok', this.model);

    return {
      ...completion,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || this.model,
    };
  }
}
