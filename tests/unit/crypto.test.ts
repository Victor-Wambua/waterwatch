import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, hashPassword, hotp, otpauthUri, passwordProblem, safeEqual, totpCode, verifyPassword, verifyTotp } from '../../src/core/crypto.ts';

describe('passwords', () => {
  it('hashes with scrypt and verifies', async () => {
    const h = await hashPassword('Correct-Horse-9');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('Correct-Horse-9', h)).toBe(true);
    expect(await verifyPassword('correct-horse-9', h)).toBe(false);
  });
  it('uses a unique salt each time', async () => {
    expect(await hashPassword('Same-Passw0rd-1')).not.toBe(await hashPassword('Same-Passw0rd-1'));
  });
  it('rejects malformed hashes', async () => {
    expect(await verifyPassword('x', 'plain')).toBe(false);
    expect(await verifyPassword('x', 'md5$1$2$3$4$5')).toBe(false);
  });
  it('enforces the password policy', () => {
    expect(passwordProblem('short1A')).toMatch(/12 characters/);
    expect(passwordProblem('alllowercase1234')).toMatch(/upper case/);
    expect(passwordProblem('NoDigitsHereAtAll')).toMatch(/digit/);
    expect(passwordProblem('Valid-Passw0rd-ok')).toBeNull();
    expect(passwordProblem('A1a'.repeat(100))).toMatch(/too long/);
  });
});

describe('encryption at rest', () => {
  it('round-trips and is non-deterministic', () => {
    const a = encryptSecret('device-secret', 'k'.repeat(32));
    expect(decryptSecret(a, 'k'.repeat(32))).toBe('device-secret');
    expect(encryptSecret('device-secret', 'k'.repeat(32))).not.toBe(a);
  });
  it('fails with the wrong key or tampered ciphertext', () => {
    const a = encryptSecret('x', 'k'.repeat(32));
    expect(() => decryptSecret(a, 'j'.repeat(32))).toThrow();
    const parts = a.split('.'); parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join('.'), 'k'.repeat(32))).toThrow();
    expect(() => decryptSecret('garbage', 'k'.repeat(32))).toThrow();
  });
});

describe('TOTP (RFC 6238 / RFC 4226 vectors)', () => {
  const secret = Buffer.from('12345678901234567890');
  it('matches the RFC 4226 HOTP test vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((e, i) => expect(hotp(secret, i)).toBe(e));
  });
  it('matches RFC 6238 at T=59s (last 6 digits of 94287082)', () => {
    expect(totpCode(base32Encode(secret), 59_000)).toBe('287082');
  });
  it('accepts +-1 step, rejects further and replays', () => {
    const s = base32Encode(secret), now = 1_700_000_000_000;
    const code = totpCode(s, now);
    expect(verifyTotp(s, code, now)).not.toBeNull();
    expect(verifyTotp(s, code, now + 30_000)).not.toBeNull();
    expect(verifyTotp(s, code, now + 120_000)).toBeNull();
    const step = verifyTotp(s, code, now) as number;
    expect(verifyTotp(s, code, now, step)).toBeNull(); // replay of same step
  });
  it('rejects non-numeric / wrong-length codes', () => {
    const s = base32Encode(secret);
    for (const c of ['', '12345', '1234567', 'abcdef', '12 345']) expect(verifyTotp(s, c, 1)).toBeNull();
  });
  it('base32 round-trips and rejects invalid characters', () => {
    const b = Buffer.from('hello waterwatch');
    expect(base32Decode(base32Encode(b)).toString()).toBe('hello waterwatch');
    expect(() => base32Decode('!!!')).toThrow();
  });
  it('builds an otpauth URI', () => expect(otpauthUri('ABC', 'a@b.c')).toContain('secret=ABC'));
});

describe('safeEqual', () => {
  it('is constant-length safe', () => { expect(safeEqual('abc', 'abc')).toBe(true); expect(safeEqual('abc', 'abd')).toBe(false); expect(safeEqual('abc', 'abcd')).toBe(false); });
});
