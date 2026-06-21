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


def provision_for_smoke(operator="OP-001"):
    """Dev helper for the Phase B bridge smoke: mint an operator keypair (store the
    public half on the Operator, print the private half) + Administrator API keys."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from frappe.core.doctype.user.user import generate_keys

    priv = Ed25519PrivateKey.generate()
    priv_hex = priv.private_bytes(
        serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
        serialization.NoEncryption()).hex()
    pub_hex = priv.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()

    doc = frappe.get_doc("Operator", operator)
    doc.ed25519_public_key = pub_hex
    doc.save(ignore_permissions=True)

    # mint a rover telemetry-signing key too (public half on the Rover)
    rpriv = Ed25519PrivateKey.generate()
    rpriv_hex = rpriv.private_bytes(
        serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
        serialization.NoEncryption()).hex()
    rpub_hex = rpriv.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()
    rover = frappe.get_doc("Rover", "MARK1-001")
    rover.signing_public_key = rpub_hex
    rover.save(ignore_permissions=True)

    res = generate_keys("Administrator")
    api_secret = res["api_secret"] if isinstance(res, dict) else res
    api_key = frappe.db.get_value("User", "Administrator", "api_key")
    frappe.db.commit()

    print("SMOKE_OP_PRIV", priv_hex)
    print("SMOKE_ROVER_PRIV", rpriv_hex)
    print("SMOKE_API_KEY", api_key)
    print("SMOKE_API_SECRET", api_secret)


def ensure_mission_workflow():
    """Create the 'Mission Approval' Frappe Workflow over the Mission.status field (idempotent)."""
    states = [
        ("Draft", "0", "Fleet Operator"),
        ("Pending Approval", "0", "Mission Approver"),
        ("Approved", "0", "Mission Approver"),
        ("Active", "0", "Fleet Admin"),
        ("Complete", "0", "Fleet Admin"),
        ("Aborted", "0", "Fleet Admin"),
    ]
    transitions = [
        ("Draft", "Submit for Approval", "Pending Approval", "Fleet Operator"),
        ("Pending Approval", "Approve", "Approved", "Mission Approver"),
        ("Pending Approval", "Reject", "Draft", "Mission Approver"),
        ("Approved", "Activate", "Active", "Fleet Admin"),
        ("Active", "Complete", "Complete", "Fleet Admin"),
        ("Active", "Abort", "Aborted", "Fleet Admin"),
    ]
    for state, _, _ in states:
        if not frappe.db.exists("Workflow State", state):
            frappe.get_doc(
                {"doctype": "Workflow State", "workflow_state_name": state}
            ).insert(ignore_permissions=True)
    for _, action, _, _ in transitions:
        if not frappe.db.exists("Workflow Action Master", action):
            frappe.get_doc(
                {"doctype": "Workflow Action Master", "workflow_action_name": action}
            ).insert(ignore_permissions=True)
    if not frappe.db.exists("Workflow", "Mission Approval"):
        frappe.get_doc({
            "doctype": "Workflow", "workflow_name": "Mission Approval", "document_type": "Mission",
            "workflow_state_field": "status", "is_active": 1, "send_email_alert": 0,
            "states": [{"state": s, "doc_status": ds, "allow_edit": role} for s, ds, role in states],
            "transitions": [{"state": st, "action": ac, "next_state": ns, "allowed": role,
                             "allow_self_approval": 1} for st, ac, ns, role in transitions],
        }).insert(ignore_permissions=True)
    frappe.db.commit()
    print("Mission Approval workflow ensured")
