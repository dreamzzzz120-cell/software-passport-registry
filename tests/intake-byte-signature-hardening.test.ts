import { describe, expect, it } from 'vitest';
import { validateObservedFileSignature } from '../src/routes/universal-intake.ts';

describe('universal intake observed-byte signatures', () => {
  it('accepts valid stable signatures', () => {
    expect(validateObservedFileSignature('report.pdf', Buffer.from('%PDF-1.7\n'))).toBeNull();
    expect(validateObservedFileSignature('bundle.zip', Buffer.from([0x50,0x4b,0x03,0x04]))).toBeNull();
    expect(validateObservedFileSignature('document.docx', Buffer.from([0x50,0x4b,0x03,0x04]))).toBeNull();
    expect(validateObservedFileSignature('bundle.gz', Buffer.from([0x1f,0x8b,0x08,0x00]))).toBeNull();
    const tar = Buffer.alloc(512); Buffer.from('ustar').copy(tar, 257);
    expect(validateObservedFileSignature('bundle.tar', tar)).toBeNull();
  });

  it.each(['report.pdf','bundle.zip','document.docx','bundle.gz','bundle.tgz','bundle.tar'])(
    'rejects spoofed bytes for %s',
    (name) => expect(validateObservedFileSignature(name, Buffer.from('MZ executable or arbitrary text'))).toMatch(/do not match/i),
  );

  it('does not invent byte signatures for source formats without a stable signature', () => {
    expect(validateObservedFileSignature('component.ts', Buffer.from('export const ok = true;'))).toBeNull();
    expect(validateObservedFileSignature('package.json', Buffer.from('{}'))).toBeNull();
  });
});
