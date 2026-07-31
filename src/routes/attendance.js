const express = require("express");
const router = express.Router();

const attendanceControllers = require("../controllers/attendance");
const attendanceV2Controllers = require("../controllers/attendanceV2");
const authorize = require("../middleware/authorize");

// ---- v2 normalized attendance (student) ----
router.post(
  "/student/context",
  authorize("Staff", "Admin"),
  attendanceV2Controllers.studentContext
);
router.post(
  "/student/save",
  authorize("Staff", "Admin"),
  attendanceV2Controllers.studentSave
);
router.post(
  "/student/today-periods",
  authorize("Staff", "Admin"),
  attendanceV2Controllers.studentTodayPeriods
);
router.get(
  "/student/today-periods",
  authorize("Staff", "Admin"),
  attendanceV2Controllers.studentTodayPeriods
);
router.get(
  "/student/my-classes",
  authorize("Staff", "Admin"),
  attendanceV2Controllers.studentMyClasses
);
router.post(
  "/student/my-classes",
  authorize("Staff", "Admin"),
  attendanceV2Controllers.studentMyClasses
);
router.post(
  "/student/view",
  authorize("Staff", "Admin"),
  attendanceV2Controllers.studentView
);
router.post(
  "/student/edit",
  authorize("Staff", "Admin"),
  attendanceV2Controllers.studentEdit
);
router.post(
  "/student/my-summary",
  authorize("Student"),
  attendanceV2Controllers.studentMySummary
);
router.get(
  "/student/my-summary",
  authorize("Student"),
  attendanceV2Controllers.studentMySummary
);

// ---- v2 normalized attendance (staff) ----
router.post(
  "/staff/mark",
  authorize("Admin"),
  attendanceV2Controllers.staffMark
);
router.post(
  "/staff/view",
  authorize("Staff", "Admin"),
  attendanceV2Controllers.staffView
);
router.get(
  "/staff/view",
  authorize("Staff", "Admin"),
  attendanceV2Controllers.staffView
);
router.post(
  "/staff/my",
  authorize("Staff"),
  attendanceV2Controllers.staffMy
);
router.get(
  "/staff/my",
  authorize("Staff"),
  attendanceV2Controllers.staffMy
);
router.post(
  "/staff/edit",
  authorize("Admin"),
  attendanceV2Controllers.staffEdit
);

// ---- legacy endpoints (kept backward compatible) ----
router.post(
  "/create_student_attendance",
  attendanceControllers.createStdAttendance
);
router.post(
  "/get_student_attendance_view",
  attendanceControllers.studentAttendanceView
);
router.post(
  "/create_staff_attendance",
  attendanceControllers.createStffAttendance
);
router.post("/get_student_attendance", attendanceControllers.getStdAttendance);
router.post(
  "/get_staff_attendance_view",
  attendanceControllers.staffAttendanceView
);

module.exports = router;
