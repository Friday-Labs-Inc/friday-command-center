import json
import os

from telemetry_store import TelemetryStore


def test_add_latest_recent(tmp_path):
    ts = TelemetryStore(str(tmp_path))
    ts.add("MARK1-001", "env", {"temperature_c": 28.4}, True, ts=100.0)
    ts.add("MARK1-001", "env", {"temperature_c": 28.6}, True, ts=105.0)
    latest = ts.latest("MARK1-001", "env")
    assert latest["data"]["temperature_c"] == 28.6
    assert latest["verified"] is True
    assert [s["ts"] for s in ts.recent("MARK1-001", "env")] == [100.0, 105.0]
    assert ts.latest("MARK1-001", "gps") is None
    assert ts.recent("MARK1-001", "gps") == []


def test_ring_bounds_memory_and_recent_limit(tmp_path):
    ts = TelemetryStore(str(tmp_path), ring_size=5)
    for i in range(9):
        ts.add("R", "env", {"i": i}, False, ts=float(i))
    recent = ts.recent("R", "env", limit=100)
    assert [s["data"]["i"] for s in recent] == [4, 5, 6, 7, 8]
    assert [s["data"]["i"] for s in ts.recent("R", "env", limit=2)] == [7, 8]


def test_survives_restart_and_compacts_file(tmp_path):
    ts = TelemetryStore(str(tmp_path), ring_size=3)
    for i in range(6):
        ts.add("R", "gps", {"i": i}, True, ts=float(i))
    # new instance = gateway restart; history reloads, file compacts to ring
    ts2 = TelemetryStore(str(tmp_path), ring_size=3)
    assert [s["data"]["i"] for s in ts2.recent("R", "gps")] == [3, 4, 5]
    path = os.path.join(str(tmp_path), "tlm_R_gps.jsonl")
    assert len(open(path).readlines()) == 3


def test_torn_tail_line_is_skipped(tmp_path):
    ts = TelemetryStore(str(tmp_path))
    ts.add("R", "env", {"i": 1}, True, ts=1.0)
    path = os.path.join(str(tmp_path), "tlm_R_env.jsonl")
    with open(path, "a") as f:
        f.write('{"ts": 2.0, "data": {"i"')       # crash mid-write
    ts2 = TelemetryStore(str(tmp_path))
    assert [s["data"]["i"] for s in ts2.recent("R", "env")] == [1]


def test_path_traversal_names_are_neutralised(tmp_path):
    ts = TelemetryStore(str(tmp_path))
    ts.add("../evil", "a/b", {"x": 1}, False, ts=1.0)
    names = os.listdir(str(tmp_path))
    assert len(names) == 1 and "/" not in names[0] and ".." not in names[0]
    assert ts.latest("../evil", "a/b")["data"]["x"] == 1


def test_kinds_lists_disk_and_memory(tmp_path):
    ts = TelemetryStore(str(tmp_path))
    ts.add("R", "env", {"x": 1}, True)
    ts.add("R", "gps", {"y": 2}, True)
    ts2 = TelemetryStore(str(tmp_path))       # disk-only view
    assert ts2.kinds("R") == ["env", "gps"]
