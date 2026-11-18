import { describe, expect, it } from 'vitest';
import { crc32, makeZip, readZip } from './zip';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('zip', () => {
  it('knows the standard CRC-32', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  it('reads back what it writes, compressed or not', async () => {
    const big = JSON.stringify({ elements: Array.from({ length: 300 }, (_, i) => ({ id: i, type: 'rectangle' })) });
    const files = [
      { name: '01 Sockets — how they work.excalidraw', data: enc.encode(big) },
      { name: '02 tiny.excalidraw', data: enc.encode('{}') },
      { name: 'How to open.txt', data: enc.encode('hello') },
    ];
    const zip = await makeZip(files);
    expect(zip.size).toBeLessThan(big.length); // the big one was deflated
    const back = await readZip(zip);
    expect(back.map((e) => e.name)).toEqual(files.map((f) => f.name));
    expect(back.map((e) => dec.decode(e.data))).toEqual(files.map((f) => dec.decode(f.data)));
  });

  it('refuses something that is not a zip', async () => {
    await expect(readZip(new Blob(['not a zip']))).rejects.toThrow();
  });
});
