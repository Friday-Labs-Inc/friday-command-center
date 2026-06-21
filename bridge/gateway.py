"""Live-console gateway (CQRS read side) — FastAPI + aiomqtt, subscribe-only.

Subscribes the broker's telemetry/ack topics over mTLS (clientid/CN = fcc-gateway, the
ACL permits subscribe only) and fans each message out to browser WebSocket clients. Also
serves the read REST the console polls (rovers, rover-state, security-events). It NEVER
publishes — operator commands go to the command dispatcher (dispatcher.py, fcc-dispatch).

Run: CP_BASE=... CP_KEY=... CP_SECRET=... PYTHONPATH=. .venv/bin/uvicorn gateway:app --port 8090
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

import aiomqtt
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

import envelope as env
from control_plane import ControlPlane

HERE = os.path.dirname(os.path.abspath(__file__))
CERTS = os.path.join(HERE, "certs")
BROKER_HOST = os.environ.get("MQTT_HOST", "127.0.0.1")
BROKER_PORT = int(os.environ.get("MQTT_TLS_PORT", "8883"))

_CP = None
if os.environ.get("CP_BASE") and os.environ.get("CP_KEY") and os.environ.get("CP_SECRET"):
    _CP = ControlPlane(os.environ["CP_BASE"], os.environ["CP_KEY"], os.environ["CP_SECRET"])


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
                await client.subscribe("mark1/+/tlm/#")
                await client.subscribe("mark1/+/ack/#")
                async for message in client.messages:
                    await hub.broadcast(_event(str(message.topic), message.payload))
        except Exception as exc:  # noqa: BLE001
            print("gateway mqtt loop error, retrying:", exc)
            await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_mqtt_loop())
    yield
    task.cancel()


app = FastAPI(title="Friday Command Center — Live Console (read)", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")


def _require_cp():
    if _CP is None:
        raise HTTPException(503, "control plane not configured (set CP_BASE/CP_KEY/CP_SECRET)")
    return _CP


@app.get("/api/rovers")
async def api_rovers():
    cp = _require_cp()
    return await asyncio.to_thread(cp.list_rovers)


@app.get("/api/rover-state")
async def api_rover_state(rover: str):
    cp = _require_cp()
    return await asyncio.to_thread(cp.get_rover_state, rover)


@app.get("/api/security-events")
async def api_security_events(rover: str | None = None, limit: int = 20):
    cp = _require_cp()
    return await asyncio.to_thread(cp.recent_security_events, rover, limit)


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
