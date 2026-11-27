/** OpenAPI 3.1 description of the HTTP API. Kept in code so tests can assert that every registered route is documented. */
const sessionAuth = [{ sessionCookie: [], csrfHeader: [] }];
const op = (summary: string, tag: string, opts: { auth?: boolean; body?: string; roles?: string } = {}) => ({ summary: `${summary}${opts.roles ? ` (roles: ${opts.roles})` : ''}`, tags: [tag], ...(opts.auth === false ? {} : { security: sessionAuth }), ...(opts.body ? { requestBody: { required: true, content: { [opts.body]: { schema: { type: 'object' } } } } } : {}), responses: { '200': { description: 'OK' }, '400': { description: 'Validation error' }, '401': { description: 'Not authenticated' }, '403': { description: 'Not permitted' }, '404': { description: 'Not found (also used for other tenants\' records)' }, '429': { description: 'Rate limited' } } });
export const openapi = {
  openapi: '3.1.0',
  info: { title: 'WaterWatch API', version: '0.1.0', description: 'Session-cookie authenticated JSON API (plus device-signed ingestion). Unsafe methods require the X-CSRF-Token header (GET /api/v1/csrf). Not production ready.' },
  servers: [{ url: 'http://127.0.0.1:4400' }],
  components: { securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: 'ww_sid' }, csrfHeader: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, deviceSignature: { type: 'apiKey', in: 'header', name: 'X-WW-Signature', description: 'HMAC-SHA256 hex of "<deviceKey>\\n<timestamp>\\n<nonce>\\n<sha256hex(body)>" with the device secret. Also send X-WW-Device, X-WW-Timestamp (unix seconds), X-WW-Nonce.' } } },
  paths: {
    '/health': { get: op('Liveness and database check', 'ops', { auth: false }) },
    '/api/v1/openapi.json': { get: op('This document', 'ops', { auth: false }) },
    '/api/v1/csrf': { get: op('Current CSRF token for the session', 'auth') },
    '/ingest/v1/readings': { post: { ...op('Ingest a signed batch of sensor readings (idempotent, late readings accepted)', 'ingestion', { auth: false, body: 'application/json' }), security: [{ deviceSignature: [] }] } },
    '/api/v1/reports': { get: op('List reports (own reports for reporters; reporter contact only for dispatcher/admin)', 'reports'), post: op('Submit a fault report (multipart with optional photo, or JSON). Idempotent on client_uid', 'reports', { body: 'multipart/form-data', roles: 'reporter' }) },
    '/api/v1/assets': { get: op('List assets', 'assets'), post: op('Create asset', 'assets', { body: 'application/json', roles: 'dispatcher, org_admin' }) },
    '/api/v1/assets/{id}': { get: op('Get asset', 'assets'), put: op('Update asset', 'assets', { body: 'application/json', roles: 'dispatcher, org_admin' }) },
    '/api/v1/work-orders': { get: op('List work orders (technicians: own only)', 'work-orders'), post: op('Create a work order from reports', 'work-orders', { body: 'application/json', roles: 'dispatcher, org_admin' }) },
    '/api/v1/work-orders/{id}': { get: op('Get a work order with events and materials', 'work-orders') },
    '/api/v1/work-orders/{id}/assign': { post: op('Assign a technician', 'work-orders', { body: 'application/json', roles: 'dispatcher, org_admin' }) },
    '/api/v1/work-orders/{id}/transition': { post: op('Move a work order through the state machine (note required for cancel / send back)', 'work-orders', { body: 'application/json' }) },
    '/api/v1/sensors': { get: op('Sensors with health, plus open alerts', 'sensors') },
    '/api/v1/sensors/{id}/readings': { get: op('Readings for a sensor (from/to epoch ms)', 'sensors') },
    '/api/v1/sensors/health-check': { post: op('Run the sensor health evaluation now', 'sensors', { roles: 'dispatcher, org_admin' }) },
    '/api/v1/analytics': { get: op('Analytics (outages, MTTR, repeat failures, downtime, cost, SLA, production readings)', 'analytics') },
    '/api/v1/audit/verify': { get: op('Verify the audit hash chain for the organisation', 'audit', { roles: 'org_admin, auditor' }) }
  }
} as const;
