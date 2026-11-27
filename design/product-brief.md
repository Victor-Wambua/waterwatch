# WaterWatch — product brief (Phase A)

Status: design phase. All demo data is **synthetic** (fictional "Mto Kijani Water Company", fictional "Kijani County"). Nothing here is a compliance claim. Simulated devices are always labelled **SIMULATED SENSOR — test environment**.

## 1. What and for whom
WaterWatch is an operations console for water assets: a map and status-first view of boreholes, kiosks, community water points, pumps, tanks and distribution nodes; a community fault-reporting flow; work orders for technicians; and optional sensor ingestion. Goal: find faults sooner, track repairs to completion, and show reliability over time.

Users: **utility/county manager and dispatcher** (desktop console), **technician** (phone), **community reporter** (low-end Android, verified/authorised users only), **NGO/programme monitor** (read-mostly, scoped to their assets), **admin** (users, assets, devices, audit).

Core promise: *every asset has a known status, every fault has an owner and a clock.*

Non-goals (MVP): billing, SCADA control (read-only telemetry only, no actuation), lab water-quality certification, public-facing "is my water safe" claims.

## 2. Research confirmation
Method: pages fetched this session (WebFetch; the WASREB PDF was downloaded with curl and converted with `pdftotext` because it exceeded the fetch size limit). Only what was read is cited. Anything else is labelled UNVERIFIED.

### 2.1 WASREB Impact 18 (https://wasreb.go.ke/wp-content/uploads/2026/06/Impact-18-Report.pdf)
Fetched in full (16.5 MB, ~6,600 text lines). Title: "A Performance Report of Kenya's Water Services Sector – 2024/2025".
- **72.1% coverage — CONFIRMED, with a definition caveat.** The report says that "in regulated areas" water coverage "reaches approximately 72.1%" (sanitation 92.5%, sewer 15.8%), versus roughly **42% water coverage at national level** (incl. non-regulated, mostly rural/informal areas). The KPI table (Table 2.6) rounds it to 72 (65 in 2022/23, 70 in 2023/24). The foreword also cites "water coverage at 72.1%". **Do not present 72.1% as national coverage.** "Regulated context" = areas served by the 94 regulated Water Services Providers (population ~31.6 million; ~22.8 million receive water).
- **52.3% revenue water — NOT FOUND, mismatch with the brief.** A text search for "52.3" found nothing in the report text (charts rendered as images could not be searched, so this is "not found in text", not proof it is absent). What the report states is **Non-Revenue Water (NRW) of 48% in 2024/25** (43% in 2022/23, 44% in 2023/24) — "NRW continues to go up". Revenue water would be the complement (~52%), but the report does not state 52.3%, so **we cite NRW 48% only** and do not quote 52.3%.
- **NRW definition** (WARIS indicator table): "Total Volume of Water Lost from Commercial and Physical Losses as a proportion of Water Produced". Sector guideline per report: below 20% optimal, 20–25% acceptable, above 25% unacceptable. County range: 23% (Meru) to 77% (West Pokot); 16 counties at or above 50%. Table 4.3 gives five NRW stages with recommended measures.
- **Revenue water / NRW is a utility-performance metric**: it needs metered production and billed volumes for a whole supply system. A community water point or a single asset cannot "have" NRW. WaterWatch therefore does **not** compute it in MVP; it supplies leak/outage/repair data that supports physical-loss reduction, and can later ingest production meter readings where a utility supplies them.

### 2.2 Peer / competitor scan
| Product | Verified from page read | Not verified |
|---|---|---|
| mWater (mwater.co) | Free data platform for water, sanitation and health; Surveyor app (Android/iOS/web, online or offline); maps infrastructure; Data Portal with forms, maps, dashboards; standard forms/indicators; dozens of languages; Uganda's RUMIS uses it for asset mapping. Page does not describe functional-status/alerts/work-order features. | Work-order and sensor capabilities |
| SweetSense (sweetsensors.com) | Remote monitoring using internet-connected sensors (incl. self-powered EnOcean transmitters) with cellular or satellite connectivity, for water pumps, filters, cookstoves, latrines; near-real-time web graphs; "hundreds of units in 12 countries". | Pricing, protocols, Kenya presence |
| WPDx (waterpointdata.org) | Standard and repository for water-point data; the page read says OGP recognised WPDx as a leader in setting a standard for mapping and collecting rural water data. | **Field list could not be fetched** (the standard PDF URL tried returned 404). Our mapping to WPDx fields in the schema phase must be checked against the current standard document. |
| CityTaps, Majitech/Maji Voice, Jibu, Afrimap-type mappers, utility SCADA vendors | **Not verified**: CityTaps page URL tried returned 404; the others were not fetched. No claims made. | All |

Positioning (design hypothesis, not a market finding): mWater/WPDx-style tools are strong at survey and mapping; sensor vendors are strong at telemetry. WaterWatch's wedge is the **closed loop**: report -> triage -> work order -> repair record -> reliability analytics, with sensors as one input among several, built for small utilities and county programmes.

### 2.3 Sensor / IoT realities (UNVERIFIED engineering knowledge — not fetched; confirm in Phase B)
- Protocols commonly used: HTTPS POST and MQTT (over TLS) where cellular/Wi-Fi exists; LoRaWAN via a gateway/network server (e.g. through a network-server webhook) for low-power, low-bandwidth sites. WaterWatch ingestion will accept HTTP and MQTT; LoRaWAN only via a network server integration (not direct).
- Device auth: per-device identity and secret/key, TLS, message signing (HMAC-SHA256 over body with sequence number + timestamp to resist replay), key rotation and revocation.
- Connectivity is intermittent: devices buffer and batch-send (store-and-forward) with original timestamps; the platform must accept late/out-of-order data and distinguish "no data" from "zero".
- Typical low-cost sensor families: pulse/electromagnetic flow meters, ultrasonic or hydrostatic tank level sensors, 4–20 mA/0.5–4.5 V pressure transducers, pump run/current sensors; water-quality probes (turbidity, chlorine, conductivity) need calibration and are only "where validated".
- Failure modes designed for: missing readings, late arrival, flat-lined (stuck) values, out-of-range spikes, battery/signal degradation.
- **No real device or live integration is claimed.** Phase B ships a labelled simulator only.

### 2.4 Legal and safety notes (UNVERIFIED — to be reviewed by counsel; no compliance claim)
- **Kenya Data Protection Act 2019** (ODPC page tried returned 404, so not read this session): photos and GPS coordinates linked to a reporter can be personal data. Design response: collect minimum data, notice at point of collection, reporter phone/ID restricted to dispatcher roles, photos resized and EXIF-stripped on the server, retention limits, export/deletion path, audit of access. Registration/DPIA needs are for the operator (utility) and counsel to decide.
- **Water-quality claims**: WaterWatch never states water is "safe" or "unsafe". A contamination report is a community observation, not a lab result; UI copy says so. Utilities remain responsible for testing and public-health notification.
- **Liability for contamination reports**: design must (a) escalate immediately as P1 with a visible banner, (b) show reporters safety guidance at once, (c) notify the water-quality officer and public-health contact by a defined procedure, (d) record who saw/acted and when (audit), (e) carry disclaimers: not a lab test, no guarantee of response time outside the utility's own SLA. Safety wording and its Swahili translation need review by a public-health professional and a native speaker.

## 3. Data classification in the UI
Every record shows its origin: user-submitted (reports), verified live (none in prototype), synthetic test data (all fixtures), mock integration (all sensors). Banner: "Synthetic demonstration data".

## 4. Success metrics (pilot)
Median time to submit a report < 45 s (measured in-app); time from report to work-order creation; % P1 acknowledged inside SLA; MTTR trend; share of assets with a known status < 24 h old; sensor missing-reading detection within 2x expected interval.
