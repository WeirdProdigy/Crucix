// Run as a child process by test/alerts-notify.test.mjs: one dispatch whose Telegram send never answers, in a process
// with nothing else to keep the event loop alive. The deadline timer is then the only handle left, so it must hold the
// process open until the send is given up on (an unref'd timer lets the loop drain: Node 22 on Linux aborts the pending
// dispatch, other versions just exit silently). Prints one JSON line when the dispatch settles.
import { AlertNotifier } from '../../lib/alerts/notify.mjs';

const lines = [];
const sink = (...parts) => lines.push(parts.join(' '));
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

const notifier = new AlertNotifier({
  telegram: { isConfigured: true, sendMessage: () => new Promise(() => {}) },
  discord: { isConfigured: true, sendMessage: async () => true },
  notifyChannels: ['telegram', 'discord'], deadlineMs: 50, now: () => NOW, sleep: async () => {},
  logger: { warn: sink, error: sink, log: sink, info: sink },
});
const alert = {
  id: `alert-${'0'.repeat(32)}`, ruleId: 'events-critical', ruleName: 'Critical events', dedupKey: 'events-critical|event-1',
  kind: 'event', severity: 'high', state: 'firing', title: 'Event reported', summary: 'Summary',
  entity: { type: 'event', id: 'event-1' }, evidence: [], firstSeenAt: NOW, lastSeenAt: NOW, count: 1, notify: true, silent: false,
  log: [{ at: NOW, action: 'created' }],
};
const result = await notifier.dispatch({ created: [alert], escalated: [], silent: false });
console.log(JSON.stringify({ channels: result.sent.map(entry => entry.channels), log: lines }));
