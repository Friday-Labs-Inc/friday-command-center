"""Gateway telemetry-recorder routes + tlm kind inference (no broker needed)."""
from fastapi.testclient import TestClient

import gateway
from telemetry_store import TelemetryStore


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(gateway, "_TLM", TelemetryStore(str(tmp_path)))
    return TestClient(gateway.app)


def test_kind_inference_for_env_and_gps_topics():
    ev = gateway._event("mark1/MARK1-001/tlm/env", b"\xa1dtempb28")  # any cbor map
    assert ev["kind"] == "env" and ev["verified"] is False
    ev = gateway._event("mark1/MARK1-001/tlm/gps", b"\xa1clatb11")
    assert ev["kind"] == "gps" and ev["verified"] is False


def test_latest_reports_kinds_with_age(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    gateway._TLM.add("MARK1-001", "env", {"temperature_c": 28.4, "presence": False}, True)
    gateway._TLM.add("MARK1-001", "gps", {"lat": 11.989, "lon": 79.833}, True)
    r = c.get("/api/telemetry/latest", params={"rover": "MARK1-001"})
    assert r.status_code == 200
    kinds = r.json()["kinds"]
    assert set(kinds) == {"env", "gps"}
    assert kinds["env"]["data"]["temperature_c"] == 28.4
    assert kinds["env"]["verified"] is True
    assert kinds["env"]["age_s"] < 5


def test_latest_empty_for_unknown_rover(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    r = c.get("/api/telemetry/latest", params={"rover": "NOBODY"})
    assert r.status_code == 200 and r.json()["kinds"] == {}


def test_history_returns_recent_and_validates_kind(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    for i in range(5):
        gateway._TLM.add("MARK1-001", "env", {"i": i}, False, ts=float(i))
    r = c.get("/api/telemetry/history",
              params={"rover": "MARK1-001", "kind": "env", "limit": 3})
    assert r.status_code == 200
    assert [s["data"]["i"] for s in r.json()["samples"]] == [2, 3, 4]
    r = c.get("/api/telemetry/history",
              params={"rover": "MARK1-001", "kind": "shadow"})
    assert r.status_code == 400
