"""Live-console gateway — FastAPI + aiomqtt.

READ path: subscribe the broker's telemetry/ack topics over mTLS (clientid/CN =
fcc-gateway) and fan each message out to browser WebSocket clients as JSON.

WRITE path (client-side signing): the operator's Ed25519 PRIVATE KEY never leaves the
browser. The gateway only (a) issues a nonce from the control plane, (b) returns the
*canonical signing bytes* for the operator's envelope (reusing envelope._signing_bytes,
so the browser need not reimplement canonical-CBOR), and (c) relays the browser-signed
envelope to the rover's cmd topic + records the audit. The signature binds to the bytes,
so the gateway cannot alter the command — a tampered envelope fails verification at the
rover (and the gateway re-verifies before publishing).

Run:  CP_BASE=... CP_KEY=... CP_SECRET=... PYTHONPATH=. .venv/bin/uvicorn gateway:app --port 8090
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager

import aiomqtt
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import envelope as env
from control_plane import ControlPlane

HERE = os.path.dirname(os.path.abspath(__file__))
CERTS = os.path.join(HERE, "certs")
BROKER_HOST = os.environ.get("MQTT_HOST", "127.0.0.1")
BROKER_PORT = int(os.environ.get("MQTT_TLS_PORT", "8883"))

# Control-plane client (server-side creds; the browser never sees these).
_CP = None
if os.environ.get("CP_BASE") and os.environ.get("CP_KEY") and os.environ.get("CP_SECRET"):
    _CP = ControlPlane(os.environ["CP_BASE"], os.environ["CP_KEY"], os.environ["CP_SECRET"])

_state = {"mqtt": None}  # the connected aiomqtt client, for command publish


class Hub:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def join(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)

    def leave(self, ws: WebSocket):
        self.clients.discard(ws)

    async def broadcast(self, msg: dict):
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.leave(ws)


hub = Hub()


def _event(topic: str, payload: bytes) -> dict:
    parts = topic.split("/")
    rover = parts[1] if len(parts) > 1 else "?"
    try:
        data = env.decode(payload)
    except Exception:  # noqa: BLE001
        data = None
    kind = ("odom" if "/tlm/odom" in topic else "fault" if "/tlm/fault" in topic
            else "ack" if "/ack/" in topic else "telemetry")
    return {"kind": kind, "rover": rover, "topic": topic, "data": data}


async def _mqtt_loop():
    tls = aiomqtt.TLSParameters(
        ca_certs=f"{CERTS}/ca.crt", certfile=f"{CERTS}/gateway.crt", keyfile=f"{CERTS}/gateway.key")
    while True:
        try:
            async with aiomqtt.Client(
                hostname=BROKER_HOST, port=BROKER_PORT, identifier="fcc-gateway", tls_params=tls,
            ) as client:
                _state["mqtt"] = client
                await client.subscribe("mark1/+/tlm/#")
                await client.subscribe("mark1/+/ack/#")
                async for message in client.messages:
                    await hub.broadcast(_event(str(message.topic), message.payload))
        except Exception as exc:  # noqa: BLE001
            _state["mqtt"] = None
            print("gateway mqtt loop error, retrying:", exc)
            await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_mqtt_loop())
    yield
    task.cancel()


app = FastAPI(title="Friday Command Center — Live Console", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")


# ---- write path (client-side signing) ---------------------------------------
class NonceReq(BaseModel):
    rover: str
    operator: str


class SignReq(BaseModel):
    envelope: dict


class CommandReq(BaseModel):
    envelope: dict
    signature: str  # hex


def _require_cp():
    if _CP is None:
        raise HTTPException(503, "control plane not configured (set CP_BASE/CP_KEY/CP_SECRET)")
    return _CP


@app.post("/api/nonce")
async def api_nonce(req: NonceReq):
    cp = _require_cp()
    nonce = await asyncio.to_thread(cp.issue_nonce, req.rover, req.operator)
    now = time.time()
    return {"nonce": nonce, "issued_at": now, "expires_at": now + env.DEFAULT_EXPIRY_S}


@app.post("/api/sign-bytes")
async def api_sign_bytes(req: SignReq):
    # The exact bytes the rover will verify — canonical CBOR of the envelope minus signature.
    return {"signing_hex": env._signing_bytes(req.envelope).hex()}


@app.post("/api/command")
async def api_command(req: CommandReq):
    cp = _require_cp()
    envelope = dict(req.envelope)
    envelope["signature"] = bytes.fromhex(req.signature)
    rover = envelope["rover_id"]
    operator = envelope["sender_id"]

    # Re-verify the operator-signed envelope against the allowlisted public key.
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


# ---- read path --------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def index():
    return open(os.path.join(HERE, "static", "index.html")).read()


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await hub.join(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.leave(websocket)
