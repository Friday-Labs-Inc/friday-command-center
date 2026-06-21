"""Rover Operator Allowlist — which operators a given rover trusts to command it.

This is the per-rover trust the data-plane bridge reads (the rover's Telemetry agent
allowlists the same operator keys). `epoch` bumps on change so an offline rover can
detect a stale allowlist on reconnect.
"""

from frappe.model.document import Document
from frappe.utils import now_datetime


class RoverOperatorAllowlist(Document):
    def validate(self):
        if not self.granted_on:
            self.granted_on = now_datetime()
        if not self.epoch:
            self.epoch = 1
