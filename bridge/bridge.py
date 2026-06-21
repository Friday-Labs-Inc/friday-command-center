"""The Command Center data-plane bridge: paho MQTT <-> the Phase A control plane.

Command path: ask the control plane for a nonce, build + sign the envelope (dev path
signs with a provisioned operator key; production signs client-side), publish it to the
rover's cmd topic, and append an immutable audit row.

Ingest path: subscribe to the rovers' ack topics and collect them (telemetry/fault
ingest into TSDB/Security Events extends this in later slices).
"""

from __future__ import annotations

import json
from datetime import datetime

import paho.mqtt.client as mqtt

import envelope as env


def _dt(unix_s: float) -> str:
    """unix seconds -> Frappe Datetime string."""
    return datetime.fromtimestamp(unix_s).strftime("%Y-%m-%d %H:%M:%S")


class CommandCenterBridge:
    def __init__(self, control_plane, host="127.0.0.1", port=1883, client_id="fcc-bridge"):
        self.cp = control_plane
        self.host = host
        self.port = port
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
        self.client.on_message = self._on_message
        self.acks: list[tuple[str, dict]] = []

    def connect(self):
        self.client.connect(self.host, self.port, keepalive=30)
        self.client.subscribe("mark1/+/ack/#", qos=1)
        self.client.loop_start()

    def disconnect(self):
        self.client.loop_stop()
        self.client.disconnect()

    def send_command(self, *, rover, operator, command_class, payload, operator_private_key):
        """Issue a nonce, sign, publish to cmd/<class>, and audit. Returns the nonce."""
        import time

        nonce = self.cp.issue_nonce(rover, operator)
        issued = time.time()
        expires = issued + env.DEFAULT_EXPIRY_S
        envel = env.build_envelope(
            rover_id=rover, sender_id=operator, msg_id=nonce, nonce=nonce,
            issued_at=issued, expires_at=expires, payload=payload,
            private_key=operator_private_key,
        )
        self.client.publish(f"mark1/{rover}/cmd/{command_class}", env.encode(envel), qos=1)
        self.cp.record_command(
            rover=rover, operator=operator, command_class=command_class, nonce=nonce,
            outcome="Accepted", category="OK", msg_id=nonce, payload=json.dumps(payload),
            signature=envel["signature"].hex(), issued_at=_dt(issued), expires_at=_dt(expires),
        )
        return nonce

    def _on_message(self, client, userdata, msg):
        try:
            ack = env.decode(msg.payload)
        except Exception:  # noqa: BLE001 - malformed wire data
            ack = {"raw": bytes(msg.payload)}
        self.acks.append((msg.topic, ack))
