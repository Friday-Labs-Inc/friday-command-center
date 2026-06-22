"""Keystone P0 — the durable edge control-plane cache.

The data plane must keep authorizing and verifying when Frappe (the control plane) is
unreachable. This wraps the ControlPlane REST client: every read tries Frappe live,
writes the result through to a durable on-disk cache (atomic + fsync'd — the same
pattern the rover's NonceStore uses), and on a *connection* failure (Frappe down /
timeout) serves the last-known value instead of failing the command. A real HTTP error
response (Frappe reachable but erroring) is NOT masked — it propagates. A cold miss
(never fetched) still raises: the cache can only serve what it has already seen.

`path=None` -> in-memory only (tests / no-persist callers).
"""

from __future__ import annotations

import json
import os

import requests

# Only these mean "Frappe is unreachable" — fall back to cache. An HTTPError (4xx/5xx)
# means Frappe answered, so it is a real error and must not be hidden behind stale data.
_OFFLINE_ERRORS = (requests.ConnectionError, requests.Timeout)


class EdgeCache:
    def __init__(self, cp, path: str | None = None, on_offline=None):
        self.cp = cp
        self._path = path or None
        self._on_offline = on_offline          # callback(reason: str), best-effort, on the online->offline edge
        self._data = self._load()
        self.online = True                     # last-known control-plane reachability
        if self._path:
            parent = os.path.dirname(self._path)
            if parent:
                os.makedirs(parent, exist_ok=True)

    @staticmethod
    def _blank() -> dict:
        return {"allowlist": {}, "rover_keys": {}, "seen": {}}

    def _load(self) -> dict:
        if not self._path:
            return self._blank()
        try:
            with open(self._path) as f:
                d = json.load(f)
            blank = self._blank()
            return {k: d.get(k, blank[k]) for k in blank}
        except (OSError, ValueError):
            return self._blank()

    def _flush(self) -> None:
        if not self._path:
            return
        tmp = self._path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self._data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self._path)

    def _mark_online(self) -> None:
        self.online = True

    def _mark_offline(self, reason: str) -> None:
        was_online = self.online
        self.online = False
        if was_online and self._on_offline:    # fire once, on the transition only
            try:
                self._on_offline(reason)
            except Exception:  # noqa: BLE001 — the offline signal must never break a command
                pass

    def get_allowlist(self, rover: str) -> list[dict]:
        try:
            fresh = self.cp.get_allowlist(rover)
            self._mark_online()
            self._data = {
                **self._data,
                "allowlist": {**self._data["allowlist"], rover: fresh},
                "seen": {**self._data["seen"], f"allowlist:{rover}": True},
            }
            self._flush()
            return fresh
        except _OFFLINE_ERRORS as exc:
            self._mark_offline(f"get_allowlist({rover}): {exc}")
            if not self._data["seen"].get(f"allowlist:{rover}"):
                raise
            return self._data["allowlist"].get(rover, [])

    def rover_keys(self) -> dict:
        try:
            fresh = self.cp.rover_keys()
            self._mark_online()
            self._data = {
                **self._data,
                "rover_keys": fresh,
                "seen": {**self._data["seen"], "rover_keys": True},
            }
            self._flush()
            return fresh
        except _OFFLINE_ERRORS as exc:
            self._mark_offline(f"rover_keys: {exc}")
            if not self._data["seen"].get("rover_keys"):
                raise
            return self._data["rover_keys"]


class EdgeNonce:
    """Durable, strictly-monotonic per-(rover, operator) nonce, issued AT THE EDGE so
    commanding survives a control-plane outage. A single dispatcher is the only writer, so
    the local counter is authoritative; Frappe is a best-effort mirror used to (a) reconcile
    the floor upward when reachable (never reuse a nonce Frappe already handed out) and
    (b) durably back the floor up for disk-loss recovery. Also tracks a relayed floor so the
    dispatcher can reject replays itself, not only the rover.

    `path=None` -> in-memory only (tests / no-persist callers).
    """

    def __init__(self, cp, path: str | None = None):
        self.cp = cp
        self._path = path or None
        self._data = self._load()
        if self._path:
            parent = os.path.dirname(self._path)
            if parent:
                os.makedirs(parent, exist_ok=True)

    @staticmethod
    def _blank() -> dict:
        return {"issued": {}, "relayed": {}}

    def _load(self) -> dict:
        if not self._path:
            return self._blank()
        try:
            with open(self._path) as f:
                d = json.load(f)
            return {sect: {str(k): int(v) for k, v in d.get(sect, {}).items()}
                    for sect in self._blank()}
        except (OSError, ValueError):
            return self._blank()

    def _flush(self) -> None:
        if not self._path:
            return
        tmp = self._path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self._data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self._path)

    @staticmethod
    def _key(rover: str, operator: str) -> str:
        return f"{rover}::{operator}"

    def issue(self, rover: str, operator: str) -> int:
        key = self._key(rover, operator)
        floor = self._data["issued"].get(key, 0)
        try:                                       # reconcile up from Frappe (best-effort)
            floor = max(floor, int(self.cp.get_nonce_floor(rover, operator)))
        except Exception as exc:                   # noqa: BLE001 — local floor is authoritative
            print("[edge] nonce reconcile skipped (using local floor):", exc)
        nxt = floor + 1
        self._data = {**self._data, "issued": {**self._data["issued"], key: nxt}}
        self._flush()
        try:                                       # mirror back so Frappe survives an edge disk loss
            self.cp.set_nonce_floor(rover, operator, nxt)
        except Exception:                          # noqa: BLE001 — the mirror is best-effort
            pass
        return nxt

    def consume(self, rover: str, operator: str, nonce: int) -> bool:
        """Replay gate: accept `nonce` only if strictly greater than the last relayed one
        for this (rover, operator), then advance the relayed floor durably. Call this only
        AFTER the signature has verified, so a forged command can't poison the floor."""
        key = self._key(rover, operator)
        if int(nonce) <= self._data["relayed"].get(key, 0):
            return False
        self._data = {**self._data, "relayed": {**self._data["relayed"], key: int(nonce)}}
        self._flush()
        return True
