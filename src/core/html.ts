/** Minimal auto-escaping HTML templating. Every interpolated value is escaped unless wrapped with raw(). */
export class Raw {
  readonly value: string;
  constructor(value: string) { this.value = value; }
  toString() { return this.value; }
}
export const raw = (s: string) => new Raw(s);
const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"'`]/g, (c) => MAP[c] ?? c);
export type Part = string | number | boolean | null | undefined | Raw | Part[];
function render(v: Part): string {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}
export function html(strings: TemplateStringsArray, ...vals: Part[]): Raw {
  let out = strings[0] ?? '';
  for (let i = 0; i < vals.length; i++) out += render(vals[i] as Part) + (strings[i + 1] ?? '');
  return new Raw(out);
}
export const toStr = (r: Raw | string) => (r instanceof Raw ? r.value : esc(r));
