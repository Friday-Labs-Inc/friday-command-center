"""Phase C write-path verify — simulate the browser's client-side-signed command flow.

Mirrors exactly what the browser JS does (Web Crypto Ed25519), using the cryptography lib
to sign: request a nonce from the gateway, build the envelope, fetch the canonical signing
bytes from the gateway, sign them locally (the private key never goes to the gateway), and
dispatch — while a stand-in rover validates the published command.

Env: GW (gateway URL, default http://127.0.0.1:8090), OP_PRIV, MQTT_HOST.
"""

import os
import time

import requests
from cryptography.hazmat.primitives import serialization

import envelope as env
from fake_rover import FakeRover

GW = os.environ.get("GW", "http://127.0.0.1:8090")
ROVER, OPERATOR = "MARK1-001", "OP-001"


def post(path, body):
    r = requests.post(f"{GW}{path}", json=body, timeout=10)
    r.raise_for_status()
    return r.json()


def main() -> int:
    host = os.environ.get("MQTT_HOST", "127.0.0.1")
    priv = env.private_key_from_hex(os.environ["OP_PRIV"])
    pub_hex = priv.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()

    rover = FakeRover(ROVER, {OPERATOR: pub_hex}, host=host, port=8883, client_id=ROVER,
                      tls={"ca": "certs/ca.crt", "cert": "certs/rover.crt", "key": "certs/rover.key"})
    rover.connect()
    time.sleep(1.0)

    n = post("/api/nonce", {"rover": ROVER, "operator": OPERATOR})
    print(f"[1] nonce from control plane via gateway: {n['nonce']}")
    envelope = {
        "protocol_version": {"major": 0, "minor": 1, "patch": 0},
        "rover_id": ROVER, "sender_id": OPERATOR, "msg_id": n["nonce"], "nonce": n["nonce"],
        "issued_at": n["issued_at"], "expires_at": n["expires_at"],
        "payload": {"class": "motion", "type": 1, "linear_velocity": 0.5, "angular_velocity": 0.0},
    }
    sb = post("/api/sign-bytes", {"envelope": envelope})
    print(f"[2] gateway returned canonical signing bytes ({len(sb['signing_hex']) // 2} bytes)")

    # SIGN locally — the private key never leaves the client (here, this process).
    signature = priv.sign(bytes.fromhex(sb["signing_hex"])).hex()
    print("[3] signed locally with the operator key (key never sent to the gateway)")

    res = post("/api/command", {"envelope": envelope, "signature": signature})
    print(f"[4] gateway verified + dispatched: {res}")
    time.sleep(1.0)

    assert rover.received, "rover received no command"
    e, outcome = rover.received[-1]
    print(f"[5] rover validated the dispatched command -> {outcome} (nonce {e['nonce']})")
    rover.disconnect()
    assert outcome == "OK", f"rover rejected: {outcome}"

    print("\nPHASE C WRITE-PATH: PASS "
          "(browser-signed command -> gateway -> rover; private key never left the client)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
