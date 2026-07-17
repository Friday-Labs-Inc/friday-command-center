# Environment telemetry — the world senses, finally visible

*Plain-English walk-through. Glossary at the bottom.*

## What this adds

The rover has two "world sense" pods that have been live for a while: the
**env pod** (a Pi Zero W measuring temperature, humidity, pressure, light,
and human presence) and the **phone pod** (an old OnePlus 6T providing GPS).
Their readings flowed into the rover's internal topics — and stopped there.
Nobody displayed them. This change opens the envelopes:

```
rover pods → signed CBOR envelope → EMQX (mTLS) → gateway RECORDER → deck panel
```

Three pieces, all on the FCC side:

1. **Recorder** (`bridge/telemetry_store.py`) — the gateway already hears every
   `mark1/<rover>/tlm/#` message. Now it *remembers* the env / gps / odom kinds:
   an in-memory ring (about an hour at one sample per 5 s) mirrored to
   append-only files under `bridge/state/`, so history survives a gateway
   restart. Files self-compact on load; a torn line from a crash is skipped.
2. **Two read-only APIs** (`bridge/gateway.py`) —
   `GET /api/telemetry/latest?rover=` (freshest sample per kind, with its age)
   and `GET /api/telemetry/history?rover=&kind=&limit=` (sparkline food).
   No control-plane dependency; they serve straight from the recorder.
3. **Environment deck view** (`console/src/deck/views/EnvironmentView.tsx`) —
   metric cards with live sparklines, presence, GPS, and the link status.

## Honest states (the FCC house rule)

The panel never pretends. Each card carries exactly one truth:

| You see | It means |
|---|---|
| `LIVE` | a sample arrived within the last 30 s |
| `STALE · 74s` | the pod went quiet; showing the last known value and its age |
| `LINK PENDING` | the gateway has never recorded this kind — **today's state**: the pods publish on the rover's internal bus, but the rover-side MQTT telemetry publisher is not deployed yet |
| `GATEWAY UNREACHABLE` | the browser cannot reach the gateway at all |
| `SIGNED` / `UNSIGNED` | whether the sample's Ed25519 signature verified against the rover's registered key |

## Wire payload shapes (the contract for the rover side)

Envelope: the existing signed telemetry envelope (`kind` + `data` + `sig`).

- `tlm/env` data: `temperature_c, humidity_pct, pressure_hpa, light_lux, presence(bool)`
- `tlm/gps` data: `lat, lon, alt_m, fix, sats`

`bridge/fake_rover.py` gained `emit_env(...)` and `emit_gps(...)` so the whole
pipe can be exercised on a bench without the rover.

## What is deliberately NOT here

- **No rover-side publisher yet** — that lands in `friday-labs-os` (a small
  node subscribing `/mark1/envpod/*` + `/mark1/phone/fix`, signing, publishing
  over MQTT). Until it deploys, the panel shows LINK PENDING — truthfully.
- **No control decisions** — this is display + memory only. World senses stay
  advisory, outside the safety path, per the architecture.

## Verification

- 38 bridge unit tests green (`bridge/.venv/bin/python -m pytest tests/` from
  `bridge/`), including recorder durability (restart, torn line, ring bounds,
  path-traversal-safe filenames) and the API routes via FastAPI TestClient.
- Console build green (tsc + vite).
- Browser-verified against a stub gateway in both states: live data
  (sparklines, SIGNED chips, presence events in the stream) and empty
  (LINK PENDING everywhere, honest explanation in the LINK card).

## Glossary

- **Gateway** — the FCC's read-side service; it listens to the rover's radio
  chatter (MQTT) and serves the web console.
- **Recorder / ring** — a fixed-size memory of recent samples; old ones fall
  off the end so it can never fill the disk.
- **Sparkline** — the tiny line chart inside a metric card showing the recent
  trend.
- **Signed envelope** — every telemetry message carries a cryptographic
  signature proving it came from the rover, not an impostor.
