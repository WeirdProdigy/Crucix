// Ollama Provider — raw fetch, no SDK
// Uses Ollama's OpenAI-compatible Chat Completions API
// No API key required — fully local inference

import { LLMProvider } from './provider.mjs';
import { reasoningEffort } from './budgets.mjs';
import { completionText } from './openai-compatible.mjs';

export class OllamaProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'ollama';
    this.baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    this.model = config.model || 'llama3.1:8b';
    this.reasoningEffort = reasoningEffort(config.reasoningEffort);
    this.keepAlive = config.keepAlive || process.env.OLLAMA_KEEP_ALIVE || '25m';
  }

  get isConfigured() { return !!this.model; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const budget = this.requestOptions(opts, { timeout: 120000 });
    const responseFormat = opts.responseFormat ?? (opts.json ? { type: 'json_object' } : (opts.purpose === 'briefing' ? { type: 'json_object' } : undefined));
    const keepAlive = opts.keepAlive ?? this.keepAlive;
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: budget.maxTokens,
        ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(keepAlive ? { keep_alive: keepAlive } : {}),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(budget.timeout),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Ollama API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const completion = completionText(data, 'Ollama', this.model);

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
