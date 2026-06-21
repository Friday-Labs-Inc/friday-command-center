"""Tests for the operator-revocation workflow: revoke -> ack -> lift."""

import frappe
from frappe.tests import IntegrationTestCase

from friday_command_center import api


class TestOperatorRevocation(IntegrationTestCase):
    def setUp(self):
        for name, doc in (
            ("RVK-ROVER", {"doctype": "Rover", "rover_id": "RVK-ROVER", "status": "Active"}),
            ("RVK-OP", {"doctype": "Operator", "operator_id": "RVK-OP", "status": "Active",
                        "ed25519_public_key": "ab" * 32}),
        ):
            if not frappe.db.exists(doc["doctype"], name):
                frappe.get_doc(doc).insert(ignore_permissions=True)
        if not frappe.db.exists("Rover Operator Allowlist", "RVK-ROVER::RVK-OP"):
            frappe.get_doc({
                "doctype": "Rover Operator Allowlist", "rover": "RVK-ROVER",
                "operator": "RVK-OP", "enabled": 1}).insert(ignore_permissions=True)

    def test_revoke_disables_allowlist_and_blocks_nonce(self):
        res = api.revoke_operator("RVK-OP", scope="All Rovers", reason="key compromised")
        self.assertGreaterEqual(res["epoch"], 1)
        self.assertEqual(frappe.db.get_value("Operator", "RVK-OP", "status"), "Revoked")
        self.assertEqual(
            frappe.db.get_value("Rover Operator Allowlist", "RVK-ROVER::RVK-OP", "enabled"), 0)
        self.assertEqual(
            frappe.db.get_value("Rover Operator Allowlist", "RVK-ROVER::RVK-OP", "epoch"),
            res["epoch"])
        with self.assertRaises(frappe.PermissionError):
            api.issue_nonce("RVK-ROVER", "RVK-OP")

    def test_ack_then_lift_re_enables(self):
        res = api.revoke_operator("RVK-OP", scope="All Rovers")
        ack = api.ack_revocation(res["name"], "RVK-ROVER")
        self.assertEqual(ack["acked_rovers"], 1)
        lift = api.lift_revocation(res["name"])
        self.assertEqual(lift["status"], "Lifted")
        self.assertEqual(frappe.db.get_value("Operator", "RVK-OP", "status"), "Active")
        self.assertEqual(
            frappe.db.get_value("Rover Operator Allowlist", "RVK-ROVER::RVK-OP", "enabled"), 1)
