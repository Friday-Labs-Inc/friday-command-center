"""Rover — a fleet member in the Command Center registry."""

import frappe
from frappe.model.document import Document


class Rover(Document):
    def validate(self):
        self.rover_id = (self.rover_id or "").strip()
        if not self.rover_id:
            frappe.throw("Rover ID is required.")
