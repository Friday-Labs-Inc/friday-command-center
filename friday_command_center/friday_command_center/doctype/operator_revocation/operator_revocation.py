"""Operator Revocation — revoke an operator's authority, fleet-wide or per rover.

Carries a monotonic `epoch`; the reconnect handshake requires a returning rover to
ACK at least this epoch before it will accept the operator's commands again. The
`applied_acks` table records which rovers have confirmed the revocation.
"""

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class OperatorRevocation(Document):
    def validate(self):
        if not self.revoked_on:
            self.revoked_on = now_datetime()
        if not self.revoked_by:
            self.revoked_by = frappe.session.user
        if not self.epoch:
            self.epoch = 1
