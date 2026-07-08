"""Phase C — rover-telemetry signature verification.

The rover signs its telemetry with its key; the read gateway (which fetched the rover's
public key from the control plane) verifies and fans out ONLY verified telemetry. A
tampered (bad-sig) message is dropped.

Env: ROVER_PRIV (rover signing key, whose public half is on the Rover), MQTT_HOST.
The gateway must already be running (it fetches rover keys on connect).
"""

import asyncio
import json
import os
import time

import cbor2
import websockets

import envelope as env
from fake_rover import FakeRover


async def main() -> int:
    host = os.environ.get("MQTT_HOST", "127.0.0.1")
    rpriv = os.environ["ROVER_PRIV"]
    got = []

    async with websockets.connect("ws://127.0.0.1:8090/ws") as ws:
        rover = FakeRover(
            "MARK1-001", {}, host=host, port=8883, client_id="MARK1-001",
            tls={"ca": "certs/ca.crt", "cert": "certs/rover.crt", "key": "certs/rover.key"},
            signing_key_hex=rpriv,
        )
        rover.connect()
        await asyncio.sleep(2.0)

        # 1. valid signed odom -> should arrive, marked verified
        rover.emit_odom(1.45, 0.0, 0.0)

        # 2. tampered: sign {x:9.99}, then swap the payload bstr after signing -> bad sig -> dropped
        now_ms = int(time.time() * 1000)
        msg = env.sign_telemetry(
            rover_id="MARK1-001", msg_id=2, nonce=2, issued_at=now_ms,
            expires_at=now_ms + env.DEFAULT_EXPIRY_MS,
            payload=cbor2.dumps({"x": 9.99, "y": 0.0, "theta": 0.0}),
            private_key=env.private_key_from_hex(rpriv))
        msg["payload"] = cbor2.dumps({"x": 0.0, "y": 0.0, "theta": 0.0})  # tamper after signing
        rover.client.publish("mark1/MARK1-001/tlm/odom", cbor2.dumps(msg), qos=1)

        try:
            while True:
                got.append(json.loads(await asyncio.wait_for(ws.recv(), timeout=3)))
        except asyncio.TimeoutError:
            pass
        rover.disconnect()

    odoms = [g for g in got if g.get("kind") == "odom"]
    print("odom events received:", [(g["data"]["x"], g.get("verified")) for g in odoms])
    assert any(abs(g["data"]["x"] - 1.45) < 1e-6 and g.get("verified") is True for g in odoms), \
        "valid signed odom was not verified+delivered"
    assert not any(g["data"]["x"] == 0.0 for g in odoms), "tampered telemetry was NOT dropped"
    print("\nPHASE C TELEMETRY-SIG: PASS (valid signed telemetry verified; tampered dropped)")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
