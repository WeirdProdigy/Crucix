import { normalizeSeverity } from '../intelligence/events.mjs';

/** Alert levels, most severe first. */
export const LEVELS = Object.freeze(['critical', 'high', 'watch', 'info']);

// Event severity words (already on the events.mjs scale) mapped onto alert levels.
// 'unknown' is deliberately absent: an event with no known severity raises nothing.
const EVENT_LEVEL = Object.freeze({
  critical: 'critical',
  high: 'high',
  elevated: 'high',
  moderate: 'watch',
  monitor: 'info',
  low: 'info',
});

const isLevel = value => typeof value === 'string' && LEVELS.includes(value);

/** critical 3, high 2, watch 1, info 0; anything else -1. */
export function levelRank(level) {
  return isLevel(level) ? LEVELS.length - 1 - LEVELS.indexOf(level) : -1;
}

/** The alert level of an EventRecord-like object, or null when it has no usable severity. */
export function eventLevel(event) {
  if (event === null || typeof event !== 'object') return null;
  const severity = normalizeSeverity(event.severity);
  return severity !== null && Object.hasOwn(EVENT_LEVEL, severity) ? EVENT_LEVEL[severity] : null;
}

/** True when `level` is at least as severe as `min`; false when either is not a level. */
export function levelAtLeast(level, min) {
  const floor = levelRank(min);
  return floor >= 0 && levelRank(level) >= floor;
}

/** Threat contribution of a firing alert level: info 2, watch 3, high 4, critical 5; 1 for anything else. */
export function threatOf(level) {
  return isLevel(level) ? levelRank(level) + 2 : 1;
}
