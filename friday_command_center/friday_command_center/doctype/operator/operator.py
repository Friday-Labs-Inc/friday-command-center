"""Operator — a human authorized to sign commands for the fleet.

The Ed25519 public key here is the one the rover's Telemetry agent allowlists and
verifies signatures against (see the rover's protocol.py). The private half never
reaches the Command Center — only the public key is stored.
"""

import hashlib

import frappe
from frappe.model.document import Document


class Operator(Document):
    def validate(self):
        self._normalize_and_check_key()

    def _normalize_and_check_key(self):
        key = (self.ed25519_public_key or "").strip().lower()
        if not key:
            frappe.throw("Ed25519 public key is required.")
        if len(key) != 64:
            frappe.throw(
                f"Ed25519 public key must be 64 hex characters (32 bytes); got {len(key)}."
            )
        try:
            raw = bytes.fromhex(key)
        except ValueError:
            frappe.throw("Ed25519 public key must be valid hex.")
        self.ed25519_public_key = key
        self.key_fingerprint = hashlib.sha256(raw).hexdigest()[:16]
