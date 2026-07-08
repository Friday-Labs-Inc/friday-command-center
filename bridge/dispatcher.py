"""Command dispatcher (CQRS write side) — FastAPI + aiomqtt, publish-only.

Separated from the read-only gateway: this service holds the `fcc-dispatch` identity
(publish `cmd` only, per the ACL), issues nonces, returns canonical signing bytes,
re-verifies the operator-signed envelope against the allowlist, and relays it to the
rover's cmd topic + audits. It NEVER subscribes. The operator's private key never
touches it (client-side signing via the agent).

Run: CP_BASE=... CP_KEY=... CP_SECRET=... PYTHONPATH=. .venv/bin/uvicorn dispatcher:app --port 8091
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager

import aiomqtt
import cbor2
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import envelope as env
from control_plane import ControlPlane
from edge_cache import EdgeCache, EdgeNonce

HERE = os.path.dirname(os.path.abspath(__file__))
CERTS = os.path.join(HERE, "certs")
BROKER_HOST = os.environ.get("MQTT_HOST", "127.0.0.1")
BROKER_PORT = int(os.environ.get("MQTT_TLS_PORT", "8883"))
CONSOLE_ORIGINS = os.environ.get(
    "CONSOLE_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

_CP = None
if os.environ.get("CP_BASE") and os.environ.get("CP_KEY") and os.environ.get("CP_SECRET"):
    _CP = ControlPlane(os.environ["CP_BASE"], os.environ["CP_KEY"], os.environ["CP_SECRET"])

# Keystone P0: read the allowlist through a durable edge cache so command authorization
# survives a control-plane (Frappe) outage instead of failing closed.
STATE_DIR = os.environ.get("FCC_STATE_DIR", os.path.join(HERE, "state"))
_CACHE = (
    EdgeCache(_CP, path=os.path.join(STATE_DIR, "edge_dispatch.json"),
              on_offline=lambda r: print("[edge] control plane OFFLINE — serving cached allowlist:", r))
    if _CP else None
)
# Edge owns the nonce: a durable, strictly-monotonic local counter so commands can still
# be issued (and replays rejected) while Frappe is unreachable; Frappe is a best-effort mirror.
_NONCE = EdgeNonce(_CP, path=os.path.join(STATE_DIR, "edge_nonce.json")) if _CP else None

_state = {"mqtt": None}


async def _publish_loop():
    tls = aiomqtt.TLSParameters(
        ca_certs=f"{CERTS}/ca.crt", certfile=f"{CERTS}/dispatch.crt", keyfile=f"{CERTS}/dispatch.key")
    while True:
        try:
            async with aiomqtt.Client(
                hostname=BROKER_HOST, port=BROKER_PORT, identifier="fcc-dispatch", tls_params=tls,
            ) as client:
                _state["mqtt"] = client
                while True:  # publish-only; just keep the connection alive
                    await asyncio.sleep(3600)
        except Exception as exc:  # noqa: BLE001
            _state["mqtt"] = None
            print("dispatcher mqtt loop error, retrying:", exc)
            await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_publish_loop())
    yield
    task.cancel()


app = FastAPI(title="Friday CC — command dispatcher", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=CONSOLE_ORIGINS, allow_methods=["*"], allow_headers=["*"])


def _require_cp():
    if _CP is None:
        raise HTTPException(503, "control plane not configured (set CP_BASE/CP_KEY/CP_SECRET)")
    return _CP


def _with_bstr_payload(envelope: dict) -> dict:
    """Return a copy of `envelope` with `payload` as an opaque canonical-CBOR byte-string.

    The console signs a command whose `payload` is a plain JSON object; the wire contract
    requires it to travel as a pre-serialized CBOR bstr so floats never re-encode across the
    JS/Python/C++ boundary. The dispatcher (not the browser) is the CBOR producer, so it makes
    the bstr here — identically in /api/sign-bytes and /api/command — and the operator signs
    over exactly the bytes that get published. Bytes/str payloads are passed through untouched.
    """
    payload = envelope.get("payload")
    if isinstance(payload, (dict, list)):
        return {**envelope, "payload": cbor2.dumps(payload, canonical=True)}
    return dict(envelope)


class NonceReq(BaseModel):
    rover: str
    operator: str


class SignReq(BaseModel):
    envelope: dict


class CommandReq(BaseModel):
    envelope: dict
    signature: str


@app.post("/api/nonce")
async def api_nonce(req: NonceReq):
    _require_cp()
    nonce = await asyncio.to_thread(_NONCE.issue, req.rover, req.operator)
    now_ms = int(time.time() * 1000)  # int64 epoch-ms wire timestamps
    return {"nonce": nonce, "issued_at": now_ms, "expires_at": now_ms + env.DEFAULT_EXPIRY_MS}


@app.post("/api/sign-bytes")
async def api_sign_bytes(req: SignReq):
    return {"signing_hex": env._signing_bytes(_with_bstr_payload(req.envelope)).hex()}


@app.post("/api/command")
async def api_command(req: CommandReq):
    cp = _require_cp()
    # The console's payload is a JSON object; keep it for the class route + human audit,
    # then seal it into the opaque CBOR bstr the operator signed over (see _with_bstr_payload).
    payload_obj = req.envelope.get("payload")
    envelope = _with_bstr_payload(req.envelope)
    envelope["signature"] = bytes.fromhex(req.signature)
    rover = envelope["rover_id"]
    operator = envelope["sender_id"]

    allow = await asyncio.to_thread(_CACHE.get_allowlist, rover)
    pub_hex = {a["operator"]: a["public_key"] for a in allow}.get(operator)
    if not pub_hex or not env.verify(envelope, env.public_key_from_hex(pub_hex)):
        raise HTTPException(400, "signature invalid or operator not allowlisted")

    # Reject stale or replayed commands at the dispatcher (not only at the rover). The
    # signature verified above, so now enforce freshness on the control-plane-owned nonce.
    # ±SKEW_MS around [issued_at, expires_at], matching the rover's CommandValidator.
    now_ms = int(time.time() * 1000)
    issued_at = int(envelope.get("issued_at") or 0)
    expires_at = int(envelope.get("expires_at") or 0)
    if not (issued_at - env.SKEW_MS <= now_ms <= expires_at + env.SKEW_MS):
        raise HTTPException(400, "command expired")
    if not _NONCE.consume(rover, operator, int(envelope["nonce"])):
        try:
            await asyncio.to_thread(
                cp.record_security_event, rover=rover, operator=operator,
                category="SECURITY_REPLAY", severity="Error",
                description=f"replayed nonce {envelope['nonce']} rejected at dispatcher")
        except Exception:  # noqa: BLE001 — never let the audit attempt mask the rejection
            pass
        raise HTTPException(400, "nonce replay rejected")

    client = _state["mqtt"]
    if client is None:
        raise HTTPException(503, "broker not connected")
    cmd_class = (payload_obj or {}).get("class", "motion") if isinstance(payload_obj, dict) else "motion"
    await client.publish(f"mark1/{rover}/cmd/{cmd_class}", env.encode(envelope), qos=1)

    # The command is already on the wire; an offline audit must not fail it. The edge
    # cache let us authorize offline, so the audit can lag and be reconciled later.
    audited = True
    try:
        await asyncio.to_thread(
            cp.record_command, rover=rover, operator=operator, command_class=cmd_class,
            nonce=envelope["nonce"], outcome="Accepted", category="OK",
            msg_id=envelope.get("msg_id"), payload=json.dumps(payload_obj),
            signature=req.signature,
        )
    except (requests.ConnectionError, requests.Timeout) as exc:
        audited = False
        print("[edge] command published; audit deferred (control plane offline):", exc)
    return {"ok": True, "nonce": envelope["nonce"], "audited": audited}
