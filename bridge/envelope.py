"""Command Center wire envelope — Ed25519-signed CBOR.

A byte-for-byte mirror of the rover's
`src/friday_telemetry/friday_telemetry/protocol.py`: the Command Center is the
producer of valid command envelopes and the consumer of telemetry/ack envelopes, so
both ends MUST sign over identical bytes. The signature covers the whole envelope
minus the `signature` field, encoded as canonical CBOR.

No private keys are persisted here — operators sign client-side; the bridge only ever
holds public keys (to verify rover telemetry) and, in the dev/server-signing path, a
provisioned key passed in explicitly.
"""

from __future__ import annotations

import cbor2
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

# Must match the rover's protocol.py exactly.
PROTOCOL_MAJOR = 0
PROTOCOL_MINOR = 1
PROTOCOL_PATCH = 0
DEFAULT_EXPIRY_MS = 30_000
SKEW_MS = 5_000


def _signing_bytes(envelope: dict) -> bytes:
    """Canonical bytes the signature covers: the envelope minus `signature`."""
    unsigned = {k: v for k, v in envelope.items() if k != "signature"}
    return cbor2.dumps(unsigned, canonical=True)


def build_envelope(
    *, rover_id, sender_id, msg_id, nonce, issued_at, expires_at, payload,
    private_key: Ed25519PrivateKey,
) -> dict:
    """Build and sign a command/telemetry envelope.

    payload must be pre-serialized CBOR bytes (cbor2.dumps before calling).
    issued_at and expires_at must be int64 epoch-milliseconds, not float seconds.
    """
    if not isinstance(payload, (bytes, bytearray)):
        raise TypeError(
            "payload must be pre-serialized bytes (opaque CBOR bstr), not "
            f"{type(payload).__name__} — re-encoding it breaks cross-language signatures")
    if not (isinstance(issued_at, int) and isinstance(expires_at, int)):
        raise TypeError("issued_at/expires_at must be int64 epoch-ms, not float")
    envelope = {
        "protocol_version": {
            "major": PROTOCOL_MAJOR, "minor": PROTOCOL_MINOR, "patch": PROTOCOL_PATCH,
        },
        "rover_id": rover_id,
        "sender_id": sender_id,
        "msg_id": msg_id,
        "nonce": nonce,
        "issued_at": issued_at,
        "expires_at": expires_at,
        "payload": payload,
    }
    envelope["signature"] = private_key.sign(_signing_bytes(envelope))
    return envelope


def sign_telemetry(*, rover_id, msg_id, nonce, issued_at, expires_at, payload,
                   private_key: Ed25519PrivateKey) -> dict:
    """Build a signed telemetry envelope using the unified envelope format.

    Telemetry uses the same wire envelope as commands; sender_id is set to rover_id.
    payload must be pre-serialized CBOR bytes.
    """
    return build_envelope(
        rover_id=rover_id, sender_id=rover_id, msg_id=msg_id, nonce=nonce,
        issued_at=issued_at, expires_at=expires_at, payload=payload,
        private_key=private_key,
    )


def encode(envelope: dict) -> bytes:
    """Serialize an envelope to wire bytes (CBOR)."""
    return cbor2.dumps(envelope)


def decode(raw: bytes) -> dict:
    """Deserialize wire bytes to an envelope dict."""
    return cbor2.loads(raw)


def verify(envelope: dict, public_key: Ed25519PublicKey) -> bool:
    """True iff the envelope's signature is valid for `public_key`."""
    try:
        public_key.verify(envelope["signature"], _signing_bytes(envelope))
        return True
    except (InvalidSignature, KeyError, TypeError):
        return False


def verify_telemetry(envelope: dict, public_key: Ed25519PublicKey) -> bool:
    """True iff the telemetry envelope's signature is valid for `public_key`.

    Telemetry now uses the same unified envelope shape as commands; this delegates
    to verify() for a consistent single code path.
    """
    return verify(envelope, public_key)


# ---- key helpers (hex <-> key objects), matching the operator allowlist format ----
def public_key_from_hex(hex_str: str) -> Ed25519PublicKey:
    return Ed25519PublicKey.from_public_bytes(bytes.fromhex(hex_str))


def private_key_from_hex(hex_str: str) -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(bytes.fromhex(hex_str))


def generate_keypair() -> tuple[str, str]:
    """Return (private_hex, public_hex) for a fresh Ed25519 key (dev/test only)."""
    priv = Ed25519PrivateKey.generate()
    priv_hex = priv.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    ).hex()
    pub_hex = priv.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    ).hex()
    return priv_hex, pub_hex
