"""Tests for the rover-certificate lifecycle: issue -> stamp fingerprint -> revoke."""

import frappe
from frappe.tests import IntegrationTestCase

from friday_command_center import api


class TestRoverCertificate(IntegrationTestCase):
    def setUp(self):
        if not frappe.db.exists("Rover", "CERTROVER"):
            frappe.get_doc(
                {"doctype": "Rover", "rover_id": "CERTROVER", "status": "Active"}
            ).insert(ignore_permissions=True)

    def test_issue_stamps_fingerprint_and_is_active(self):
        name = api.issue_rover_certificate("CERTROVER", fingerprint="abc123", serial="01")
        self.assertEqual(frappe.db.get_value("Rover Certificate", name, "status"), "Active")
        self.assertEqual(frappe.db.get_value("Rover", "CERTROVER", "tls_cert_fingerprint"), "abc123")
        self.assertIsNotNone(frappe.db.get_value("Rover Certificate", name, "issued_on"))

    def test_revoke_sets_status_and_timestamp(self):
        name = api.issue_rover_certificate("CERTROVER", serial="02")
        res = api.revoke_rover_certificate(name, reason="key compromised")
        self.assertEqual(res["status"], "Revoked")
        self.assertIsNotNone(frappe.db.get_value("Rover Certificate", name, "revoked_on"))

    def test_active_list_excludes_revoked(self):
        name = api.issue_rover_certificate("CERTROVER", serial="03")
        api.revoke_rover_certificate(name)
        active_names = [c["name"] for c in api.active_rover_certificates("CERTROVER")]
        self.assertNotIn(name, active_names)
