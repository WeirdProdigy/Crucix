// The archive step of a sweep, kept out of server.mjs so that it can be tested on its own.
import { buildChanges } from './changes.mjs';

/**
 * Sets `snapshot.changes` (against `previous`, the last archived snapshot) and stores the snapshot in the archive. Never throws.
 * Returns `{archived: true}` when it was stored, `{archived: false}` when the archive skipped it (a sweep with the same id is
 * already stored, or the clock went back past everything the retention keeps; the archive logs that itself), and
 * `{archived: false, error}` when it could not be written (logged here as `[Sweeps] Archive failed:`, once per failure).
 * The caller keeps `snapshot` as the next `previous` unless `error` is set: after a skip the next changes are counted from the
 * sweep the dashboard showed; after a failure they are counted from the last sweep that is on disk, so the stored changes of the
 * next archived sweep also cover the one that was lost.
 */
export function archiveSweep({ archive, snapshot, timing, previous, log = console }) {
  try {
    snapshot.changes = buildChanges(previous, snapshot);
    return { archived: archive.add({ snapshot, timing }) !== null };
  } catch (error) {
    const message = error?.message || String(error);
    try { log.error('[Sweeps] Archive failed:', message); } catch { /* logging never breaks the sweep */ }
    return { archived: false, error: message };
  }
}
