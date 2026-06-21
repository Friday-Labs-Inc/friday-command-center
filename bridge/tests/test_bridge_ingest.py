"""Unit tests for the bridge ingest routing (no broker, no Frappe — a fake control plane)."""

import cbor2

from bridge import CommandCenterBridge, _rover_from_topic


class FakeCP:
    def __init__(self):
        self.events = []
        self.telemetry = []

    def record_security_event(self, **kw):
        self.events.append(kw)
        return f"SEC-{len(self.events):05d}"

    def update_rover_telemetry(self, rover, **fields):
        self.telemetry.append((rover, fields))
        return True


class Msg:
    def __init__(self, topic, payload):
        self.topic = topic
        self.payload = payload


def _bridge():
    return CommandCenterBridge(FakeCP())


def test_rover_from_topic():
    assert _rover_from_topic("mark1/MARK1-001/ack/3") == "MARK1-001"


def test_rejected_ack_creates_error_security_event():
    b = _bridge()
    b._on_message(None, None, Msg(
        "mark1/MARK1-001/ack/3",
        cbor2.dumps({"msg_id": 3, "accepted": False, "category": "SECURITY_REPLAY"})))
    assert len(b.cp.events) == 1
    assert b.cp.events[0]["category"] == "SECURITY_REPLAY"
    assert b.cp.events[0]["severity"] == "Error"


def test_accepted_ack_creates_no_security_event():
    b = _bridge()
    b._on_message(None, None, Msg(
        "mark1/MARK1-001/ack/3",
        cbor2.dumps({"msg_id": 3, "accepted": True, "category": "OK"})))
    assert b.cp.events == []


def test_watchdog_fault_creates_critical_security_event():
    b = _bridge()
    b._on_message(None, None, Msg(
        "mark1/MARK1-001/tlm/fault",
        cbor2.dumps({"category": "WATCHDOG", "description": "safety pulse lost"})))
    assert b.cp.events[0]["category"] == "WATCHDOG"
    assert b.cp.events[0]["severity"] == "Critical"


def test_odom_updates_rover_state():
    b = _bridge()
    b._on_message(None, None, Msg(
        "mark1/MARK1-001/tlm/odom",
        cbor2.dumps({"x": 1.45, "y": 0.0, "theta": 0.0})))
    rover, fields = b.cp.telemetry[0]
    assert rover == "MARK1-001"
    assert fields["last_pose_x"] == 1.45
