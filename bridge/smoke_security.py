"""Phase B hardening smoke: telemetry/fault ingest -> Security Events + rover state.

  1. a replayed command is rejected by the rover -> the bridge records a Security Event,
  2. a rover-initiated WATCHDOG fault is ingested -> a (Critical) Security Event,
  3. odometry telemetry updates the Rover's last-known pose.

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


def main() -> int:
    cp = ControlPlane(os.environ["CP_BASE"], os.environ["CP_KEY"], os.environ["CP_SECRET"])
    host = os.environ.get("MQTT_HOST", "127.0.0.1")
    op_priv = env.private_key_from_hex(os.environ["OP_PRIV"])
    op_keys = {a["operator"]: a["public_key"] for a in cp.get_allowlist(ROVER)}

    before = cp.security_event_count(ROVER)
    print(f"[0] security events before: {before}")

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
    time.sleep(0.5)
    replay = env.build_envelope(
        rover_id=ROVER, sender_id=OPERATOR, msg_id=nonce, nonce=nonce,
        issued_at=time.time(), expires_at=time.time() + env.DEFAULT_EXPIRY_S,
        payload={"class": "motion", "type": 1, "linear_velocity": 0.5},
        private_key=op_priv,
    )
    bridge.client.publish(f"mark1/{ROVER}/cmd/motion", env.encode(replay), qos=1)
    time.sleep(0.8)
    print("[1] replayed command -> rover rejected -> bridge recorded a Security Event")

    rover.emit_fault("WATCHDOG", description="safety pulse lost (112 ms)")
    time.sleep(0.8)
    print("[2] rover WATCHDOG fault -> ingested as a Critical Security Event")

    rover.emit_odom(1.45, 0.0, 0.0)
    time.sleep(0.8)

    bridge.disconnect()
    rover.disconnect()

    after = cp.security_event_count(ROVER)
    print(f"[3] bridge recorded categories: {[c for _, c, _ in bridge.security_events]}")
    print(f"[4] security events after: {after} (delta {after - before})")
    assert after - before >= 2, "expected >=2 new Security Events (replay + watchdog)"

    state = cp.get_rover_state(ROVER)
    print(f"[5] rover last-known state: {state}")
    assert abs(float(state.get("last_pose_x") or 0) - 1.45) < 1e-6, "rover pose not updated"

    print("\nPHASE B HARDENING SMOKE: PASS "
          "(fault ingest -> Security Events, telemetry -> rover state)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
