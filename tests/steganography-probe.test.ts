import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { probePixelSafePng } from '../src/scanners/steganography-probe';

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); t.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, data])), 8 + data.length);
  return out;
}

function pngWithLsb(payload: Buffer, colorType = 2): Buffer {
  const width = 32, height = 2, channels = colorType === 6 ? 4 : 3;
  const pixels = Buffer.alloc(width * height * channels, 0x80);
  let bit = 0;
  for (let i = 0; i < pixels.length && bit < payload.length * 8; i += channels) {
    for (let c = 0; c < 3 && bit < payload.length * 8; c++) {
      pixels[i + c] = (pixels[i + c] & 0xfe) | ((payload[Math.floor(bit / 8)] >>> (bit % 8)) & 1);
      bit++;
    }
  }
  const scanlines = Buffer.alloc(height * (width * channels + 1));
  for (let y = 0; y < height; y++) {
    scanlines[y * (width * channels + 1)] = 0;
    pixels.copy(scanlines, y * (width * channels + 1) + 1, y * width * channels, (y + 1) * width * channels);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('PixelSafe steganography probe', () => {
  it('detects PixelSafe public signature in RGB PNG LSBs', () => {
    expect(probePixelSafePng(pngWithLsb(Buffer.from('PixelSafe'))).status).toBe('detected');
  });

  it('detects the signature in RGBA PNGs while ignoring alpha', () => {
    expect(probePixelSafePng(pngWithLsb(Buffer.from('PixelSafe'), 6)).status).toBe('detected');
  });

  it('does not claim absence when the PNG profile is unsupported', () => {
    expect(probePixelSafePng(pngWithLsb(Buffer.from('PixelSafe'), 4)).status).toBe('unknown');
  });

  it('does not flag an ordinary supported PNG with no signature', () => {
    expect(probePixelSafePng(pngWithLsb(Buffer.from('NotPixelSafe'))).status).toBe('not_detected');
  });
});
