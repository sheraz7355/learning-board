// A small .zip writer and reader, so many boards can be shared as one file. No packages: files are
// compressed with the browser's own deflate when it has one (all current browsers), otherwise stored.
// The reader opens zips made here and ones re-zipped by Windows Explorer or macOS Finder.

export type ZipEntry = { name: string; data: Uint8Array };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function through(data: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const canDeflate = () => typeof CompressionStream !== 'undefined';

/** DOS date and time, as zip files keep them. */
function dosTime(d: Date) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export async function makeZip(entries: ZipEntry[], when = new Date()): Promise<Blob> {
  const enc = new TextEncoder();
  const { time, date } = dosTime(when);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    let method = 0;
    let body = e.data;
    if (canDeflate() && e.data.length > 64) {
      const packed = await through(e.data, new CompressionStream('deflate-raw'));
      if (packed.length < e.data.length) { method = 8; body = packed; }
    }
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, body);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, method, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, body.length, true);
    cen.setUint32(24, e.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + body.length;
  }

  const cenSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' });
}

export async function readZip(blob: Blob): Promise<ZipEntry[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // The directory at the end lists every file with its real sizes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder();
  const latin = new TextDecoder('latin1');
  const out: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged zip file');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const at = v.getUint32(p + 42, true);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x0800 ? utf8 : latin).decode(rawName);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // a folder

    const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
    const body = buf.subarray(start, start + size);
    if (method === 0) out.push({ name, data: body.slice() });
    else if (method === 8) out.push({ name, data: await through(body, new DecompressionStream('deflate-raw')) });
    // other methods (rare) are skipped
  }
  return out;
}
