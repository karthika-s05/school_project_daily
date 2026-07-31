const reportsModel = require("../models/reports");
const assignmentModel = require("../models/assignment");

const toCsv = (rows, headers, filename) => ({
  csv: [
    headers.join(","),
    ...rows.map((r) =>
      headers
        .map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n"),
  rows,
  filename,
});

const filterAssignments = (rows, { search, classId, subjectId, status }) => {
  let list = rows || [];
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(
      (r) =>
        (r.title || "").toLowerCase().includes(q) ||
        (r.subjectName || "").toLowerCase().includes(q) ||
        (r.staffName || "").toLowerCase().includes(q)
    );
  }
  if (classId && classId !== "All")
    list = list.filter((r) => String(r.classId) === String(classId));
  if (subjectId && subjectId !== "All")
    list = list.filter((r) => String(r.subjectId) === String(subjectId));
  if (status && status !== "All")
    list = list.filter((r) => (r.status || "") === status);
  return list;
};

const subjectWiseFromRows = (rows) => {
  const map = {};
  rows.forEach((r) => {
    const sub = r.subjectName || r.subject || "Unknown";
    if (!map[sub])
      map[sub] = { subject: sub, assignments: 0, submitted: 0, total: 0 };
    map[sub].assignments += 1;
    map[sub].submitted += Number(r.submitted || 0);
    map[sub].total += Number(r.totalStudents || 0);
  });
  return Object.values(map).map((s) => ({
    ...s,
    submissionRate: s.total ? Math.round((s.submitted / s.total) * 100) : 0,
  }));
};

const filterHomework = (rows, { search, subjectId, startDate, endDate }) => {
  let list = rows || [];
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(
      (r) =>
        (r.description || "").toLowerCase().includes(q) ||
        (r.subjectName || "").toLowerCase().includes(q) ||
        (r.staffName || "").toLowerCase().includes(q)
    );
  }
  if (subjectId && subjectId !== "All")
    list = list.filter((r) => String(r.subjectId) === String(subjectId));
  if (startDate)
    list = list.filter((r) => !r.createdDate || r.createdDate >= startDate);
  if (endDate)
    list = list.filter((r) => !r.createdDate || r.createdDate <= endDate);
  return list;
};

// sp_getAssignmentReport requires DATE params; empty string causes
// "Incorrect date value: '' for column '_startDate'".
const toSqlDate = (value, fallback) => {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : fallback;
};

const fetchAssignmentRows = (body, user, cb) => {
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
    cb,
    { role, allRows: true }
  );
};

module.exports = {
  getOverview: async (req, res) => {
    const { classId, sectionId } = req.body;
    const { administrationId, userName } = req.user;
    if (!administrationId || !classId || !sectionId) {
      return res.send({
        status: "Error",
        message: "classId and sectionId are required",
      });
    }

    fetchAssignmentRows(
      { classId, sectionId },
      req.user,
      (err, assignmentData) => {
        reportsModel.getHomeworkList(
          classId,
          sectionId,
          administrationId,
          (hwErr, homeworkData) => {
            const assignments = !err ? assignmentData[0] || [] : [];
            const homework = !hwErr ? homeworkData[0] || [] : [];

            res.send({
              status: "success",
              message: "Reports overview retrieved",
              data: {
                assignment: {
                  total: assignments.length,
                  active: assignments.filter((r) => r.status === "Active")
                    .length,
                  closed: assignments.filter((r) => r.status === "Closed")
                    .length,
                },
                homework: { total: homework.length },
                modules: [
                  "assignment",
                  "attendance",
                  "homework",
                  "exam",
                ],
              },
            });
          }
        );
      }
    );
  },

  getAssignmentReport: async (req, res) => {
    const {
      classId,
      sectionId,
      search,
      subjectId,
      status,
      startDate,
      endDate,
      pageNo,
    } = req.body;
    const { administrationId } = req.user;
    if (!administrationId || !classId || !sectionId) {
      return res.send({
        status: "Error",
        message: "classId and sectionId are required",
      });
    }
    fetchAssignmentRows(req.body, req.user, (err, data) => {
      if (err) {
        return res.send({
          status: "Error",
          message: "Assignment report not retrieved",
          data: err.sqlMessage || err,
        });
      }
      const rows = data[0] || [];
      const filtered = filterAssignments(rows, {
        search,
        classId,
        subjectId,
        status,
      });
      const totalSubmitted = filtered.reduce(
        (s, r) => s + Number(r.submitted || 0),
        0
      );
      const totalStudents = filtered.reduce(
        (s, r) => s + Number(r.totalStudents || 0),
        0
      );
      res.send({
        status: "success",
        message: "Assignment report retrieved",
        data: filtered,
        summary: {
          total: filtered.length,
          active: filtered.filter((r) => r.status === "Active").length,
          closed: filtered.filter((r) => r.status === "Closed").length,
          submissionRate: totalStudents
            ? Math.round((totalSubmitted / totalStudents) * 100)
            : 0,
        },
      });
    });
  },

  getClassWiseAssignment: async (req, res) => {
    const { classId, sectionId, startDate, endDate } = req.body;
    const { administrationId } = req.user;
    if (!administrationId || !classId || !sectionId) {
      return res.send({
        status: "Error",
        message: "classId and sectionId are required",
      });
    }
    fetchAssignmentRows(req.body, req.user, (err, data) => {
      if (err) {
        return res.send({
          status: "Error",
          message: "Class-wise assignment report failed",
          data: err.sqlMessage || err,
        });
      }
      const rows = data[0] || [];
      const map = {};
      rows.forEach((r) => {
        const cls = r.className || r.classId || "Unknown";
        if (!map[cls])
          map[cls] = { cls, assignments: 0, submitted: 0, total: 0 };
        map[cls].assignments += 1;
        map[cls].submitted += Number(r.submitted || 0);
        map[cls].total += Number(r.totalStudents || 0);
      });
      res.send({
        status: "success",
        message: "Class-wise assignment report retrieved",
        data: Object.values(map).map((c) => ({
          ...c,
          submissionRate: c.total
            ? Math.round((c.submitted / c.total) * 100)
            : 0,
        })),
      });
    });
  },

  getSubjectWiseAssignment: async (req, res) => {
    const { classId, sectionId, startDate, endDate } = req.body;
    const { administrationId } = req.user;
    if (!administrationId || !classId || !sectionId) {
      return res.send({
        status: "Error",
        message: "classId and sectionId are required",
      });
    }
    fetchAssignmentRows(req.body, req.user, (err, data) => {
      if (err) {
        return res.send({
          status: "Error",
          message: "Subject-wise assignment report failed",
          data: err.sqlMessage || err,
        });
      }
      res.send({
        status: "success",
        message: "Subject-wise assignment report retrieved",
        data: subjectWiseFromRows(data[0] || []),
      });
    });
  },

  getStudentWiseAssignment: async (req, res) => {
    const { assignmentId, classId, sectionId } = req.body;
    const { administrationId, userName } = req.user;
    if (!administrationId || !assignmentId || !classId || !sectionId) {
      return res.send({
        status: "Error",
        message: "assignmentId, classId and sectionId are required",
      });
    }
    reportsModel.getAssignmentSubmissions(
      assignmentId,
      classId,
      sectionId,
      administrationId,
      userName,
      0,
      (err, data) => {
        if (err) {
          return res.send({
            status: "Error",
            message: "Student-wise assignment report failed",
            data: err.sqlMessage || err,
          });
        }
        const rows = data[0] || [];
        const submitted = rows.filter(
          (r) => r.status === "Submitted" || r.submitted === 1 || r.isSubmitted
        ).length;
        res.send({
          status: "success",
          message: "Student-wise assignment report retrieved",
          data: rows,
          summary: {
            total: rows.length,
            submitted,
            pending: Math.max(0, rows.length - submitted),
          },
        });
      }
    );
  },

  exportAssignmentReport: async (req, res) => {
    const { classId, sectionId, startDate, endDate, search, subjectId, status } =
      req.body;
    const { administrationId } = req.user;
    if (!administrationId || !classId || !sectionId) {
      return res.send({
        status: "Error",
        message: "classId and sectionId are required",
      });
    }
    fetchAssignmentRows(req.body, req.user, (err, data) => {
      if (err) {
        return res.send({
          status: "Error",
          message: "Export failed",
          data: err.sqlMessage || err,
        });
      }
      const rows = filterAssignments(data[0] || [], {
        search,
        classId,
        subjectId,
        status,
      });
      const headers = [
        "title",
        "subjectName",
        "className",
        "sectionName",
        "staffName",
        "startDate",
        "endDate",
        "submitted",
        "totalStudents",
        "status",
      ];
      res.send({
        status: "success",
        message: "Export ready",
        data: toCsv(rows, headers, "assignment_report.csv"),
      });
    });
  },

  getAttendanceStudentMonthly: async (req, res) => {
    const { studentId, classId, sectionId, month } = req.body;
    const { administrationId } = req.user;
    if (!administrationId || !studentId || !classId || !sectionId) {
      return res.send({
        status: "Error",
        message: "studentId, classId and sectionId are required",
      });
    }
    // Accept a month number (legacy) or a "YYYY-MM" string (newer clients);
    // the SP only understands a month number.
    let monthNumber = 0;
    if (typeof month === "string" && /^\d{4}-\d{2}/.test(month)) {
      monthNumber = Number(month.slice(5, 7)) || 0;
    } else if (month !== undefined && month !== null && month !== "") {
      monthNumber = Number(month) || 0;
    }
    reportsModel.getMonthlyStudentAttendance(
      studentId,
      classId,
      sectionId,
      monthNumber,
      administrationId,
      (err, attendance) => {
        if (err) {
          return res.send({
            status: "Error",
            message: "Attendance report not retrieved",
            data: err.sqlMessage || err,
          });
        }
        const workingDays = attendance[0]?.[0]?.totalWorkingDays || 0;
        const presented = attendance[1]?.[0]?.presented || 0;
        const percentage =
          workingDays === 0
            ? 0
            : Math.round((presented / workingDays) * 100);
        const leaveDates =
          monthNumber !== 0
            ? (attendance[2] || []).map((d) => d.date)
            : [];
        res.send({
          status: "success",
          message: "Student monthly attendance report retrieved",
          data: {
            workingDays,
            present: presented,
            absent: workingDays - presented,
            percentage,
            leaveDates,
            calendar: attendance[0] || [],
          },
        });
      }
    );
  },

  getAttendanceClassDaily: async (req, res) => {
    const { classId, sectionId, date } = req.body;
    const { administrationId } = req.user;
    if (!administrationId || !classId || !sectionId || !date) {
      return res.send({
        status: "Error",
        message: "classId, sectionId and date are required",
      });
    }
    reportsModel.getDailyClassAttendance(
      classId,
      sectionId,
      "All",
      date,
      administrationId,
      (err, attendance) => {
        if (err) {
          return res.send({
            status: "Error",
            message: "Class daily attendance report not retrieved",
            data: err.sqlMessage || err,
          });
        }
        const rows = attendance[0] || [];
        const present = rows.filter(
          (r) => r.status === "P" || r.status === "Present"
        ).length;
        const absent = rows.filter(
          (r) => r.status === "A" || r.status === "Absent"
        ).length;
        res.send({
          status: "success",
          message: "Class daily attendance report retrieved",
          data: rows,
          summary: {
            total: rows.length,
            present,
            absent,
            holiday: rows.filter((r) => r.status === "H").length,
            attendanceRate: rows.length
              ? Math.round((present / rows.length) * 100)
              : 0,
          },
        });
      }
    );
  },

  exportAttendanceReport: async (req, res) => {
    const { classId, sectionId } = req.body;
    // Older clients send reqDate, newer ones send date; accept both.
    const reqDate = req.body.reqDate || req.body.date;
    const { administrationId } = req.user;
    if (!administrationId || !classId || !sectionId || !reqDate) {
      return res.send({
        status: "Error",
        message: "classId, sectionId and date (or reqDate) are required",
      });
    }
    reportsModel.getDailyClassAttendance(
      classId,
      sectionId,
      "All",
      reqDate,
      administrationId,
      (err, attendance) => {
        if (err) {
          return res.send({
            status: "Error",
            message: "Attendance export failed",
            data: err.sqlMessage || err,
          });
        }
        const rows = attendance[0] || [];
        const preferred = [
          "studentId",
          "studentName",
          "admissionNo",
          "status",
          "date",
        ];
        const headers = rows.length
          ? preferred.filter((h) => h in rows[0])
          : preferred;
        res.send({
          status: "success",
          message: "Export ready",
          data: toCsv(
            rows,
            headers.length ? headers : preferred,
            `attendance_${reqDate}.csv`
          ),
        });
      }
    );
  },

  getHomeworkReport: async (req, res) => {
    const { classId, sectionId, search, subjectId, startDate, endDate } =
      req.body;
    const { administrationId } = req.user;
    if (!administrationId || !classId || !sectionId) {
      return res.send({
        status: "Error",
        message: "classId and sectionId are required",
      });
    }
    reportsModel.getHomeworkList(
      classId,
      sectionId,
      administrationId,
      (err, data) => {
        if (err) {
          return res.send({
            status: "Error",
            message: "Homework report not retrieved",
            data: err.sqlMessage || err,
          });
        }
        const filtered = filterHomework(data[0] || [], {
          search,
          subjectId,
          startDate,
          endDate,
        });
        res.send({
          status: "success",
          message: "Homework report retrieved",
          data: filtered,
          summary: { total: filtered.length },
        });
      }
    );
  },

  exportHomeworkReport: async (req, res) => {
    const { classId, sectionId, search, subjectId, startDate, endDate } =
      req.body;
    const { administrationId } = req.user;
    if (!administrationId || !classId || !sectionId) {
      return res.send({
        status: "Error",
        message: "classId and sectionId are required",
      });
    }
    reportsModel.getHomeworkList(
      classId,
      sectionId,
      administrationId,
      (err, data) => {
        if (err) {
          return res.send({
            status: "Error",
            message: "Homework export failed",
            data: err.sqlMessage || err,
          });
        }
        const rows = filterHomework(data[0] || [], {
          search,
          subjectId,
          startDate,
          endDate,
        });
        const headers = [
          "id",
          "description",
          "subjectName",
          "className",
          "sectionName",
          "staffName",
          "createdDate",
        ];
        res.send({
          status: "success",
          message: "Export ready",
          data: toCsv(rows, headers, "homework_report.csv"),
        });
      }
    );
  },
};
