import { z } from 'zod';

const bool = (d: boolean) => z.string().optional().transform((v) => (v === undefined || v === '' ? d : v === '1' || v === 'true'));

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4400),
  HOST: z.string().default('127.0.0.1'),
  WW_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  WW_DB_PATH: z.string().default('data/waterwatch.sqlite'),
  WW_DATA_DIR: z.string().default('data/files'),
  WW_SECRET_KEY: z.string().min(32, 'WW_SECRET_KEY must be at least 32 characters'),
  WW_COOKIE_SECURE: bool(false),
  WW_TRUST_PROXY: bool(false),
  WW_ALLOW_SIMULATED: bool(true),
  WW_TILE_URL: z.string().default(''),
  WW_TILE_ATTRIBUTION: z.string().default(''),
  WW_HEALTH_INTERVAL_MS: z.coerce.number().int().min(0).default(60000),
  WW_SEED_ON_START: bool(false),
  WW_SEED_PASSWORD: z.string().default(''),
  WW_RATE_LIMIT_DISABLED: bool(false),
  WW_MAX_UPLOAD_BYTES: z.coerce.number().int().default(5 * 1024 * 1024)
});

export type Config = {
  port: number;
  host: string;
  env: 'development' | 'test' | 'staging' | 'production';
  dbPath: string;
  dataDir: string;
  secretKey: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  allowSimulated: boolean;
  tileUrl: string;
  tileAttribution: string;
  healthIntervalMs: number;
  seedOnStart: boolean;
  seedPassword: string;
  rateLimitDisabled: boolean;
  maxUploadBytes: number;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) throw new Error('Invalid configuration: ' + r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const e = r.data;
  if (e.WW_ENV === 'production' && /change-me|0123456789/.test(e.WW_SECRET_KEY)) throw new Error('Refusing to start in production with a placeholder WW_SECRET_KEY');
  return {
    port: e.PORT, host: e.HOST, env: e.WW_ENV, dbPath: e.WW_DB_PATH, dataDir: e.WW_DATA_DIR, secretKey: e.WW_SECRET_KEY,
    cookieSecure: e.WW_COOKIE_SECURE, trustProxy: e.WW_TRUST_PROXY,
    // Simulated devices are never allowed in production.
    allowSimulated: e.WW_ENV === 'production' ? false : e.WW_ALLOW_SIMULATED,
    tileUrl: e.WW_TILE_URL, tileAttribution: e.WW_TILE_ATTRIBUTION, healthIntervalMs: e.WW_HEALTH_INTERVAL_MS,
    seedOnStart: e.WW_SEED_ON_START, seedPassword: e.WW_SEED_PASSWORD, rateLimitDisabled: e.WW_RATE_LIMIT_DISABLED,
    maxUploadBytes: e.WW_MAX_UPLOAD_BYTES
  };
}
