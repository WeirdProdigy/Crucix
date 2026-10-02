import { LEVELS, levelAtLeast, levelRank } from './levels.mjs';
import { cleanText } from './store.mjs';

// Notifications of the alert engine: Telegram and Discord through the existing alerters, plus ntfy and a JSON webhook.
// The alert text comes from feeds, so it is only ever sent as plain text (Telegram without a parse mode, Discord with
// its markdown escaped and mentions suppressed, ntfy as a text body with ASCII-safe headers) or as data (webhook JSON).
// The notifier decides and sends; it does not record anything: the caller marks the returned alerts as notified.
// Nothing here throws out of dispatch(), and a channel's failure never stops another channel. Logs name the channel and
// an error class or HTTP status, never a URL, a token or a message.

const TIMEOUT_MS = 10000;
const DEFAULT_MIN_SEVERITY = 'high';
const DEFAULT_MAX_PER_SWEEP = 5;
const MAX_PER_SWEEP = 50;
const MAX_TITLE = 160;
const MAX_SUMMARY = 600;
const MAX_EVIDENCE_LINES = 3;
const MAX_EVIDENCE_SCAN = 8;
const MAX_PUBLIC_URL = 500;
const MAX_CHANNEL_URL = 2048;
const MAX_TOKEN = 500;
const MAX_BATCH = 1000;
const MAX_HELD = 1000;
const MAX_QUIET_SPEC = 40;
const MAX_DISCORD = 2000;
const DEFAULT_DEADLINE_MS = 20000;
const MAX_DEADLINE_MS = 300000;

const PRIORITY = Object.freeze({ critical: 5, high: 4, watch: 3, info: 2 });
const NTFY_TAG = Object.freeze({ critical: 'rotating_light', high: 'warning', watch: 'eyes', info: 'information_source' });
const RULE_TAG = /^[a-z0-9-]{1,40}$/;
const TOKEN = /^[\x21-\x7e]+$/;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const QUIET_HOURS = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/;
// Discord renders these as markdown or mention syntax; a backslash in front of any of them prints it literally.
const DISCORD_SPECIAL = /[\\*_~`|>#[\]()<@-]/g;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const listOf = value => Array.isArray(value) ? value.slice(0, MAX_BATCH) : [];
const plural = count => count === 1 ? 'alert' : 'alerts';
const discordEscape = text => text.replace(DISCORD_SPECIAL, '\\$&');
const identity = text => text;

// The longest start of `text`, escaped for Discord and ended by an ellipsis, that is at most `max` characters long.
// It is built one character at a time, so a backslash is never separated from the character it escapes.
function escapedPrefix(text, max) {
  let out = '';
  for (const char of text) {
    const piece = discordEscape(char);
    if (out.length + piece.length > max - 1) return `${out}…`;
    out += piece;
  }
  return out;
}

/** An error's class name for the log, never its message (which can carry a URL or a token). */
function errorClass(error) {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name) ? name : 'Error';
}

/** `value` as an http(s) URL string without credentials and of at most `max` characters, or null. */
function safeUrl(value, max) {
  if (typeof value !== 'string' || value === '' || value.length > max) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  return ['http:', 'https:'].includes(url.protocol) && url.username === '' && url.password === '' ? url.toString() : null;
}

/**
 * An HTTP header value that is printable ASCII on one line: plain when it already is, otherwise one RFC 2047
 * UTF-8 encoded word (which ntfy decodes), so Hungarian or any other text never breaks the request.
 */
function headerValue(value) {
  const text = cleanText(String(value), 400);
  return PRINTABLE_ASCII.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

/**
 * Parse `HH:MM-HH:MM` (local time) into minutes from midnight. The window wraps past midnight when start is after
 * end. Anything else, including an empty window (start equal to end), is null.
 * @returns {{start: number, end: number}|null}
 */
export function parseQuietHours(value) {
  if (typeof value !== 'string' || value.length > MAX_QUIET_SPEC) return null;
  const match = QUIET_HOURS.exec(value);
  if (match === null) return null;
  const [startHour, startMinute, endHour, endMinute] = match.slice(1).map(Number);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return start === end ? null : { start, end };
}

const severityLabel = alert => (LEVELS.includes(alert?.severity) ? alert.severity : 'info').toUpperCase();
const titleOf = alert => cleanText(alert?.title, MAX_TITLE) || 'Untitled alert';

// The titles of the first three evidence entries that have one.
function evidenceTitles(alert) {
  const titles = [];
  const evidence = Array.isArray(alert?.evidence) ? alert.evidence.slice(0, MAX_EVIDENCE_SCAN) : [];
  for (const item of evidence) {
    const title = isObject(item) ? cleanText(item.title, MAX_TITLE) : '';
    if (title !== '') titles.push(title);
    if (titles.length === MAX_EVIDENCE_LINES) break;
  }
  return titles;
}

// The fields of an alert a webhook consumer gets; the engine's bookkeeping (dedupKey, log, notified) stays home.
const WEBHOOK_FIELDS = Object.freeze(['id', 'ruleId', 'ruleName', 'kind', 'severity', 'state', 'title', 'summary', 'entity', 'evidence', 'metric', 'firstSeenAt', 'lastSeenAt', 'count']);
function webhookAlert(alert) {
  const out = {};
  for (const field of WEBHOOK_FIELDS) if (alert[field] !== undefined) out[field] = alert[field];
  return out;
}

export class AlertNotifier {
  #telegram;
  #discord;
  #ntfy;
  #webhook;
  #minSeverity;
  #quiet;
  #maxPerSweep;
  #publicUrl;
  #deadlineMs;
  #now;
  #fetch;
  #logger;
  // Alerts kept back during quiet hours (id -> severity), plus how many beyond the cap were not remembered.
  #held = new Map();
  #heldMore = 0;

  /**
   * @param {object} [options]
   * @param {{isConfigured: boolean, sendMessage: Function}} [options.telegram] a TelegramAlerter
   * @param {{isConfigured: boolean, sendMessage: Function}} [options.discord] a DiscordAlerter
   * @param {{url: string|null, token?: string|null}} [options.ntfy] full topic URL and an optional bearer token
   * @param {{url: string|null}} [options.webhook]
   * @param {string} [options.minSeverity] critical | high | watch | info (default high)
   * @param {string|null} [options.quietHours] `HH:MM-HH:MM` local time
   * @param {number} [options.maxPerSweep] individual messages per dispatch, 1-50 (default 5); the rest become one digest
   * @param {string|null} [options.publicUrl] dashboard link added to every message
   * @param {number} [options.deadlineMs] longest wait for one Telegram or Discord send, 1-300000 (default 20000)
   * @param {() => number} [options.now]
   * @param {typeof fetch} [options.fetch]
   * @param {object} [options.logger]
   */
  constructor({ telegram, discord, ntfy, webhook, minSeverity, quietHours, maxPerSweep, publicUrl, deadlineMs, now = Date.now, fetch = globalThis.fetch, logger = console } = {}) {
    this.#logger = logger;
    this.#now = typeof now === 'function' ? now : Date.now;
    this.#fetch = typeof fetch === 'function' ? fetch : null;
    this.#telegram = telegram?.isConfigured && typeof telegram.sendMessage === 'function' ? telegram : null;
    this.#discord = discord?.isConfigured && typeof discord.sendMessage === 'function' ? discord : null;

    this.#minSeverity = DEFAULT_MIN_SEVERITY;
    if (minSeverity !== undefined && minSeverity !== null && minSeverity !== '') {
      if (LEVELS.includes(minSeverity)) this.#minSeverity = minSeverity;
      else this.#warn(`minimum severity is not one of ${LEVELS.join(', ')}; using ${DEFAULT_MIN_SEVERITY}`);
    }
    this.#maxPerSweep = DEFAULT_MAX_PER_SWEEP;
    if (maxPerSweep !== undefined && maxPerSweep !== null) {
      if (Number.isInteger(maxPerSweep) && maxPerSweep >= 1 && maxPerSweep <= MAX_PER_SWEEP) this.#maxPerSweep = maxPerSweep;
      else this.#warn(`notifications per sweep must be an integer from 1 to ${MAX_PER_SWEEP}; using ${DEFAULT_MAX_PER_SWEEP}`);
    }
    this.#deadlineMs = DEFAULT_DEADLINE_MS;
    if (deadlineMs !== undefined && deadlineMs !== null) {
      if (Number.isInteger(deadlineMs) && deadlineMs >= 1 && deadlineMs <= MAX_DEADLINE_MS) this.#deadlineMs = deadlineMs;
      else this.#warn(`send deadline must be an integer from 1 to ${MAX_DEADLINE_MS} ms; using ${DEFAULT_DEADLINE_MS}`);
    }
    this.#quiet = null;
    if (quietHours !== undefined && quietHours !== null && quietHours !== '') {
      this.#quiet = parseQuietHours(quietHours);
      if (this.#quiet === null) this.#warn('quiet hours must look like 22:00-07:00; quiet hours are off');
    }
    this.#publicUrl = null;
    if (publicUrl !== undefined && publicUrl !== null && publicUrl !== '') {
      this.#publicUrl = safeUrl(publicUrl, MAX_PUBLIC_URL);
      if (this.#publicUrl === null) this.#warn(`public URL must be http(s) without credentials, at most ${MAX_PUBLIC_URL} characters; messages carry no link`);
    }
    this.#ntfy = this.#ntfyChannel(this.#channelUrl('ntfy', ntfy?.url), ntfy?.token);
    this.#webhook = this.#channelUrl('webhook', webhook?.url);
  }

  // A configured channel URL, or null when it is unset, invalid or there is no fetch to send it with.
  #channelUrl(name, value) {
    if (value === undefined || value === null || value === '') return null;
    const url = safeUrl(value, MAX_CHANNEL_URL);
    if (url === null) this.#warn(`${name} URL must be http(s) without credentials; ${name} is off`);
    return url !== null && this.#fetch !== null ? url : null;
  }

  // The ntfy channel {url, token}: a token that cannot go into a header turns ntfy off rather than sending without it.
  #ntfyChannel(url, token) {
    if (url === null) return null;
    if (token === undefined || token === null || token === '') return { url, token: null };
    if (typeof token === 'string' && token.length <= MAX_TOKEN && TOKEN.test(token)) return { url, token };
    this.#warn('ntfy token must be visible ASCII without spaces; ntfy is off');
    return null;
  }

  #warn(message) {
    try { (this.#logger?.warn ?? this.#logger?.log)?.call(this.#logger, `[Alerts] ${message}`); } catch { /* a broken logger never breaks a notification */ }
  }

  /** The configured channels: telegram, discord, ntfy, webhook (in that order). */
  channels() {
    const names = [];
    if (this.#telegram !== null) names.push('telegram');
    if (this.#discord !== null) names.push('discord');
    if (this.#ntfy !== null) names.push('ntfy');
    if (this.#webhook !== null) names.push('webhook');
    return names;
  }

  /** True when `date` (local time) falls inside the quiet-hours window; the start is included, the end is not. */
  inQuietHours(date) {
    if (this.#quiet === null || !(date instanceof Date)) return false;
    const minutes = date.getHours() * 60 + date.getMinutes();
    if (Number.isNaN(minutes)) return false;
    const { start, end } = this.#quiet;
    return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  }

  // ─── text ───────────────────────────────────────────────────────────────────

  // The lines of an alert message: [SEVERITY] title, the summary, up to three evidence titles, the dashboard link. Every
  // field comes out as one cleaned line of bounded length; `escape` is applied to the feed text only.
  #lines(alert, escape) {
    const lines = [`[${severityLabel(alert)}] ${escape(titleOf(alert))}`];
    const summary = cleanText(alert?.summary, MAX_SUMMARY);
    if (summary !== '') lines.push(escape(summary));
    for (const title of evidenceTitles(alert)) lines.push(`- ${escape(title)}`);
    if (this.#publicUrl !== null) lines.push(this.#publicUrl);
    return lines;
  }

  #digestLines({ overflow, held }, escape = identity) {
    const lines = [];
    if (overflow > 0) lines.push(escape(`+${overflow} more ${plural(overflow)}`));
    if (held > 0) lines.push(escape(`${held} ${plural(held)} held during quiet hours`));
    if (this.#publicUrl !== null) lines.push(this.#publicUrl);
    return lines;
  }

  /** The plain-text message of an alert (no markdown): under 2000 characters whatever the alert holds. */
  formatText(alert) {
    return this.#lines(alert, identity).join('\n');
  }

  // ─── delivery ───────────────────────────────────────────────────────────────

  /**
   * Send the notifications due for one evaluation. `batch.created` and `batch.escalated` are the engine's lists; a batch
   * with `silent` (the bootstrap sweep) sends nothing. An alert notifies when its rule has `notify`, its severity reaches
   * the minimum and, for a created alert, it is not `silent` (an escalated alert notifies even if it started silent).
   * The most severe alerts go out individually up to the per-sweep cap; the rest, and the alerts held back during quiet
   * hours (only `critical` goes through then), follow as one digest. Never throws.
   * @returns {Promise<{sent: Array<{alertId: string, channels: string[]}>, digest: {count: number, channels: string[]}|null, skipped: number}>}
   *   `sent`: alerts that reached at least one channel, with those channels (for the caller to record);
   *   `skipped`: alerts the gates excluded (silent, notify off, below the minimum, malformed, listed twice).
   */
  async dispatch(batch) {
    try {
      return await this.#dispatch(batch);
    } catch (error) {
      this.#warn(`dispatch failed: ${errorClass(error)}`);
      return { sent: [], digest: null, skipped: 0 };
    }
  }

  async #dispatch(batch) {
    const created = listOf(batch?.created);
    const escalated = listOf(batch?.escalated);
    const channels = this.channels();
    if (batch?.silent === true || channels.length === 0) return { sent: [], digest: null, skipped: created.length + escalated.length };

    const candidates = new Map();
    let skipped = 0;
    for (const [alerts, isEscalated] of [[created, false], [escalated, true]]) {
      for (const alert of alerts) {
        if (this.#eligible(alert, isEscalated) && !candidates.has(alert.id)) candidates.set(alert.id, { alert, escalated: isEscalated });
        else skipped += 1;
      }
    }

    const quiet = this.inQuietHours(new Date(this.#now()));
    const due = [];
    const ranked = [...candidates.values()].sort((a, b) => levelRank(b.alert.severity) - levelRank(a.alert.severity));
    for (const item of ranked) {
      if (quiet && item.alert.severity !== 'critical') {
        this.#hold(item.alert);
      } else {
        this.#held.delete(item.alert.id);
        due.push(item);
      }
    }
    const individual = due.slice(0, this.#maxPerSweep);
    const overflow = due.length - individual.length;

    // After the quiet window the held alerts are released as part of the digest; they come back if nobody accepted it.
    let taken = null;
    if (!quiet && (this.#held.size > 0 || this.#heldMore > 0)) {
      taken = { alerts: this.#held, more: this.#heldMore };
      this.#held = new Map();
      this.#heldMore = 0;
    }
    const released = taken === null ? 0 : taken.alerts.size + taken.more;
    const digest = overflow + released > 0 ? { count: overflow + released, overflow, held: released } : null;
    if (individual.length === 0 && digest === null) return { sent: [], digest: null, skipped };

    const outcomes = await Promise.all(channels.map(name => this.#deliver(name, individual, digest)));
    const sent = [];
    for (const { alert } of individual) {
      const reached = outcomes.filter(outcome => outcome.alerts.has(alert.id)).map(outcome => outcome.name);
      if (reached.length > 0) sent.push({ alertId: alert.id, channels: reached });
    }
    let digestResult = null;
    if (digest !== null) {
      const reached = outcomes.filter(outcome => outcome.digest).map(outcome => outcome.name);
      if (reached.length > 0) digestResult = { count: digest.count, channels: reached };
      else if (taken !== null) this.#restore(taken);
    }
    return { sent, digest: digestResult, skipped };
  }

  // Whether an alert may notify now. A hostile or half-built entry is simply not eligible.
  #eligible(alert, escalated) {
    try {
      return isObject(alert) && typeof alert.id === 'string' && alert.id !== '' && alert.id.length <= 100
        && alert.notify === true && levelAtLeast(alert.severity, this.#minSeverity) && (escalated || alert.silent !== true);
    } catch {
      return false;
    }
  }

  #hold(alert) {
    if (this.#held.has(alert.id) || this.#held.size < MAX_HELD) this.#held.set(alert.id, alert.severity);
    else this.#heldMore += 1;
  }

  #restore({ alerts, more }) {
    for (const [id, severity] of alerts) {
      if (this.#held.has(id) || this.#held.size < MAX_HELD) this.#held.set(id, severity);
      else this.#heldMore += 1;
    }
    this.#heldMore += more;
  }

  // Every message for one channel, one after the other; the channels run side by side.
  async #deliver(name, individual, digest) {
    const alerts = new Set();
    for (const item of individual) {
      if (await this.#send(name, { type: 'alert', ...item })) alerts.add(item.alert.id);
    }
    const digestSent = digest !== null && await this.#send(name, { type: 'digest', ...digest });
    return { name, alerts, digest: digestSent };
  }

  // True when the channel accepted the message. Never throws, never logs more than the channel and the failure class.
  async #send(name, message) {
    try {
      if (name === 'telegram') {
        const text = this.#plainText(message);
        return this.#accepted(name, await this.#withDeadline(() => this.#telegram.sendMessage(text, { parseMode: null })));
      }
      if (name === 'discord') {
        const content = this.#discordContent(message);
        return this.#accepted(name, await this.#withDeadline(() => this.#discord.sendMessage(content, [], { suppressMentions: true })));
      }
      if (name === 'ntfy') return await this.#post(name, this.#ntfy.url, this.#ntfyRequest(message));
      return await this.#post(name, this.#webhook, this.#webhookRequest(message));
    } catch (error) {
      this.#warn(`${name} failed: ${errorClass(error)}`);
      return false;
    }
  }

  #plainText(message) {
    const lines = message.type === 'alert' ? this.#lines(message.alert, identity) : this.#digestLines(message);
    return lines.join('\n');
  }

  // The Discord message: the same lines with the feed text escaped, kept within Discord's 2000 characters (a longer
  // message is rejected outright). Escaping can double the text, so when it does not fit the evidence lines go first
  // (the last one first), then the summary is cut. Head and link are bounded (a title of at most 160 characters escaped
  // is 320, a link at most 500), so the summary always keeps more than a thousand characters of room.
  #discordContent(message) {
    if (message.type === 'digest') return this.#digestLines(message, discordEscape).join('\n');
    const { alert } = message;
    const head = `[${severityLabel(alert)}] ${discordEscape(titleOf(alert))}`;
    const tail = this.#publicUrl === null ? [] : [this.#publicUrl];
    const summary = cleanText(alert?.summary, MAX_SUMMARY);
    const evidence = evidenceTitles(alert).map(title => `- ${discordEscape(title)}`);
    let summaryLine = summary === '' ? [] : [discordEscape(summary)];
    const joined = () => [head, ...summaryLine, ...evidence, ...tail].join('\n');
    while (evidence.length > 0 && joined().length > MAX_DISCORD) evidence.pop();
    if (summaryLine.length > 0 && joined().length > MAX_DISCORD) {
      const room = MAX_DISCORD - [head, ...evidence, ...tail].join('\n').length - 1;
      summaryLine = [escapedPrefix(summary, room)];
    }
    return joined();
  }

  // One alerter call, given up on after the deadline so a hanging alerter cannot hold back the other channels' results.
  // The timer is cleared when the call settles; the race keeps a handler on the call, so one that fails after the deadline
  // is not an unhandled rejection.
  async #withDeadline(call) {
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('deadline passed'), { name: 'TimeoutError' })), this.#deadlineMs);
      timer.unref?.();
    });
    const pending = Promise.resolve().then(call);
    try {
      return await Promise.race([pending, expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  // The alerters answer {ok} (Telegram) or a boolean (Discord) and log their own errors.
  #accepted(name, result) {
    const ok = result === true || (isObject(result) && result.ok === true);
    if (!ok) this.#warn(`${name} did not accept the message`);
    return ok;
  }

  async #post(name, url, { headers, body }) {
    let response;
    try {
      // A redirect would turn the POST into a GET that "succeeds": it is a failure instead.
      response = await this.#fetch(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      this.#warn(`${name} request failed: ${errorClass(error)}`);
      return false;
    }
    const ok = isObject(response) && response.ok === true;
    if (!ok) this.#warn(`${name} rejected the message: HTTP ${Number.isInteger(response?.status) ? response.status : '?'}`);
    // Only the status is used; the body is dropped unread.
    try { Promise.resolve(response?.body?.cancel?.()).catch(() => {}); } catch { /* nothing to release */ }
    return ok;
  }

  #ntfyRequest(message) {
    const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
    let body;
    if (message.type === 'alert') {
      const { alert } = message;
      const severity = LEVELS.includes(alert.severity) ? alert.severity : 'info';
      headers.Title = headerValue(`[${severityLabel(alert)}] ${titleOf(alert)}`);
      headers.Priority = String(PRIORITY[severity]);
      headers.Tags = headerValue([NTFY_TAG[severity], 'crucix', ...(typeof alert.ruleId === 'string' && RULE_TAG.test(alert.ruleId) ? [alert.ruleId] : [])].join(','));
      body = this.formatText(alert);
    } else {
      headers.Title = headerValue(`Crucix: ${message.count} ${plural(message.count)}`);
      headers.Priority = '3';
      headers.Tags = 'crucix';
      body = this.#digestLines(message).join('\n');
    }
    if (this.#ntfy.token !== null) headers.Authorization = `Bearer ${this.#ntfy.token}`;
    return { headers, body };
  }

  #webhookRequest(message) {
    const payload = message.type === 'alert'
      ? { event: 'alert', alert: webhookAlert(message.alert), escalated: message.escalated }
      : { event: 'digest', count: message.count, overflow: message.overflow, held: message.held };
    return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
  }
}
