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
