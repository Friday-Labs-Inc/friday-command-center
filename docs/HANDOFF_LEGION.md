# Friday Command Center — Legion Handoff

**Pick this up cold.** This is the one doc a fresh Claude (or human) session on Legion needs to continue FCC development. Plain English first, exact commands underneath.

---

## Where the project is

The FCC is **feature-complete (Phases A–D + 4 follow-ups), in production behind Tailscale HTTPS**, with one critical architecture fix committed but **not yet redeployed**. That redeploy is the very first job for this session.

- Repo: `Friday-Labs-Inc/friday-command-center`, branch `main`, HEAD **`2118edd`** (pushed)
- Live URL: `https://friday-lenovo-legion-5-pro-16ach6h.tail2074fe.ts.net/` (valid cert, tailnet-only)
- Bench: `~/fcc-bench` (Frappe v16, site `fcc.localhost`, MariaDB root `fcc_root_2026`)
- App: `~/fcc-bench/apps/friday_command_center`
- node v24.16 lives at `~/.nvm/versions/node/v24.16.0/bin` (system node v22 is too old for the SPA build)

---

## 🥇 First job — redeploy `2118edd`

The live systemd services still run the **pre-fix** code. `2118edd` is the Keystone P0 offline-first fix; until it's deployed, a Frappe outage still blacks out all commanding (the whole reason the fix exists). Order matters — pull first, validate tests, restart services.

```bash
# 1. Pull the fix
cd ~/fcc-bench/apps/friday_command_center && git pull --ff-only

# 2. Validate the two new control-plane methods (get_nonce_floor / set_nonce_floor)
#    against the real bench (NOT just the bridge venv).
cd ~/fcc-bench && \
  bench --site fcc.localhost run-tests --app friday_command_center

# 3. Restart the data-plane services (control plane unchanged on the wire, but the
#    api.py adds two whitelisted methods — bench restart picks them up).
sudo systemctl restart fcc-control-plane fcc-dispatcher fcc-gateway
sudo systemctl is-active fcc-control-plane fcc-dispatcher fcc-gateway   # all 3 = active

# 4. Smoke-test the live URL.
U="https://friday-lenovo-legion-5-pro-16ach6h.tail2074fe.ts.net"
curl -s "$U/api/rovers"           # expect MARK1-001 JSON
curl -s "$U/" | grep -o '<title>.*</title>'   # expect <title>Friday Command Center</title>

# 5. Confirm the edge cache is doing its job (the proof the redeploy succeeded):
ls -la ~/fcc-bench/apps/friday_command_center/bridge/state/
# expect edge_dispatch.json, edge_gateway.json, edge_nonce.json after a few API calls
```

If `bench run-tests` fails on Legion (it passed on the Mac venv: 28/28), DO NOT restart the services — investigate first. The two new methods are pure Frappe code, so a failure most likely means a Python version / Frappe v16 quirk on Legion.

---

## What `2118edd` actually changed (so you can reason about regressions)

The data plane used to call Frappe **synchronously per command** → a Frappe outage = total blackout. Now:

- **`bridge/edge_cache.py`** — new file, two classes:
  - `EdgeCache` — durable read-through cache for `allowlist` + `rover_keys`. Atomic fsync (same pattern as the rover's `NonceStore`). On `ConnectionError`/`Timeout` from Frappe serves last-known data; real HTTP errors propagate; cold miss raises.
  - `EdgeNonce` — durable strictly-monotonic per-(rover, operator) nonce **issued at the edge**. Single dispatcher is the authoritative writer; Frappe is a best-effort mirror via the two new APIs. Also runs a `consume()` replay gate post-signature so the dispatcher rejects replays itself.
- **`bridge/dispatcher.py`** — issues from `EdgeNonce`, applies `consume()` after signature verification, and an offline audit no longer 500s an already-published command (returns `audited:false`).
- **`bridge/gateway.py`** — verifies telemetry from cached keys; no longer wipes keys on a failed refresh.
- **`friday_command_center/api.py`** — two new whitelisted methods: `get_nonce_floor(rover, operator)` and `set_nonce_floor(rover, operator, nonce)` (monotonic advance).
- **`bridge/state/`** — runtime cache dir, gitignored.

28 bridge tests green on the Mac venv. The proof test is `bridge/tests/test_offline_command_path.py`: issue → sign → authorize → replay/expiry/forgery, all correct with Frappe **down**.

---

## 🥈 Next job — broker hardening (the audit's other critical)

Fast config-only fixes. Each closes a real bypass found in the 4-expert audit.

1. **Close plaintext MQTT** — `bridge/emqx/run_broker.sh` currently maps `-p 1883:1883`. Remove that line (and the listener), then `docker rm -f fcc-emqx && bash bridge/emqx/run_broker.sh`. Without this, anyone on the host can publish forged commands and skip mTLS entirely. The app-layer Ed25519 check at the rover still catches them, but the broker layer is bypassed.
2. **Change EMQX dashboard creds** — currently factory default `admin`/`public` on exposed `:18083`. Set `EMQX_DASHBOARD__DEFAULT_USERNAME` + `EMQX_DASHBOARD__DEFAULT_PASSWORD` env vars on the container, and update `bridge/emqx/configure_acl.py` to read them from env (it already supports `EMQX_DASH_USER`/`EMQX_DASH_PASS`).
3. **`peer_cert_as_clientid=cn`** — add `EMQX_LISTENERS__SSL__DEFAULT__PEER_CERT_AS_CLIENTID=cn` env var. Binds the MQTT clientid to the cert CN at TLS handshake, so a holder of a different valid cert can't claim `clientid=fcc-dispatch` and gain publish rights.

After: `docker update --restart=always fcc-emqx` (already set, but re-confirm).

---

## 🥉 Lower-priority open items (FCC-side)

In rough order:
- **Signing-agent caller auth** — `bridge/signing_agent.py` accepts any localhost POST matching CORS origins. Add a per-session challenge token tied to the authenticated console session.
- **Audit store-and-forward outbox** — `dispatcher.py:api_command` currently publishes to MQTT first then calls `cp.record_command`; if the audit write fails, the command was already sent. Wrap with a local SQLite outbox flushed by a background task. (Partial mitigation already done: an offline audit no longer raises, returns `audited:false`.)
- **`/api/sign-bytes` allowlist pre-check** — currently returns canonical signing bytes for any envelope. Add `cp.get_allowlist` check before returning.
- **Deprecate legacy `bridge.py`** — Phase B paho bridge is superseded by `dispatcher.py` but still present and still has its own `send_command` path. Rename to `bridge_legacy.py` or move to `tests/`.

---

## Pending cross-repo asks (rover session: `local_502e059f…`, "Engineering specs review")

Sent 2026-06-24; **don't act on these until rover-side responds.**

1. **Nonce strictly-greater confirmation** — FCC now issues nonces from a durable edge counter that may leave gaps after a reconcile. The rover must accept any `nonce > floor`, not require `floor+1`. Awaiting yes/no on `src/friday_telemetry/.../protocol.py:CommandValidator` + `friday_module_agent/NonceStore`.
2. **Wire-contract golden-vector drift test** — `protocol.py` (rover) and `bridge/envelope.py` (FCC) are byte-identical today but hand-maintained in two repos with no shared package. Proposed: a fixed JSON fixture (priv key + envelope + expected `_signing_bytes` hex + expected sig hex) asserted on both sides. FCC half is on me; rover half on them.
3. **Telemetry signing decision** — the FCC gateway has full `sign_telemetry`/`verify_telemetry` paths, but real rover nodes publish unsigned telemetry. Either sign on the rover side (mirror `sign_telemetry`), or declare telemetry unauthenticated and I'll remove the dead verify code.

---

## Operational quick reference

```bash
# Service control
sudo systemctl status  fcc-control-plane fcc-dispatcher fcc-gateway
sudo systemctl restart fcc-control-plane fcc-dispatcher fcc-gateway
sudo journalctl -u fcc-gateway -n 100 --no-pager

# EMQX (Docker)
docker ps --filter name=fcc-emqx
docker logs --tail 80 fcc-emqx
docker restart fcc-emqx

# Tailscale serve (the HTTPS edge)
tailscale serve status     # should show: https://<machine>.tail2074fe.ts.net → http://127.0.0.1:8090

# Env (paths the systemd units use)
sudo cat /etc/fcc/fcc.env  # CP_BASE / CP_KEY / CP_SECRET / MQTT_HOST / MQTT_TLS_PORT

# Edge-cache state (after the redeploy)
ls -la ~/fcc-bench/apps/friday_command_center/bridge/state/

# Tests — run BOTH suites
cd ~/fcc-bench && bench --site fcc.localhost run-tests --app friday_command_center
cd ~/fcc-bench/apps/friday_command_center/bridge && \
  PYTHONPATH=. .venv/bin/python -m pytest tests/ -q
```

---

## The mental model (90 seconds)

Three systems, one wire contract:

| System | What | Port |
|---|---|---|
| **FCC control plane** (Frappe v16) | System of record: allowlist, nonce mirror, audit, revocation, CA | `:8003` (loopback) |
| **Bridge** — CQRS split | Read **gateway** (`fcc-gateway`, sub-only) + write **dispatcher** (`fcc-dispatch`, pub-only) | `:8090`, `:8091` (loopback) |
| **EMQX broker** | mTLS + topic ACL (`no_match=deny`) | `:8883` |
| **Rover (FL OS)** — separate repo | The other end of the signed wire | — |
| **Operator's Mac** (NOT Legion) | Browser SPA + macOS Keychain signing agent | `:7070` local |
| **Tailscale edge** | Fronts the gateway over HTTPS at the MagicDNS name | `:443` |

Every command is an **Ed25519-signed CBOR envelope**. The bridge holds no private keys; the operator signs in the browser via the local keychain agent. The byte-format definition lives in TWO places (rover's `protocol.py` and FCC's `bridge/envelope.py`) — keeping them in sync is item #2 in the cross-repo asks above.

---

## Source-of-truth pointers

- **Code architecture** — read `bridge/envelope.py`, then `bridge/dispatcher.py`, then `bridge/gateway.py`. ~500 lines total, very readable.
- **Walk-throughs** — `docs/Phase B - Data Plane Bridge.md`, `docs/Phase C - Live Console.md`. (Phase A walk-through doc was never written — gap.)
- **Memory** — the Command Center session's memory under `~/.claude/projects/-Users-alphaworkz-Desktop-Friday-Labs-Os/memory/project_command_center_fcc.md` is the full chronological state.
- **Audit findings** — full 4-expert audit lives in the Mac session transcript (architecture / security / wire-contract / resilience lenses).

---

**Bottom line:** redeploy `2118edd` first (≤5 min). Then broker hardening (≤30 min). Then either wait on rover-session replies for the wire-contract work, or start the signing-agent caller-auth item — both are productive.
