const model = require("../models/attendanceV2");
const legacyModel = require("../models/attendance");
const logger = require("../config/winston");
const notificationService = require("../services/notificationService");

const isAdmin = (req) =>
  String(req.user?.role || "").trim().toLowerCase() === "admin";
const isStudent = (req) =>
  String(req.user?.role || "").trim().toLowerCase() === "student";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const todayStr = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const normalizeDate = (value) => {
  const date = String(value || "").trim().slice(0, 10);
  return DATE_RE.test(date) ? date : null;
};

// mysql2 returns DATE columns as JS Date objects; format them in local time
// (toISOString can shift the day across timezones).
const toYmd = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return normalizeDate(value);
};

// Accepts "YYYY-MM", "YYYY-MM-DD", or a month number (current year assumed).
const monthRange = (input) => {
  let year;
  let month;
  const now = new Date();
  const str = String(input || "").trim();
  if (/^\d{4}-\d{2}/.test(str)) {
    year = Number(str.slice(0, 4));
    month = Number(str.slice(5, 7));
  } else if (/^\d{1,2}$/.test(str) && Number(str) >= 1 && Number(str) <= 12) {
    year = now.getFullYear();
    month = Number(str);
  } else {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    monthStart: `${year}-${pad(month)}-01`,
    monthEnd: `${year}-${pad(month)}-${pad(lastDay)}`,
    label: `${year}-${pad(month)}`,
  };
};

const sendError = (res, message, data = []) =>
  res.send({ status: "Error", message, data, summary: null, canEdit: false });

const sendOk = (res, message, data, extra = {}) =>
  res.send({
    status: "success",
    message,
    data,
    summary: extra.summary ?? null,
    canEdit: extra.canEdit ?? false,
  });

const handleError = (req, res, err, message) => {
  logger.error(`${req.path} -- ${req.method} -- ${err?.message || err}`);
  sendError(res, message, err?.sqlMessage || err?.message || String(err));
};

// Class mode uses subjectId=0 / periodSlotId=0 by convention.
const resolveMode = (body) => {
  const rawMode = String(body.mode || "").trim().toLowerCase();
  const subjectId = Number(body.subjectId) || 0;
  const periodSlotId = Number(body.periodSlotId) || 0;
  if (rawMode === "period" || (rawMode === "" && (subjectId || periodSlotId))) {
    if (!subjectId || !periodSlotId) return null;
    return { mode: "Period", subjectId, periodSlotId };
  }
  return { mode: "Class", subjectId: 0, periodSlotId: 0 };
};

const canMarkContext = async (req, ctx) => {
  if (isAdmin(req)) return { allowed: true, via: "admin" };
  const staffId = String(req.user.userName);
  if (ctx.mode === "Class") {
    const classTeacher = await model.isClassTeacher(
      staffId,
      ctx.classId,
      ctx.sectionId,
      req.user.administrationId
    );
    return { allowed: classTeacher, via: classTeacher ? "classTeacher" : null };
  }
  const period = await model.isPeriodAuthorized({
    staffId,
    classId: ctx.classId,
    sectionId: ctx.sectionId,
    subjectId: ctx.subjectId,
    periodSlotId: ctx.periodSlotId,
    date: ctx.date,
    administrationId: req.user.administrationId,
  });
  return { allowed: period.authorized, via: period.via };
};

const canEditHeader = async (req, header) => {
  if (isAdmin(req)) return true;
  const staffId = String(req.user.userName);
  const marker = String(header.staffId || header.createdBy || "");
  const authorization = await canMarkContext(req, {
    mode: Number(header.subjectId) === 0 ? "Class" : "Period",
    classId: header.classId,
    sectionId: header.sectionId,
    subjectId: header.subjectId,
    periodSlotId: header.periodSlotId,
    date: header.date || toYmd(header.attendanceDate),
  });
  return authorization.allowed || marker === staffId;
};

const validateStudents = (students, roster) => {
  if (!Array.isArray(students) || !students.length) {
    return { error: "students array is required" };
  }
  const rosterIds = new Set(roster.map((row) => String(row.studentId)));
  const cleaned = [];
  const unknown = [];
  const seen = new Set();
  for (const entry of students) {
    const studentId = String(entry?.studentId || "").trim();
    if (!studentId) return { error: "Each entry needs a studentId" };
    if (seen.has(studentId)) continue;
    seen.add(studentId);
    const status = model.canonicalStatus(entry.status, model.STUDENT_STATUSES);
    if (!status) {
      return {
        error: `Invalid status '${entry.status}' for student ${studentId}. Allowed: ${model.STUDENT_STATUSES.join(", ")}`,
      };
    }
    if (rosterIds.size && !rosterIds.has(studentId)) {
      unknown.push(studentId);
      continue;
    }
    cleaned.push({ studentId, status, remarks: entry.remarks ?? null });
  }
  if (unknown.length) {
    return { error: `Students not in class roster: ${unknown.join(", ")}` };
  }
  if (!cleaned.length) return { error: "No valid student entries supplied" };
  return { cleaned };
};

const legacySummaryFallback = (studentId, classId, sectionId, administrationId) =>
  new Promise((resolve) => {
    try {
      legacyModel.getStdAttendance(
        studentId,
        classId,
        sectionId,
        0,
        administrationId,
        (err, attendance) => {
          if (err || !Array.isArray(attendance)) return resolve(null);
          const workingDays = Number(attendance[0]?.[0]?.totalWorkingDays || 0);
          const presented = Number(attendance[1]?.[0]?.presented || 0);
          resolve({
            workingDays,
            present: presented,
            absent: Math.max(0, workingDays - presented),
            percentage:
              workingDays === 0
                ? 0
                : Math.round((presented / workingDays) * 10000) / 100,
          });
        }
      );
    } catch (err) {
      resolve(null);
    }
  });

module.exports = {
  /* ------------------------- student attendance ------------------------- */

  studentContext: async (req, res) => {
    try {
      const { administrationId } = req.user;
      const classId = Number(req.body.classId);
      const sectionId = Number(req.body.sectionId);
      const date = normalizeDate(req.body.date) || todayStr();
      if (!classId || !sectionId) {
        return sendError(res, "classId and sectionId are required");
      }
      const ctx = resolveMode(req.body);
      if (!ctx) {
        return sendError(
          res,
          "Period mode requires subjectId and periodSlotId"
        );
      }
      const academicYear = await model.getActiveAcademicYear(administrationId);
      if (!academicYear) {
        return sendError(res, "No active academic year configured");
      }

      const permission = await canMarkContext(req, {
        ...ctx,
        classId,
        sectionId,
        date,
      });

      const roster = await model.getRoster(classId, sectionId, administrationId);
      const header = await model.findHeader({
        administrationId,
        academicYear,
        date,
        classId,
        sectionId,
        subjectId: ctx.subjectId,
        periodSlotId: ctx.periodSlotId,
      });

      let existing = new Map();
      let canEdit = false;
      if (header) {
        const details = await model.getDetailsForHeaders([header.id]);
        existing = new Map(
          details.map((row) => [String(row.studentId), row])
        );
        canEdit = await canEditHeader(req, header);
      }

      const students = roster.map((row) => {
        const detail = existing.get(String(row.studentId));
        return {
          studentId: row.studentId,
          studentName: row.studentName,
          status: detail ? detail.status : null,
          remarks: detail ? detail.remarks : null,
        };
      });

      sendOk(
        res,
        "Attendance context retrieved",
        {
          academicYear,
          date,
          mode: ctx.mode,
          classId,
          sectionId,
          subjectId: ctx.subjectId,
          periodSlotId: ctx.periodSlotId,
          statuses: model.STUDENT_STATUSES,
          alreadyMarked: Boolean(header),
          attendanceId: header ? header.id : null,
          markedBy: header ? header.staffId : null,
          canMark: permission.allowed,
          authorizedVia: permission.via,
          students,
        },
        {
          canEdit: header ? canEdit : permission.allowed,
          summary: {
            totalStudents: students.length,
            marked: students.filter((s) => s.status).length,
          },
        }
      );
    } catch (err) {
      handleError(req, res, err, "Attendance context not retrieved");
    }
  },

  studentSave: async (req, res) => {
    try {
      const { administrationId, userName } = req.user;
      const classId = Number(req.body.classId);
      const sectionId = Number(req.body.sectionId);
      const date = normalizeDate(req.body.date);
      if (!classId || !sectionId || !date) {
        return sendError(res, "classId, sectionId and date (YYYY-MM-DD) are required");
      }
      const ctx = resolveMode(req.body);
      if (!ctx) {
        return sendError(res, "Period mode requires subjectId and periodSlotId");
      }
      const academicYear = await model.getActiveAcademicYear(administrationId);
      if (!academicYear) {
        return sendError(res, "No active academic year configured");
      }

      const permission = await canMarkContext(req, {
        ...ctx,
        classId,
        sectionId,
        date,
      });
      if (!permission.allowed) {
        return res.status(403).send({
          status: "Error",
          message:
            ctx.mode === "Class"
              ? "Only the class teacher or admin can mark class attendance"
              : "You are not scheduled for this period on the selected date",
          data: [],
          summary: null,
          canEdit: false,
        });
      }

      const existing = await model.findHeader({
        administrationId,
        academicYear,
        date,
        classId,
        sectionId,
        subjectId: ctx.subjectId,
        periodSlotId: ctx.periodSlotId,
      });
      if (existing && !(await canEditHeader(req, existing))) {
        return res.status(403).send({
          status: "Error",
          message: "Attendance already marked and you cannot modify it",
          data: { attendanceId: existing.id },
          summary: null,
          canEdit: false,
        });
      }

      const roster = await model.getRoster(classId, sectionId, administrationId);
      const validation = validateStudents(req.body.students, roster);
      if (validation.error) return sendError(res, validation.error);

      const result = await model.saveStudentAttendance({
        administrationId,
        academicYear,
        date,
        classId,
        sectionId,
        subjectId: ctx.subjectId,
        periodSlotId: ctx.periodSlotId,
        staffId: existing ? existing.staffId : String(userName),
        mode: ctx.mode,
        markedBy: String(userName),
        students: validation.cleaned,
      });

      const absentStudents = validation.cleaned
        .filter((student) => student.status === "Absent")
        .map((student) => ({
          receiverId: student.studentId,
          receiverRole: "Student",
          classId,
          sectionId,
        }));
      if (absentStudents.length) {
        notificationService
          .createNotifications(
            {
              title: "Attendance Update",
              message: `You were marked Absent on ${date}.`,
              notificationType: "Attendance",
              senderId: userName,
              referenceId: result.attendanceId,
              administrationId,
              classId,
              sectionId,
            },
            absentStudents
          )
          .catch((notificationError) => {
            console.error(
              "Attendance notification failed:",
              notificationError.message || notificationError
            );
          });
      }

      logger.info(`${req.path} -- ${req.method} -- Success`);
      sendOk(
        res,
        existing ? "Attendance updated successfully" : "Attendance saved successfully",
        { attendanceId: result.attendanceId, date, mode: ctx.mode },
        {
          canEdit: true,
          summary: {
            totalStudents: validation.cleaned.length,
            present: validation.cleaned.filter((s) => s.status === "Present").length,
            absent: validation.cleaned.filter((s) => s.status === "Absent").length,
          },
        }
      );
    } catch (err) {
      handleError(req, res, err, "Attendance not saved");
    }
  },

  studentTodayPeriods: async (req, res) => {
    try {
      const { administrationId, userName } = req.user;
      const date =
        normalizeDate(req.body?.date || req.query?.date) || todayStr();
      const staffId = isAdmin(req)
        ? String(req.body?.staffId || req.query?.staffId || userName)
        : String(userName);
      const periods = await model.getStaffPeriodsForDate(
        staffId,
        date,
        administrationId
      );
      sendOk(res, "Today periods retrieved", periods, {
        summary: {
          total: periods.length,
          marked: periods.filter((p) => p.attendanceMarked).length,
        },
      });
    } catch (err) {
      handleError(req, res, err, "Today periods not retrieved");
    }
  },

  /** Classes/sections where the logged-in staff is class teacher */
  studentMyClasses: async (req, res) => {
    try {
      const { administrationId, userName } = req.user;
      if (isAdmin(req)) {
        return sendOk(res, "Admin can access all classes", [], {
          summary: { allClasses: true },
        });
      }
      const rows = await model.getClassTeacherAssignments(
        userName,
        administrationId
      );
      console.log("Rows: ", rows);
      sendOk(res, "Class teacher assignments retrieved", rows, {
        summary: { total: rows.length },
      });
    } catch (err) {
      handleError(req, res, err, "Class teacher assignments not retrieved");
    }
  },

  studentView: async (req, res) => {
    try {
      const { administrationId } = req.user;
      const classId = Number(req.body.classId);
      const sectionId = Number(req.body.sectionId);
      const date = normalizeDate(req.body.date);
      if (!classId || !sectionId || !date) {
        return sendError(res, "classId, sectionId and date (YYYY-MM-DD) are required");
      }
      const headers = await model.getHeadersForDate({
        administrationId,
        date,
        classId,
        sectionId,
        subjectId: req.body.subjectId,
        periodSlotId: req.body.periodSlotId,
      });
      if (!headers.length) {
        return sendOk(res, "No attendance marked for the selection", [], {
          summary: { sessions: 0, students: 0 },
        });
      }
      const details = await model.getDetailsForHeaders(
        headers.map((h) => h.id)
      );
      const detailMap = new Map();
      details.forEach((row) => {
        const key = Number(row.attendanceId);
        if (!detailMap.has(key)) detailMap.set(key, []);
        detailMap.get(key).push({
          studentId: row.studentId,
          studentName: row.studentName,
          status: row.status,
          remarks: row.remarks,
        });
      });

      const sessions = [];
      let anyEditable = false;
      for (const header of headers) {
        const canEdit = await canEditHeader(req, header);
        anyEditable = anyEditable || canEdit;
        sessions.push({
          attendanceId: header.id,
          date: header.date,
          mode: header.attendanceMode,
          classId: header.classId,
          className: header.className,
          sectionId: header.sectionId,
          sectionName: header.sectionName,
          subjectId: header.subjectId,
          subjectName: header.subjectName,
          periodSlotId: header.periodSlotId,
          startTime: header.startTime,
          endTime: header.endTime,
          markedBy: header.staffId,
          canEdit,
          students: detailMap.get(Number(header.id)) || [],
        });
      }

      sendOk(res, "Attendance view retrieved", sessions, {
        canEdit: anyEditable,
        summary: {
          sessions: sessions.length,
          students: details.length,
          present: details.filter((d) => d.status === "Present").length,
          absent: details.filter((d) => d.status === "Absent").length,
        },
      });
    } catch (err) {
      handleError(req, res, err, "Attendance view not retrieved");
    }
  },

  studentEdit: async (req, res) => {
    try {
      const { administrationId, userName } = req.user;
      const attendanceId = Number(req.body.attendanceId);
      if (!attendanceId) {
        return sendError(res, "attendanceId is required");
      }
      const header = await model.getHeaderById(attendanceId, administrationId);
      if (!header) {
        return sendError(res, "Attendance record not found");
      }
      if (!(await canEditHeader(req, header))) {
        return res.status(403).send({
          status: "Error",
          message: "You are not allowed to edit this attendance record",
          data: [],
          summary: null,
          canEdit: false,
        });
      }
      const roster = await model.getRoster(
        header.classId,
        header.sectionId,
        administrationId
      );
      const validation = validateStudents(req.body.students, roster);
      if (validation.error) return sendError(res, validation.error);

      await model.updateStudentAttendanceDetails({
        attendanceId,
        students: validation.cleaned,
        updatedBy: String(userName),
        administrationId,
      });
      logger.info(`${req.path} -- ${req.method} -- Success`);
      sendOk(
        res,
        "Attendance updated successfully",
        { attendanceId },
        { canEdit: true, summary: { updated: validation.cleaned.length } }
      );
    } catch (err) {
      handleError(req, res, err, "Attendance not updated");
    }
  },

  studentMySummary: async (req, res) => {
    try {
      // Student self-service: identifiers come from the JWT only.
      const { administrationId, userName, classId, sectionId } = req.user;
      if (!isStudent(req)) {
        return res.status(403).send({
          status: "Error",
          message: "Only students can access their own summary",
          data: [],
          summary: null,
          canEdit: false,
        });
      }
      const { monthStart, monthEnd, label } = monthRange(
        req.body?.month || req.query?.month
      );
      const date = todayStr();
      const summaryData = await model.getStudentSummary({
        administrationId,
        studentId: String(userName),
        date,
        monthStart,
        monthEnd,
      });

      const monthlyDays = summaryData.monthly || [];
      const presentEquivalent = monthlyDays.reduce(
        (sum, day) => sum + Number(day.dayWeight || 0),
        0
      );
      const monthlySummary = {
        month: label,
        daysMarked: monthlyDays.length,
        presentEquivalent: Math.round(presentEquivalent * 10) / 10,
        percentage: monthlyDays.length
          ? Math.round((presentEquivalent / monthlyDays.length) * 10000) / 100
          : 0,
      };

      let legacy = null;
      if (!summaryData.history.length) {
        // No normalized history yet; surface the legacy SP summary read-only.
        legacy = await legacySummaryFallback(
          String(userName),
          classId,
          sectionId,
          administrationId
        );
      }

      sendOk(
        res,
        "Attendance summary retrieved",
        {
          today: summaryData.today,
          monthly: { days: monthlyDays, summary: monthlySummary },
          subjectWise: summaryData.subjectWise,
          history: summaryData.history,
          legacySummary: legacy,
          source: summaryData.history.length ? "normalized" : legacy ? "legacy" : "empty",
        },
        { summary: monthlySummary }
      );
    } catch (err) {
      handleError(req, res, err, "Attendance summary not retrieved");
    }
  },

  /* -------------------------- staff attendance -------------------------- */

  staffMark: async (req, res) => {
    try {
      const { administrationId, userName } = req.user;
      const date = normalizeDate(req.body.date);
      const entries = req.body.entries || req.body.staffAttendance;
      if (!date) return sendError(res, "date (YYYY-MM-DD) is required");
      if (!Array.isArray(entries) || !entries.length) {
        return sendError(res, "entries array is required");
      }
      const academicYear = await model.getActiveAcademicYear(administrationId);
      if (!academicYear) {
        return sendError(res, "No active academic year configured");
      }
      const cleaned = [];
      const seen = new Set();
      for (const entry of entries) {
        const staffId = String(entry?.staffId || "").trim();
        if (!staffId) return sendError(res, "Each entry needs a staffId");
        if (seen.has(staffId)) continue;
        seen.add(staffId);
        const status = model.canonicalStatus(entry.status, model.STAFF_STATUSES);
        if (!status) {
          return sendError(
            res,
            `Invalid status '${entry.status}' for staff ${staffId}. Allowed: ${model.STAFF_STATUSES.join(", ")}`
          );
        }
        cleaned.push({ staffId, status, remarks: entry.remarks ?? null });
      }
      const staffList = await model.getActiveStaffList(administrationId);
      const known = new Set(staffList.map((row) => String(row.staffId)));
      if (known.size) {
        const unknown = cleaned
          .map((e) => e.staffId)
          .filter((id) => !known.has(id));
        if (unknown.length) {
          return sendError(res, `Unknown staff: ${unknown.join(", ")}`);
        }
      }

      await model.saveStaffAttendance({
        administrationId,
        academicYear,
        date,
        entries: cleaned,
        markedBy: String(userName),
      });
      logger.info(`${req.path} -- ${req.method} -- Success`);
      sendOk(
        res,
        "Staff attendance saved successfully",
        { date, saved: cleaned.length },
        {
          canEdit: true,
          summary: {
            total: cleaned.length,
            present: cleaned.filter((e) => e.status === "Present").length,
            absent: cleaned.filter((e) => e.status === "Absent").length,
          },
        }
      );
    } catch (err) {
      handleError(req, res, err, "Staff attendance not saved");
    }
  },

  staffView: async (req, res) => {
    try {
      const { administrationId } = req.user;
      const date =
        normalizeDate(req.body?.date || req.query?.date) || todayStr();
      const rows = await model.getStaffAttendanceForDate(administrationId, date);
      const marked = rows.filter((row) => row.status);
      sendOk(res, "Staff attendance retrieved", rows, {
        canEdit: isAdmin(req),
        summary: {
          date,
          totalStaff: rows.length,
          marked: marked.length,
          present: marked.filter((r) => r.status === "Present").length,
          absent: marked.filter((r) => r.status === "Absent").length,
          statuses: model.STAFF_STATUSES,
        },
      });
    } catch (err) {
      handleError(req, res, err, "Staff attendance not retrieved");
    }
  },

  staffMy: async (req, res) => {
    try {
      const { administrationId, userName } = req.user;
      const { monthStart, monthEnd, label } = monthRange(
        req.body?.month || req.query?.month
      );
      const data = await model.getMyStaffAttendance({
        administrationId,
        staffId: String(userName),
        monthStart,
        monthEnd,
      });
      sendOk(
        res,
        "My attendance retrieved",
        { history: data.history, monthly: { month: label, ...(data.monthly || {}) } },
        { summary: { month: label, ...(data.monthly || {}) } }
      );
    } catch (err) {
      handleError(req, res, err, "My attendance not retrieved");
    }
  },

  staffEdit: async (req, res) => {
    try {
      const { administrationId, userName } = req.user;
      const id = Number(req.body.id) || null;
      const staffId = req.body.staffId ? String(req.body.staffId) : null;
      const date = normalizeDate(req.body.date);
      if (!id && !(staffId && date)) {
        return sendError(res, "Provide id, or staffId and date");
      }
      const status = model.canonicalStatus(req.body.status, model.STAFF_STATUSES);
      if (!status) {
        return sendError(
          res,
          `Invalid status. Allowed: ${model.STAFF_STATUSES.join(", ")}`
        );
      }
      const row = await model.getStaffAttendanceRow({
        administrationId,
        id,
        staffId,
        date,
      });
      if (!row) {
        return sendError(res, "Staff attendance record not found");
      }
      await model.updateStaffAttendanceRow({
        id: row.id,
        status,
        remarks: req.body.remarks ?? row.remarks,
        updatedBy: String(userName),
        administrationId,
      });
      logger.info(`${req.path} -- ${req.method} -- Success`);
      sendOk(
        res,
        "Staff attendance updated successfully",
        { id: row.id, staffId: row.staffId, status },
        { canEdit: true }
      );
    } catch (err) {
      handleError(req, res, err, "Staff attendance not updated");
    }
  },
};
