"""Minimal stand-in rover for the Phase B end-to-end smoke.

Mirrors the real Telemetry agent's command acceptance (the rover's protocol.py
CommandValidator): a command is obeyed only if the sender is allowlisted, the Ed25519
signature verifies, and the nonce strictly increases. It then publishes a CBOR ack —
exactly what the rover does — so the bridge's ingest path has something to consume.

This is a TEST harness, not production code; it stands in for the ROS 2 rover (which
can't run on macOS) so we can prove the signed command path through a real broker.
"""

from __future__ import annotations

import cbor2
import paho.mqtt.client as mqtt

import envelope as env


class FakeRover:
    def __init__(self, rover_id, operator_keys: dict, host="127.0.0.1", port=1883,
                 client_id=None, tls=None):
        # operator_keys: {operator_id: public_key_hex}
        self.rover_id = rover_id
        self.keys = {op: env.public_key_from_hex(k) for op, k in operator_keys.items()}
        self.last_nonce: dict[str, int] = {}
        self.received: list[tuple[dict, str]] = []
        self.host, self.port = host, port
        # clientid defaults to the rover_id so the broker ACL can match it (= cert CN).
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, client_id=client_id or rover_id
        )
        if tls:
            self.client.tls_set(ca_certs=tls["ca"], certfile=tls["cert"], keyfile=tls["key"])
        self.client.on_message = self._on_message

    def connect(self):
        self.client.connect(self.host, self.port, keepalive=30)
        self.client.subscribe(f"mark1/{self.rover_id}/cmd/#", qos=1)
        self.client.loop_start()

    def disconnect(self):
        self.client.loop_stop()
        self.client.disconnect()

    def emit_fault(self, category, description=None, sender_id=None, fault_id=None):
        """Publish a rover-initiated fault on tlm/fault (e.g. a watchdog safe-stop)."""
        payload = {
            "category": category, "description": description,
            "sender_id": sender_id, "fault_id": fault_id,
        }
        self.client.publish(f"mark1/{self.rover_id}/tlm/fault", cbor2.dumps(payload), qos=1)

    def emit_odom(self, x, y, theta):
        """Publish odometry telemetry on tlm/odom."""
        self.client.publish(
            f"mark1/{self.rover_id}/tlm/odom",
            cbor2.dumps({"x": x, "y": y, "theta": theta}), qos=1,
        )

    def _on_message(self, client, userdata, msg):
        try:
            e = env.decode(msg.payload)
        except Exception:  # noqa: BLE001
            return
        outcome = self._validate(e)
        self.received.append((e, outcome))
        ack = {"msg_id": e.get("msg_id"), "accepted": outcome == "OK", "category": outcome}
        client.publish(
            f"mark1/{self.rover_id}/ack/{e.get('msg_id')}", cbor2.dumps(ack), qos=1
        )

    def _validate(self, e: dict) -> str:
        sender = e.get("sender_id")
        key = self.keys.get(sender)
        if key is None:
            return "UNKNOWN_SENDER"
        if not env.verify(e, key):
            return "SECURITY_AUTH"
        nonce = e.get("nonce")
        last = self.last_nonce.get(sender)
        if last is not None and nonce <= last:
            return "SECURITY_REPLAY"
        self.last_nonce[sender] = nonce
        return "OK"
