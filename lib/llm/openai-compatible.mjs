// Local or self-hosted OpenAI-compatible Chat Completions (llama.cpp, LM Studio).
import { LLMProvider } from './provider.mjs';
import { reasoningEffort } from './budgets.mjs';

export function chatCompletionsUrl(raw = 'http://127.0.0.1:8080') {
  let url;
  try { url = new URL(raw); } catch { throw new TypeError('LLM_BASE_URL must be an absolute HTTP or HTTPS URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError('LLM_BASE_URL must use HTTP or HTTPS without credentials, query, or fragment');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/chat\/completions$/.test(path) ? path
    : /\/v1$/.test(path) ? `${path}/chat/completions` : `${path}/v1/chat/completions`;
  return url.toString();
}

export function completionText(data, name, model) {
  const choice = data?.choices?.[0] || {};
  const content = choice.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('') : '';
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
  if (!text.trim() && finishReason === 'length') {
    throw new Error(`${name} ${model}: no content generated (finish_reason=length); reasoning exhausted the token budget. Increase the configured budget or disable thinking if the model supports it.`);
  }
  return { text, finishReason };
}

export class OpenAICompatibleProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'openai-compatible';
    this.apiKey = config.apiKey || null;
    this.model = config.model || 'local-model';
    this.url = chatCompletionsUrl(config.baseUrl || undefined);
    this.reasoningEffort = reasoningEffort(config.reasoningEffort);
  }

  get isConfigured() { return !!this.model; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const budget = this.requestOptions(opts, { timeout: 120000 });
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({
        model: this.model,
        max_tokens: budget.maxTokens,
        stream: false,
        ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
      }),
      signal: AbortSignal.timeout(budget.timeout),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenAI-compatible API ${res.status}: ${err.substring(0, 200)}`);
    }
    const data = await res.json();
    return {
      ...completionText(data, this.name, this.model),
      usage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0 },
      model: data.model || this.model,
    };
  }
}
