"""Durable telemetry recorder for the gateway (data-plane memory).

The gateway fans live telemetry to browsers, but a page that just opened has
no past: this store keeps the recent history per (rover, kind) so the console
can draw "the last half hour" instead of starting blank, and remembers the
latest sample across gateway restarts.

Design mirrors EdgeCache's posture: stdlib-only, files under bridge/state/,
append-only JSONL per (rover, kind) with an in-memory ring. Appends are
line-atomic (single write of one line); the file is truncated back to the
ring size on load so it cannot grow without bound.
"""
from __future__ import annotations

import json
import os
import threading
import time
from collections import deque

RING_SIZE = 720            # at one sample / 5 s ≈ the last hour
_SAFE = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")


def _safe_name(part: str) -> str:
    return "".join(c if c in _SAFE else "_" for c in part) or "_"


class TelemetryStore:
    def __init__(self, state_dir: str, ring_size: int = RING_SIZE,
                 ring_overrides: dict | None = None):
        self._dir = state_dir
        self._ring_size = ring_size
        # per-kind ring sizes: bulky kinds (a whole map) keep less history
        self._ring_overrides = dict(ring_overrides or {})
        self._rings: dict[tuple[str, str], deque] = {}
        self._lock = threading.Lock()
        os.makedirs(state_dir, exist_ok=True)

    # ---- internals ---------------------------------------------------------
    def _path(self, rover: str, kind: str) -> str:
        return os.path.join(self._dir, f"tlm_{_safe_name(rover)}_{_safe_name(kind)}.jsonl")

    def _ring(self, rover: str, kind: str) -> deque:
        key = (rover, kind)
        ring = self._rings.get(key)
        if ring is None:
            size = self._ring_overrides.get(kind, self._ring_size)
            ring = deque(maxlen=size)
            path = self._path(rover, kind)
            if os.path.exists(path):
                try:
                    with open(path, encoding="utf-8") as f:
                        lines = f.readlines()[-size:]
                    for line in lines:
                        try:
                            ring.append(json.loads(line))
                        except json.JSONDecodeError:
                            continue          # torn tail line from a crash: skip
                    # compact: rewrite only the retained window
                    tmp = path + ".tmp"
                    with open(tmp, "w", encoding="utf-8") as f:
                        for s in ring:
                            f.write(json.dumps(s, separators=(",", ":")) + "\n")
                    os.replace(tmp, path)
                except OSError:
                    pass                      # unreadable history is not fatal
            self._rings[key] = ring
        return ring

    # ---- API ---------------------------------------------------------------
    def add(self, rover: str, kind: str, data, verified, ts: float | None = None) -> dict:
        sample = {"ts": ts if ts is not None else time.time(),
                  "data": data, "verified": verified}
        with self._lock:
            self._ring(rover, kind).append(sample)
            try:
                with open(self._path(rover, kind), "a", encoding="utf-8") as f:
                    f.write(json.dumps(sample, separators=(",", ":")) + "\n")
            except OSError:
                pass                          # disk trouble must never break the feed
        return sample

    def latest(self, rover: str, kind: str) -> dict | None:
        with self._lock:
            ring = self._ring(rover, kind)
            return ring[-1] if ring else None

    def recent(self, rover: str, kind: str, limit: int = 120) -> list[dict]:
        with self._lock:
            ring = self._ring(rover, kind)
            if limit <= 0:
                return []
            return list(ring)[-limit:]

    def kinds(self, rover: str) -> list[str]:
        """Kinds with any recorded data for this rover (memory + disk)."""
        found = {k for (r, k) in self._rings if r == rover and self._rings[(r, k)]}
        prefix = f"tlm_{_safe_name(rover)}_"
        try:
            for name in os.listdir(self._dir):
                if name.startswith(prefix) and name.endswith(".jsonl"):
                    found.add(name[len(prefix):-len(".jsonl")])
        except OSError:
            pass
        return sorted(found)
