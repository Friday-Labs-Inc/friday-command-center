"""Operator Nonce Counter — the control plane's authoritative per-(rover, operator)
monotonic nonce. The `issue_nonce` API increments this atomically when signing a
command, keeping the Command Center's nonces strictly above the rover's replay floor.
"""

from frappe.model.document import Document


class OperatorNonceCounter(Document):
    pass
