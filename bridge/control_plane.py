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

    def get_nonce_floor(self, rover: str, operator: str) -> int:
        return int(self._call("get_nonce_floor", rover=rover, operator=operator))

    def set_nonce_floor(self, rover: str, operator: str, nonce: int) -> int:
        return int(self._call("set_nonce_floor", rover=rover, operator=operator, nonce=nonce))

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

    def record_security_event(self, *, rover, category, severity="Warning",
                              description=None, operator=None, source_fault=None) -> str:
        return self._call(
            "record_security_event", rover=rover, category=category, severity=severity,
            description=description, operator=operator, source_fault=source_fault,
        )

    def update_rover_telemetry(self, rover, **fields):
        return self._call("update_rover_telemetry", rover=rover, **fields)

    def security_event_count(self, rover, unacknowledged_only=False) -> int:
        return int(self._call(
            "security_event_count", rover=rover,
            unacknowledged_only=1 if unacknowledged_only else 0,
        ))

    def get_rover_state(self, rover) -> dict:
        return self._call("get_rover_state", rover=rover)

    def recent_security_events(self, rover=None, limit=20):
        return self._call("recent_security_events", rover=rover, limit=limit)

    def list_rovers(self):
        return self._call("list_rovers")

    def rover_keys(self):
        return self._call("rover_keys")

    # ---- new read wrappers ----

    def list_fleets(self) -> list[dict]:
        return self._call("list_fleets")

    def list_missions(self) -> list[dict]:
        return self._call("list_missions")

    def get_mission(self, name: str) -> dict:
        return self._call("get_mission", name=name)

    def list_operators(self) -> list[dict]:
        return self._call("list_operators")

    def list_operator_revocations(self) -> list[dict]:
        return self._call("list_operator_revocations")

    def list_certificates(self, status: str | None = None, rover: str | None = None) -> list[dict]:
        params: dict = {}
        if status is not None:
            params["status"] = status
        if rover is not None:
            params["rover"] = rover
        return self._call("list_certificates", **params)

    def list_certificate_authorities(self) -> list[dict]:
        return self._call("list_certificate_authorities")

    def list_command_audit(self, rover: str | None = None, limit: int = 50) -> list[dict]:
        params: dict = {"limit": limit}
        if rover is not None:
            params["rover"] = rover
        return self._call("list_command_audit", **params)

    def acknowledge_security_event(self, name: str) -> dict:
        return self._call("acknowledge_security_event", name=name)

    def get_settings(self) -> dict:
        return self._call("get_settings")

    # ---- existing api methods now wrapped for the UI ----

    def active_rover_certificates(self, rover: str | None = None) -> list[dict]:
        params: dict = {}
        if rover is not None:
            params["rover"] = rover
        return self._call("active_rover_certificates", **params)

    def issue_rover_certificate(
        self,
        rover: str,
        cert_pem: str | None = None,
        serial: str | None = None,
        fingerprint: str | None = None,
        expires_on: str | None = None,
        issuing_ca: str | None = None,
    ) -> str:
        return self._call(
            "issue_rover_certificate",
            rover=rover,
            cert_pem=cert_pem,
            serial=serial,
            fingerprint=fingerprint,
            expires_on=expires_on,
            issuing_ca=issuing_ca,
        )

    def revoke_rover_certificate(self, name: str, reason: str | None = None) -> dict:
        return self._call("revoke_rover_certificate", name=name, reason=reason)

    def upload_mission(
        self,
        title: str,
        rover: str | None = None,
        waypoints=None,
        payload: str | None = None,
    ) -> str:
        import json as _json
        # api.py handles str or list; serialize to string so Frappe's form_dict round-trips cleanly
        wps = _json.dumps(waypoints) if isinstance(waypoints, list) else (waypoints or "[]")
        return self._call("upload_mission", title=title, rover=rover, waypoints=wps, payload=payload)

    def revoke_operator(
        self,
        operator: str,
        scope: str = "All Rovers",
        rover: str | None = None,
        reason: str | None = None,
    ) -> dict:
        return self._call(
            "revoke_operator", operator=operator, scope=scope, rover=rover, reason=reason,
        )

    def lift_revocation(self, revocation: str) -> dict:
        return self._call("lift_revocation", revocation=revocation)
