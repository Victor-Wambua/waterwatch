export type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };
/** Default: approximate bounding box of Kenya. Configurable per organisation. */
export const KENYA_BOUNDS: Bounds = { minLat: -4.9, maxLat: 5.1, minLng: 33.9, maxLng: 41.95 };

export function validateCoords(lat: unknown, lng: unknown, b: Bounds): { ok: true; lat: number; lng: number } | { ok: false; error: string } {
  const la = typeof lat === 'string' && lat.trim() !== '' ? Number(lat) : lat;
  const lo = typeof lng === 'string' && lng.trim() !== '' ? Number(lng) : lng;
  if (typeof la !== 'number' || typeof lo !== 'number' || !Number.isFinite(la) || !Number.isFinite(lo)) return { ok: false, error: 'Latitude and longitude must be numbers.' };
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return { ok: false, error: 'Coordinates are outside the valid range.' };
  if (la === 0 && lo === 0) return { ok: false, error: 'Coordinates 0,0 are not a valid location.' };
  if (la < b.minLat || la > b.maxLat || lo < b.minLng || lo > b.maxLng) return { ok: false, error: `Location is outside the configured service area (lat ${b.minLat}..${b.maxLat}, lng ${b.minLng}..${b.maxLng}).` };
  return { ok: true, lat: la, lng: lo };
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLa = rad(b.lat - a.lat), dLo = rad(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
