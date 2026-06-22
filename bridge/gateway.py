"""Live-console gateway (CQRS read side + production edge) — FastAPI + aiomqtt.

READ: subscribes telemetry/ack over mTLS (fcc-gateway, subscribe-only), verifies rover
telemetry signatures, fans out over WebSocket, serves the read REST.

PRODUCTION EDGE: serves the built SPA (console/dist) as a single TLS origin and
reverse-proxies the WRITE paths (/api/nonce, /api/sign-bytes, /api/command) to the
command dispatcher (dispatcher.py). The gateway holds NO broker publish rights — only the
dispatcher publishes — so CQRS at the broker layer is preserved; this is an edge proxy.

Run (dev):  CP_BASE=... CP_KEY=... CP_SECRET=... uvicorn gateway:app --port 8090
Run (prod): ... uvicorn gateway:app --port 8443 --ssl-certfile certs/server.crt --ssl-keyfile certs/server.key
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

import aiomqtt
import httpx
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

import envelope as env
from control_plane import ControlPlane
from edge_cache import EdgeCache

HERE = os.path.dirname(os.path.abspath(__file__))
CERTS = os.path.join(HERE, "certs")
DIST = os.path.abspath(os.path.join(HERE, "..", "console", "dist"))
BROKER_HOST = os.environ.get("MQTT_HOST", "127.0.0.1")
BROKER_PORT = int(os.environ.get("MQTT_TLS_PORT", "8883"))
DISPATCHER = os.environ.get("DISPATCHER_URL", "http://127.0.0.1:8091")

_CP = None
if os.environ.get("CP_BASE") and os.environ.get("CP_KEY") and os.environ.get("CP_SECRET"):
    _CP = ControlPlane(os.environ["CP_BASE"], os.environ["CP_KEY"], os.environ["CP_SECRET"])

# Keystone P0: serve rover telemetry-verification keys from a durable edge cache so
# telemetry keeps verifying when the control plane (Frappe) is unreachable.
STATE_DIR = os.environ.get("FCC_STATE_DIR", os.path.join(HERE, "state"))
_CACHE = (
    EdgeCache(_CP, path=os.path.join(STATE_DIR, "edge_gateway.json"),
              on_offline=lambda r: print("[edge] control plane OFFLINE — serving cached rover keys:", r))
    if _CP else None
)


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
_rover_keys: dict = {}  # rover_id -> Ed25519PublicKey (telemetry signing)


async def _refresh_rover_keys():
    if _CACHE is None:
        return
    try:
        keys = await asyncio.to_thread(_CACHE.rover_keys)
    except Exception as exc:  # noqa: BLE001 — cold cache + Frappe down: keep existing keys
        print("rover-key refresh failed (keeping existing keys):", exc)
        return
    _rover_keys.clear()
    for rover, pub_hex in keys.items():
        if pub_hex:
            _rover_keys[rover] = env.public_key_from_hex(pub_hex)


def _event(topic: str, payload: bytes):
    parts = topic.split("/")
    rover = parts[1] if len(parts) > 1 else "?"
    try:
        msg = env.decode(payload)
    except Exception:  # noqa: BLE001
        return {"kind": "telemetry", "rover": rover, "topic": topic, "data": None, "verified": None}
    if isinstance(msg, dict) and "sig" in msg and "kind" in msg:
        pub = _rover_keys.get(rover)
        if not (pub and env.verify_telemetry(msg, pub)):
            print(f"DROP unverifiable telemetry from {rover} on {topic}")
            return None
        return {"kind": msg.get("kind"), "rover": rover, "topic": topic,
                "data": msg.get("data"), "verified": True}
    kind = ("odom" if "/tlm/odom" in topic else "fault" if "/tlm/fault" in topic
            else "ack" if "/ack/" in topic else "telemetry")
    return {"kind": kind, "rover": rover, "topic": topic, "data": msg,
            "verified": (False if "/tlm/" in topic else None)}


async def _mqtt_loop():
    tls = aiomqtt.TLSParameters(
        ca_certs=f"{CERTS}/ca.crt", certfile=f"{CERTS}/gateway.crt", keyfile=f"{CERTS}/gateway.key")
    while True:
        try:
            await _refresh_rover_keys()
            async with aiomqtt.Client(
                hostname=BROKER_HOST, port=BROKER_PORT, identifier="fcc-gateway", tls_params=tls,
            ) as client:
                await client.subscribe("mark1/+/tlm/#")
                await client.subscribe("mark1/+/ack/#")
                async for message in client.messages:
                    ev = _event(str(message.topic), message.payload)
                    if ev is not None:
                        await hub.broadcast(ev)
        except Exception as exc:  # noqa: BLE001
            print("gateway mqtt loop error, retrying:", exc)
            await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_mqtt_loop())
    yield
    task.cancel()


app = FastAPI(title="Friday Command Center — gateway", lifespan=lifespan)


def _require_cp():
    if _CP is None:
        raise HTTPException(503, "control plane not configured (set CP_BASE/CP_KEY/CP_SECRET)")
    return _CP


# ---- read REST --------------------------------------------------------------
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


# ---- write edge: reverse-proxy to the dispatcher (gateway never publishes) ----
async def _proxy(req: Request, path: str) -> Response:
    body = await req.body()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{DISPATCHER}{path}", content=body,
            headers={"content-type": req.headers.get("content-type", "application/json")})
    return Response(content=r.content, status_code=r.status_code, media_type="application/json")


@app.post("/api/nonce")
async def proxy_nonce(req: Request):
    return await _proxy(req, "/api/nonce")


@app.post("/api/sign-bytes")
async def proxy_sign_bytes(req: Request):
    return await _proxy(req, "/api/sign-bytes")


@app.post("/api/command")
async def proxy_command(req: Request):
    return await _proxy(req, "/api/command")


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await hub.join(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.leave(websocket)


# ---- SPA serving (mounted LAST so it never shadows the routes above) ----
if os.path.isfile(os.path.join(DIST, "index.html")):
    app.mount("/", StaticFiles(directory=DIST, html=True), name="spa")
else:
    app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")

    @app.get("/", response_class=HTMLResponse)
    async def index():
        return open(os.path.join(HERE, "static", "index.html")).read()
