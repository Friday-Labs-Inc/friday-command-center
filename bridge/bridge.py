"""The Command Center data-plane bridge: paho MQTT <-> the Phase A control plane.

Command path: ask the control plane for a nonce, build + sign the envelope, publish it
to the rover's cmd topic, and append an immutable audit row.

Ingest path: subscribe to ack + telemetry topics. A rejected ack or a rover-initiated
fault becomes a Security Event in the control plane; odometry updates the Rover's
last-known state. (Rover-telemetry signature verification lands with the rover-key PKI
in the mTLS/ACL hardening slice.)
"""

from __future__ import annotations

import json
import time
from datetime import datetime

import cbor2
import paho.mqtt.client as mqtt

import envelope as env

# Rover fault category -> Security Event severity.
_SEVERITY = {
    "SECURITY_AUTH": "Error",
    "SECURITY_REPLAY": "Error",
    "WATCHDOG": "Critical",
    "UNKNOWN_SENDER": "Warning",
    "PROTOCOL_MISMATCH": "Warning",
    "ROVER_MISMATCH": "Warning",
    "EXPIRED": "Warning",
}


def _dt(unix_ms: int) -> str:
    return datetime.fromtimestamp(unix_ms / 1000).strftime("%Y-%m-%d %H:%M:%S")


def _rover_from_topic(topic: str) -> str | None:
    parts = topic.split("/")
    return parts[1] if len(parts) > 1 else None


class CommandCenterBridge:
    def __init__(self, control_plane, host="127.0.0.1", port=1883,
                 client_id="fcc-bridge", tls=None):
        self.cp = control_plane
        self.host = host
        self.port = port
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
        if tls:
            self.client.tls_set(ca_certs=tls["ca"], certfile=tls["cert"], keyfile=tls["key"])
        self.client.on_message = self._on_message
        self.acks: list[tuple[str, dict]] = []
        self.security_events: list[tuple[str, str, str]] = []

    def connect(self):
        self.client.connect(self.host, self.port, keepalive=30)
        self.client.subscribe("mark1/+/ack/#", qos=1)
        self.client.subscribe("mark1/+/tlm/#", qos=1)
        self.client.loop_start()

    def disconnect(self):
        self.client.loop_stop()
        self.client.disconnect()

    # ---- command path -----------------------------------------------------
    def send_command(self, *, rover, operator, command_class, payload, operator_private_key):
        nonce = self.cp.issue_nonce(rover, operator)
        issued = int(time.time() * 1000)
        expires = issued + env.DEFAULT_EXPIRY_MS
        envel = env.build_envelope(
            rover_id=rover, sender_id=operator, msg_id=nonce, nonce=nonce,
            issued_at=issued, expires_at=expires, payload=cbor2.dumps(payload),
            private_key=operator_private_key,
        )
        self.client.publish(f"mark1/{rover}/cmd/{command_class}", env.encode(envel), qos=1)
        self.cp.record_command(
            rover=rover, operator=operator, command_class=command_class, nonce=nonce,
            outcome="Accepted", category="OK", msg_id=nonce, payload=json.dumps(payload),
            signature=envel["signature"].hex(), issued_at=_dt(issued), expires_at=_dt(expires),
        )
        return nonce

    # ---- ingest path ------------------------------------------------------
    def _on_message(self, client, userdata, msg):
        topic = msg.topic
        try:
            data = env.decode(msg.payload)
        except Exception:  # noqa: BLE001 - malformed wire data
            data = {"raw": bytes(msg.payload)}
        if "/ack/" in topic:
            self._on_ack(topic, data)
        elif "/tlm/fault" in topic:
            self._on_fault(topic, data)
        elif "/tlm/" in topic:
            self._on_telemetry(topic, data)

    def _on_ack(self, topic, data):
        self.acks.append((topic, data))
        if isinstance(data, dict) and data.get("accepted") is False:
            category = data.get("category", "OTHER")
            self._security_event(
                _rover_from_topic(topic), category,
                description=f"command {data.get('msg_id')} rejected: {category}",
            )

    def _on_fault(self, topic, data):
        if not isinstance(data, dict):
            return
        self._security_event(
            _rover_from_topic(topic), data.get("category", "OTHER"),
            operator=data.get("sender_id"), description=data.get("description"),
            source_fault=data.get("fault_id"),
        )

    def _on_telemetry(self, topic, data):
        if isinstance(data, dict) and "x" in data:
            self.cp.update_rover_telemetry(
                _rover_from_topic(topic), last_pose_x=data.get("x"),
                last_pose_y=data.get("y"), last_pose_theta=data.get("theta"),
            )

    def _security_event(self, rover, category, **kw):
        name = self.cp.record_security_event(
            rover=rover, category=category, severity=_SEVERITY.get(category, "Warning"), **kw
        )
        self.security_events.append((rover, category, name))
        return name
