import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { processImage, sniffImage } from '../../src/domain/uploads.ts';
import { jpegWithExif, plainPng } from '../helpers.ts';

const MAX = 5 * 1024 * 1024;
const text = (s: string) => new TextEncoder().encode(s);

describe('upload validation', () => {
  it('detects formats by magic bytes, not by name', async () => {
    expect(sniffImage(await jpegWithExif())).toBe('jpeg');
    expect(sniffImage(await plainPng())).toBe('png');
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).webp().toBuffer();
    expect(sniffImage(webp)).toBe('webp');
    for (const bad of [text('<?php system($_GET["c"]); ?>'), text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), text('GIF89a'), text('%PDF-1.4'), new Uint8Array(0), text('MZ\x90\x00')]) expect(sniffImage(bad)).toBeNull();
  });
  it('rejects non-images renamed to .jpg (a script, SVG, PDF)', async () => {
    for (const bad of [text('<?php echo 1;'), text('<svg onload=alert(1)>'), text('%PDF-1.7 fake')]) await expect(processImage(bad, MAX)).rejects.toThrow(/Unsupported file type/);
  });
  it('rejects empty files and files over the size limit', async () => {
    await expect(processImage(new Uint8Array(0), MAX)).rejects.toThrow(/empty/);
    await expect(processImage(await jpegWithExif(), 100)).rejects.toThrow(/too large/);
  });
  it('rejects corrupt images that start with valid magic bytes', async () => {
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('this is not really jpeg data'.repeat(5))]);
    await expect(processImage(corrupt, MAX)).rejects.toThrow(/could not be read/);
    await expect(processImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage')]), MAX)).rejects.toThrow(/could not be read/);
  });
  it('strips EXIF metadata and always re-encodes to JPEG', async () => {
    const withExif = await jpegWithExif();
    expect((await sharp(withExif).metadata()).exif).toBeTruthy(); // precondition: the fixture really has EXIF
    expect(withExif.includes(Buffer.from('SECRET-OWNER-TAG'))).toBe(true);
    const out = await processImage(withExif, MAX);
    expect(out.mime).toBe('image/jpeg');
    expect(sniffImage(out.buf)).toBe('jpeg');
    expect((await sharp(out.buf).metadata()).exif).toBeUndefined();
    expect(out.buf.includes(Buffer.from('SECRET-OWNER-TAG'))).toBe(false);
    expect(out.buf.includes(Buffer.from('TestCam'))).toBe(false);
  });
  it('re-encodes PNG to JPEG and caps the dimensions', async () => {
    const big = await sharp({ create: { width: 3200, height: 2000, channels: 3, background: '#123' } }).png().toBuffer();
    const out = await processImage(big, MAX);
    expect(sniffImage(out.buf)).toBe('jpeg'); expect(Math.max(out.width, out.height)).toBe(1600); expect(out.width).toBe(1600); expect(out.height).toBe(1000);
  });
  it('does not enlarge small images', async () => { const o = await processImage(await plainPng(), MAX); expect([o.width, o.height]).toEqual([32, 32]); });
  it('refuses decompression bombs (pixel limit)', async () => {
    const bomb = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(MAX);
    await expect(processImage(bomb, MAX)).rejects.toThrow(/could not be read/);
  });
  it('a polyglot (valid JPEG followed by script text) is neutralised by re-encoding', async () => {
    const poly = Buffer.concat([await jpegWithExif(), Buffer.from('<?php system($_GET["x"]); ?>')]);
    const out = await processImage(poly, MAX);
    expect(out.buf.includes(Buffer.from('<?php'))).toBe(false);
  });
});
