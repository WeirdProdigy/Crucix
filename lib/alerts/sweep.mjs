import { messageOf } from './lifecycle.mjs';

// The alert engine's part of a server sweep. Nothing here throws into the sweep or waits for a notification: a failing
// evaluation, notifier or store write is logged and the sweep, its broadcast and the other alerters go on.

const EMPTY_BATCH = Object.freeze({ created: [], escalated: [], resolved: [], silent: false });

function logError(logger, what, error) {
  try { (logger?.error ?? logger?.log)?.call(logger, `[Alerts] ${what}:`, messageOf(error)); } catch { /* logging never breaks the sweep */ }
}

/**
 * Put the stored summary on `snapshot` as `snapshot.alerts` without evaluating (the startup snapshot from latest.json
 * is stale and has no delta). When the summary cannot be read the snapshot gets no `alerts`.
 */
export function attachAlertSummary(snapshot, engine, logger = console) {
  try {
    snapshot.alerts = engine.summary();
  } catch (error) {
    logError(logger, 'Summary unavailable', error);
  }
}

/**
 * Evaluate the sweep's snapshot (with its delta), put the summary on it and send the notifications in the background,
 * recording the alerts that reached a channel (an alert folded into a digest is not recorded). The notifier is called
 * on every sweep, with an empty batch too, so alerts held during quiet hours are released when the window ends. When
 * the evaluation fails the snapshot gets the stored summary instead.
 * @param {object} snapshot the synthesized sweep data, after its events were built
 * @param {{engine: import('./engine.mjs').AlertEngine, notifier: {dispatch: Function}, delta?: object, logger?: object}} options
 * @returns {Promise<void>} settles when the notifications are done; never rejects. The sweep does not wait for it.
 */
export function runAlertStep(snapshot, { engine, notifier, delta, logger = console }) {
  let batch = EMPTY_BATCH;
  try {
    batch = engine.evaluate(snapshot, { delta });
    snapshot.alerts = batch.summary;
  } catch (error) {
    logError(logger, 'Evaluation failed', error);
    batch = EMPTY_BATCH;
    attachAlertSummary(snapshot, engine, logger);
  }
  return Promise.resolve()
    .then(() => notifier.dispatch(batch))
    .then(outcome => {
      for (const { alertId, channels } of outcome?.sent ?? []) engine.markNotified(alertId, channels);
    })
    .catch(error => logError(logger, 'Notification failed', error));
}
