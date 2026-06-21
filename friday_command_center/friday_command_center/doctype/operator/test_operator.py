"""Tests for Operator — the Ed25519 public-key validation."""

import frappe
from frappe.tests import IntegrationTestCase


class TestOperator(IntegrationTestCase):
    def test_valid_key_sets_fingerprint(self):
        op = frappe.get_doc(
            {
                "doctype": "Operator",
                "operator_id": "OP-TEST-VALID",
                "status": "Active",
                "ed25519_public_key": "ab" * 32,
            }
        ).insert(ignore_permissions=True)
        self.assertEqual(len(op.ed25519_public_key), 64)
        self.assertEqual(len(op.key_fingerprint), 16)

    def test_short_key_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "Operator",
                    "operator_id": "OP-TEST-SHORT",
                    "status": "Active",
                    "ed25519_public_key": "abcd",
                }
            ).insert(ignore_permissions=True)

    def test_non_hex_key_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(
                {
                    "doctype": "Operator",
                    "operator_id": "OP-TEST-NONHEX",
                    "status": "Active",
                    "ed25519_public_key": "zz" * 32,
                }
            ).insert(ignore_permissions=True)
