# Security

Controls implemented and tested (see tests in `tests/`). Not a compliance claim; Kenya Data Protection Act 2019 considerations need counsel and the operating utility (registration, DPIA, retention). Not production ready.

| Area | Control | Evidence |
|---|---|---|
| Passwords | scrypt N=16384, salt, policy (12+ chars, mixed), lockout after 5 failures for 15 min, uniform error + dummy hash for unknown users | auth tests |
| MFA | TOTP (RFC 6238) required for dispatcher/utility admin/platform admin; replay of a used step refused; secrets AES-256-GCM encrypted; admin reset | crypto + auth tests |
| Sessions | random 256-bit token, only SHA-256 stored, HttpOnly, SameSite=Lax, Secure when configured, 8 h idle / 12 h absolute, destroyed on password change/suspension/MFA reset, rotated at login | auth tests |
| CSRF | session synchroniser token (pre-login HMAC token for login/invite), Origin check, JSON API needs header | auth tests |
| RBAC | deny-by-default matrix (6 roles); 266-case route x role matrix; technician job scoping; NGO owner scope | authz-matrix |
| Tenancy | `TenantDb` + exhaustive cross-tenant tests + static scan | tenant-isolation |
| Input | Zod/explicit validation everywhere; parameterised SQL only; LIKE wildcards escaped; CSV formula-injection neutralised on export | tests |
| XSS | auto-escaping templates; CSP without inline script/style; test scans pages for inline handlers/styles/third-party URLs | security tests |
| Uploads | magic-byte sniff, 5 MB limit, 40 MP limit, re-encode to JPEG (EXIF/GPS dropped), random server path, 0600 files outside web root, authorised serving with `sandbox` CSP, audited views | uploads tests |
| Device auth | per-device HMAC, timestamp window, nonce replay, idempotency, no enumeration, secrets encrypted | ingest tests |
| Audit | append-only hash chain, DB triggers, verification | audit tests |
| Rate limiting | per-IP global, login (IP+account), MFA, uploads, ingest per device (in-memory) | tests |
| Headers | CSP, nosniff, frame deny, referrer same-origin, permissions policy, HSTS when secure | tests |
| Dependencies | `npm audit`: 0 vulnerabilities at time of writing | see ACCEPTANCE-REPORT |

## Reporter privacy
Name/phone visible only to dispatcher/utility admin; technicians, auditors, NGO monitors and the API for those roles never receive it; photos stripped of metadata; reporters see only their own reports. Retention/deletion/export tooling for reporter data is **not built** (limitation).

## Known gaps
No password-reset-by-email (admin issues a new invitation), no account-level data export/erase, no IP allow-listing, rate limiter not shared across instances, no malware scanning of uploads (they are re-encoded, not scanned), TLS and secret management are deployment responsibilities, no penetration test or third-party review, no WAF. Seeded demo credentials exist only when seeding is on (never in production).
