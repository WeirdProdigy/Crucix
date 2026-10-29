import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const DEFAULT_REGISTRY_PATH = join(ROOT, 'data/live-streams.json');

export const ALLOWED_STREAM_TYPES = Object.freeze(['news', 'webcam']);
export const ALLOWED_REGIONS = Object.freeze(['local', 'county', 'national', 'global']);
export const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a single live stream registry entry against strict schema and security rules.
 * Throws an Error with a descriptive message if the entry is invalid.
 */
export function validateLiveStreamEntry(entry, index = null) {
  const prefix = index !== null ? `LiveStream[${index}]: ` : 'LiveStream: ';
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${prefix}Entry must be a non-null object`);
  }

  if (typeof entry.id !== 'string' || !/^[a-z0-9_-]{2,64}$/.test(entry.id)) {
    throw new Error(`${prefix}Invalid or missing 'id'. Must be a 2-64 character kebab/snake-case string.`);
  }

  if (typeof entry.name !== 'string' || !entry.name.trim()) {
    throw new Error(`${prefix}Invalid or missing 'name'. Must be a non-empty string.`);
  }

  if (!ALLOWED_STREAM_TYPES.includes(entry.type)) {
    throw new Error(`${prefix}Invalid 'type' "${entry.type}". Allowed: ${ALLOWED_STREAM_TYPES.join(', ')}`);
  }

  if (!ALLOWED_REGIONS.includes(entry.region)) {
    throw new Error(`${prefix}Invalid 'region' "${entry.region}". Allowed: ${ALLOWED_REGIONS.join(', ')}`);
  }

  if (typeof entry.provider !== 'string' || !entry.provider.trim()) {
    throw new Error(`${prefix}Invalid or missing 'provider'.`);
  }

  if (entry.sourceType !== 'youtube') {
    throw new Error(`${prefix}Invalid 'sourceType' "${entry.sourceType}". Only 'youtube' is supported.`);
  }

  if (typeof entry.videoId !== 'string' || !YOUTUBE_VIDEO_ID_REGEX.test(entry.videoId)) {
    throw new Error(`${prefix}Invalid 'videoId' "${entry.videoId}". Must strictly match 11-character YouTube video ID format.`);
  }

  if (typeof entry.language !== 'string' || !/^[a-z]{2,5}$/.test(entry.language)) {
    throw new Error(`${prefix}Invalid 'language' "${entry.language}". Expected 2-5 character ISO language code.`);
  }

  if (typeof entry.checkedAt !== 'string' || !ISO_DATE_REGEX.test(entry.checkedAt)) {
    throw new Error(`${prefix}Invalid 'checkedAt' "${entry.checkedAt}". Expected YYYY-MM-DD.`);
  }

  if (typeof entry.notes !== 'string') {
    throw new Error(`${prefix}'notes' must be a string.`);
  }

  return true;
}

/**
 * Loads and validates the live streams registry from disk.
 * Returns an empty array gracefully if file does not exist.
 */
export function loadLiveStreams(filePath = DEFAULT_REGISTRY_PATH) {
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse live streams registry JSON at ${filePath}: ${error.message}`);
  }

  if (!Array.isArray(data)) {
    throw new Error(`Live streams registry at ${filePath} must contain an array.`);
  }

  const seenIds = new Set();
  const validated = [];

  for (let i = 0; i < data.length; i++) {
    const entry = data[i];
    validateLiveStreamEntry(entry, i);
    if (seenIds.has(entry.id)) {
      throw new Error(`Duplicate stream ID found in registry: "${entry.id}" at index ${i}`);
    }
    seenIds.add(entry.id);
    validated.push(Object.freeze({ ...entry }));
  }

  return Object.freeze(validated);
}

/**
 * Builds a strict, sanitized youtube-nocookie.com embed URL from a validated videoId.
 * Never allows arbitrary hostnames or unescaped query injection.
 */
export function buildSafeYouTubeEmbedUrl(videoId) {
  if (!videoId || typeof videoId !== 'string' || !YOUTUBE_VIDEO_ID_REGEX.test(videoId)) {
    return null;
  }
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1`;
}

/**
 * Builds a safe direct source URL linking to the original YouTube watch page.
 */
export function buildSafeYouTubeSourceUrl(videoId) {
  if (!videoId || typeof videoId !== 'string' || !YOUTUBE_VIDEO_ID_REGEX.test(videoId)) {
    return null;
  }
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * Filters stream list by type and region.
 */
export function filterLiveStreams(streams, { type = 'all', region = 'all' } = {}) {
  if (!Array.isArray(streams)) return [];
  return streams.filter(s => {
    if (type !== 'all' && s.type !== type) return false;
    if (region !== 'all' && s.region !== region) return false;
    return true;
  });
}
