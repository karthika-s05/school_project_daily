const con = require("../config/dbConfig");

const queryAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    con.query(sql, params, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

const num = (v, d = 0) => {
  if (v == null) return d;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const safeQuery = async (sql, params = [], fallback = []) => {
  try {
    const rows = await queryAsync(sql, params);
    return Array.isArray(rows) ? rows : fallback;
  } catch (err) {
    console.error("[staff-dashboard]", err.sqlMessage || err.message || err);
    return fallback;
  }
};

const callSp = async (sql, params = []) => {
  try {
    const rows = await queryAsync(sql, params);
    if (Array.isArray(rows?.[0])) return rows[0];
    if (Array.isArray(rows)) return rows;
    return [];
  } catch (err) {
    console.error("[staff-dashboard] SP", err.sqlMessage || err.message || err);
    return [];
  }
};

const EXAM_COLORS = ["#2D3A8C", "#16a34a", "#0891b2", "#E8541A", "#d97706", "#7c3aed"];
const ACT_COLORS = ["#2D3A8C", "#16a34a", "#0891b2", "#7c3aed", "#d97706", "#E8541A"];

const initials = (text = "") => {
  const parts = String(text).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
};

const relativeTime = (dateVal) => {
  if (!dateVal) return "";
  const d = new Date(dateVal);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
};

const emptyWeekly = () =>
  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => ({
    day,
    Present: 0,
    Absent: 0,
  }));

const normalizeClassRow = (row) => {
  const classId = num(
    row.classId ?? row.ClassId ?? row.class_id ?? row.classID ?? row.id,
    0
  );
  const sectionId = num(
    row.sectionId ?? row.SectionId ?? row.section_id ?? row.sectionID,
    0
  );
  const className = String(
    row.className ?? row.ClassName ?? row.class ?? row.name ?? (classId ? `Class ${classId}` : "")
  );
  const sectionName = String(
    row.sectionName ?? row.SectionName ?? row.section ?? (sectionId ? `Sec ${sectionId}` : "")
  );
  const subjectName = String(row.subjectName ?? row.SubjectName ?? row.subject ?? "");
  if (!classId) return null;
  return { classId, sectionId, className, sectionName, subjectName };
};

const uniquePairs = (rows) => {
  const map = new Map();
  (rows || []).forEach((row) => {
    const n = normalizeClassRow(row);
    if (!n) return;
    const key = `${n.classId}-${n.sectionId || 0}`;
    if (!map.has(key)) map.set(key, n);
  });
  return [...map.values()];
};

const buildPairFilter = (pairs, classCol, sectionCol) => {
  if (!pairs.length) return { sql: "1=0", params: [] };
  const parts = pairs.map(
    () => `(${classCol} = ? AND (${sectionCol} = ? OR ? = 0))`
  );
  const params = [];
  pairs.forEach((p) => {
    params.push(p.classId, p.sectionId || 0, p.sectionId || 0);
  });
  return { sql: `(${parts.join(" OR ")})`, params };
};

module.exports = {
  getStaffSummary: async (userName, administrationId, callback) => {
    const adminId = Number(administrationId);
    const staffId = String(userName || "").trim();
    if (!adminId || !staffId) {
      return callback(new Error("Missing Credential"), null);
    }

    try {
      // 1) Classes assigned to this staff (SP + timetable fallback)
      const spClasses = await callSp(`CALL sp_GetStaffClass(?, ?)`, [staffId, adminId]);
      const ttClasses = await safeQuery(
        `SELECT DISTINCT classId, sectionId
           FROM tbl_classtimetable
          WHERE administrationId = ? AND staffId = ? AND isActive = '1'`,
        [adminId, staffId],
        []
      );
      const classList = uniquePairs([...(spClasses || []), ...(ttClasses || [])]);
      const pairFilter = buildPairFilter(classList, "h.classId", "h.sectionId");
      const studentPair = buildPairFilter(classList, "s.classId", "s.sectionId");

      // 2) Student count across assigned classes
      let totalStudents = 0;
      if (classList.length) {
        totalStudents = num(
          (
            await safeQuery(
              `SELECT COUNT(*) AS count FROM student s
                WHERE s.administrationId = ? AND s.isActive = '1'
                  AND ${studentPair.sql}`,
              [adminId, ...studentPair.params],
              [{ count: 0 }]
            )
          )?.[0]?.count
        );
      }

      // 3) Today's periods for this staff (timetable)
      const todayPeriods = await safeQuery(
        `SELECT ctt.id, ctt.classId, ctt.sectionId, ctt.subjectId, ctt.periodSlotId
           FROM tbl_classtimetable ctt
          WHERE ctt.administrationId = ?
            AND ctt.staffId = ?
            AND ctt.dayId = WEEKDAY(CURDATE()) + 1
            AND ctt.isActive = '1'`,
        [adminId, staffId],
        []
      );
      const todayClassCount = todayPeriods.length || classList.length;

      // 4) Attendance today for assigned classes
      const attTodayRows = classList.length
        ? await safeQuery(
            `SELECT
                SUM(CASE WHEN d.status = 'Present' THEN 1 ELSE 0 END) AS present,
                SUM(CASE WHEN d.status = 'Absent' THEN 1 ELSE 0 END) AS absent,
                SUM(CASE WHEN d.status = 'Late' THEN 1 ELSE 0 END) AS late,
                SUM(CASE WHEN d.status IN ('Leave', 'Medical Leave') THEN 1 ELSE 0 END) AS onLeave,
                COUNT(*) AS total
               FROM tbl_student_attendance_detail d
               JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
              WHERE h.administrationId = ?
                AND h.attendanceDate = CURDATE()
                AND ${pairFilter.sql}`,
            [adminId, ...pairFilter.params],
            [{ present: 0, absent: 0, late: 0, onLeave: 0, total: 0 }]
          )
        : [{ present: 0, absent: 0, late: 0, onLeave: 0, total: 0 }];

      const present = num(attTodayRows?.[0]?.present);
      const absent = num(attTodayRows?.[0]?.absent);
      const late = num(attTodayRows?.[0]?.late);
      const onLeave = num(attTodayRows?.[0]?.onLeave);
      const attTotal = num(attTodayRows?.[0]?.total);
      const todayAttendance =
        attTotal > 0 ? Math.round((present / attTotal) * 1000) / 10 : 0;

      // 5) Weekly attendance (last 6 days)
      const weeklyRows = classList.length
        ? await safeQuery(
            `SELECT
                DATE_FORMAT(h.attendanceDate, '%a') AS dayLabel,
                SUM(CASE WHEN d.status = 'Present' THEN 1 ELSE 0 END) AS present,
                SUM(CASE WHEN d.status = 'Absent' THEN 1 ELSE 0 END) AS absent
               FROM tbl_student_attendance_detail d
               JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
              WHERE h.administrationId = ?
                AND h.attendanceDate >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
                AND h.attendanceDate <= CURDATE()
                AND ${pairFilter.sql}
              GROUP BY h.attendanceDate, DATE_FORMAT(h.attendanceDate, '%a')
              ORDER BY h.attendanceDate`,
            [adminId, ...pairFilter.params],
            []
          )
        : [];

      const weeklyMap = new Map();
      weeklyRows.forEach((r) => {
        const key = String(r.dayLabel || "").slice(0, 3);
        if (!key) return;
        weeklyMap.set(key, { Present: num(r.present), Absent: num(r.absent) });
      });
      const attendanceWeekly = emptyWeekly().map((row) => ({
        ...row,
        ...(weeklyMap.get(row.day) || {}),
      }));

      // 6) Monthly trend (last 5 months)
      const trendRows = classList.length
        ? await safeQuery(
            `SELECT
                DATE_FORMAT(h.attendanceDate, '%b') AS month,
                MONTH(h.attendanceDate) AS monthNum,
                YEAR(h.attendanceDate) AS yearNum,
                ROUND(
                  SUM(CASE WHEN d.status = 'Present' THEN 1 ELSE 0 END) * 100 / NULLIF(COUNT(*), 0),
                  1
                ) AS pct
               FROM tbl_student_attendance_detail d
               JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
              WHERE h.administrationId = ?
                AND h.attendanceDate >= DATE_SUB(CURDATE(), INTERVAL 5 MONTH)
                AND ${pairFilter.sql}
              GROUP BY YEAR(h.attendanceDate), MONTH(h.attendanceDate), DATE_FORMAT(h.attendanceDate, '%b')
              ORDER BY yearNum, monthNum`,
            [adminId, ...pairFilter.params],
            []
          )
        : [];
      const attendanceTrend = trendRows.map((r) => ({
        month: String(r.month || ""),
        pct: num(r.pct),
      }));

      // 7) Class-wise attendance (today) - used as "Class Performance"
      const classAttRows = classList.length
        ? await safeQuery(
            `SELECT
                COALESCE(MAX(cm.name), CONCAT('Class ', h.classId)) AS cls,
                COALESCE(MAX(sm.name), CONCAT('Sec ', h.sectionId)) AS sectionName,
                SUM(CASE WHEN d.status = 'Present' THEN 1 ELSE 0 END) AS present,
                COUNT(*) AS total,
                ROUND(
                  SUM(CASE WHEN d.status = 'Present' THEN 1 ELSE 0 END) * 100 / NULLIF(COUNT(*), 0),
                  0
                ) AS pct
               FROM tbl_student_attendance_detail d
               JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
               LEFT JOIN classMaster cm
                 ON cm.id = h.classId AND cm.administrationId = h.administrationId
               LEFT JOIN sectionMaster sm
                 ON sm.id = h.sectionId AND sm.administrationId = h.administrationId
              WHERE h.administrationId = ?
                AND h.attendanceDate = CURDATE()
                AND ${pairFilter.sql}
              GROUP BY h.classId, h.sectionId
              ORDER BY cls
              LIMIT 8`,
            [adminId, ...pairFilter.params],
            []
          )
        : [];

      // Fallback class performance from class list if no attendance today
      const classPerformance =
        classAttRows.length > 0
          ? classAttRows.map((r, i) => ({
              cls: `${r.cls}${r.sectionName ? ` - ${r.sectionName}` : ""}`,
              subject: "Attendance today",
              pct: num(r.pct),
              color: EXAM_COLORS[i % EXAM_COLORS.length],
            }))
          : classList.slice(0, 8).map((c, i) => ({
              cls: `${c.className}${c.sectionName ? ` - ${c.sectionName}` : ""}`,
              subject: c.subjectName || "Assigned class",
              pct: 0,
              color: EXAM_COLORS[i % EXAM_COLORS.length],
            }));

      const perfPcts = classPerformance.map((c) => num(c.pct)).filter((n) => n > 0);
      const overallAvg = perfPcts.length
        ? Math.round(perfPcts.reduce((a, b) => a + b, 0) / perfPcts.length)
        : 0;
      const bestClass = perfPcts.length ? Math.max(...perfPcts) : 0;
      const needsWork = perfPcts.length ? Math.min(...perfPcts) : 0;

      // 8) Homework / assignments for assigned classes (or created by staff)
      const hwPair = buildPairFilter(classList, "classId", "sectionId");
      let homeworkCount = 0;
      let assignmentCount = 0;
      if (classList.length) {
        homeworkCount = num(
          (
            await safeQuery(
              `SELECT COUNT(*) AS count FROM tbl_homework
                WHERE administrationId = ? AND (${hwPair.sql} OR createdBy = ?)`,
              [adminId, ...hwPair.params, staffId],
              [{ count: 0 }]
            )
          )?.[0]?.count
        );
        // Some DBs use homework table without tbl_ prefix
        if (!homeworkCount) {
          homeworkCount = num(
            (
              await safeQuery(
                `SELECT COUNT(*) AS count FROM homework
                  WHERE administrationId = ? AND (${hwPair.sql} OR createdBy = ?)`,
                [adminId, ...hwPair.params, staffId],
                [{ count: 0 }]
              )
            )?.[0]?.count
          );
        }
        assignmentCount = num(
          (
            await safeQuery(
              `SELECT COUNT(*) AS count FROM tbl_assignment
                WHERE administrationId = ? AND (${hwPair.sql} OR createdBy = ?)`,
              [adminId, ...hwPair.params, staffId],
              [{ count: 0 }]
            )
          )?.[0]?.count
        );
      } else {
        // No class mapping - count items created by this staff
        homeworkCount = num(
          (
            await safeQuery(
              `SELECT COUNT(*) AS count FROM tbl_homework
                WHERE administrationId = ? AND createdBy = ?`,
              [adminId, staffId],
              [{ count: 0 }]
            )
          )?.[0]?.count
        );
        assignmentCount = num(
          (
            await safeQuery(
              `SELECT COUNT(*) AS count FROM tbl_assignment
                WHERE administrationId = ? AND createdBy = ?`,
              [adminId, staffId],
              [{ count: 0 }]
            )
          )?.[0]?.count
        );
      }

      // 9) Leaves
      const leaves = await callSp(`CALL sp_GetStaffLeave(?, 'Staff', ?)`, [
        staffId,
        adminId,
      ]);
      const totalLeaves = Array.isArray(leaves) ? leaves.length : 0;
      const pendingLeaves = Array.isArray(leaves)
        ? leaves.filter((l) =>
            ["pending"].includes(
              String(l.status || l.leaveStatus || "").toLowerCase()
            )
          ).length
        : 0;

      // 10) Recent activity (notifications for this staff)
      const activityRows = await safeQuery(
        `SELECT title, message, notificationType, createdAt
           FROM tbl_notification_center
          WHERE administrationId = ?
            AND (
              LOWER(receiverRole) = 'staff'
              OR receiverId = ?
              OR senderId = ?
            )
          ORDER BY createdAt DESC, id DESC
          LIMIT 8`,
        [adminId, staffId, staffId],
        []
      );
      const recentActivity = activityRows.map((r, i) => {
        const label = String(r.title || r.notificationType || "Update");
        return {
          avatar: initials(label),
          label,
          desc: String(r.message || r.notificationType || "Notification"),
          time: relativeTime(r.createdAt),
          color: ACT_COLORS[i % ACT_COLORS.length],
        };
      });

      // 11) Productivity today
      const attendanceMarkedToday = num(
        (
          await safeQuery(
            `SELECT COUNT(DISTINCT CONCAT(classId, '-', sectionId, '-', IFNULL(periodSlotId, 0))) AS count
               FROM tbl_student_attendance_header
              WHERE administrationId = ?
                AND attendanceDate = CURDATE()
                AND staffId = ?`,
            [adminId, staffId],
            [{ count: 0 }]
          )
        )?.[0]?.count
      );
      const homeworkToday = num(
        (
          await safeQuery(
            `SELECT COUNT(*) AS count FROM tbl_homework
              WHERE administrationId = ? AND createdBy = ?
                AND DATE(createdAt) = CURDATE()`,
            [adminId, staffId],
            [{ count: 0 }]
          )
        )?.[0]?.count
      );
      const assignmentsToday = num(
        (
          await safeQuery(
            `SELECT COUNT(*) AS count FROM tbl_assignment
              WHERE administrationId = ? AND createdBy = ?
                AND DATE(createdAt) = CURDATE()`,
            [adminId, staffId],
            [{ count: 0 }]
          )
        )?.[0]?.count
      );

      const summary = {
        assignedClasses: todayClassCount,
        totalAssignedClasses: classList.length,
        classList,
        totalStudents,
        todayAttendance,
        attendanceToday: {
          present,
          absent,
          late,
          leave: onLeave,
          total: attTotal || totalStudents,
          rate: todayAttendance,
        },
        attendanceWeekly,
        attendanceTrend,
        classPerformance,
        performanceSummary: {
          overallAvg,
          bestClass,
          needsWork,
        },
        homeworkCount,
        assignmentCount,
        totalLeaves,
        pendingLeaves,
        recentActivity,
        productivity: {
          classesCompleted: todayClassCount,
          attendanceMarked: attendanceMarkedToday,
          assignmentsReviewed: assignmentsToday,
          homeworkChecked: homeworkToday,
        },
      };

      const safe = JSON.parse(
        JSON.stringify(summary, (_k, v) => (typeof v === "bigint" ? Number(v) : v))
      );
      callback(null, safe);
    } catch (err) {
      console.error("[staff-dashboard] getStaffSummary:", err.sqlMessage || err.message || err);
      callback(err, null);
    }
  },
};
