"""Tests for the bridge wire envelope — round-trip, tamper, and key isolation.

These prove the Command Center produces envelopes that verify under the same rules the
rover's protocol.py enforces (identical canonical-CBOR signing bytes).
"""

import time

import envelope as env


def _build(private_key, **overrides):
    args = dict(
        rover_id="MARK1-001",
        sender_id="OP-001",
        msg_id=1,
        nonce=1,
        issued_at=time.time(),
        expires_at=time.time() + env.DEFAULT_EXPIRY_S,
        payload={"class": "motion", "type": 1, "linear_velocity": 0.5},
        private_key=private_key,
    )
    args.update(overrides)
    return env.build_envelope(**args)


def test_roundtrip_encode_decode_verifies():
    priv_hex, pub_hex = env.generate_keypair()
    e = _build(env.private_key_from_hex(priv_hex))
    decoded = env.decode(env.encode(e))
    assert env.verify(decoded, env.public_key_from_hex(pub_hex)) is True


def test_required_fields_present():
    priv_hex, _ = env.generate_keypair()
    e = _build(env.private_key_from_hex(priv_hex))
    for field in ("protocol_version", "rover_id", "sender_id", "msg_id",
                  "nonce", "issued_at", "expires_at", "payload", "signature"):
        assert field in e
    assert e["protocol_version"]["major"] == env.PROTOCOL_MAJOR


def test_tampered_payload_fails_verify():
    priv_hex, pub_hex = env.generate_keypair()
    e = _build(env.private_key_from_hex(priv_hex))
    e["payload"] = {**e["payload"], "linear_velocity": 9.9}  # tamper after signing
    assert env.verify(e, env.public_key_from_hex(pub_hex)) is False


def test_wrong_key_fails_verify():
    signer_priv, _ = env.generate_keypair()
    _, other_pub = env.generate_keypair()
    e = _build(env.private_key_from_hex(signer_priv))
    assert env.verify(e, env.public_key_from_hex(other_pub)) is False


def test_tampered_nonce_fails_verify():
    priv_hex, pub_hex = env.generate_keypair()
    e = _build(env.private_key_from_hex(priv_hex))
    e["nonce"] = e["nonce"] + 1  # replay-style tamper
    assert env.verify(e, env.public_key_from_hex(pub_hex)) is False
