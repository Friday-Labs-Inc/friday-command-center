"""Client for the Phase A Frappe control-plane REST API.

The bridge calls the whitelisted methods in friday_command_center/api.py over HTTP with
token auth (Authorization: token <key>:<secret>). The control plane owns the nonce,
serves the allowlist, and records the immutable audit — this is the thin client.
"""

from __future__ import annotations

import requests


class ControlPlane:
    def __init__(self, base_url: str, api_key: str, api_secret: str, timeout: float = 10.0):
        self.base = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"token {api_key}:{api_secret}"

    def _call(self, method: str, **params):
        url = f"{self.base}/api/method/friday_command_center.api.{method}"
        resp = self.session.post(url, json=params, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()["message"]

    def issue_nonce(self, rover: str, operator: str) -> int:
        return int(self._call("issue_nonce", rover=rover, operator=operator))

    def get_allowlist(self, rover: str) -> list[dict]:
        return self._call("get_allowlist", rover=rover)

    def record_command(
        self, *, rover, operator, command_class, nonce, outcome, category,
        msg_id=None, payload=None, issued_at=None, expires_at=None, signature=None,
    ) -> str:
        return self._call(
            "record_command", rover=rover, operator=operator, command_class=command_class,
            nonce=nonce, outcome=outcome, category=category, msg_id=msg_id, payload=payload,
            issued_at=issued_at, expires_at=expires_at, signature=signature,
        )
