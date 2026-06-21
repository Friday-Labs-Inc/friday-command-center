"""Local signing agent — keeps the operator's Ed25519 key in the OS keystore (macOS
Keychain via the `security` CLI) and signs on request. The key never enters the browser:
the console sends the bytes to sign and gets back only a signature.

This is the blueprint's "local signing agent" pattern. Runs on localhost only; CORS is
scoped to the console origin.

Threat notes (production hardening, not done here):
  * use a hardware token (PKCS#11 / PIV / Secure Enclave) so the key is non-extractable;
  * authenticate the caller (a per-session token from the console) — CORS alone does not
    stop another local page from *triggering* a signature, only from reading it;
  * scope keychain ACL to the signed agent binary (`-T`) instead of `-A`.

Run:  PYTHONPATH=. .venv/bin/uvicorn signing_agent:app --port 7070
"""

from __future__ import annotations

import os
import subprocess

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

SERVICE = "friday-cc-signer"
CONSOLE_ORIGINS = os.environ.get(
    "CONSOLE_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")

app = FastAPI(title="Friday CC — local signing agent")
app.add_middleware(
    CORSMiddleware, allow_origins=CONSOLE_ORIGINS, allow_methods=["*"], allow_headers=["*"]
)


def _store_key(operator: str, hex_: str):
    # -A: accessible without a keychain prompt (DEV ONLY; production scopes with -T).
    subprocess.run(
        ["security", "add-generic-password", "-U", "-A", "-s", SERVICE, "-a", operator, "-w", hex_],
        check=True, capture_output=True,
    )


def _get_key(operator: str) -> str | None:
    r = subprocess.run(
        ["security", "find-generic-password", "-s", SERVICE, "-a", operator, "-w"],
        capture_output=True, text=True,
    )
    return r.stdout.strip() if r.returncode == 0 else None


def _pub_hex(priv: Ed25519PrivateKey) -> str:
    return priv.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()


class Enroll(BaseModel):
    operator: str
    private_key_hex: str


class SignReq(BaseModel):
    operator: str
    bytes_hex: str


@app.post("/enroll")
def enroll(req: Enroll):
    """Store an operator key in the keychain (one-time). Returns the public key to
    register in the control-plane allowlist."""
    try:
        priv = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(req.private_key_hex))
    except ValueError:
        raise HTTPException(400, "invalid Ed25519 private key hex")
    _store_key(req.operator, req.private_key_hex)
    return {"operator": req.operator, "public_key": _pub_hex(priv), "enrolled": True}


@app.get("/status/{operator}")
def status(operator: str):
    hex_ = _get_key(operator)
    if not hex_:
        return {"operator": operator, "enrolled": False}
    priv = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(hex_))
    return {"operator": operator, "enrolled": True, "public_key": _pub_hex(priv)}


@app.post("/sign")
def sign(req: SignReq):
    """Sign bytes with the keychain-held operator key. The key is never returned."""
    hex_ = _get_key(req.operator)
    if not hex_:
        raise HTTPException(404, f"operator {req.operator} not enrolled in this agent")
    priv = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(hex_))
    return {"signature": priv.sign(bytes.fromhex(req.bytes_hex)).hex()}
