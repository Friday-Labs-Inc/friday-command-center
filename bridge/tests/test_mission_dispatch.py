"""Mission payload sign → validate round trip.

Mirrors the rover's CommandValidator semantics (protocol.py rules):
  sender_id must be in the allowlist, signature must verify,
  nonce must be strictly increasing, expiry must be in the future.
No MQTT, no broker, no pytest-asyncio needed.
"""

import time

import envelope as env


ROVER_ID = "MARK1-SIM-001"
OPERATOR_ID = "OP-DEMO-001"


def _allowlist_and_key():
    priv_hex, pub_hex = env.generate_keypair()
    allowlist = {OPERATOR_ID: env.public_key_from_hex(pub_hex)}
    priv = env.private_key_from_hex(priv_hex)
    return allowlist, priv, pub_hex


def _build_survey(priv, nonce=1, zone=None, expiry_offset=60.0):
    zone = zone or [-15.0, -15.0, 15.0, 15.0]
    now = time.time()
    payload = {
        "class": "mission", "op": "survey_start",
        "mission_id": f"MSN-2026-{nonce:05d}",
        "zone": zone,
        "lane_spacing_m": 3.0,
        "speed": 0.28,
    }
    return env.build_envelope(
        rover_id=ROVER_ID,
        sender_id=OPERATOR_ID,
        msg_id=nonce,
        nonce=nonce,
        issued_at=now,
        expires_at=now + expiry_offset,
        payload=payload,
        private_key=priv,
    )


class _NonceStore:
    """Minimal nonce floor tracker (mirrors rover's NonceStore semantics)."""
    def __init__(self):
        self._last = {}

    def last(self, sender):
        return self._last.get(sender)

    def commit(self, sender, nonce):
        self._last[sender] = nonce


def _validate(envelope_dict, allowlist, nonce_store=None):
    """Replica of CommandValidator.validate without importing the rover package."""
    pv = envelope_dict.get("protocol_version", {})
    if pv.get("major") != env.PROTOCOL_MAJOR:
        return False, "PROTOCOL_MISMATCH"
    if envelope_dict.get("rover_id") != ROVER_ID:
        return False, "ROVER_MISMATCH"
    sender = envelope_dict.get("sender_id")
    pub = allowlist.get(sender)
    if pub is None:
        return False, "UNKNOWN_SENDER"
    if not env.verify(envelope_dict, pub):
        return False, "SECURITY_AUTH"
    if float(envelope_dict.get("expires_at", 0)) < time.time():
        return False, "EXPIRED"
    if nonce_store is not None:
        nonce = envelope_dict.get("nonce")
        last = nonce_store.last(sender)
        if last is not None and nonce <= last:
            return False, "SECURITY_REPLAY"
        nonce_store.commit(sender, nonce)
    return True, "OK"


# ── tests ──────────────────────────────────────────────────────────────────────

def test_survey_start_round_trip():
    allowlist, priv, _ = _allowlist_and_key()
    e = _build_survey(priv, nonce=1)
    wire = env.encode(e)
    decoded = env.decode(wire)
    ok, cat = _validate(decoded, allowlist)
    assert ok, cat
    assert decoded["payload"]["class"] == "mission"
    assert decoded["payload"]["op"] == "survey_start"
    assert decoded["payload"]["zone"] == [-15.0, -15.0, 15.0, 15.0]


def test_abort_round_trip():
    allowlist, priv, _ = _allowlist_and_key()
    nonce_store = _NonceStore()
    start = _build_survey(priv, nonce=1)
    ok, _ = _validate(start, allowlist, nonce_store)
    assert ok

    now = time.time()
    abort_payload = {"class": "mission", "op": "abort", "mission_id": "MSN-2026-00001"}
    abort_env = env.build_envelope(
        rover_id=ROVER_ID, sender_id=OPERATOR_ID,
        msg_id=2, nonce=2, issued_at=now, expires_at=now + 60,
        payload=abort_payload, private_key=priv,
    )
    ok, cat = _validate(abort_env, allowlist, nonce_store)
    assert ok, cat
    assert abort_env["payload"]["op"] == "abort"


def test_unknown_operator_rejected():
    allowlist, priv, _ = _allowlist_and_key()
    _, other_priv, _ = _allowlist_and_key()
    # sign with 'other_priv' but the allowlist only has 'priv'
    e = _build_survey(other_priv, nonce=1)
    ok, cat = _validate(e, allowlist)
    assert not ok
    assert cat == "SECURITY_AUTH"


def test_tampered_zone_rejected():
    allowlist, priv, _ = _allowlist_and_key()
    e = _build_survey(priv, nonce=1)
    e["payload"] = {**e["payload"], "zone": [-99.0, -99.0, 99.0, 99.0]}
    ok, cat = _validate(e, allowlist)
    assert not ok
    assert cat == "SECURITY_AUTH"


def test_replay_rejected():
    allowlist, priv, _ = _allowlist_and_key()
    nonce_store = _NonceStore()
    e = _build_survey(priv, nonce=5)
    ok, _ = _validate(e, allowlist, nonce_store)
    assert ok
    # replay the same nonce
    e2 = _build_survey(priv, nonce=5)
    ok2, cat = _validate(e2, allowlist, nonce_store)
    assert not ok2
    assert cat == "SECURITY_REPLAY"


def test_expired_rejected():
    allowlist, priv, _ = _allowlist_and_key()
    e = _build_survey(priv, nonce=1, expiry_offset=-1.0)  # already expired
    ok, cat = _validate(e, allowlist)
    assert not ok
    assert cat == "EXPIRED"


def test_zone_gps_optional():
    allowlist, priv, _ = _allowlist_and_key()
    now = time.time()
    payload = {
        "class": "mission", "op": "survey_start",
        "mission_id": "MSN-2026-00001",
        "zone": [-15.0, -15.0, 15.0, 15.0],
        "zone_gps": [12.34, 56.78, 12.35, 56.79],
        "lane_spacing_m": 3.0, "speed": 0.28,
    }
    e = env.build_envelope(
        rover_id=ROVER_ID, sender_id=OPERATOR_ID,
        msg_id=1, nonce=1, issued_at=now, expires_at=now + 60,
        payload=payload, private_key=priv,
    )
    wire = env.encode(e)
    decoded = env.decode(wire)
    ok, cat = _validate(decoded, allowlist)
    assert ok, cat
    assert decoded["payload"]["zone_gps"] == [12.34, 56.78, 12.35, 56.79]
