# Phase B — Data Plane (Bridge + Broker)

> Walk-through for Phase B of the Friday Command Center. Read the Phase A control
> plane first; this chapter makes it *talk to a rover over the wire*.
>
> **Status:** ✅ core built + verified end-to-end · **Component:** `bridge/`

---

## 1. The 30-second version

Phase A is the **system of record** (rovers, operators, allowlist, nonces, audit).
Phase B is the **live wire**: an MQTT broker plus a bridge that connects the control
plane to real rovers.

The bridge does two jobs:

- **Command path** — ask the control plane for a nonce, build + sign the envelope,
  publish it to the rover's `cmd/` topic, and append an immutable audit row.
- **Ingest path** — subscribe to the rovers' `ack/` (and later `tlm/`, `dbg/`) topics
  and bring the results back.

Verified end-to-end against a real **EMQX** broker: a signed command is accepted by a
stand-in rover, and a replayed command is rejected.

---

## 2. What's in the box (`bridge/`)

| File | Role |
|---|---|
| `envelope.py` | Ed25519-signed CBOR envelope — a **byte-for-byte mirror** of the rover's `protocol.py` (same canonical-CBOR signing bytes, protocol v0.1.0). Build / encode / decode / verify + key helpers. |
| `control_plane.py` | Thin REST client for the Phase A API (`issue_nonce`, `get_allowlist`, `record_command`), token auth. |
| `bridge.py` | The paho-MQTT bridge: `send_command()` (nonce → sign → publish → audit) and ack ingest. |
| `fake_rover.py` | A **test harness** standing in for the ROS 2 rover (which can't run on macOS): validates the signature + nonce exactly like the rover, then acks. |
| `smoke.py` | The end-to-end orchestration (steps 1–5 below). |

The broker is **EMQX 5.8** in Docker (`fcc-emqx`, port 1883). Deps live in an isolated
`bridge/.venv` (paho-mqtt, cbor2, cryptography, requests).

---

## 3. The path (one command's journey)

```
operator command
      │  bridge.send_command()
      ▼
control plane: issue_nonce(rover, operator)  ──►  monotonic nonce
      │
      ▼  envelope.build_envelope(... private_key)   (Ed25519 over canonical CBOR)
publish  mark1/<rover>/cmd/motion  ──►  EMQX  ──►  rover
      │                                              │ verify sig + nonce
record_command (immutable audit)                     ▼  publish ack
      ◄──────────────  mark1/<rover>/ack/<msg_id>  ◄──┘
   bridge ingests the ack
```

Replay: re-publishing the same signed envelope fails at the rover because the nonce no
longer strictly increases → `SECURITY_REPLAY`.

---

## 4. Decisions & why

| Decision | Why |
|---|---|
| **paho-mqtt** (not aiomqtt yet) | Matches the rover's `transport.py`; simplest for the ingest+publish core. The async `aiomqtt` + FastAPI WebSocket layer arrives with the SPA in Phase C. |
| **EMQX** broker | The blueprint's production choice (MQTT 5, TLS, mTLS, ACLs); Docker makes it one command, so dev matches prod. |
| **Envelope mirrored, not shared** | The bridge re-implements the same wire spec rather than importing the rover's `protocol.py` — zero cross-repo code coupling; canonical CBOR guarantees byte-identity. |
| **Dev signs server-side; prod signs client-side** | The smoke signs with a provisioned operator key for convenience. In production the operator signs client-side (key never reaches the server); the bridge only relays + audits. |

---

## 5. Run it yourself

```bash
# 1. broker
docker run -d --name fcc-emqx -p 1883:1883 -p 18083:18083 emqx/emqx:5.8

# 2. control plane web server
bench --site command-center.localhost serve --port 8003

# 3. provision a smoke operator keypair + API keys (prints SMOKE_OP_PRIV / KEY / SECRET)
bench --site command-center.localhost execute friday_command_center.setup.provision_for_smoke

# 4. run the end-to-end smoke (from bridge/)
CP_BASE=http://127.0.0.1:8003 CP_KEY=... CP_SECRET=... OP_PRIV=... \
  PYTHONPATH=. .venv/bin/python smoke.py
```

---

## 6. Verification

| Check | Result |
|---|---|
| Envelope unit tests (`bridge/tests/`) | **5 / 5 pass** (round-trip, tamper, wrong-key, replay-tamper) |
| End-to-end smoke (real EMQX + Frappe) | signed command **accepted** (OK), replay **rejected** (SECURITY_REPLAY) |
| Control-plane integration | `issue_nonce` monotonic, `get_allowlist` served the operator key, `record_command` audited |

---

## 7. What is intentionally NOT done yet

- **Telemetry / fault ingest** — `tlm/` and `dbg/` topics into a TSDB (QuestDB) and
  rover faults into Security Events. This slice does the command path + ack ingest.
- **Client-side signing agent** — the operator's local signer (the key never reaching
  the server). Today the smoke signs server-side for convenience.
- **mTLS + EMQX ACLs** — per-rover client certs, per-topic ACLs. The broker runs open
  (anonymous) for the dev loop.
- **WebSocket / SPA push** — the async `aiomqtt` + FastAPI layer that feeds the live
  console (Phase C).
- **Durable store-and-forward** — a bounded queue + shedding for offline survival.

---

## 8. Where this goes next

- **Phase C** — the live console SPA (map + telemetry + command console) over the
  WebSocket layer.
- **Hardening** — mTLS + ACLs on EMQX, telemetry/fault ingest, store-and-forward.

---

**Related:** [Command Center Application Blueprint](../../../../Desktop/Friday%20Labs%20Os/docs/command-center/Command%20Center%20Application%20Blueprint.md) (dossier) · `bridge/` · Phase A control plane (the DocTypes + API this calls).
