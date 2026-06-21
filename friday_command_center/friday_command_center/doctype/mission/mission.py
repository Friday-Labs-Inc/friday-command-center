"""Mission — a planned task for a rover, with an approval lifecycle.

Phase A is the record + status model; the full approval workflow, waypoint child
table, and on-approve dispatch land in Phase D.
"""

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class Mission(Document):
    def validate(self):
        if self.status == "Approved" and not self.approved_by:
            self.approved_by = frappe.session.user
            self.approved_on = now_datetime()
