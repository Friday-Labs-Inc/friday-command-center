"""Command Audit Log — the immutable record of every command crossing the boundary.

One row per command (accepted or rejected), with the operator, rover, nonce,
signature, and the validation category the rover would assign. Entries are
write-once: any attempt to edit an existing row is rejected.
"""

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


class CommandAuditLog(Document):
    def validate(self):
        if not self.is_new():
            frappe.throw(_("Command Audit Log entries are immutable and cannot be edited."))
        if not self.received_at:
            self.received_at = now_datetime()
