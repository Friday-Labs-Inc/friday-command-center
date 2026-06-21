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
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import envelope as env
from control_plane import ControlPlane

HERE = os.path.dirname(os.path.abspath(__file__))
CERTS = os.path.join(HERE, "certs")
BROKER_HOST = os.environ.get("MQTT_HOST", "127.0.0.1")
BROKER_PORT = int(os.environ.get("MQTT_TLS_PORT", "8883"))
CONSOLE_ORIGINS = os.environ.get(
    "CONSOLE_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

_CP = None
if os.environ.get("CP_BASE") and os.environ.get("CP_KEY") and os.environ.get("CP_SECRET"):
    _CP = ControlPlane(os.environ["CP_BASE"], os.environ["CP_KEY"], os.environ["CP_SECRET"])

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
    cp = _require_cp()
    nonce = await asyncio.to_thread(cp.issue_nonce, req.rover, req.operator)
    now = time.time()
    return {"nonce": nonce, "issued_at": now, "expires_at": now + env.DEFAULT_EXPIRY_S}


@app.post("/api/sign-bytes")
async def api_sign_bytes(req: SignReq):
    return {"signing_hex": env._signing_bytes(req.envelope).hex()}


@app.post("/api/command")
async def api_command(req: CommandReq):
    cp = _require_cp()
    envelope = dict(req.envelope)
    envelope["signature"] = bytes.fromhex(req.signature)
    rover = envelope["rover_id"]
    operator = envelope["sender_id"]

    allow = await asyncio.to_thread(cp.get_allowlist, rover)
    pub_hex = {a["operator"]: a["public_key"] for a in allow}.get(operator)
    if not pub_hex or not env.verify(envelope, env.public_key_from_hex(pub_hex)):
        raise HTTPException(400, "signature invalid or operator not allowlisted")

    client = _state["mqtt"]
    if client is None:
        raise HTTPException(503, "broker not connected")
    cmd_class = (envelope.get("payload") or {}).get("class", "motion")
    await client.publish(f"mark1/{rover}/cmd/{cmd_class}", env.encode(envelope), qos=1)
    await asyncio.to_thread(
        cp.record_command, rover=rover, operator=operator, command_class=cmd_class,
        nonce=envelope["nonce"], outcome="Accepted", category="OK",
        msg_id=envelope.get("msg_id"), payload=json.dumps(envelope.get("payload")),
        signature=req.signature,
    )
    return {"ok": True, "nonce": envelope["nonce"]}
