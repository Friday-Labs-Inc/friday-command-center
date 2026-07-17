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
import json
import os
import time
from contextlib import asynccontextmanager

import aiomqtt
import httpx
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException


class SPAStaticFiles(StaticFiles):
    """Serve the built SPA with a single-page-app fallback: any path that isn't
    a real static file (e.g. client-side routes /brain, /system, /deck/terrain)
    returns index.html so the React router can handle it, instead of a 404.
    API routes are registered before this mount, so they still take precedence."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise

import envelope as env
from control_plane import ControlPlane
from edge_cache import EdgeCache
from telemetry_store import TelemetryStore

HERE = os.path.dirname(os.path.abspath(__file__))
CERTS = os.path.join(HERE, "certs")
DIST = os.path.abspath(os.path.join(HERE, "..", "console", "dist"))
BROKER_HOST = os.environ.get("MQTT_HOST", "127.0.0.1")
BROKER_PORT = int(os.environ.get("MQTT_TLS_PORT", "8883"))
DISPATCHER = os.environ.get("DISPATCHER_URL", "http://127.0.0.1:8091")

# OS-control agent on the Core Hub (Pi). Bearer-token'd; allowlisted service control.
# Unset in dev -> the /api/system/* routes report 503 (not configured) instead of failing.
OS_CONTROL_URL = os.environ.get("OS_CONTROL_URL", "").rstrip("/")
OS_CONTROL_TOKEN = os.environ.get("OS_CONTROL_TOKEN", "")

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
# sensor kinds worth remembering (odom = pose; env/gps = the world-sense pods)
RECORDED_KINDS = ("env", "gps", "odom", "imu")
_TLM = TelemetryStore(STATE_DIR)


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
    if isinstance(msg, dict) and "signature" in msg and "payload" in msg:
        # The rover's CANONICAL telemetry envelope (friday_telemetry protocol.py):
        # full envelope signed by the rover key, kind taken from the topic. The
        # compact {kind, data, sig} branch below stays for the bench fake_rover.
        pub = _rover_keys.get(rover)
        if not (pub and env.verify(msg, pub)):
            print(f"DROP unverifiable telemetry from {rover} on {topic}")
            return None
        if msg.get("expires_at", float("inf")) < time.time():
            print(f"DROP expired telemetry from {rover} on {topic}")
            return None
        kind = parts[3] if len(parts) > 3 and parts[2] == "tlm" else "telemetry"
        return {"kind": kind, "rover": rover, "topic": topic,
                "data": msg.get("payload"), "verified": True}
    if isinstance(msg, dict) and "sig" in msg and "kind" in msg:
        pub = _rover_keys.get(rover)
        if not (pub and env.verify_telemetry(msg, pub)):
            print(f"DROP unverifiable telemetry from {rover} on {topic}")
            return None
        return {"kind": msg.get("kind"), "rover": rover, "topic": topic,
                "data": msg.get("data"), "verified": True}
    kind = ("odom" if "/tlm/odom" in topic else "fault" if "/tlm/fault" in topic
            else "env" if "/tlm/env" in topic else "gps" if "/tlm/gps" in topic
            else "imu" if "/tlm/imu" in topic
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
                        if ev.get("kind") in RECORDED_KINDS and ev.get("data") is not None:
                            await asyncio.to_thread(
                                _TLM.add, ev["rover"], ev["kind"], ev["data"], ev["verified"])
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


# ---- extended read + admin-write REST ----------------------------------------
# NOTE: the fleet/mission/PKI writes below reach Frappe via the control plane
# (CP_KEY / CP_SECRET). The OS-control + brain routes (/api/system/*, /api/brain/*)
# use a SEPARATE model: a bearer token to the on-board os-control agent, which is
# where their auth is enforced. Neither path yet does per-operator RBAC at the
# gateway — that is a documented follow-up; the tailnet is the current perimeter.

# -- Pydantic request bodies --

class MissionBody(BaseModel):
    title: str
    rover: str | None = None
    waypoints: list[dict] | None = None
    payload: str | None = None


class RevokeOperatorBody(BaseModel):
    operator: str
    scope: str = "All Rovers"
    rover: str | None = None
    reason: str | None = None


class LiftRevocationBody(BaseModel):
    name: str


class IssueCertBody(BaseModel):
    rover: str
    cert_pem: str | None = None
    serial: str | None = None
    fingerprint: str | None = None
    expires_on: str | None = None
    issuing_ca: str | None = None


class RevokeCertBody(BaseModel):
    name: str
    reason: str | None = None


class AckEventBody(BaseModel):
    name: str


class ServiceActionBody(BaseModel):
    name: str
    action: str  # start | stop | restart


class SoulBody(BaseModel):
    content: str


class ModeBody(BaseModel):
    autonomy_level: int
    mission_profile: str
    brain: str


# -- fleet --

@app.get("/api/fleets")
async def api_fleets():
    cp = _require_cp()
    return await asyncio.to_thread(cp.list_fleets)


# -- missions --

@app.get("/api/missions")
async def api_missions():
    cp = _require_cp()
    return await asyncio.to_thread(cp.list_missions)


@app.get("/api/mission")
async def api_get_mission(name: str):
    cp = _require_cp()
    return await asyncio.to_thread(cp.get_mission, name)


@app.post("/api/mission")
async def api_create_mission(body: MissionBody):
    cp = _require_cp()
    name = await asyncio.to_thread(
        cp.upload_mission, body.title, body.rover, body.waypoints, body.payload
    )
    return {"name": name}


# -- operators --

@app.get("/api/operators")
async def api_operators():
    cp = _require_cp()
    return await asyncio.to_thread(cp.list_operators)


@app.get("/api/allowlist")
async def api_allowlist(rover: str):
    cp = _require_cp()
    return await asyncio.to_thread(cp.get_allowlist, rover)


@app.post("/api/operator/revoke")
async def api_revoke_operator(body: RevokeOperatorBody):
    cp = _require_cp()
    return await asyncio.to_thread(
        cp.revoke_operator, body.operator, body.scope, body.rover, body.reason
    )


@app.get("/api/revocations")
async def api_revocations():
    cp = _require_cp()
    return await asyncio.to_thread(cp.list_operator_revocations)


@app.post("/api/revocation/lift")
async def api_lift_revocation(body: LiftRevocationBody):
    cp = _require_cp()
    return await asyncio.to_thread(cp.lift_revocation, body.name)


# -- PKI --

@app.get("/api/certificates")
async def api_certificates(status: str | None = None, rover: str | None = None):
    cp = _require_cp()
    return await asyncio.to_thread(cp.list_certificates, status, rover)


@app.get("/api/certificate-authorities")
async def api_certificate_authorities():
    cp = _require_cp()
    return await asyncio.to_thread(cp.list_certificate_authorities)


@app.post("/api/certificate/issue")
async def api_issue_certificate(body: IssueCertBody):
    cp = _require_cp()
    name = await asyncio.to_thread(
        cp.issue_rover_certificate,
        body.rover, body.cert_pem, body.serial,
        body.fingerprint, body.expires_on, body.issuing_ca,
    )
    return {"name": name}


@app.post("/api/certificate/revoke")
async def api_revoke_certificate(body: RevokeCertBody):
    cp = _require_cp()
    return await asyncio.to_thread(cp.revoke_rover_certificate, body.name, body.reason)


# -- audit log --

@app.get("/api/audit")
async def api_audit(rover: str | None = None, limit: int = 50):
    cp = _require_cp()
    return await asyncio.to_thread(cp.list_command_audit, rover, limit)


# -- security event ack --

@app.post("/api/security-event/ack")
async def api_ack_security_event(body: AckEventBody):
    cp = _require_cp()
    return await asyncio.to_thread(cp.acknowledge_security_event, body.name)


# -- settings --

@app.get("/api/telemetry/latest")
async def api_telemetry_latest(rover: str):
    """Freshest recorded sample per sensor kind (age included, honesty first)."""
    import time as _time
    now = _time.time()
    out = {}
    for kind in await asyncio.to_thread(_TLM.kinds, rover):
        sample = await asyncio.to_thread(_TLM.latest, rover, kind)
        if sample is not None:
            out[kind] = {**sample, "age_s": round(now - sample["ts"], 1)}
    return {"rover": rover, "kinds": out}


@app.get("/api/telemetry/history")
async def api_telemetry_history(rover: str, kind: str, limit: int = 120):
    if kind not in RECORDED_KINDS:
        raise HTTPException(400, f"kind must be one of {RECORDED_KINDS}")
    samples = await asyncio.to_thread(_TLM.recent, rover, kind, min(max(limit, 1), 720))
    return {"rover": rover, "kind": kind, "samples": samples}


@app.get("/api/settings")
async def api_settings():
    cp = _require_cp()
    return await asyncio.to_thread(cp.get_settings)


# -- OS service control (Core Hub) --
# Edge-proxy to the Pi os-control-agent. The gateway holds the bearer token; the
# browser never sees it. The agent enforces the real guardrails (unit allowlist +
# action allowlist); the checks here are fail-fast, not the security boundary.

def _os_control_headers() -> dict:
    return {"Authorization": f"Bearer {OS_CONTROL_TOKEN}"} if OS_CONTROL_TOKEN else {}


def _require_os_control() -> None:
    """Fail closed: both the agent URL and its token must be configured, else the
    call would go out unauthenticated. Loud 503 beats a silent open path."""
    if not OS_CONTROL_URL:
        raise HTTPException(503, "os-control agent not configured (set OS_CONTROL_URL)")
    if not OS_CONTROL_TOKEN:
        raise HTTPException(503, "OS_CONTROL_TOKEN not configured — refusing to call the agent unauthenticated")


@app.get("/api/system/services")
async def api_system_services():
    _require_os_control()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{OS_CONTROL_URL}/services", headers=_os_control_headers())
    except httpx.RequestError as exc:
        raise HTTPException(502, f"os-control agent unreachable: {exc}")
    return Response(content=r.content, status_code=r.status_code, media_type="application/json")


@app.post("/api/system/service")
async def api_system_service(body: ServiceActionBody):
    _require_os_control()
    if body.action not in {"start", "stop", "restart"}:
        raise HTTPException(400, "action must be start|stop|restart")
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            r = await client.post(
                f"{OS_CONTROL_URL}/service",
                json={"name": body.name, "action": body.action},
                headers=_os_control_headers(),
            )
    except httpx.RequestError as exc:
        raise HTTPException(502, f"os-control agent unreachable: {exc}")
    return Response(content=r.content, status_code=r.status_code, media_type="application/json")


# -- rover brain config (SOUL.md on the Core Hub) --
# Same edge-proxy pattern. The agent enforces the single fixed path + size cap.

@app.get("/api/brain/soul")
async def api_get_soul():
    _require_os_control()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{OS_CONTROL_URL}/config/soul", headers=_os_control_headers())
    except httpx.RequestError as exc:
        raise HTTPException(502, f"os-control agent unreachable: {exc}")
    return Response(content=r.content, status_code=r.status_code, media_type="application/json")


@app.put("/api/brain/soul")
async def api_put_soul(body: SoulBody):
    _require_os_control()
    if len(body.content.encode("utf-8")) > 65536:
        raise HTTPException(413, "SOUL.md exceeds 65536 bytes")
    # Serialize with ensure_ascii=False so the agent measures the same UTF-8 byte
    # count we validated (httpx json= would \u-escape and inflate multibyte text).
    payload = json.dumps({"content": body.content}, ensure_ascii=False).encode("utf-8")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.put(
                f"{OS_CONTROL_URL}/config/soul",
                content=payload,
                headers={**_os_control_headers(), "Content-Type": "application/json"},
            )
    except httpx.RequestError as exc:
        raise HTTPException(502, f"os-control agent unreachable: {exc}")
    return Response(content=r.content, status_code=r.status_code, media_type="application/json")


# -- operating mode (autonomy × profile × brain) --
# The agent validates against fixed allowlists + persists atomically. The rover-side
# mode-manager that ACTS on the mode is a separate node (documented follow-up).

@app.get("/api/modules/registry")
async def api_modules_registry():
    """Live module registry snapshot (registered modules + liveness), exported
    by the Core Hub and served read-only by the os-control agent."""
    _require_os_control()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{OS_CONTROL_URL}/registry", headers=_os_control_headers())
    except httpx.RequestError as exc:
        raise HTTPException(502, f"os-control agent unreachable: {exc}")
    return Response(content=r.content, status_code=r.status_code, media_type="application/json")


@app.get("/api/modes/active")
async def api_get_mode():
    _require_os_control()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{OS_CONTROL_URL}/config/mode", headers=_os_control_headers())
    except httpx.RequestError as exc:
        raise HTTPException(502, f"os-control agent unreachable: {exc}")
    return Response(content=r.content, status_code=r.status_code, media_type="application/json")


@app.put("/api/modes/active")
async def api_put_mode(body: ModeBody):
    _require_os_control()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.put(
                f"{OS_CONTROL_URL}/config/mode",
                json={"autonomy_level": body.autonomy_level,
                      "mission_profile": body.mission_profile, "brain": body.brain},
                headers=_os_control_headers(),
            )
    except httpx.RequestError as exc:
        raise HTTPException(502, f"os-control agent unreachable: {exc}")
    return Response(content=r.content, status_code=r.status_code, media_type="application/json")


# ---- SPA serving (mounted LAST so it never shadows the routes above) ----
if os.path.isfile(os.path.join(DIST, "index.html")):
    app.mount("/", SPAStaticFiles(directory=DIST, html=True), name="spa")
else:
    app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")

    @app.get("/", response_class=HTMLResponse)
    async def index():
        return open(os.path.join(HERE, "static", "index.html")).read()
