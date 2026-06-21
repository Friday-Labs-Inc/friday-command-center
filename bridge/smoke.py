"""Phase B end-to-end smoke: control plane -> bridge -> EMQX -> rover -> ack.

Proves the full data-plane path with the real broker and the real control plane:
  1. read the allowlist from the control plane (Frappe REST),
  2. bridge asks the control plane for a nonce, signs + publishes a command,
  3. the stand-in rover validates the signature + nonce and acks,
  4. the bridge ingests the ack,
  5. a replayed (reused-nonce) command is rejected by the rover.

Env: CP_BASE, CP_KEY, CP_SECRET (control-plane REST + token), OP_PRIV (operator private
key whose public key is in the allowlist), MQTT_HOST (default 127.0.0.1).
"""

import os
import time

import envelope as env
from bridge import CommandCenterBridge
from control_plane import ControlPlane
from fake_rover import FakeRover

ROVER = "MARK1-001"
OPERATOR = "OP-001"


def main() -> int:
    cp = ControlPlane(os.environ["CP_BASE"], os.environ["CP_KEY"], os.environ["CP_SECRET"])
    host = os.environ.get("MQTT_HOST", "127.0.0.1")
    op_priv = env.private_key_from_hex(os.environ["OP_PRIV"])

    allowlist = cp.get_allowlist(ROVER)
    op_keys = {a["operator"]: a["public_key"] for a in allowlist}
    print(f"[1] allowlist from control plane: {list(op_keys)}")
    assert OPERATOR in op_keys, "operator not in allowlist"

    rover = FakeRover(ROVER, op_keys, host=host)
    rover.connect()
    bridge = CommandCenterBridge(cp, host=host)
    bridge.connect()
    time.sleep(0.5)

    nonce = bridge.send_command(
        rover=ROVER, operator=OPERATOR, command_class="motion",
        payload={"class": "motion", "type": 1, "linear_velocity": 0.5},
        operator_private_key=op_priv,
    )
    print(f"[2] bridge issued nonce={nonce}, signed + published motion command")
    time.sleep(1.0)

    assert rover.received, "rover received no command"
    e, outcome = rover.received[-1]
    print(f"[3] rover validated command -> {outcome} (nonce {e['nonce']})")
    assert outcome == "OK", f"rover rejected a valid command: {outcome}"

    assert bridge.acks, "bridge ingested no ack"
    print(f"[4] bridge ingested ack: {bridge.acks[-1][1]}")

    # Replay: re-publish the SAME signed envelope -> rover must reject (nonce not increasing).
    replay = env.build_envelope(
        rover_id=ROVER, sender_id=OPERATOR, msg_id=nonce, nonce=nonce,
        issued_at=time.time(), expires_at=time.time() + env.DEFAULT_EXPIRY_S,
        payload={"class": "motion", "type": 1, "linear_velocity": 0.5},
        private_key=op_priv,
    )
    bridge.client.publish(f"mark1/{ROVER}/cmd/motion", env.encode(replay), qos=1)
    time.sleep(1.0)
    _, replay_outcome = rover.received[-1]
    print(f"[5] replayed command -> {replay_outcome} (expect SECURITY_REPLAY)")
    assert replay_outcome == "SECURITY_REPLAY", f"replay not rejected: {replay_outcome}"

    bridge.disconnect()
    rover.disconnect()
    print(f"\nPHASE B E2E SMOKE: PASS  (signed command accepted, replay rejected)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
