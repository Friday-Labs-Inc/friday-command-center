"""Keystone P0 edge-cache tests — the data plane survives a Frappe outage.

No Frappe, no broker: a fake control plane that can be flipped offline (raises the same
requests.ConnectionError the real thin client raises when Frappe is unreachable).
"""

import requests

from edge_cache import EdgeCache


class FlakyCP:
    def __init__(self):
        self.up = True
        self._allow = {"MARK1-001": [{"operator": "OP-001", "public_key": "ab" * 32, "epoch": 1}]}
        self._keys = {"MARK1-001": "cd" * 32}

    def get_allowlist(self, rover):
        if not self.up:
            raise requests.ConnectionError("frappe unreachable")
        return self._allow.get(rover, [])

    def rover_keys(self):
        if not self.up:
            raise requests.ConnectionError("frappe unreachable")
        return self._keys


def test_serves_live_and_writes_through(tmp_path):
    c = EdgeCache(FlakyCP(), path=str(tmp_path / "cache.json"))
    assert c.get_allowlist("MARK1-001")[0]["operator"] == "OP-001"
    assert c.online is True
    assert (tmp_path / "cache.json").exists()


def test_serves_cache_when_frappe_down(tmp_path):
    cp = FlakyCP()
    c = EdgeCache(cp, path=str(tmp_path / "cache.json"))
    c.get_allowlist("MARK1-001")            # warm
    cp.up = False
    out = c.get_allowlist("MARK1-001")      # Frappe down -> still answers
    assert out[0]["public_key"] == "ab" * 32
    assert c.online is False


def test_cold_miss_when_frappe_down_raises(tmp_path):
    cp = FlakyCP()
    cp.up = False
    c = EdgeCache(cp, path=str(tmp_path / "cache.json"))
    try:
        c.get_allowlist("MARK1-001")
    except requests.ConnectionError:
        return
    raise AssertionError("a cold miss while offline must raise, not serve empty")


def test_cache_persists_across_restart(tmp_path):
    p = str(tmp_path / "cache.json")
    EdgeCache(FlakyCP(), path=p).get_allowlist("MARK1-001")   # instance 1 warms + fsyncs
    cp2 = FlakyCP()
    cp2.up = False
    c2 = EdgeCache(cp2, path=p)                                # fresh process, Frappe down
    assert c2.get_allowlist("MARK1-001")[0]["operator"] == "OP-001"   # served from disk


def test_offline_signal_fires_once_on_transition(tmp_path):
    seen = []
    cp = FlakyCP()
    c = EdgeCache(cp, path=str(tmp_path / "cache.json"), on_offline=seen.append)
    c.get_allowlist("MARK1-001")     # online
    cp.up = False
    c.get_allowlist("MARK1-001")     # -> offline, fires
    c.get_allowlist("MARK1-001")     # still offline, must NOT re-fire
    assert len(seen) == 1


def test_rover_keys_cached(tmp_path):
    cp = FlakyCP()
    c = EdgeCache(cp, path=str(tmp_path / "cache.json"))
    assert c.rover_keys()["MARK1-001"] == "cd" * 32
    cp.up = False
    assert c.rover_keys()["MARK1-001"] == "cd" * 32   # from cache
