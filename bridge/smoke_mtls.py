"""Phase B hardening: mutual-TLS broker smoke.

Connects the bridge + rover to EMQX over the TLS listener (:8883) with their client
certs (CN = fcc-bridge / MARK1-001), and runs the signed command path. Proves that the
mTLS + ACL path works end-to-end for authorized clients on their own topics.

Env: CP_BASE, CP_KEY, CP_SECRET, OP_PRIV, MQTT_HOST (default 127.0.0.1).
"""

import os
import time

import envelope as env
from bridge import CommandCenterBridge
from control_plane import ControlPlane
from fake_rover import FakeRover

ROVER = "MARK1-001"
OPERATOR = "OP-001"
CERTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "certs")


def _tls(name):
    return {"ca": f"{CERTS}/ca.crt", "cert": f"{CERTS}/{name}.crt", "key": f"{CERTS}/{name}.key"}


def main() -> int:
    cp = ControlPlane(os.environ["CP_BASE"], os.environ["CP_KEY"], os.environ["CP_SECRET"])
    host = os.environ.get("MQTT_HOST", "127.0.0.1")
    op_priv = env.private_key_from_hex(os.environ["OP_PRIV"])
    op_keys = {a["operator"]: a["public_key"] for a in cp.get_allowlist(ROVER)}

    rover = FakeRover(ROVER, op_keys, host=host, port=8883, client_id=ROVER, tls=_tls("rover"))
    rover.connect()
    bridge = CommandCenterBridge(cp, host=host, port=8883, client_id="fcc-bridge", tls=_tls("bridge"))
    bridge.connect()
    time.sleep(1.2)

    nonce = bridge.send_command(
        rover=ROVER, operator=OPERATOR, command_class="motion",
        payload={"class": "motion", "type": 1, "linear_velocity": 0.5},
        operator_private_key=op_priv,
    )
    time.sleep(1.2)

    assert rover.received and rover.received[-1][1] == "OK", "command not accepted over mTLS"
    print(f"[mTLS] command accepted over :8883 with client certs (nonce {nonce})")
    assert bridge.acks, "no ack received over mTLS"
    print(f"[mTLS] ack ingested over TLS: {bridge.acks[-1][1]}")

    bridge.disconnect()
    rover.disconnect()
    print("\nPHASE B mTLS SMOKE: PASS (mutual-TLS command path on :8883)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
