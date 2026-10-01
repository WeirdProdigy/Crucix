// Google Gemini Provider — raw fetch, no SDK

import { LLMProvider } from './provider.mjs';

export class GeminiProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'gemini';
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-3.1-pro';
  }

  get isConfigured() { return !!this.apiKey; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const budget = this.requestOptions(opts);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: {
          maxOutputTokens: budget.maxTokens,
        },
      }),
      signal: AbortSignal.timeout(budget.timeout),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts
      .filter(part => !part?.thought && typeof part?.text === 'string')
      .map(part => part.text).join('').trim() : '';
    const finishReason = data.candidates?.[0]?.finishReason || null;
    if (!text && finishReason === 'MAX_TOKENS') {
      throw new Error(`Gemini ${this.model}: no answer generated before MAX_TOKENS; increase the configured token budget.`);
    }

    return {
      text,
      finishReason,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      },
      model: this.model,
    };
  }
}
