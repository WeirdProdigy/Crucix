// OFAC — US Treasury Office of Foreign Assets Control Sanctions
// No auth required. Monitors the Specially Designated Nationals (SDN) list
// and consolidated sanctions list for changes.

const EXPORTS_BASE = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports';

// SDN list endpoints
const SDN_XML_URL = `${EXPORTS_BASE}/SDN.XML`;
const SDN_ADVANCED_URL = `${EXPORTS_BASE}/SDN_ADVANCED.XML`;
const CONS_ADVANCED_URL = `${EXPORTS_BASE}/CONS_ADVANCED.XML`;

const SAMPLE_BYTES = 64 * 1024;

// Request a prefix, and enforce the same bound if the origin ignores Range.
// Copy only retained bytes: a large transport chunk must not enlarge the sample.
async function fetchSample(url, { timeout = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  let reader;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Crucix/2.2', Range: `bytes=0-${SAMPLE_BYTES - 1}` },
    });
    if (!response.ok) return { error: `HTTP ${response.status}`, status: response.status };
    reader = response.body?.getReader();
    if (!reader) return { error: 'OFAC export returned no response body' };

    const chunks = [];
    let sampleBytes = 0;
    let complete = false;
    while (sampleBytes < SAMPLE_BYTES) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      const retained = value.subarray(0, SAMPLE_BYTES - sampleBytes);
      chunks.push(Buffer.from(retained));
      sampleBytes += retained.byteLength;
    }

    if (sampleBytes === 0) return { error: 'OFAC export returned an empty body' };

    const range = response.headers.get('content-range')?.match(/^bytes\s+0-\d+\/(\d+)$/i);
    const length = response.headers.get('content-length');
    const total = range?.[1] ?? (response.status === 200 && length ? length : null);
    const totalBytes = total && /^\d+$/.test(total) && Number.isSafeInteger(Number(total)) ? Number(total) : null;
    return {
      rawText: new TextDecoder().decode(Buffer.concat(chunks)),
      sampleBytes,
      totalBytes,
      partial: !complete || (response.status === 206 && (totalBytes === null || sampleBytes < totalBytes)),
      rangeHonored: response.status === 206,
    };
  } catch (error) {
    return { error: controller.signal.aborted ? `OFAC request timed out after ${timeout}ms` : error.message };
  } finally {
    try {
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      } else {
        await response?.body?.cancel().catch(() => {});
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseDateOfIssue(raw) {
  const block = raw.match(/<DateOfIssue\b[^>]*>([\s\S]*?)<\/DateOfIssue>/i)?.[1];
  if (!block) return null;
  const year = Number(block.match(/<Year>(\d{4})<\/Year>/i)?.[1]);
  const month = Number(block.match(/<Month>(\d{1,2})<\/Month>/i)?.[1]);
  const day = Number(block.match(/<Day>(\d{1,2})<\/Day>/i)?.[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

// Header counts describe the whole list; prefix entry counts describe only a sample.
function parseSDNMetadata(xml) {
  if (!xml || xml.error) return { error: xml?.error || 'No data returned', ...(xml?.status ? { status: xml.status } : {}) };

  const raw = xml.rawText || '';

  // Extract publish date
  const publishDate = raw.match(/<Publish_Date>(.*?)<\/Publish_Date>/)?.[1]
    || raw.match(/<publish_date>(.*?)<\/publish_date>/i)?.[1]
    || parseDateOfIssue(raw)
    || null;

  const sampleEntryCount = (raw.match(/<sdnEntry>([\s\S]*?)<\/sdnEntry>/gi) || []).length;

  // Extract record count if present
  const recordCount = raw.match(/<Record_Count>(.*?)<\/Record_Count>/)?.[1]
    || raw.match(/<records_count>(.*?)<\/records_count>/i)?.[1]
    || null;

  return {
    publishDate,
    // Do not label a sampled count as the total number of sanctions entries.
    entryCount: null,
    sampleEntryCount,
    recordCount: recordCount && /^\d+$/.test(recordCount.trim()) && Number.isSafeInteger(Number(recordCount)) ? Number(recordCount) : null,
    hasData: raw.length > 0,
    dataSize: xml.sampleBytes,
    sampleBytes: xml.sampleBytes,
    totalBytes: xml.totalBytes,
    sampled: true,
    partial: xml.partial,
    rangeHonored: xml.rangeHonored,
  };
}

// Fetch at most 64 KiB from the start of each export.
export async function getSDNMetadata(opts) {
  return parseSDNMetadata(await fetchSample(SDN_XML_URL, opts));
}

// Fetch advanced SDN data (includes more structured info)
export async function getSDNAdvanced(opts) {
  return parseSDNMetadata(await fetchSample(SDN_ADVANCED_URL, opts));
}

// Fetch consolidated list metadata
export async function getConsolidatedMetadata(opts) {
  return parseSDNMetadata(await fetchSample(CONS_ADVANCED_URL, opts));
}

// These entries occur at the start of the SDN export; they are not recent additions.
function parseSampleEntries(xml) {
  if (!xml || xml.error) return [];

  const raw = xml.rawText || '';
  const entries = [];
  const entryRegex = /<sdnEntry>([\s\S]*?)<\/sdnEntry>/gi;
  let match;
  let count = 0;

  while ((match = entryRegex.exec(raw)) !== null && count < 20) {
    const content = match[1];
    const uid = content.match(/<uid>(.*?)<\/uid>/i)?.[1];
    const lastName = content.match(/<lastName>(.*?)<\/lastName>/i)?.[1];
    const firstName = content.match(/<firstName>(.*?)<\/firstName>/i)?.[1];
    const sdnType = content.match(/<sdnType>(.*?)<\/sdnType>/i)?.[1];

    // Extract programs
    const programs = [];
    const progRegex = /<program>(.*?)<\/program>/gi;
    let progMatch;
    while ((progMatch = progRegex.exec(content)) !== null) {
      programs.push(progMatch[1]);
    }

    if (uid || lastName) {
      entries.push({
        uid,
        name: [firstName, lastName].filter(Boolean).join(' '),
        type: sdnType,
        programs,
      });
      count++;
    }
  }

  return entries;
}

// Briefing — report on sanctions list status and metadata
export async function briefing() {
  const [sdnSample, advancedSample] = await Promise.all([
    fetchSample(SDN_XML_URL),
    fetchSample(SDN_ADVANCED_URL),
  ]);
  const sdnMeta = parseSDNMetadata(sdnSample);
  const advancedMeta = parseSDNMetadata(advancedSample);
  const errors = [sdnMeta.error && `SDN: ${sdnMeta.error}`, advancedMeta.error && `Advanced: ${advancedMeta.error}`].filter(Boolean);
  const listSummary = meta => ({
    ...meta,
    dataAvailable: meta.hasData || false,
  });

  return {
    source: 'OFAC Sanctions',
    timestamp: new Date().toISOString(),
    ...(errors.length ? { error: errors.join('; ') } : {}),
    coverage: 'metadata-and-prefix-sample',
    lastUpdated: sdnMeta.publishDate || advancedMeta.publishDate || 'unknown',
    sdnList: listSummary(sdnMeta),
    advancedList: listSummary(advancedMeta),
    sampleEntries: parseSampleEntries(sdnSample).slice(0, 10),
    sampleEntriesNote: 'Entries from the sampled start of SDN.XML, not recent additions or the complete sanctions list.',
    endpoints: {
      sdnXml: SDN_XML_URL,
      sdnAdvanced: SDN_ADVANCED_URL,
      consolidatedAdvanced: CONS_ADVANCED_URL,
    },
  };
}

// Run standalone
if (process.argv[1]?.endsWith('ofac.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
