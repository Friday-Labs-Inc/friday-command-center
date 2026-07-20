"""Boundary-contract v0.1.0 envelope — the locked FCC↔rover wire format.

This is the NEW contract negotiated on the architect bridge (turns 1–10), NOT yet cut
over on the live path — `envelope.py` (legacy) still serves production until the
dispatcher/gateway/SPA are migrated together and the rover side ships. This module is
the proven-correct encoder + the thing `tests/test_golden_vector.py` locks; the rover's
rclpy/C++ encoder asserts the identical constants.

How it differs from legacy `envelope.py`:
  * Timestamps are **int64 Unix epoch-milliseconds (UTC)**, never floats — one canonical
    CBOR uint encoding across every language.
  * `payload` (command) and `data` (telemetry) are carried as an **opaque CBOR byte
    string (bstr, major type 2)**: the producer serializes the inner object ONCE, those
    exact bytes travel and are what the signature covers, and the verifier checks the sig
    over the received bstr WITHOUT decode→re-encode. So no float (e.g. an odom pose) ever
    crosses a re-encode on the signature path, and only the OUTER map must be canonical.

Canonicalization: `cbor2.dumps(outer, canonical=True)` — RFC 8949 §4.2 deterministic
(map keys sorted by bytewise order of their encoded form, minimal-int, definite-length).
The signature covers the outer map with the signature field absent.
"""

from __future__ import annotations

import cbor2
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

# Must match the rover's protocol_version exactly.
PROTOCOL_MAJOR = 0
PROTOCOL_MINOR = 1
PROTOCOL_PATCH = 0

DEFAULT_EXPIRY_MS = 30_000   # command freshness window
SKEW_MS = 5_000              # ±5 s clock-skew tolerance, both directions, both paths


def _outer_signing_bytes(outer: dict, sig_field: str) -> bytes:
    """Canonical bytes the signature covers: the outer map minus its signature field.
    `payload`/`data` are already bytes (bstr) here, so they pass through verbatim."""
    unsigned = {k: v for k, v in outer.items() if k != sig_field}
    return cbor2.dumps(unsigned, canonical=True)


def encode_payload(payload) -> bytes:
    """Serialize an inner payload/data object to its authoritative CBOR bytes — ONCE.
    On the wire the producer's bytes are authoritative and travel verbatim; this helper
    is for producers/fixtures. Verifiers must NEVER re-encode a received payload."""
    return cbor2.dumps(payload, canonical=True)


def decode_payload(payload_bstr: bytes):
    """Decode an opaque payload/data bstr back to its object — for application use only,
    AFTER the signature has verified over the bstr."""
    return cbor2.loads(payload_bstr)


# ---- commands (operator-signed) ----
def build_command(
    *, rover_id, sender_id, msg_id, nonce, issued_at_ms, expires_at_ms,
    payload_bstr: bytes, private_key: Ed25519PrivateKey,
) -> dict:
    """Build and sign a command envelope. `payload_bstr` is opaque CBOR bytes
    (use `encode_payload` to produce it from an object)."""
    outer = {
        "protocol_version": {
            "major": PROTOCOL_MAJOR, "minor": PROTOCOL_MINOR, "patch": PROTOCOL_PATCH,
        },
        "rover_id": rover_id,
        "sender_id": sender_id,
        "msg_id": msg_id,
        "nonce": nonce,
        "issued_at": issued_at_ms,
        "expires_at": expires_at_ms,
        "payload": payload_bstr,
    }
    outer["signature"] = private_key.sign(_outer_signing_bytes(outer, "signature"))
    return outer


def verify_command(outer: dict, public_key: Ed25519PublicKey) -> bool:
    """True iff the command's signature is valid for `public_key`. Does not re-encode
    the payload bstr — checks over the received bytes."""
    try:
        public_key.verify(outer["signature"], _outer_signing_bytes(outer, "signature"))
        return True
    except (InvalidSignature, KeyError, TypeError):
        return False


# ---- telemetry (rover-signed) ----
def sign_telemetry(
    *, rover_id, kind, nonce, issued_at_ms, data_bstr: bytes,
    private_key: Ed25519PrivateKey,
) -> dict:
    """Build and sign a telemetry envelope. `data_bstr` is opaque CBOR bytes."""
    outer = {
        "rover_id": rover_id,
        "kind": kind,
        "nonce": nonce,
        "issued_at": issued_at_ms,
        "data": data_bstr,
    }
    outer["sig"] = private_key.sign(_outer_signing_bytes(outer, "sig"))
    return outer


def verify_telemetry(outer: dict, public_key: Ed25519PublicKey) -> bool:
    try:
        public_key.verify(outer["sig"], _outer_signing_bytes(outer, "sig"))
        return True
    except (InvalidSignature, KeyError, TypeError):
        return False


# ---- wire (de)serialization of the whole outer envelope ----
def encode(outer: dict) -> bytes:
    return cbor2.dumps(outer)


def decode(raw: bytes) -> dict:
    return cbor2.loads(raw)


# ---- key helpers (hex <-> key objects), matching the allowlist format ----
def public_key_from_hex(hex_str: str) -> Ed25519PublicKey:
    return Ed25519PublicKey.from_public_bytes(bytes.fromhex(hex_str))


def private_key_from_hex(hex_str: str) -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(bytes.fromhex(hex_str))
