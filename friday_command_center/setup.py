"""Bootstrap helpers for the Friday Command Center control plane.

`ensure_roles` creates the RBAC roles the DocTypes reference; `smoke` inserts a
sample Rover + Operator to exercise the schema and controller validation. Both are
idempotent so they are safe to re-run on the bench scratch site.
"""

import frappe

CUSTOM_ROLES = ["Fleet Admin", "Fleet Operator", "Mission Approver", "Auditor"]


def ensure_roles():
    """Create the Command Center RBAC roles (idempotent)."""
    for role_name in CUSTOM_ROLES:
        if not frappe.db.exists("Role", role_name):
            frappe.get_doc(
                {"doctype": "Role", "role_name": role_name, "desk_access": 1}
            ).insert(ignore_permissions=True)
    frappe.db.commit()
    print("roles ensured:", ", ".join(CUSTOM_ROLES))


DOCTYPES = [
    "Fleet",
    "Rover",
    "Operator",
    "Rover Operator Allowlist",
    "Operator Nonce Counter",
    "Command Audit Log",
    "Security Event",
    "Operator Revocation",
    "Mission",
]


def _ensure(doctype, name, values):
    if not frappe.db.exists(doctype, name):
        frappe.get_doc({"doctype": doctype, **values}).insert(ignore_permissions=True)


def smoke():
    """Insert one sample of the core records to exercise schema, links, validation."""
    _ensure("Fleet", "Bench Fleet", {"fleet_name": "Bench Fleet"})
    _ensure("Rover", "MARK1-001", {
        "rover_id": "MARK1-001", "rover_name": "Mark 1 (bench)",
        "status": "Active", "protocol_major": 0, "fleet": "Bench Fleet"})
    _ensure("Operator", "OP-001", {
        "operator_id": "OP-001", "operator_name": "Bench Operator",
        "status": "Active", "ed25519_public_key": "0" * 64})
    _ensure("Rover Operator Allowlist", "MARK1-001::OP-001", {
        "rover": "MARK1-001", "operator": "OP-001", "enabled": 1})
    _ensure("Operator Nonce Counter", "MARK1-001::OP-001", {
        "rover": "MARK1-001", "operator": "OP-001", "last_nonce": 0})
    if frappe.db.count("Command Audit Log") == 0:
        frappe.get_doc({
            "doctype": "Command Audit Log", "rover": "MARK1-001", "operator": "OP-001",
            "command_class": "motion", "nonce": 1, "outcome": "Accepted",
            "category": "OK"}).insert(ignore_permissions=True)
    frappe.db.commit()
    print("counts:", {dt: frappe.db.count(dt) for dt in DOCTYPES})
