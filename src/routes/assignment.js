const express = require("express");
const router = express.Router();

const assignmentControllers = require("../controllers/assignment");
const authorize = require("../middleware/authorize");

router.get("/get_assignment", assignmentControllers.getAssignment);
router.get(
  "/get_assignment_staff_view",
  authorize("Staff", "Admin"),
  assignmentControllers.getAssignmentStaff
);
router.post(
  "/get_assignment_staff_view",
  authorize("Staff", "Admin"),
  assignmentControllers.getAssignmentStaff
);
router.post(
  "/get_assignment_staff_report",
  authorize("Staff", "Admin"),
  assignmentControllers.getAssignmentStaffReport
);
router.get(
  "/get_assignment_staff_report",
  authorize("Staff", "Admin"),
  assignmentControllers.getAssignmentStaffReport
);
router.post(
  "/create_update_assignment",
  authorize("Staff", "Admin"),
  assignmentControllers.createUpdateAssignment
);
router.post(
  "/update_assignment_status/:id",
  authorize("Staff", "Admin"),
  assignmentControllers.updateAssignmentStatus
);
router.post(
  "/update_assignment_progress",
  authorize("Student"),
  assignmentControllers.updateAssignmentProgress
);
router.post(
  "/delete_assignment/:id",
  authorize("Staff", "Admin"),
  assignmentControllers.deleteAssignment
);

module.exports = router;
