import { inflateRawSync } from 'node:zlib';

const END_OF_DIRECTORY = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const MAX_END_SEARCH = 22 + 0xffff; // fixed record plus the longest allowed comment

// Returns the first entry of a ZIP archive. Sizes come from the central directory because
// archives written in streaming mode leave them empty in the local header. The output
// limit is enforced while inflating, so a falsified size cannot expand past maxBytes.
export function readZipEntry(archive, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const buffer = Buffer.isBuffer(archive) ? archive : Buffer.from(archive);
  let end = -1;
  for (let at = buffer.length - 22; at >= 0 && at >= buffer.length - MAX_END_SEARCH; at--) {
    if (buffer.readUInt32LE(at) === END_OF_DIRECTORY) { end = at; break; }
  }
  if (end < 0) throw new Error('Data is not a ZIP archive');
  const entries = buffer.readUInt16LE(end + 10);
  const directory = buffer.readUInt32LE(end + 16);
  if (!entries || directory + 46 > buffer.length || buffer.readUInt32LE(directory) !== CENTRAL_HEADER) {
    throw new Error('ZIP central directory is corrupt');
  }
  const flags = buffer.readUInt16LE(directory + 8);
  const method = buffer.readUInt16LE(directory + 10);
  const compressed = buffer.readUInt32LE(directory + 20);
  const size = buffer.readUInt32LE(directory + 24);
  const local = buffer.readUInt32LE(directory + 42);
  if (flags & 1) throw new Error('ZIP entry is encrypted');
  if (method !== 0 && method !== 8) throw new Error(`ZIP compression method ${method} is not supported`);
  if (compressed === 0xffffffff || size === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  if (size > maxBytes) throw new Error(`ZIP entry exceeds ${maxBytes} byte limit`);
  if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== LOCAL_HEADER) throw new Error('ZIP local header is corrupt');
  const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
  if (start + compressed > buffer.length) throw new Error('ZIP entry is truncated');
  const data = buffer.subarray(start, start + compressed);
  if (method === 0) return Buffer.from(data);
  try {
    return inflateRawSync(data, { maxOutputLength: maxBytes });
  } catch (error) {
    throw new Error(error?.code === 'ERR_BUFFER_TOO_LARGE' ? `ZIP entry exceeds ${maxBytes} byte limit` : 'ZIP entry is corrupt');
  }
}
