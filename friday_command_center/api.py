"""Whitelisted control-plane API.

The data-plane bridge calls these over Frappe's REST API. The control plane owns the
per-(rover, operator) monotonic nonce, serves the allowlist the bridge enforces, and
records every command in the immutable audit log. No private keys pass through here —
operators sign client-side; the Command Center only ever holds public keys.
"""

import frappe
from frappe import _
from frappe.utils import now_datetime


def _counter_name(rover, operator):
    return f"{rover}::{operator}"


def _require_allowlisted(rover, operator):
    """Raise unless the operator is Active, allowlisted for the rover, and not revoked."""
    if frappe.db.get_value("Operator", operator, "status") != "Active":
        frappe.throw(_("Operator {0} is not Active.").format(operator), frappe.PermissionError)

    entry = frappe.db.get_value(
        "Rover Operator Allowlist", _counter_name(rover, operator), ["enabled"], as_dict=True
    )
    if not entry or not entry.enabled:
        frappe.throw(
            _("Operator {0} is not allowlisted for rover {1}.").format(operator, rover),
            frappe.PermissionError,
        )

    revoked = frappe.db.exists(
        "Operator Revocation", {"operator": operator, "status": "Active", "scope": "All Rovers"}
    ) or frappe.db.exists(
        "Operator Revocation",
        {"operator": operator, "status": "Active", "scope": "Specific Rover", "rover": rover},
    )
    if revoked:
        frappe.throw(_("Operator {0} is revoked.").format(operator), frappe.PermissionError)


@frappe.whitelist()
def issue_nonce(rover, operator):
    """Atomically allocate the next monotonic nonce for (rover, operator)."""
    _require_allowlisted(rover, operator)
    name = _counter_name(rover, operator)
    if not frappe.db.exists("Operator Nonce Counter", name):
        frappe.get_doc(
            {
                "doctype": "Operator Nonce Counter",
                "rover": rover,
                "operator": operator,
                "last_nonce": 0,
            }
        ).insert(ignore_permissions=True)
    # Single atomic increment; the SELECT reads the updated row in the same txn.
    frappe.db.sql(
        "UPDATE `tabOperator Nonce Counter` SET last_nonce = last_nonce + 1 WHERE name = %s",
        name,
    )
    nonce = frappe.db.sql(
        "SELECT last_nonce FROM `tabOperator Nonce Counter` WHERE name = %s", name
    )[0][0]
    return int(nonce)


@frappe.whitelist()
def get_nonce_floor(rover, operator):
    """Read the (rover, operator) monotonic nonce floor WITHOUT consuming one (0 if it
    does not exist yet). The edge nonce authority reconciles against this so a nonce the
    control plane already issued is never reused after the edge takes over issuance."""
    val = frappe.db.get_value("Operator Nonce Counter", _counter_name(rover, operator), "last_nonce")
    return int(val or 0)


@frappe.whitelist()
def set_nonce_floor(rover, operator, nonce):
    """Advance the (rover, operator) nonce floor to max(current, nonce) — the edge's
    best-effort durable mirror of its locally-issued floor. Monotonic; never lowers it."""
    name = _counter_name(rover, operator)
    nonce = int(nonce)
    if not frappe.db.exists("Operator Nonce Counter", name):
        frappe.get_doc({
            "doctype": "Operator Nonce Counter", "rover": rover, "operator": operator,
            "last_nonce": nonce,
        }).insert(ignore_permissions=True)
        return nonce
    frappe.db.sql(
        "UPDATE `tabOperator Nonce Counter` SET last_nonce = GREATEST(last_nonce, %s) WHERE name = %s",
        (nonce, name),
    )
    return int(frappe.db.get_value("Operator Nonce Counter", name, "last_nonce"))


@frappe.whitelist()
def get_allowlist(rover):
    """Return the enabled operators + public keys a rover trusts (what the bridge reads)."""
    out = []
    for row in frappe.get_all(
        "Rover Operator Allowlist",
        filters={"rover": rover, "enabled": 1},
        fields=["operator", "epoch"],
    ):
        op = frappe.db.get_value(
            "Operator", row.operator, ["ed25519_public_key", "status"], as_dict=True
        )
        if op and op.status == "Active":
            out.append(
                {"operator": row.operator, "public_key": op.ed25519_public_key, "epoch": row.epoch}
            )
    return out


@frappe.whitelist()
def record_command(
    rover,
    operator,
    command_class,
    nonce,
    outcome,
    category,
    msg_id=None,
    payload=None,
    issued_at=None,
    expires_at=None,
    signature=None,
):
    """Append an immutable Command Audit Log entry; returns its name."""
    doc = frappe.get_doc(
        {
            "doctype": "Command Audit Log",
            "rover": rover,
            "operator": operator,
            "command_class": command_class,
            "nonce": nonce,
            "outcome": outcome,
            "category": category,
            "msg_id": msg_id,
            "payload": payload,
            "issued_at": issued_at,
            "expires_at": expires_at,
            "signature": signature,
            "received_at": now_datetime(),
        }
    ).insert(ignore_permissions=True)
    return doc.name


@frappe.whitelist()
def record_security_event(
    rover, category, severity="Warning", description=None, operator=None,
    source_fault=None, event_time=None,
):
    """Ingest a security-relevant rover fault (or a rejected command) as a Security Event."""
    doc = frappe.get_doc(
        {
            "doctype": "Security Event",
            "rover": rover,
            "operator": operator,
            "category": category,
            "severity": severity,
            "description": description,
            "source_fault": source_fault,
            "event_time": event_time or now_datetime(),
        }
    ).insert(ignore_permissions=True)
    return doc.name


@frappe.whitelist()
def update_rover_telemetry(
    rover, last_seen=None, last_pose_x=None, last_pose_y=None, last_pose_theta=None,
):
    """Update a rover's last-known state from ingested odometry telemetry."""
    updates = {"last_seen": last_seen or now_datetime()}
    for field, value in (
        ("last_pose_x", last_pose_x),
        ("last_pose_y", last_pose_y),
        ("last_pose_theta", last_pose_theta),
    ):
        if value is not None:
            updates[field] = float(value)
    frappe.db.set_value("Rover", rover, updates)
    return True


@frappe.whitelist()
def security_event_count(rover, unacknowledged_only=0):
    filters = {"rover": rover}
    if int(unacknowledged_only or 0):
        filters["acknowledged"] = 0
    return frappe.db.count("Security Event", filters)


@frappe.whitelist()
def get_rover_state(rover):
    return frappe.db.get_value(
        "Rover", rover,
        ["last_seen", "last_pose_x", "last_pose_y", "last_pose_theta", "status"],
        as_dict=True,
    )


@frappe.whitelist()
def recent_security_events(rover=None, limit=20):
    filters = {"rover": rover} if rover else {}
    return frappe.get_all(
        "Security Event", filters=filters,
        fields=["name", "rover", "operator", "category", "severity", "description",
                "event_time", "acknowledged"],
        order_by="creation desc", limit=int(limit),
    )


@frappe.whitelist()
def list_rovers():
    return frappe.get_all(
        "Rover", fields=["name", "rover_name", "status", "last_seen",
                         "last_pose_x", "last_pose_y", "last_pose_theta"],
        order_by="name",
    )


@frappe.whitelist()
def rover_keys():
    """Map of rover -> telemetry signing public key, for the gateway to verify against."""
    rows = frappe.get_all("Rover", fields=["name", "signing_public_key"])
    return {r.name: r.signing_public_key for r in rows if r.signing_public_key}


# ---- PKI: rover mTLS certificate lifecycle (Phase D) ----
@frappe.whitelist()
def issue_rover_certificate(rover, cert_pem=None, serial=None, fingerprint=None,
                            expires_on=None, issuing_ca=None):
    """Record an issued rover mTLS certificate (and stamp the rover's fingerprint)."""
    doc = frappe.get_doc({
        "doctype": "Rover Certificate", "rover": rover, "common_name": rover,
        "status": "Active", "cert_pem": cert_pem, "serial": serial,
        "fingerprint": fingerprint, "expires_on": expires_on, "issuing_ca": issuing_ca,
    }).insert(ignore_permissions=True)
    if fingerprint:
        frappe.db.set_value("Rover", rover, "tls_cert_fingerprint", fingerprint)
    return doc.name


@frappe.whitelist()
def revoke_rover_certificate(name, reason=None):
    doc = frappe.get_doc("Rover Certificate", name)
    doc.status = "Revoked"
    doc.revoked_reason = reason
    doc.save(ignore_permissions=True)
    return {"name": name, "status": doc.status}


@frappe.whitelist()
def active_rover_certificates(rover=None):
    filters = {"status": "Active"}
    if rover:
        filters["rover"] = rover
    return frappe.get_all(
        "Rover Certificate", filters=filters,
        fields=["name", "rover", "common_name", "serial", "fingerprint", "issued_on", "expires_on"],
    )


# ---- missions (Phase D) ----
@frappe.whitelist()
def upload_mission(title, rover=None, waypoints=None, payload=None):
    """Create a Mission (Draft) with ordered waypoints. Approval runs via the
    'Mission Approval' Frappe Workflow over the status field."""
    import json as _json

    wps = _json.loads(waypoints) if isinstance(waypoints, str) else (waypoints or [])
    doc = frappe.get_doc({
        "doctype": "Mission", "title": title, "rover": rover, "status": "Draft",
        "mission_payload": payload,
        "waypoints": [
            {"seq": i + 1, "x": w.get("x"), "y": w.get("y"), "action": w.get("action")}
            for i, w in enumerate(wps)
        ],
    }).insert(ignore_permissions=True)
    return doc.name


# ---- operator revocation (Phase D) ----
def _next_revocation_epoch():
    rows = frappe.get_all("Operator Revocation", fields=["epoch"], order_by="epoch desc", limit=1)
    return ((rows[0].epoch or 0) + 1) if rows else 1


@frappe.whitelist()
def revoke_operator(operator, scope="All Rovers", rover=None, reason=None):
    """Revoke an operator (fleet-wide or per rover). Bumps the affected allowlist epoch so
    a reconnecting rover detects the change (the reconnect handshake)."""
    epoch = _next_revocation_epoch()
    rev = frappe.get_doc({
        "doctype": "Operator Revocation", "operator": operator, "scope": scope,
        "rover": rover if scope == "Specific Rover" else None,
        "status": "Active", "epoch": epoch, "reason": reason,
    }).insert(ignore_permissions=True)

    filters = {"operator": operator}
    if scope == "Specific Rover" and rover:
        filters["rover"] = rover
    for entry in frappe.get_all("Rover Operator Allowlist", filters=filters, pluck="name"):
        frappe.db.set_value("Rover Operator Allowlist", entry, {"enabled": 0, "epoch": epoch})
    frappe.db.set_value("Operator", operator, "status", "Revoked")
    return {"name": rev.name, "epoch": epoch}


@frappe.whitelist()
def ack_revocation(revocation, rover):
    """A reconnecting rover acknowledges it applied the revocation bundle."""
    doc = frappe.get_doc("Operator Revocation", revocation)
    doc.append("applied_acks", {"rover": rover, "acked_on": now_datetime()})
    doc.save(ignore_permissions=True)
    return {"revocation": revocation, "acked_rovers": len(doc.applied_acks)}


@frappe.whitelist()
def lift_revocation(revocation):
    """Lift a revocation: re-enable the operator and the affected allowlist entries."""
    doc = frappe.get_doc("Operator Revocation", revocation)
    doc.status = "Lifted"
    doc.save(ignore_permissions=True)
    frappe.db.set_value("Operator", doc.operator, "status", "Active")
    filters = {"operator": doc.operator}
    if doc.scope == "Specific Rover" and doc.rover:
        filters["rover"] = doc.rover
    for entry in frappe.get_all("Rover Operator Allowlist", filters=filters, pluck="name"):
        frappe.db.set_value("Rover Operator Allowlist", entry, "enabled", 1)
    return {"revocation": revocation, "status": "Lifted"}


# ---- fleet read ----
@frappe.whitelist()
def list_fleets():
    return frappe.get_all(
        "Fleet",
        fields=["name", "fleet_name", "status", "description"],
        order_by="name",
    )


# ---- mission read ----
@frappe.whitelist()
def list_missions():
    return frappe.get_all(
        "Mission",
        fields=["name", "title", "rover", "status", "approved_by", "approved_on"],
        order_by="creation desc",
    )


@frappe.whitelist()
def get_mission(name):
    """Return a Mission doc as dict with waypoints ordered by seq."""
    doc = frappe.get_doc("Mission", name)
    out = doc.as_dict()
    out["waypoints"] = sorted(
        [{"seq": w.seq, "x": w.x, "y": w.y, "action": w.action} for w in doc.waypoints],
        key=lambda w: w["seq"],
    )
    return out


# ---- operator read ----
@frappe.whitelist()
def list_operators():
    return frappe.get_all(
        "Operator",
        fields=["name", "operator_id", "operator_name", "status", "key_fingerprint", "user"],
        order_by="name",
    )


@frappe.whitelist()
def list_operator_revocations():
    return frappe.get_all(
        "Operator Revocation",
        fields=["name", "operator", "scope", "rover", "status", "epoch", "revoked_on", "reason"],
        order_by="epoch desc",
    )


# ---- PKI reads ----
@frappe.whitelist()
def list_certificates(status=None, rover=None):
    filters = {}
    if status:
        filters["status"] = status
    if rover:
        filters["rover"] = rover
    return frappe.get_all(
        "Rover Certificate",
        filters=filters,
        fields=[
            "name", "rover", "common_name", "status", "serial", "fingerprint",
            "issued_on", "expires_on", "revoked_on", "revoked_reason",
        ],
        order_by="creation desc",
    )


@frappe.whitelist()
def list_certificate_authorities():
    # CA fields: name (=ca_name), ca_name, common_name, ca_type, status, fingerprint, created_on
    return frappe.get_all(
        "Certificate Authority",
        fields=["name", "ca_name", "common_name", "ca_type", "status", "fingerprint", "created_on"],
        order_by="name",
    )


# ---- audit log read ----
@frappe.whitelist()
def list_command_audit(rover=None, limit=50):
    filters = {"rover": rover} if rover else {}
    return frappe.get_all(
        "Command Audit Log",
        filters=filters,
        fields=[
            "name", "rover", "operator", "command_class", "outcome", "category",
            "msg_id", "nonce", "issued_at", "expires_at", "received_at",
        ],
        order_by="received_at desc",
        limit=int(limit),
    )


# ---- security event admin ----
@frappe.whitelist()
def acknowledge_security_event(name):
    doc = frappe.get_doc("Security Event", name)
    doc.acknowledged = 1
    doc.acknowledged_by = frappe.session.user or "operator"
    doc.acknowledged_on = now_datetime()
    doc.save(ignore_permissions=True)
    return {"name": name, "acknowledged": 1}


# ---- settings read ----
@frappe.whitelist()
def get_settings():
    return frappe.get_single("Command Center Settings").as_dict()
