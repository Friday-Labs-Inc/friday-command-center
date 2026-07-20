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
import datetime
import json
import os
import time
from contextlib import asynccontextmanager

import aiomqtt
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

# ── Self-signing mission dispatch (OP-DEMO-001) ──────────────────────────────
# The FCC signs mission commands directly using a provisioned operator key so
# dispatch works without a running client-side signing agent.
_OP_MISSION_ID = "OP-DEMO-001"
_OP_MISSION_KEY = None   # loaded at startup; None if key file missing

MISSION_EXPIRY_S = 60.0   # mission commands are longer-lived than motion (30 s)


def _load_op_mission_key():
    path = os.path.join(STATE_DIR, "op-demo-001.key")
    try:
        return env.private_key_from_hex(open(path).read().strip())
    except (OSError, ValueError) as exc:
        print(f"[mission] cannot load operator key from {path}: {exc}")
        return None


def _next_mission_nonce() -> int:
    """Monotonic, durable nonce for mission envelopes (separate from motion nonces)."""
    path = os.path.join(STATE_DIR, "mission_nonce.json")
    try:
        data = json.loads(open(path).read())
    except (OSError, ValueError):
        data = {}
    nonce = data.get(_OP_MISSION_ID, 0) + 1
    data[_OP_MISSION_ID] = nonce
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    return nonce


def _new_mission_id(nonce: int) -> str:
    year = datetime.datetime.now(datetime.timezone.utc).year
    return f"MSN-{year}-{nonce:05d}"


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
    global _OP_MISSION_KEY
    _OP_MISSION_KEY = _load_op_mission_key()
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
    _require_cp()
    nonce = await asyncio.to_thread(_NONCE.issue, req.rover, req.operator)
    now = time.time()
    return {"nonce": nonce, "issued_at": now, "expires_at": now + env.DEFAULT_EXPIRY_S}


@app.post("/api/sign-bytes")
async def api_sign_bytes(req: SignReq):
    return {"signing_hex": env._signing_bytes(req.envelope).hex()}


class MissionDispatchReq(BaseModel):
    rover_id: str
    zone: list[float]           # [x0, y0, x1, y1] MAP-frame metres
    zone_gps: list[float] | None = None  # [lat0, lon0, lat1, lon1]
    lane_spacing_m: float = 3.0
    speed: float = 0.28


class MissionAbortReq(BaseModel):
    rover_id: str
    mission_id: str


class ModeDispatchReq(BaseModel):
    rover_id: str
    autonomy_level: int          # 0..3
    mission_profile: str = "Bench"
    brain: str = "Rules"


class MissionApproveReq(BaseModel):
    rover_id: str
    mission_id: str
    decision: str                # 'approve' | 'deny'
    waypoint_i: int | None = None


@app.post("/api/mission/dispatch")
async def api_mission_dispatch(req: MissionDispatchReq):
    if _OP_MISSION_KEY is None:
        raise HTTPException(503, "mission operator key not loaded (missing state/op-demo-001.key)")
    client = _state["mqtt"]
    if client is None:
        raise HTTPException(503, "broker not connected")

    nonce = await asyncio.to_thread(_next_mission_nonce)
    mission_id = _new_mission_id(nonce)
    now = time.time()
    payload = {
        "class": "mission", "op": "survey_start",
        "mission_id": mission_id,
        "zone": req.zone,
        "lane_spacing_m": req.lane_spacing_m,
        "speed": req.speed,
    }
    if req.zone_gps is not None:
        payload["zone_gps"] = req.zone_gps

    envelope = env.build_envelope(
        rover_id=req.rover_id,
        sender_id=_OP_MISSION_ID,
        msg_id=nonce,
        nonce=nonce,
        issued_at=now,
        expires_at=now + MISSION_EXPIRY_S,
        payload=payload,
        private_key=_OP_MISSION_KEY,
    )
    await client.publish(
        f"mark1/{req.rover_id}/cmd/mission", env.encode(envelope), qos=1)

    # Best-effort Frappe mission record (gap if CP not configured)
    if _CP is not None:
        try:
            await asyncio.to_thread(
                _CP.upload_mission, mission_id, req.rover_id, None, json.dumps(payload))
        except Exception as exc:  # noqa: BLE001
            print(f"[mission] Frappe record skipped: {exc}")

    return {"ok": True, "mission_id": mission_id, "nonce": nonce}


@app.post("/api/mission/abort")
async def api_mission_abort(req: MissionAbortReq):
    if _OP_MISSION_KEY is None:
        raise HTTPException(503, "mission operator key not loaded (missing state/op-demo-001.key)")
    client = _state["mqtt"]
    if client is None:
        raise HTTPException(503, "broker not connected")

    nonce = await asyncio.to_thread(_next_mission_nonce)
    now = time.time()
    payload = {"class": "mission", "op": "abort", "mission_id": req.mission_id}
    envelope = env.build_envelope(
        rover_id=req.rover_id,
        sender_id=_OP_MISSION_ID,
        msg_id=nonce,
        nonce=nonce,
        issued_at=now,
        expires_at=now + MISSION_EXPIRY_S,
        payload=payload,
        private_key=_OP_MISSION_KEY,
    )
    await client.publish(
        f"mark1/{req.rover_id}/cmd/mission", env.encode(envelope), qos=1)
    return {"ok": True, "mission_id": req.mission_id, "nonce": nonce}


@app.post("/api/mission/approve")
async def api_mission_approve(req: MissionApproveReq):
    """L2 Supervised: operator approves/denies the pending waypoint. Signs a
    cmd/mission op=approve|deny; the rover's mission executor releases (approve)
    or skips (deny) the waypoint it paused on."""
    if _OP_MISSION_KEY is None:
        raise HTTPException(503, "mission operator key not loaded")
    client = _state["mqtt"]
    if client is None:
        raise HTTPException(503, "broker not connected")
    if req.decision not in ("approve", "deny"):
        raise HTTPException(400, "decision must be approve|deny")
    nonce = await asyncio.to_thread(_next_mission_nonce)
    now = time.time()
    payload = {"class": "mission", "op": req.decision, "mission_id": req.mission_id}
    if req.waypoint_i is not None:
        payload["waypoint_i"] = req.waypoint_i
    envelope = env.build_envelope(
        rover_id=req.rover_id, sender_id=_OP_MISSION_ID,
        msg_id=nonce, nonce=nonce, issued_at=now,
        expires_at=now + MISSION_EXPIRY_S, payload=payload,
        private_key=_OP_MISSION_KEY,
    )
    await client.publish(
        f"mark1/{req.rover_id}/cmd/mission", env.encode(envelope), qos=1)
    return {"ok": True, "mission_id": req.mission_id, "decision": req.decision, "nonce": nonce}



@app.post("/api/mode/dispatch")
async def api_mode_dispatch(req: ModeDispatchReq):
    """Dispatch a signed autonomy-mode command to the rover. Mirrors mission
    dispatch: the rover's command router applies it (publishes the enforced
    autonomy level + gates motion). This is what makes the FCC mode ACT."""
    if _OP_MISSION_KEY is None:
        raise HTTPException(503, "operator key not loaded (missing state/op-demo-001.key)")
    client = _state["mqtt"]
    if client is None:
        raise HTTPException(503, "broker not connected")
    if req.autonomy_level not in (0, 1, 2, 3):
        raise HTTPException(400, "autonomy_level must be 0..3")

    nonce = await asyncio.to_thread(_next_mission_nonce)
    now = time.time()
    payload = {
        "class": "mode",
        "autonomy_level": req.autonomy_level,
        "mission_profile": req.mission_profile,
        "brain": req.brain,
    }
    envelope = env.build_envelope(
        rover_id=req.rover_id, sender_id=_OP_MISSION_ID,
        msg_id=nonce, nonce=nonce, issued_at=now,
        expires_at=now + MISSION_EXPIRY_S, payload=payload,
        private_key=_OP_MISSION_KEY,
    )
    await client.publish(
        f"mark1/{req.rover_id}/cmd/mode", env.encode(envelope), qos=1)
    return {"ok": True, "autonomy_level": req.autonomy_level, "nonce": nonce}

@app.post("/api/command")
async def api_command(req: CommandReq):
    cp = _require_cp()
    envelope = dict(req.envelope)
    envelope["signature"] = bytes.fromhex(req.signature)
    rover = envelope["rover_id"]
    operator = envelope["sender_id"]

    allow = await asyncio.to_thread(_CACHE.get_allowlist, rover)
    pub_hex = {a["operator"]: a["public_key"] for a in allow}.get(operator)
    if not pub_hex or not env.verify(envelope, env.public_key_from_hex(pub_hex)):
        raise HTTPException(400, "signature invalid or operator not allowlisted")

    # Reject stale or replayed commands at the dispatcher (not only at the rover). The
    # signature verified above, so now enforce freshness on the control-plane-owned nonce.
    if time.time() > float(envelope.get("expires_at") or 0):
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
    cmd_class = (envelope.get("payload") or {}).get("class", "motion")
    await client.publish(f"mark1/{rover}/cmd/{cmd_class}", env.encode(envelope), qos=1)

    # The command is already on the wire; an offline audit must not fail it. The edge
    # cache let us authorize offline, so the audit can lag and be reconciled later.
    audited = True
    try:
        await asyncio.to_thread(
            cp.record_command, rover=rover, operator=operator, command_class=cmd_class,
            nonce=envelope["nonce"], outcome="Accepted", category="OK",
            msg_id=envelope.get("msg_id"), payload=json.dumps(envelope.get("payload")),
            signature=req.signature,
        )
    except (requests.ConnectionError, requests.Timeout) as exc:
        audited = False
        print("[edge] command published; audit deferred (control plane offline):", exc)
    return {"ok": True, "nonce": envelope["nonce"], "audited": audited}
