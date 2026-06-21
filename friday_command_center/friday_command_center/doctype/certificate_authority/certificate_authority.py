"""Certificate Authority — the fleet's CA record (public cert + metadata).

The CA private key is never stored here; it lives offline / in an HSM. This DocType is
the control-plane record of the CA used to issue rover mTLS certificates.
"""

from frappe.model.document import Document
from frappe.utils import now_datetime


class CertificateAuthority(Document):
    def validate(self):
        if not self.created_on:
            self.created_on = now_datetime()
