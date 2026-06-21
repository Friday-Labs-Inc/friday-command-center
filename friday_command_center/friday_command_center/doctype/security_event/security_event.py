"""Security Event — an ingested security-relevant FaultReport from a rover.

The rover's Telemetry agent emits FaultReports (SECURITY_AUTH, SECURITY_REPLAY, ...)
when it rejects a command; the bridge maps those to Security Events here for alerting
and review. Acknowledgement is stamped with the user + time.
"""

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime


class SecurityEvent(Document):
    def validate(self):
        if not self.event_time:
            self.event_time = now_datetime()
        if self.acknowledged and not self.acknowledged_by:
            self.acknowledged_by = frappe.session.user
            self.acknowledged_on = now_datetime()
