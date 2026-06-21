"""Tests for the control-plane API: monotonic nonce issuance + allowlist gating."""

import frappe
from frappe.tests import IntegrationTestCase

from friday_command_center import api


class TestNonceAndAllowlist(IntegrationTestCase):
    def setUp(self):
        if not frappe.db.exists("Rover", "RTEST"):
            frappe.get_doc(
                {"doctype": "Rover", "rover_id": "RTEST", "status": "Active"}
            ).insert(ignore_permissions=True)
        if not frappe.db.exists("Operator", "OPTEST"):
            frappe.get_doc(
                {
                    "doctype": "Operator",
                    "operator_id": "OPTEST",
                    "status": "Active",
                    "ed25519_public_key": "ab" * 32,
                }
            ).insert(ignore_permissions=True)
        if not frappe.db.exists("Rover Operator Allowlist", "RTEST::OPTEST"):
            frappe.get_doc(
                {
                    "doctype": "Rover Operator Allowlist",
                    "rover": "RTEST",
                    "operator": "OPTEST",
                    "enabled": 1,
                }
            ).insert(ignore_permissions=True)

    def test_nonce_is_monotonic(self):
        nonces = [api.issue_nonce("RTEST", "OPTEST") for _ in range(3)]
        self.assertEqual(nonces, [1, 2, 3])

    def test_not_allowlisted_rejected(self):
        frappe.get_doc(
            {
                "doctype": "Operator",
                "operator_id": "OPTEST2",
                "status": "Active",
                "ed25519_public_key": "cd" * 32,
            }
        ).insert(ignore_permissions=True)
        with self.assertRaises(frappe.PermissionError):
            api.issue_nonce("RTEST", "OPTEST2")

    def test_revoked_operator_rejected(self):
        frappe.get_doc(
            {
                "doctype": "Operator Revocation",
                "operator": "OPTEST",
                "scope": "All Rovers",
                "status": "Active",
            }
        ).insert(ignore_permissions=True)
        with self.assertRaises(frappe.PermissionError):
            api.issue_nonce("RTEST", "OPTEST")

    def test_get_allowlist_returns_active_enabled(self):
        operators = [row["operator"] for row in api.get_allowlist("RTEST")]
        self.assertIn("OPTEST", operators)
