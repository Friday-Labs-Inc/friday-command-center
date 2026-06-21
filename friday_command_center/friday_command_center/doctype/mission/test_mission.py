"""Tests for Mission upload + the 'Mission Approval' Frappe Workflow."""

import frappe
from frappe.model.workflow import apply_workflow
from frappe.tests import IntegrationTestCase

from friday_command_center import api, setup


class TestMissionWorkflow(IntegrationTestCase):
    def setUp(self):
        setup.ensure_mission_workflow()
        if not frappe.db.exists("Rover", "MROVER"):
            frappe.get_doc(
                {"doctype": "Rover", "rover_id": "MROVER", "status": "Active"}
            ).insert(ignore_permissions=True)
        # give the test user the workflow roles so transitions are allowed
        admin = frappe.get_doc("User", "Administrator")
        have = {r.role for r in admin.roles}
        for role in ("Fleet Operator", "Mission Approver", "Fleet Admin"):
            if role not in have:
                admin.append("roles", {"role": role})
        admin.save(ignore_permissions=True)

    def test_upload_creates_draft_with_waypoints(self):
        name = api.upload_mission(
            "Survey field", rover="MROVER",
            waypoints=[{"x": 1.0, "y": 2.0, "action": "scan"},
                       {"x": 3.0, "y": 4.0, "action": "photo"}])
        doc = frappe.get_doc("Mission", name)
        self.assertEqual(doc.status, "Draft")
        self.assertEqual(len(doc.waypoints), 2)
        self.assertEqual(doc.waypoints[0].action, "scan")

    def test_approval_workflow_transitions(self):
        name = api.upload_mission("Patrol", rover="MROVER",
                                  waypoints=[{"x": 0.0, "y": 0.0, "action": "go"}])
        apply_workflow(frappe.get_doc("Mission", name), "Submit for Approval")
        self.assertEqual(frappe.db.get_value("Mission", name, "status"), "Pending Approval")
        apply_workflow(frappe.get_doc("Mission", name), "Approve")
        self.assertEqual(frappe.db.get_value("Mission", name, "status"), "Approved")
        apply_workflow(frappe.get_doc("Mission", name), "Activate")
        self.assertEqual(frappe.db.get_value("Mission", name, "status"), "Active")
