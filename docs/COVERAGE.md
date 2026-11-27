# Coverage

Tool: Vitest + `@vitest/coverage-v8` (`npm run test:coverage`), measured over `src/` excluding `server.ts`, `src/scripts/**`, `src/sim/simulate.ts` (CLI entry points; the simulator's request/reading builders are tested). 559 tests, all executed and passing. Playwright e2e is not part of the percentage.

| Scope | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| Overall | 93.52% | 82.76% | 93.39% | 97.86% |
| Critical business rules (defined below) | 96.31% | 90.98% | n/a | 99.06% |

**Critical modules** (business rules, security, data integrity): `domain/{analytics,workorder,health,rbac,audit,uploads,settings}`, `core/{crypto,geo,csv,ratelimit}`, `repo/{ingest,health,photos,system,workorders,reports,assets,devices,analytics}`, `web/http` (session, CSRF, rate limit, auth guards, static files).

Lowest branch coverage: `web/app.ts` (error-handler variants), `web/routes-console.ts`, `routes-ops.ts`, `routes-field.ts`, `ui.ts` (rendering conditionals). Line coverage is high but line coverage does not prove behaviour; the authorization, tenancy, ingestion and analytics tests assert specific outcomes (one tenancy mutation was checked to fail the suite).
