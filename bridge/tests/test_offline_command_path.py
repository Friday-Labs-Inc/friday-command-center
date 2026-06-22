"""Keystone P0 proof — the full command path authorizes with Frappe DOWN.

Mirrors dispatcher.api_command's authorize gate (cached-allowlist verify -> expiry ->
edge-nonce replay) over a REAL Ed25519 envelope. No broker, no Frappe. This is the
end-to-end evidence that a control-plane outage no longer blacks out commanding.
"""

import time

import requests

import envelope as env
from edge_cache import EdgeCache, EdgeNonce


class FlakyCP:
    def __init__(self, pub_hex):
        self.up = True
        self._allow = {"MARK1-001": [{"operator": "OP-001", "public_key": pub_hex, "epoch": 1}]}
        self.floor = {}

    def get_allowlist(self, rover):
        if not self.up:
            raise requests.ConnectionError("frappe down")
        return self._allow.get(rover, [])

    def get_nonce_floor(self, rover, operator):
        if not self.up:
            raise requests.ConnectionError("frappe down")
        return self.floor.get(f"{rover}::{operator}", 0)

    def set_nonce_floor(self, rover, operator, nonce):
        if not self.up:
            raise requests.ConnectionError("frappe down")
        k = f"{rover}::{operator}"
        self.floor[k] = max(self.floor.get(k, 0), int(nonce))
        return self.floor[k]


def _authorize(cache, nonces, envelope) -> str:
    """The same gate dispatcher.api_command runs, minus the broker publish."""
    rover, operator = envelope["rover_id"], envelope["sender_id"]
    allow = cache.get_allowlist(rover)
    pub_hex = {a["operator"]: a["public_key"] for a in allow}.get(operator)
    if not pub_hex or not env.verify(envelope, env.public_key_from_hex(pub_hex)):
        return "bad-signature"
    if time.time() > float(envelope.get("expires_at") or 0):
        return "expired"
    if not nonces.consume(rover, operator, int(envelope["nonce"])):
        return "replay"
    return "accepted"


def _signed_command(priv_hex, nonce, *, expires_in=env.DEFAULT_EXPIRY_S):
    now = time.time()
    return env.build_envelope(
        rover_id="MARK1-001", sender_id="OP-001", msg_id=nonce, nonce=nonce,
        issued_at=now, expires_at=now + expires_in,
        payload={"class": "motion", "v": 0.5, "w": 0.0},
        private_key=env.private_key_from_hex(priv_hex))


def _offline_rig(tmp_path):
    priv_hex, pub_hex = env.generate_keypair()
    cp = FlakyCP(pub_hex)
    cache = EdgeCache(cp, path=str(tmp_path / "c.json"))
    nonces = EdgeNonce(cp, path=str(tmp_path / "n.json"))
    cache.get_allowlist("MARK1-001")     # warm cache while online
    cp.up = False                        # <-- Frappe goes DOWN for the rest of the test
    return priv_hex, cache, nonces


def test_command_authorizes_with_frappe_down(tmp_path):
    priv_hex, cache, nonces = _offline_rig(tmp_path)
    nonce = nonces.issue("MARK1-001", "OP-001")          # issued offline
    assert nonce == 1
    assert _authorize(cache, nonces, _signed_command(priv_hex, nonce)) == "accepted"
    assert cache.online is False                          # ...and we really were offline


def test_replay_rejected_with_frappe_down(tmp_path):
    priv_hex, cache, nonces = _offline_rig(tmp_path)
    cmd = _signed_command(priv_hex, nonces.issue("MARK1-001", "OP-001"))
    assert _authorize(cache, nonces, cmd) == "accepted"
    assert _authorize(cache, nonces, cmd) == "replay"     # same envelope twice


def test_expired_rejected_with_frappe_down(tmp_path):
    priv_hex, cache, nonces = _offline_rig(tmp_path)
    cmd = _signed_command(priv_hex, nonces.issue("MARK1-001", "OP-001"), expires_in=-1)
    assert _authorize(cache, nonces, cmd) == "expired"


def test_forged_signature_rejected_with_frappe_down(tmp_path):
    priv_hex, cache, nonces = _offline_rig(tmp_path)
    wrong_priv, _ = env.generate_keypair()                # not the allowlisted key
    cmd = _signed_command(wrong_priv, nonces.issue("MARK1-001", "OP-001"))
    assert _authorize(cache, nonces, cmd) == "bad-signature"
