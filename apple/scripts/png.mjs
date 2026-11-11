import fs from 'node:fs';
import zlib from 'node:zlib';

// A small PNG made here, so no picture file lives in the repo.
export function makePng(file, size = 96) {
  const crc = buf => {
    let c, n = ~0;
    for (const byte of buf) { c = (n ^ byte) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; n = c ^ (n >>> 8); }
    return ~n >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = y * (size * 3 + 1) + 1 + x * 3;
    rows[at] = 40 + Math.round(180 * x / size); rows[at + 1] = 90 + Math.round(120 * y / size); rows[at + 2] = 200 - Math.round(100 * x / size);
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}
