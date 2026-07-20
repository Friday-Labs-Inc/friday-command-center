"""Golden test vector for the locked FCC↔rover boundary contract (architect bridge,
turn 8). These constants are FROZEN and shared verbatim with the rover side, whose
rclpy/C++ encoder asserts the identical values — if either encoder drifts on any field
(key order, int encoding, bstr handling), this test catches it.

Construction rules the bytes encode:
  * payload/data are opaque CBOR bstr, signed verbatim — NEVER regenerated from the
    inner dict by a verifier (inner float width is out of the canonical contract).
  * timestamps are int64 epoch-ms (minimal CBOR uint, not float/bignum).
  * the OUTER map is RFC 8949 §4.2 canonical; signature is Ed25519 over those bytes.
"""

import envelope_v2 as env

# --- frozen test keypairs (NOT production) ---
OP_SEED_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
OP_PUB_HEX = "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8"
ROVER_SEED_HEX = "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"
ROVER_PUB_HEX = "29acbae141bccaf0b22e1a94d34d0bc7361e526d0bfe12c89794bc9322966dd7"

# --- frozen command vector ---
CMD_PAYLOAD = {"class": "motion", "v": 0.5, "w": -0.25}
CMD_PAYLOAD_BSTR_HEX = "a36176f938006177f9b40065636c617373666d6f74696f6e"
CMD_ISSUED_AT_MS = 1782777600000
CMD_EXPIRES_AT_MS = 1782777630000
CMD_SIGNING_BYTES_HEX = (
    "a8656e6f6e636501666d73675f6964686d73672d30303031677061796c6f61645818"
    "a36176f938006177f9b40065636c617373666d6f74696f6e68726f7665725f6964694d"
    "41524b312d303031696973737565645f61741b0000019f15d358006973656e6465725f"
    "69646c6f70657261746f72406663636a657870697265735f61741b0000019f15d3cd30"
    "7070726f746f636f6c5f76657273696f6ea3656d616a6f7200656d696e6f7201657061"
    "74636800"
)
CMD_SIGNATURE_HEX = (
    "81fc9c18505c1ebf645afeab532982715a72e0dbb5c7851fccc75aa08bbcfa04"
    "a6ce763dd934750f284768e976aa61a5ff394a1e52ba2600be2eaed9bb21ab0b"
)

# --- frozen telemetry vector ---
TLM_DATA = {"x": 1.5, "y": -2.25, "theta": 0.125}
TLM_DATA_BSTR_HEX = "a36178f93e006179f9c080657468657461f93000"
TLM_ISSUED_AT_MS = 1782777600500
TLM_SIGNING_BYTES_HEX = (
    "a5646461746154a36178f93e006179f9c080657468657461f93000646b696e64"
    "646f646f6d656e6f6e63650168726f7665725f6964694d41524b312d30303169"
    "6973737565645f61741b0000019f15d359f4"
)
TLM_SIGNATURE_HEX = (
    "ccce0f9c2ecff4b9461a8c22622acff43ef3f1dc6cf5daa5f232caf02c89d29f"
    "9c0567ff4e0e643750d28751b249acf988f645c13ac4d62973cebcd67fa9e70d"
)


def _op_priv():
    return env.private_key_from_hex(OP_SEED_HEX)


def _rover_priv():
    return env.private_key_from_hex(ROVER_SEED_HEX)


def test_pubkeys_derive_from_seeds():
    from cryptography.hazmat.primitives import serialization
    for priv, expect in ((_op_priv(), OP_PUB_HEX), (_rover_priv(), ROVER_PUB_HEX)):
        pub = priv.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()
        assert pub == expect


def test_command_payload_bstr_is_frozen():
    assert env.encode_payload(CMD_PAYLOAD).hex() == CMD_PAYLOAD_BSTR_HEX


def test_command_signing_bytes_and_signature_match_vector():
    cmd = env.build_command(
        rover_id="MARK1-001", sender_id="operator@fcc", msg_id="msg-0001", nonce=1,
        issued_at_ms=CMD_ISSUED_AT_MS, expires_at_ms=CMD_EXPIRES_AT_MS,
        payload_bstr=bytes.fromhex(CMD_PAYLOAD_BSTR_HEX), private_key=_op_priv(),
    )
    sb = env._outer_signing_bytes(cmd, "signature")
    assert sb.hex() == CMD_SIGNING_BYTES_HEX               # canonical outer bytes frozen
    assert cmd["signature"].hex() == CMD_SIGNATURE_HEX     # Ed25519 is deterministic
    assert env.verify_command(cmd, env.public_key_from_hex(OP_PUB_HEX)) is True


def test_command_outer_key_order_is_canonical():
    # length-in-head-byte ⇒ this order is both length-first and §4.2.1 bytewise.
    cmd = env.build_command(
        rover_id="MARK1-001", sender_id="operator@fcc", msg_id="msg-0001", nonce=1,
        issued_at_ms=CMD_ISSUED_AT_MS, expires_at_ms=CMD_EXPIRES_AT_MS,
        payload_bstr=bytes.fromhex(CMD_PAYLOAD_BSTR_HEX), private_key=_op_priv(),
    )
    import cbor2
    decoded = cbor2.loads(env._outer_signing_bytes(cmd, "signature"))
    assert list(decoded.keys()) == [
        "nonce", "msg_id", "payload", "rover_id",
        "issued_at", "sender_id", "expires_at", "protocol_version",
    ]


def test_telemetry_data_bstr_is_frozen():
    assert env.encode_payload(TLM_DATA).hex() == TLM_DATA_BSTR_HEX


def test_telemetry_signing_bytes_and_signature_match_vector():
    tlm = env.sign_telemetry(
        rover_id="MARK1-001", kind="odom", nonce=1, issued_at_ms=TLM_ISSUED_AT_MS,
        data_bstr=bytes.fromhex(TLM_DATA_BSTR_HEX), private_key=_rover_priv(),
    )
    sb = env._outer_signing_bytes(tlm, "sig")
    assert sb.hex() == TLM_SIGNING_BYTES_HEX
    assert tlm["sig"].hex() == TLM_SIGNATURE_HEX
    assert env.verify_telemetry(tlm, env.public_key_from_hex(ROVER_PUB_HEX)) is True


def test_payload_decodes_back_after_verify():
    assert env.decode_payload(bytes.fromhex(CMD_PAYLOAD_BSTR_HEX)) == CMD_PAYLOAD
    assert env.decode_payload(bytes.fromhex(TLM_DATA_BSTR_HEX)) == TLM_DATA


def test_tampered_payload_fails_verification():
    cmd = env.build_command(
        rover_id="MARK1-001", sender_id="operator@fcc", msg_id="msg-0001", nonce=1,
        issued_at_ms=CMD_ISSUED_AT_MS, expires_at_ms=CMD_EXPIRES_AT_MS,
        payload_bstr=bytes.fromhex(CMD_PAYLOAD_BSTR_HEX), private_key=_op_priv(),
    )
    tampered = {**cmd, "payload": env.encode_payload({"class": "motion", "v": 9.9, "w": 0.0})}
    assert env.verify_command(tampered, env.public_key_from_hex(OP_PUB_HEX)) is False
