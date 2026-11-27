import sharp from 'sharp';
import { badRequest } from '../core/errors.ts';

export type Processed = { buf: Buffer; mime: 'image/jpeg'; width: number; height: number };
export const MAX_DIMENSION = 1600;

/** Detects the real format from magic bytes; the client-supplied filename and Content-Type are ignored. */
export function sniffImage(b: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'png';
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}

/**
 * Validates and re-encodes an uploaded photo: magic-byte check, size limit, pixel limit, orientation applied,
 * ALL metadata (EXIF incl. GPS, ICC, XMP) discarded, output is always a fresh JPEG capped at 1600 px.
 */
export async function processImage(input: Uint8Array, maxBytes: number): Promise<Processed> {
  if (input.length === 0) throw badRequest('The photo is empty.');
  if (input.length > maxBytes) throw badRequest(`Photo is too large (limit ${Math.floor(maxBytes / 1024 / 1024)} MB).`);
  if (!sniffImage(input)) throw badRequest('Unsupported file type. Please upload a JPEG, PNG or WebP photo.');
  try {
    const { data, info } = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'error', pages: 1 })
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: false })
      .toBuffer({ resolveWithObject: true });
    return { buf: data, mime: 'image/jpeg', width: info.width, height: info.height };
  } catch {
    throw badRequest('The photo could not be read. It may be corrupt or too large.');
  }
}
