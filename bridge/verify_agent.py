"""Phase C signing-agent verify — sign via the local agent (key in the OS keychain),
never in the client.

Mirrors the browser flow: enroll a key in the agent, then nonce -> envelope ->
sign-bytes (gateway) -> sign (AGENT; key stays in the keychain) -> dispatch -> rover OK.

Env: GW (gateway), AGENT (signing agent), MQTT_HOST, OP_PRIV (key to enroll).
"""

import os
import time

import requests
from cryptography.hazmat.primitives import serialization

import envelope as env
from fake_rover import FakeRover

GW = os.environ.get("GW", "http://127.0.0.1:8090")
AGENT = os.environ.get("AGENT", "http://127.0.0.1:7070")
ROVER, OPERATOR = "MARK1-001", "OP-001"


def main() -> int:
    host = os.environ.get("MQTT_HOST", "127.0.0.1")
    priv_hex = os.environ["OP_PRIV"]
    priv = env.private_key_from_hex(priv_hex)
    pub_hex = priv.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()

    e = requests.post(f"{AGENT}/enroll",
                      json={"operator": OPERATOR, "private_key_hex": priv_hex}, timeout=10).json()
    print(f"[1] enrolled in agent (key now in OS keychain); pubkey {e['public_key'][:16]}…")
    assert e["public_key"] == pub_hex

    rover = FakeRover(ROVER, {OPERATOR: pub_hex}, host=host, port=8883, client_id=ROVER,
                      tls={"ca": "certs/ca.crt", "cert": "certs/rover.crt", "key": "certs/rover.key"})
    rover.connect()
    time.sleep(1.0)

    n = requests.post(f"{GW}/api/nonce", json={"rover": ROVER, "operator": OPERATOR}, timeout=10).json()
    envelope = {
        "protocol_version": {"major": 0, "minor": 1, "patch": 0}, "rover_id": ROVER,
        "sender_id": OPERATOR, "msg_id": n["nonce"], "nonce": n["nonce"],
        "issued_at": n["issued_at"], "expires_at": n["expires_at"],
        "payload": {"class": "motion", "type": 1, "linear_velocity": 0.5, "angular_velocity": 0.0},
    }
    sb = requests.post(f"{GW}/api/sign-bytes", json={"envelope": envelope}, timeout=10).json()
    print("[2] got nonce + canonical signing bytes from gateway")

    sig = requests.post(f"{AGENT}/sign",
                        json={"operator": OPERATOR, "bytes_hex": sb["signing_hex"]},
                        timeout=10).json()["signature"]
    print("[3] signed via the agent (the client never saw the key)")

    res = requests.post(f"{GW}/api/command",
                        json={"envelope": envelope, "signature": sig}, timeout=10).json()
    print(f"[4] gateway verified + dispatched: {res}")
    time.sleep(1.0)

    e2, outcome = rover.received[-1]
    print(f"[5] rover validated -> {outcome} (nonce {e2['nonce']})")
    rover.disconnect()
    assert outcome == "OK", f"rover rejected: {outcome}"

    print("\nPHASE C SIGNING-AGENT: PASS (key in OS keychain via local agent; never in the client)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
