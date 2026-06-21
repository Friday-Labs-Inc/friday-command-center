# Phase C — Live Console (read pipeline + client-side-signed commands)

> Walk-through for Phase C of the Friday Command Center. Builds the operator-facing
> console on top of the Phase A control plane and the Phase B hardened broker.
>
> **Status:** ✅ slice 1 (live read) + slice 2 (command console / client-side signing) verified.

---

## 1. The 30-second version

The console has two halves, both running through one **FastAPI + aiomqtt gateway**:

- **Read** — the gateway subscribes the broker's telemetry/ack topics over **mTLS**
  (`fcc-gateway`) and fans every message out to browsers over **WebSocket**. The page
  shows live rover pose + an event feed.
- **Write (security-critical)** — the operator signs commands **in the browser** with
  **Web Crypto Ed25519**; the private key never reaches the server. The gateway only
  issues the nonce, returns the canonical signing bytes, and relays the signed envelope.

---

## 2. What's in the box

| File | Role |
|---|---|
| `gateway.py` | FastAPI + aiomqtt. WS fan-out + `/api/nonce`, `/api/sign-bytes`, `/api/command`. |
| `static/index.html` | No-build console: live feed + the command console (Web Crypto signer). |
| `verify_write.py` | Browser-simulator that proves the signed write path end-to-end. |
| `emqx/acl.conf` | `fcc-gateway` may subscribe `tlm`/`ack` and publish `cmd` (relay only). |

Served at **http://127.0.0.1:8090/**. Reuses `envelope.py` for the canonical signing bytes
and the hardened Phase B broker (mTLS + ACLs).

## 3. The write path — why the gateway can't forge a command

```
browser                              gateway                       control plane / rover
  │  POST /api/nonce ───────────────────►  issue_nonce ──────────────►  monotonic nonce
  │  build envelope (nonce, payload)
  │  POST /api/sign-bytes ──────────────►  env._signing_bytes(envelope)  (canonical CBOR)
  │  ◄── signing bytes (hex)
  │  Web Crypto Ed25519 sign  (PRIVATE KEY STAYS HERE)
  │  POST /api/command {envelope, sig} ─►  verify vs allowlisted pubkey
  │                                        publish mark1/<rover>/cmd/… + record_command
  │                                                              └──►  rover verifies sig+nonce
```

The signature binds to the exact canonical bytes. If the gateway published a *different*
envelope, the signature wouldn't verify at the rover — so the gateway can only relay (or
drop) what the operator signed, never alter it. The browser doesn't reimplement canonical
CBOR (floats are the hard part); it signs the bytes the rover's own encoder produces.

## 4. Decisions & why

| Decision | Why |
|---|---|
| **Gateway returns the signing bytes** | The browser can't cheaply reproduce cbor2-canonical (esp. float encoding). Signing server-computed bytes is safe — the signature still binds, and the gateway can't substitute a different command. |
| **Web Crypto Ed25519** | Native browser signing; the raw 32-byte key is wrapped in the fixed Ed25519 PKCS#8 prefix and imported non-extractable. |
| **Pasted key (dev)** | Production keeps the key in a hardware token / OS keystore via the signing agent. The console never transmits it. |
| **One gateway does read + dispatch** | Pragmatic for the slice; production splits read vs command-dispatch into separate identities (CQRS). |

## 5. Run it

```bash
bash gen_certs.sh && bash emqx/run_broker.sh           # Phase B broker (mTLS + ACLs)
bench --site command-center.localhost serve --port 8003 &   # control plane
CP_BASE=http://127.0.0.1:8003 CP_KEY=... CP_SECRET=... \
  PYTHONPATH=. .venv/bin/uvicorn gateway:app --port 8090     # gateway + console
# open http://127.0.0.1:8090/  — paste an operator key (SMOKE_OP_PRIV) and send.
```

## 6. Verification

| Check | Result |
|---|---|
| Live pipeline (rover telemetry → gateway → WS client) | odom + fault events received |
| Write path (`verify_write.py`) | nonce → sign-bytes → **local sign** → dispatch → rover **OK** |

## 7. What is NOT done yet

- **Frappe reads in the console** — Security Events, audit log, rover list from the
  control-plane REST (the console shows live MQTT only).
- ~~Client-side signing agent~~ — ✅ **done**: `bridge/signing_agent.py` holds the operator
  key in the **OS keychain** (macOS Keychain via the `security` CLI). The console enrolls a
  key once and then signs via the agent (`POST /sign`), so the key never enters the browser.
  Run: `uvicorn signing_agent:app --port 7070`. Verified by `verify_agent.py`. Remaining
  production hardening: a hardware token (PKCS#11/PIV, non-extractable) + caller
  authentication (CORS alone doesn't stop another local page triggering a signature).
- **Real SPA** — React/Vue + MapLibre map; the no-build page proves the pipeline.
- **CQRS split + rover-telemetry signature verification.**

---

**Related:** Phase A (control plane) · Phase B (data plane + hardening) · `gateway.py`.
