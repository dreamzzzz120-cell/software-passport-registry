/**
 * PixelSafe steganography probe.
 *
 * Narrow, conservative detector for PixelSafe's public unencrypted signature
 * in PNG RGB/RGBA 8-bit non-interlaced pixel LSBs. Unsupported PNG variants
 * return UNKNOWN rather than claiming absence. Password-encrypted PixelSafe
 * payloads are intentionally not claimed absent.
 */
import { inflateSync } from 'node:zlib';

export type StegoProbeResult =
  | { status: 'detected'; method: 'pixelsafe-lsb-signature'; confidence: 'high'; detail: string }
  | { status: 'not_detected'; method: 'pixelsafe-lsb-signature'; confidence: 'limited'; detail: string }
  | { status: 'unknown'; method: 'pixelsafe-lsb-signature'; confidence: 'none'; detail: string };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PIXELSAFE_SIGNATURE = Buffer.from('PixelSafe', 'ascii');

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilter(data: Buffer, width: number, height: number, bpp: number): Buffer | null {
  const stride = width * bpp;
  if (data.length !== height * (stride + 1)) return null;
  const out = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = data[src++];
    const row = y * stride, prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const raw = data[src++];
      const left = x >= bpp ? out[row + x - bpp] : 0;
      const up = y > 0 ? out[prev + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prev + x - bpp] : 0;
      if (filter === 0) out[row + x] = raw;
      else if (filter === 1) out[row + x] = (raw + left) & 0xff;
      else if (filter === 2) out[row + x] = (raw + up) & 0xff;
      else if (filter === 3) out[row + x] = (raw + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) out[row + x] = (raw + paeth(left, up, upLeft)) & 0xff;
      else return null;
    }
  }
  return out;
}

function decodePng(png: Buffer): { pixels: Buffer; channels: number } | null {
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let offset = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat: Buffer[] = [];
  try {
    while (offset + 12 <= png.length) {
      const length = png.readUInt32BE(offset);
      const type = png.subarray(offset + 4, offset + 8).toString('ascii');
      const end = offset + 12 + length;
      if (end > png.length) return null;
      const body = png.subarray(offset + 8, offset + 8 + length);
      if (type === 'IHDR' && length === 13) {
        width = png.readUInt32BE(offset + 16);
        height = png.readUInt32BE(offset + 20);
        bitDepth = body[8]; colorType = body[9]; interlace = body[12];
      } else if (type === 'IDAT') idat.push(body);
      else if (type === 'IEND') break;
      offset = end;
    }
    if (!width || !height || bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6) || idat.length === 0) return null;
    const channels = colorType === 6 ? 4 : 3;
    const inflated = inflateSync(Buffer.concat(idat));
    const pixels = unfilter(inflated, width, height, channels);
    return pixels ? { pixels, channels } : null;
  } catch {
    return null;
  }
}

function readLsbBytes(pixels: Buffer, channels: number, byteCount: number): Buffer | null {
  const neededBits = byteCount * 8;
  if ((pixels.length / channels) * 3 < neededBits) return null;
  const out = Buffer.alloc(byteCount);
  let bit = 0;
  for (let i = 0; i < pixels.length && bit < neededBits; i += channels) {
    for (let channel = 0; channel < 3 && bit < neededBits; channel++) {
      out[Math.floor(bit / 8)] |= (pixels[i + channel] & 1) << (bit % 8);
      bit++;
    }
  }
  return out;
}

export function probePixelSafePng(png: Buffer): StegoProbeResult {
  const decoded = decodePng(png);
  if (!decoded) return {
    status: 'unknown', method: 'pixelsafe-lsb-signature', confidence: 'none',
    detail: 'PNG is outside the probe\'s supported RGB/RGBA 8-bit non-interlaced profile; no absence claim is made.',
  };
  const signature = readLsbBytes(decoded.pixels, decoded.channels, PIXELSAFE_SIGNATURE.length);
  if (signature?.equals(PIXELSAFE_SIGNATURE)) return {
    status: 'detected', method: 'pixelsafe-lsb-signature', confidence: 'high',
    detail: 'The pixel LSB stream begins with PixelSafe\'s public unencrypted signature.',
  };
  return {
    status: 'not_detected', method: 'pixelsafe-lsb-signature', confidence: 'limited',
    detail: 'No PixelSafe public signature was found at offset zero; password-encrypted payloads are not ruled out.',
  };
}
