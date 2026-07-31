const con = require("../config/dbConfig");
const attendanceModel = require("./attendance");
const homeWorkModel = require("./homeWork");
const assignmentModel = require("./assignment");

const toSqlDate = (value, fallback) => {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : fallback;
};

module.exports = {
  getMonthlyStudentAttendance: attendanceModel.getStdAttendance,
  getDailyClassAttendance: attendanceModel.studentAttendanceView,
  getHomeworkList: homeWorkModel.getHomeWork,
  getAssignmentSubmissions: (assignmentId, classId, sectionId, administrationId, _userName, _pageNo, callback) => {
    assignmentModel
      .getStudentSubmissions(assignmentId, classId, sectionId, administrationId)
      .then((rows) => callback(null, [rows]))
      .catch((err) => callback(err, null));
  },
  getAssignmentReportRows: (body, user, callback) => {
    const { classId, sectionId, startDate, endDate, pageNo } = body;
    const { administrationId, userName, role } = user;
    assignmentModel.getAssignmentStaffReport(
      Number(classId) || 0,
      Number(sectionId) || 0,
      administrationId,
      userName,
      Number(pageNo) || 0,
      toSqlDate(startDate, "2000-01-01"),
      toSqlDate(endDate, "2099-12-31"),
      callback,
      { role, allRows: true }
    );
  },
};
