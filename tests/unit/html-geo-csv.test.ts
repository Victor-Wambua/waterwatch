import { describe, expect, it } from 'vitest';
import { esc, html, raw } from '../../src/core/html.ts';
import { KENYA_BOUNDS, haversineM, validateCoords } from '../../src/core/geo.ts';
import { csvCell, parseCsv, toCsv } from '../../src/core/csv.ts';
import { RateLimiter } from '../../src/core/ratelimit.ts';
import { loadConfig } from '../../src/core/config.ts';

describe('html escaping (XSS)', () => {
  const payloads = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "' onmouseover='alert(1)", '`${alert(1)}`', '<svg/onload=alert(1)>', 'javascript:alert(1)'];
  it('escapes every interpolated value', () => {
    for (const p of payloads) { const out = html`<p title="${p}">${p}</p>`.value; expect(out).not.toMatch(/<(script|img|svg)/i); expect((out.match(/"/g) ?? []).length).toBe(2); expect(out.match(/</g)?.length).toBe(2); /* only <p> and </p> */ }
  });
  it('escapes nested arrays and numbers, but not raw()', () => {
    expect(html`${['<b>', 1, null, undefined, false]}`.value).toBe('&lt;b&gt;1');
    expect(html`${raw('<b>ok</b>')}`.value).toBe('<b>ok</b>');
    expect(esc('&<>"\'`')).toBe('&amp;&lt;&gt;&quot;&#39;&#96;');
  });
  it('does not double-escape html() results', () => { const inner = html`<i>${'<x>'}</i>`; expect(html`${inner}`.value).toBe('<i>&lt;x&gt;</i>'); });
});

describe('geolocation validation', () => {
  it('accepts a point in Kenya and numeric strings', () => { expect(validateCoords(-1.29, 36.82, KENYA_BOUNDS)).toEqual({ ok: true, lat: -1.29, lng: 36.82 }); expect(validateCoords('-1.29', '36.82', KENYA_BOUNDS).ok).toBe(true); });
  it.each([[0, 0], [95, 10], [-1, 200], [-1.29, 10], [52, 36], ['abc', 36], [NaN, 36], ['', ''], [null, null]])('rejects %s,%s', (a, b) => { expect(validateCoords(a, b, KENYA_BOUNDS).ok).toBe(false); });
  it('respects configurable bounds', () => { const b = { minLat: -2, maxLat: -1, minLng: 36, maxLng: 37 }; expect(validateCoords(-1.5, 36.5, b).ok).toBe(true); expect(validateCoords(-3, 36.5, b).ok).toBe(false); });
  it('haversine distance is sensible', () => { expect(Math.round(haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }))).toBe(111195); expect(haversineM({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0); });
});

describe('csv', () => {
  it('parses quotes, commas, CRLF, BOM and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n"x,1","he said ""hi"""\r\n\r\n')).toEqual([['a', 'b'], ['x,1', 'he said "hi"']]);
  });
  it('throws on unterminated quotes', () => expect(() => parseCsv('a,"b')).toThrow());
  it('neutralises formula injection but keeps negative numbers', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    for (const f of ['+1+1', '-cmd', '@SUM(A1)', '\tX']) expect(csvCell(f).startsWith("'")).toBe(true);
    expect(csvCell('-1.5')).toBe('-1.5'); expect(csvCell(42)).toBe('42'); expect(csvCell(null)).toBe('');
  });
  it('serialises rows', () => expect(toCsv([['a', 'b,c'], [1, 'x']])).toBe('a,"b,c"\r\n1,x\r\n'));
});

describe('rate limiter', () => {
  it('limits within a window and resets after it', () => {
    let now = 0; const rl = new RateLimiter(() => now);
    for (let i = 0; i < 3; i++) expect(rl.hit('k', 3, 1000).ok).toBe(true);
    const blocked = rl.hit('k', 3, 1000); expect(blocked.ok).toBe(false); expect(blocked.retryAfterSec).toBe(1);
    expect(rl.hit('other', 3, 1000).ok).toBe(true);
    now = 1001; expect(rl.hit('k', 3, 1000).ok).toBe(true);
  });
  it('can be disabled', () => { const rl = new RateLimiter(() => 0, true); for (let i = 0; i < 100; i++) expect(rl.hit('k', 1, 1000).ok).toBe(true); });
});

describe('config', () => {
  const base = { WW_SECRET_KEY: 'x'.repeat(40) };
  it('applies defaults and parses booleans', () => { const c = loadConfig({ ...base, WW_COOKIE_SECURE: '1' }); expect(c.port).toBe(4400); expect(c.cookieSecure).toBe(true); expect(c.allowSimulated).toBe(true); });
  it('rejects a short secret and invalid values', () => { expect(() => loadConfig({ WW_SECRET_KEY: 'short' })).toThrow(/32/); expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(); expect(() => loadConfig({ ...base, WW_ENV: 'prod' })).toThrow(); });
  it('forces simulated devices off in production and refuses placeholder secrets', () => {
    expect(loadConfig({ WW_SECRET_KEY: 'z'.repeat(40), WW_ENV: 'production', WW_ALLOW_SIMULATED: '1' }).allowSimulated).toBe(false);
    expect(() => loadConfig({ WW_SECRET_KEY: 'change-me-to-a-long-random-string-at-least-32-chars', WW_ENV: 'production' })).toThrow(/placeholder/);
  });
});
