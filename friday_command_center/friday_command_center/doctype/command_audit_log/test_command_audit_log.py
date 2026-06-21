"""Tests for Command Audit Log — append-once immutability."""

import frappe
from frappe.tests import IntegrationTestCase

_BASE = {
    "doctype": "Command Audit Log",
    "command_class": "motion",
    "nonce": 1,
    "outcome": "Accepted",
    "category": "OK",
}


class TestCommandAuditLog(IntegrationTestCase):
    def test_insert_stamps_received_at(self):
        doc = frappe.get_doc(dict(_BASE)).insert(ignore_permissions=True)
        self.assertIsNotNone(doc.received_at)

    def test_entries_are_immutable(self):
        doc = frappe.get_doc(dict(_BASE)).insert(ignore_permissions=True)
        doc.nonce = 99
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)
