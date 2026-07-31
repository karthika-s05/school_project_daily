const express = require("express");
const router = express.Router();
const reportsController = require("../controllers/reports");
const attendanceReportsController = require("../controllers/attendanceReports");
const authorize = require("../middleware/authorize");

router.post("/get_overview", reportsController.getOverview);

router.post("/assignment/get_report", reportsController.getAssignmentReport);
router.post(
  "/assignment/get_class_wise",
  reportsController.getClassWiseAssignment
);
router.post(
  "/assignment/get_subject_wise",
  reportsController.getSubjectWiseAssignment
);
router.post(
  "/assignment/get_student_wise",
  reportsController.getStudentWiseAssignment
);
router.post("/assignment/export", reportsController.exportAssignmentReport);

router.post(
  "/attendance/get_student_monthly",
  reportsController.getAttendanceStudentMonthly
);
router.post(
  "/attendance/get_class_daily",
  reportsController.getAttendanceClassDaily
);
router.post("/attendance/export", reportsController.exportAttendanceReport);

// Normalized attendance reports (institution-level filters)
router.post(
  "/attendance/student",
  authorize("Staff", "Admin"),
  attendanceReportsController.studentReport
);
router.post(
  "/attendance/staff",
  authorize("Admin"),
  attendanceReportsController.staffReport
);
router.post(
  "/attendance/daily",
  authorize("Staff", "Admin"),
  attendanceReportsController.dailyReport
);
router.post(
  "/attendance/monthly",
  authorize("Staff", "Admin"),
  attendanceReportsController.monthlyReport
);
router.post(
  "/attendance/class_wise",
  authorize("Staff", "Admin"),
  attendanceReportsController.classWiseReport
);
router.post(
  "/attendance/subject_wise",
  authorize("Staff", "Admin"),
  attendanceReportsController.subjectWiseReport
);
router.post(
  "/attendance/absent_students",
  authorize("Staff", "Admin"),
  attendanceReportsController.absentStudentsReport
);
router.post(
  "/attendance/absent_staff",
  authorize("Admin"),
  attendanceReportsController.absentStaffReport
);
router.post(
  "/attendance/export_v2",
  authorize("Staff", "Admin"),
  attendanceReportsController.exportReport
);

router.post("/homework/get_report", reportsController.getHomeworkReport);
router.post("/homework/export", reportsController.exportHomeworkReport);

module.exports = router;
