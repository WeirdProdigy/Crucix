import { deflateRawSync } from 'node:zlib';

// Minimal single-entry ZIP writer for fixtures. `descriptor: true` mimics archives that
// leave the sizes empty in the local header and only record them in the central directory.
export function zipOf(name, content, { method = 8, descriptor = false, flags = 0 } = {}) {
  const raw = Buffer.from(content);
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const label = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags | (descriptor ? 8 : 0), 6);
  local.writeUInt16LE(method, 8);
  if (!descriptor) { local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); }
  local.writeUInt16LE(label.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags | (descriptor ? 8 : 0), 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(label.length, 28);
  const head = Buffer.concat([local, label, data]);
  const directory = Buffer.concat([central, label]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(head.length, 16);
  return Buffer.concat([head, directory, end]);
}
