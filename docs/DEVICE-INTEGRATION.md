# Device integration

No real device or live integration has been tested. A labelled simulator exists (`npm run simulate`).

## Endpoint
`POST /ingest/v1/readings`, JSON body, max 1 MB, max 500 readings.

Headers: `X-WW-Device` (device key, `dev_...`), `X-WW-Timestamp` (unix seconds), `X-WW-Nonce` (8-64 chars `[A-Za-z0-9_-]`, unique per request), `X-WW-Signature`.

**Signature** = hex(HMAC-SHA256(secret, `deviceKey + "\n" + timestamp + "\n" + nonce + "\n" + sha256hex(rawBody)`)).

Checks in order: headers well-formed; device exists, active, signature valid (constant time; unknown/revoked/bad signature are indistinguishable, 401); timestamp within +-300 s (configurable) else 401; simulated devices refused when disabled (403); JSON/shape (422); payload `origin` must equal the registered origin (422); nonce not seen for this device (else 409 `replay`); readings stored.

## Payload
```json
{ "batch_id": "b-1", "origin": "real", "device": { "battery_pct": 82, "rssi_dbm": -91 },
  "readings": [ { "sensor": "flow", "ts": 1780304220000, "value": 12.4, "id": "flow:1780304220000" } ] }
```
`ts`: epoch seconds, epoch milliseconds or ISO-8601. Readings may be late or out of order and keep their original timestamp (accepted if not more than 5 min in the future and not older than 30 days; both configurable). Idempotency: `(device, id)`, id defaults to `sensor:ts`; retry with a fresh nonce and the same ids is safe (`duplicates` counted). Response 200: `{accepted, duplicates, rejected:[{index,reason}], server_time, origin}`; per-item reasons: `unknown_sensor`, `invalid_timestamp`, `future_timestamp`, `too_old`.

## Store-and-forward
Buffer locally, send batches in any order with original timestamps, new nonce per attempt, retry on network error/5xx/429 (`Retry-After`). Do not retry 401/422.

## Sensors and health
Kinds: flow (m3/h), tank level (% full), pump status (0/1), pressure (bar), water quality (parameter named; always labelled "validation required"). Per sensor: expected interval, valid min/max, flat-line count. Rules: Late > 1.25x interval, Missing > 2x, Out of range (latest value), Flat-lined (N identical readings; not for pump status), plus device battery/signal alerts from supplied telemetry. Alerts dedupe, auto-resolve, and missing/flat-line/out-of-range carry a work-order **suggestion**; asset status is never changed automatically. Thresholds are in Settings.

## Credentials
Per-device key and secret (32 random bytes); secret shown once, stored AES-256-GCM encrypted (key from `WW_SECRET_KEY`); rotate (old secret dies immediately) and revoke in the console.

## Simulator
`npm run seed` writes `data/simulator-devices.json` (9 simulated devices). `npm run simulate -- --every 15 [--count N] [--stop SIM-FL-04] [--flatline SIM-FL-06] [--backfill 6] [--url http://127.0.0.1:4400]`. Every payload has `origin:"simulated"`; refuses non-local targets without `--allow-remote`; production rejects simulated devices. Additional simulated devices can be registered in the console and passed with `--device key:secret:sensor:kind:intervalS`.

## MQTT / LoRaWAN
**Not implemented.** There is no in-process broker, so an MQTT adapter could not be tested here. `handleIngest` (authenticated batch -> storage) is the seam for a bridge; LoRaWAN would arrive via a network-server webhook mapped to this endpoint. Outstanding adapter work and a real device are external dependencies.
