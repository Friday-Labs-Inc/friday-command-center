"""Rover Certificate — the control-plane record of a rover's mTLS client certificate
(CN = rover_id). Tracks issuance, expiry, and revocation so a compromised rover's cert
can be revoked from the system of record.
"""

from frappe.model.document import Document
from frappe.utils import now_datetime


class RoverCertificate(Document):
    def validate(self):
        if self.rover and not self.common_name:
            self.common_name = self.rover
        if not self.issued_on:
            self.issued_on = now_datetime()
        if self.status == "Revoked" and not self.revoked_on:
            self.revoked_on = now_datetime()
