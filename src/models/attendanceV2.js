const con = require("../config/dbConfig");

const queryAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    con.query(sql, params, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

const getConnectionAsync = () =>
  new Promise((resolve, reject) => {
    con.getConnection((err, connection) => {
      if (err) reject(err);
      else resolve(connection);
    });
  });

const connQuery = (connection, sql, params = []) =>
  new Promise((resolve, reject) => {
    connection.query(sql, params, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

const withTransaction = async (work) => {
  const connection = await getConnectionAsync();
  try {
    await new Promise((resolve, reject) =>
      connection.beginTransaction((err) => (err ? reject(err) : resolve()))
    );
    const result = await work((sql, params) =>
      connQuery(connection, sql, params)
    );
    await new Promise((resolve, reject) =>
      connection.commit((err) => (err ? reject(err) : resolve()))
    );
    return result;
  } catch (err) {
    await new Promise((resolve) => connection.rollback(() => resolve()));
    throw err;
  } finally {
    connection.release();
  }
};

// Tries each {sql, params} in order; falls back on schema mismatch errors
// (unknown column / missing table) so name-joins degrade gracefully across
// deployments with different roster schemas.
const tryQueries = async (candidates) => {
  let lastErr = null;
  for (const candidate of candidates) {
    try {
      return await queryAsync(candidate.sql, candidate.params || []);
    } catch (err) {
      lastErr = err;
      if (
        err &&
        (err.code === "ER_BAD_FIELD_ERROR" ||
          err.code === "ER_NO_SUCH_TABLE" ||
          err.code === "ER_SP_DOES_NOT_EXIST")
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("No query candidates supplied");
};

let tablesReady = false;

const ensureTables = async () => {
  if (tablesReady) return;
  await queryAsync(`
    CREATE TABLE IF NOT EXISTS tbl_student_attendance_header (
      id INT AUTO_INCREMENT PRIMARY KEY,
      administrationId INT NOT NULL,
      academicYear VARCHAR(20) NOT NULL,
      attendanceDate DATE NOT NULL,
      classId INT NOT NULL,
      sectionId INT NOT NULL,
      subjectId INT NOT NULL DEFAULT 0,
      periodSlotId INT NOT NULL DEFAULT 0,
      staffId VARCHAR(50) NOT NULL,
      attendanceMode VARCHAR(20) NOT NULL DEFAULT 'Class',
      createdBy VARCHAR(50) NOT NULL,
      updatedBy VARCHAR(50) DEFAULT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_std_att_header (administrationId, academicYear, attendanceDate, classId, sectionId, subjectId, periodSlotId),
      KEY idx_std_att_header_date (administrationId, attendanceDate),
      KEY idx_std_att_header_class (administrationId, classId, sectionId, attendanceDate),
      KEY idx_std_att_header_staff (administrationId, staffId, attendanceDate)
    )
  `);
  await queryAsync(`
    CREATE TABLE IF NOT EXISTS tbl_student_attendance_detail (
      id INT AUTO_INCREMENT PRIMARY KEY,
      attendanceId INT NOT NULL,
      studentId VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'Present',
      remarks VARCHAR(255) DEFAULT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_std_att_detail (attendanceId, studentId),
      KEY idx_std_att_detail_student (studentId)
    )
  `);
  await queryAsync(`
    CREATE TABLE IF NOT EXISTS tbl_staff_attendance (
      id INT AUTO_INCREMENT PRIMARY KEY,
      administrationId INT NOT NULL,
      academicYear VARCHAR(20) NOT NULL,
      attendanceDate DATE NOT NULL,
      staffId VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'Present',
      remarks VARCHAR(255) DEFAULT NULL,
      createdBy VARCHAR(50) NOT NULL,
      updatedBy VARCHAR(50) DEFAULT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_staff_att (administrationId, academicYear, attendanceDate, staffId),
      KEY idx_staff_att_date (administrationId, attendanceDate),
      KEY idx_staff_att_staff (administrationId, staffId)
    )
  `);
  tablesReady = true;
};

const STUDENT_STATUSES = [
  "Present",
  "Absent",
  "Leave",
  "Late",
  "Half Day",
  "Medical Leave",
];
const STAFF_STATUSES = ["Present", "Absent", "Leave", "Half Day", "Late"];

const canonicalStatus = (value, allowed) => {
  const norm = String(value || "").trim().toLowerCase();
  return allowed.find((status) => status.toLowerCase() === norm) || null;
};

// Present/Late/Medical Leave = 1, Half Day = 0.5, Absent/Leave = 0
const weightExpr = (column) =>
  `CASE WHEN ${column} IN ('Present','Late','Medical Leave') THEN 1 WHEN ${column} = 'Half Day' THEN 0.5 ELSE 0 END`;

const STUDENT_NAME_EXPR = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', st.firstName, st.middleName, st.lastName)), ''), d.studentId)`;
const STAFF_NAME_EXPR = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', s.firstName, s.lastName)), ''), sa.staffId)`;

const getActiveAcademicYear = async (administrationId) => {
  await ensureTables();
  const rows = await queryAsync(
    `SELECT academicYear FROM tbl_academicyear WHERE administrationId = ? AND isActive = '1' LIMIT 1`,
    [Number(administrationId)]
  );
  return rows && rows[0] ? String(rows[0].academicYear) : null;
};

const isClassTeacher = async (staffId, classId, sectionId, administrationId) => {
  // Do not use sp_GetClassTeacher: it joins legacy tbl_teachers, so staff who
  // only exist in `staff` were mapped but never authorized for attendance.
  try {
    const target = String(staffId || "").trim();
    if (!target || !classId || !sectionId || !administrationId) return false;
    const rows = await queryAsync(
      `SELECT ct.id
         FROM tbl_classteachermap ct
        WHERE ct.staffId = ?
          AND ct.classId = ?
          AND ct.sectionId = ?
          AND ct.administrationId = ?
          AND ct.isActive = '1'
        LIMIT 1`,
      [
        target,
        Number(classId),
        Number(sectionId),
        Number(administrationId),
      ]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    return false;
  }
};

/** Class/section pairs assigned to a staff member as class teacher. */
const getClassTeacherAssignments = async (staffId, administrationId) => {
  const target = String(staffId || "").trim();
  if (!target || !administrationId) return [];
  return queryAsync(
    `SELECT ct.id,
            ct.staffId,
            ct.classId,
            ct.sectionId,
            cm.name AS className,
            sm.name AS sectionName
       FROM tbl_classteachermap ct
       JOIN classMaster cm ON ct.classId = cm.id
       JOIN sectionMaster sm ON ct.sectionId = sm.id
      WHERE ct.staffId = ?
        AND ct.administrationId = ?
        AND ct.isActive = '1'
      ORDER BY cm.name, sm.name`,
    [target, Number(administrationId)]
  );
};

// Authorized when the staff owns the timetable period on that weekday for the
// active year, or holds an accepted substitution for that exact slot/date.
const isPeriodAuthorized = async ({
  staffId,
  classId,
  sectionId,
  subjectId,
  periodSlotId,
  date,
  administrationId,
}) => {
  const timetable = await queryAsync(
    `SELECT ctt.id
       FROM tbl_classtimetable ctt
      WHERE ctt.administrationId = ?
        AND ctt.staffId = ?
        AND ctt.classId = ?
        AND ctt.sectionId = ?
        AND ctt.subjectId = ?
        AND ctt.periodSlotId = ?
        AND ctt.dayId = WEEKDAY(?) + 1
        AND ctt.isActive = '1'
        AND ctt.academicYear = (
          SELECT academicYear FROM tbl_academicyear
          WHERE administrationId = ? AND isActive = '1' LIMIT 1
        )
      LIMIT 1`,
    [
      Number(administrationId),
      String(staffId),
      Number(classId),
      Number(sectionId),
      Number(subjectId),
      Number(periodSlotId),
      date,
      Number(administrationId),
    ]
  );
  if (timetable.length) return { authorized: true, via: "timetable" };

  try {
    const substitute = await queryAsync(
      `SELECT id FROM tbl_timetable_substitute
        WHERE administrationId = ?
          AND substituteStaffId = ?
          AND classId = ?
          AND sectionId = ?
          AND subjectId = ?
          AND periodSlotId = ?
          AND substituteDate = ?
          AND status = 'Accepted'
        LIMIT 1`,
      [
        Number(administrationId),
        String(staffId),
        Number(classId),
        Number(sectionId),
        Number(subjectId),
        Number(periodSlotId),
        date,
      ]
    );
    if (substitute.length) return { authorized: true, via: "substitute" };
  } catch (err) {
    /* substitute table may not exist in this deployment */
  }
  return { authorized: false, via: null };
};

const normalizeRosterRow = (row) => {
  const studentId =
    row.studentId ||
    row.admissionNo ||
    row.userName ||
    row.studentID ||
    row.id ||
    "";
  const studentName =
    row.studentName ||
    row.name ||
    [row.firstName, row.middleName, row.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    String(studentId);
  return { studentId: String(studentId), studentName: String(studentName).trim() };
};

const getRoster = async (classId, sectionId, administrationId) => {
  await ensureTables();
  try {
    const rows = await queryAsync(
      `SELECT s.admissionNo AS studentId,
              TRIM(CONCAT_WS(' ', s.firstName, s.middleName, s.lastName)) AS studentName
         FROM student s
        WHERE s.classId = ? AND s.sectionId = ? AND s.administrationId = ? AND s.isActive = '1'
        ORDER BY s.firstName, s.lastName, s.admissionNo`,
      [Number(classId), Number(sectionId), Number(administrationId)]
    );
    if (rows.length) return rows.map(normalizeRosterRow);
  } catch (err) {
    /* fall through to stored procedures */
  }

  const spCandidates = [
    { sql: `CALL sp_getStutentList(?, ?, ?)`, params: [Number(classId), Number(sectionId), Number(administrationId)] },
    { sql: `CALL getStudentList('0', ?, ?, ?)`, params: [Number(classId), Number(sectionId), Number(administrationId)] },
  ];
  for (const candidate of spCandidates) {
    try {
      const data = await queryAsync(candidate.sql, candidate.params);
      const rows = Array.isArray(data) ? data[0] || [] : [];
      if (rows.length) return rows.map(normalizeRosterRow);
    } catch (err) {
      /* try next candidate */
    }
  }
  return [];
};

const getStaffPeriodsForDate = async (staffId, date, administrationId) => {
  await ensureTables();
  const timetable = await queryAsync(
    `SELECT
        ctt.id AS timetableId,
        ctt.classId,
        cm.name AS className,
        ctt.sectionId,
        sm.name AS sectionName,
        ctt.subjectId,
        sb.name AS subjectName,
        ctt.periodSlotId,
        TIME_FORMAT(ps.startTime, '%h:%i %p') AS startTime,
        TIME_FORMAT(ps.endTime, '%h:%i %p') AS endTime,
        'timetable' AS source
       FROM tbl_classtimetable ctt
       JOIN tbl_periodslot ps
         ON ps.id = ctt.periodSlotId AND ps.administrationId = ctt.administrationId
       JOIN subject sb
         ON sb.id = ctt.subjectId AND sb.administrationId = ctt.administrationId
       LEFT JOIN classmaster cm
         ON cm.id = ctt.classId AND cm.administrationId = ctt.administrationId
       LEFT JOIN sectionmaster sm
         ON sm.id = ctt.sectionId AND sm.administrationId = ctt.administrationId
      WHERE ctt.administrationId = ?
        AND ctt.staffId = ?
        AND ctt.dayId = WEEKDAY(?) + 1
        AND ctt.isActive = '1'
        AND ctt.academicYear = (
          SELECT academicYear FROM tbl_academicyear
          WHERE administrationId = ? AND isActive = '1' LIMIT 1
        )
      ORDER BY ps.startTime`,
    [Number(administrationId), String(staffId), date, Number(administrationId)]
  );

  let substitutes = [];
  try {
    substitutes = await queryAsync(
      `SELECT
          sub.timetableId,
          sub.classId,
          cm.name AS className,
          sub.sectionId,
          sm.name AS sectionName,
          sub.subjectId,
          sb.name AS subjectName,
          sub.periodSlotId,
          TIME_FORMAT(ps.startTime, '%h:%i %p') AS startTime,
          TIME_FORMAT(ps.endTime, '%h:%i %p') AS endTime,
          'substitute' AS source
         FROM tbl_timetable_substitute sub
         LEFT JOIN tbl_periodslot ps
           ON ps.id = sub.periodSlotId AND ps.administrationId = sub.administrationId
         LEFT JOIN subject sb
           ON sb.id = sub.subjectId AND sb.administrationId = sub.administrationId
         LEFT JOIN classmaster cm
           ON cm.id = sub.classId AND cm.administrationId = sub.administrationId
         LEFT JOIN sectionmaster sm
           ON sm.id = sub.sectionId AND sm.administrationId = sub.administrationId
        WHERE sub.administrationId = ?
          AND sub.substituteStaffId = ?
          AND sub.substituteDate = ?
          AND sub.status = 'Accepted'
        ORDER BY ps.startTime`,
      [Number(administrationId), String(staffId), date]
    );
  } catch (err) {
    substitutes = [];
  }

  const headers = await queryAsync(
    `SELECT id, subjectId, periodSlotId, staffId, attendanceMode
       FROM tbl_student_attendance_header
      WHERE administrationId = ? AND attendanceDate = ?`,
    [Number(administrationId), date]
  );
  const headerKey = (row) =>
    [ row.subjectId, row.periodSlotId].join("|");
  const headerMap = new Map(headers.map((row) => [headerKey(row), row]));

  const combined = [...timetable, ...substitutes];
  return combined.map((period) => {
    const existing = headerMap.get(headerKey(period));
    return {
      ...period,
      attendanceMarked: Boolean(existing),
      attendanceId: existing ? existing.id : null,
      markedBy: existing ? existing.staffId : null,
    };
  });
};

const findHeader = async ({
  administrationId,
  academicYear,
  date,
  classId,
  sectionId,
  subjectId,
  periodSlotId,
}) => {
  await ensureTables();
  const rows = await queryAsync(
    `SELECT * FROM tbl_student_attendance_header
      WHERE administrationId = ? AND academicYear = ? AND attendanceDate = ?
        AND classId = ? AND sectionId = ? AND subjectId = ? AND periodSlotId = ?
      LIMIT 1`,
    [
      Number(administrationId),
      String(academicYear),
      date,
      Number(classId),
      Number(sectionId),
      Number(subjectId),
      Number(periodSlotId),
    ]
  );
  return rows[0] || null;
};

const getHeaderById = async (attendanceId, administrationId) => {
  await ensureTables();
  const rows = await queryAsync(
    `SELECT * FROM tbl_student_attendance_header
      WHERE id = ? AND administrationId = ? LIMIT 1`,
    [Number(attendanceId), Number(administrationId)]
  );
  return rows[0] || null;
};

const getHeadersForDate = async ({
  administrationId,
  date,
  classId,
  sectionId,
  subjectId,
  periodSlotId,
}) => {
  await ensureTables();
  const conditions = [
    "h.administrationId = ?",
    "h.attendanceDate = ?",
    "h.classId = ?",
    "h.sectionId = ?",
  ];
  const params = [
    Number(administrationId),
    date,
    Number(classId),
    Number(sectionId),
  ];
  if (subjectId !== undefined && subjectId !== null && subjectId !== "") {
    conditions.push("h.subjectId = ?");
    params.push(Number(subjectId));
  }
  if (periodSlotId !== undefined && periodSlotId !== null && periodSlotId !== "") {
    conditions.push("h.periodSlotId = ?");
    params.push(Number(periodSlotId));
  }
  return queryAsync(
    `SELECT
        h.*,
        DATE_FORMAT(h.attendanceDate, '%Y-%m-%d') AS date,
        cm.name AS className,
        sm.name AS sectionName,
        sb.name AS subjectName,
        TIME_FORMAT(ps.startTime, '%h:%i %p') AS startTime,
        TIME_FORMAT(ps.endTime, '%h:%i %p') AS endTime
       FROM tbl_student_attendance_header h
       LEFT JOIN classmaster cm
         ON cm.id = h.classId AND cm.administrationId = h.administrationId
       LEFT JOIN sectionmaster sm
         ON sm.id = h.sectionId AND sm.administrationId = h.administrationId
       LEFT JOIN subject sb
         ON sb.id = h.subjectId AND sb.administrationId = h.administrationId
       LEFT JOIN tbl_periodslot ps
         ON ps.id = h.periodSlotId AND ps.administrationId = h.administrationId
      WHERE ${conditions.join(" AND ")}
      ORDER BY h.periodSlotId, h.id`,
    params
  );
};

const getDetailsForHeaders = async (attendanceIds) => {
  await ensureTables();
  if (!attendanceIds.length) return [];
  return tryQueries([
    {
      sql: `SELECT d.attendanceId, d.studentId, d.status, d.remarks,
                   ${STUDENT_NAME_EXPR} AS studentName
              FROM tbl_student_attendance_detail d
              JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
              LEFT JOIN student st
                ON st.admissionNo = d.studentId AND st.administrationId = h.administrationId
             WHERE d.attendanceId IN (?)
             ORDER BY studentName, d.studentId`,
      params: [attendanceIds],
    },
    {
      sql: `SELECT d.attendanceId, d.studentId, d.status, d.remarks,
                   d.studentId AS studentName
              FROM tbl_student_attendance_detail d
             WHERE d.attendanceId IN (?)
             ORDER BY d.studentId`,
      params: [attendanceIds],
    },
  ]);
};

// Upserts header + details in one transaction. Unique keys make retries
// idempotent: the header row is reused (LAST_INSERT_ID trick) and details
// are updated in place.
const saveStudentAttendance = async ({
  administrationId,
  academicYear,
  date,
  classId,
  sectionId,
  subjectId,
  periodSlotId,
  staffId,
  mode,
  markedBy,
  students,
}) => {
  await ensureTables();
  return withTransaction(async (query) => {
    const headerResult = await query(
      `INSERT INTO tbl_student_attendance_header
         (administrationId, academicYear, attendanceDate, classId, sectionId,
          subjectId, periodSlotId, staffId, attendanceMode, createdBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         staffId = VALUES(staffId),
         attendanceMode = VALUES(attendanceMode),
         updatedBy = VALUES(createdBy),
         updatedAt = CURRENT_TIMESTAMP`,
      [
        Number(administrationId),
        String(academicYear),
        date,
        Number(classId),
        Number(sectionId),
        Number(subjectId),
        Number(periodSlotId),
        String(staffId),
        String(mode),
        String(markedBy),
      ]
    );
    const attendanceId = headerResult.insertId;

    if (students.length) {
      const placeholders = students.map(() => "(?, ?, ?, ?)").join(", ");
      const params = [];
      students.forEach((student) => {
        params.push(
          attendanceId,
          String(student.studentId),
          student.status,
          student.remarks == null ? null : String(student.remarks)
        );
      });
      await query(
        `INSERT INTO tbl_student_attendance_detail (attendanceId, studentId, status, remarks)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           remarks = VALUES(remarks),
           updatedAt = CURRENT_TIMESTAMP`,
        params
      );
    }
    return { attendanceId };
  });
};

const updateStudentAttendanceDetails = async ({
  attendanceId,
  students,
  updatedBy,
  administrationId,
}) => {
  await ensureTables();
  return withTransaction(async (query) => {
    if (students.length) {
      const placeholders = students.map(() => "(?, ?, ?, ?)").join(", ");
      const params = [];
      students.forEach((student) => {
        params.push(
          Number(attendanceId),
          String(student.studentId),
          student.status,
          student.remarks == null ? null : String(student.remarks)
        );
      });
      await query(
        `INSERT INTO tbl_student_attendance_detail (attendanceId, studentId, status, remarks)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           remarks = VALUES(remarks),
           updatedAt = CURRENT_TIMESTAMP`,
        params
      );
    }
    await query(
      `UPDATE tbl_student_attendance_header
          SET updatedBy = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ? AND administrationId = ?`,
      [String(updatedBy), Number(attendanceId), Number(administrationId)]
    );
    return { attendanceId: Number(attendanceId) };
  });
};

const getStudentSummary = async ({
  administrationId,
  studentId,
  date,
  monthStart,
  monthEnd,
}) => {
  await ensureTables();
  const weight = weightExpr("d.status");

  const today = await queryAsync(
    `SELECT
        DATE_FORMAT(h.attendanceDate, '%Y-%m-%d') AS date,
        h.attendanceMode,
        h.subjectId,
        sb.name AS subjectName,
        h.periodSlotId,
        TIME_FORMAT(ps.startTime, '%h:%i %p') AS startTime,
        TIME_FORMAT(ps.endTime, '%h:%i %p') AS endTime,
        d.status,
        d.remarks,
        h.staffId AS markedBy
       FROM tbl_student_attendance_detail d
       JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
       LEFT JOIN subject sb
         ON sb.id = h.subjectId AND sb.administrationId = h.administrationId
       LEFT JOIN tbl_periodslot ps
         ON ps.id = h.periodSlotId AND ps.administrationId = h.administrationId
      WHERE h.administrationId = ? AND d.studentId = ? AND h.attendanceDate = ?
      ORDER BY h.periodSlotId`,
    [Number(administrationId), String(studentId), date]
  );

  const monthly = await queryAsync(
    `SELECT
        DATE_FORMAT(h.attendanceDate, '%Y-%m-%d') AS date,
        ROUND(AVG(${weight}), 2) AS dayWeight,
        GROUP_CONCAT(DISTINCT d.status) AS statuses
       FROM tbl_student_attendance_detail d
       JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
      WHERE h.administrationId = ? AND d.studentId = ?
        AND h.attendanceDate BETWEEN ? AND ?
      GROUP BY h.attendanceDate
      ORDER BY h.attendanceDate`,
    [Number(administrationId), String(studentId), monthStart, monthEnd]
  );

  const subjectWise = await queryAsync(
    `SELECT
        h.subjectId,
        MIN(sb.name) AS subjectName,
        COUNT(*) AS totalClasses,
        SUM(CASE WHEN d.status = 'Present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN d.status = 'Absent' THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN d.status = 'Leave' THEN 1 ELSE 0 END) AS onLeave,
        SUM(CASE WHEN d.status = 'Late' THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN d.status = 'Half Day' THEN 1 ELSE 0 END) AS halfDay,
        SUM(CASE WHEN d.status = 'Medical Leave' THEN 1 ELSE 0 END) AS medicalLeave,
        ROUND(SUM(${weight}) / COUNT(*) * 100, 2) AS percentage
       FROM tbl_student_attendance_detail d
       JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
       LEFT JOIN subject sb
         ON sb.id = h.subjectId AND sb.administrationId = h.administrationId
      WHERE h.administrationId = ? AND d.studentId = ? AND h.subjectId <> 0
      GROUP BY h.subjectId
      ORDER BY subjectName`,
    [Number(administrationId), String(studentId)]
  );

  const history = await queryAsync(
    `SELECT
        DATE_FORMAT(h.attendanceDate, '%Y-%m-%d') AS date,
        h.attendanceMode,
        h.subjectId,
        sb.name AS subjectName,
        h.periodSlotId,
        TIME_FORMAT(ps.startTime, '%h:%i %p') AS startTime,
        TIME_FORMAT(ps.endTime, '%h:%i %p') AS endTime,
        d.status,
        d.remarks,
        h.staffId AS markedBy
       FROM tbl_student_attendance_detail d
       JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
       LEFT JOIN subject sb
         ON sb.id = h.subjectId AND sb.administrationId = h.administrationId
       LEFT JOIN tbl_periodslot ps
         ON ps.id = h.periodSlotId AND ps.administrationId = h.administrationId
      WHERE h.administrationId = ? AND d.studentId = ?
      ORDER BY h.attendanceDate DESC, h.periodSlotId
      LIMIT 120`,
    [Number(administrationId), String(studentId)]
  );

  return { today, monthly, subjectWise, history };
};

const getActiveStaffList = async (administrationId) => {
  await ensureTables();
  return queryAsync(
    `SELECT staffId,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', firstName, lastName)), ''), staffId) AS staffName
       FROM staff
      WHERE administrationId = ? AND isActive = '1'
      ORDER BY firstName, lastName, staffId`,
    [Number(administrationId)]
  );
};

const saveStaffAttendance = async ({
  administrationId,
  academicYear,
  date,
  entries,
  markedBy,
}) => {
  await ensureTables();
  return withTransaction(async (query) => {
    const placeholders = entries.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
    const params = [];
    entries.forEach((entry) => {
      params.push(
        Number(administrationId),
        String(academicYear),
        date,
        String(entry.staffId),
        entry.status,
        entry.remarks == null ? null : String(entry.remarks),
        String(markedBy)
      );
    });
    await query(
      `INSERT INTO tbl_staff_attendance
         (administrationId, academicYear, attendanceDate, staffId, status, remarks, createdBy)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         remarks = VALUES(remarks),
         updatedBy = VALUES(createdBy),
         updatedAt = CURRENT_TIMESTAMP`,
      params
    );
    return { saved: entries.length };
  });
};

const getStaffAttendanceForDate = async (administrationId, date) => {
  await ensureTables();
  return queryAsync(
    `SELECT
        s.staffId,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', s.firstName, s.lastName)), ''), s.staffId) AS staffName,
        sa.id,
        DATE_FORMAT(sa.attendanceDate, '%Y-%m-%d') AS date,
        sa.status,
        sa.remarks,
        sa.createdBy AS markedBy
       FROM staff s
       LEFT JOIN tbl_staff_attendance sa
         ON sa.staffId = s.staffId
        AND sa.administrationId = s.administrationId
        AND sa.attendanceDate = ?
      WHERE s.administrationId = ? AND s.isActive = '1'
      ORDER BY s.firstName, s.lastName, s.staffId`,
    [date, Number(administrationId)]
  );
};

const getStaffAttendanceRow = async ({ administrationId, id, staffId, date }) => {
  await ensureTables();
  if (id) {
    const rows = await queryAsync(
      `SELECT * FROM tbl_staff_attendance WHERE id = ? AND administrationId = ? LIMIT 1`,
      [Number(id), Number(administrationId)]
    );
    return rows[0] || null;
  }
  const rows = await queryAsync(
    `SELECT * FROM tbl_staff_attendance
      WHERE administrationId = ? AND staffId = ? AND attendanceDate = ? LIMIT 1`,
    [Number(administrationId), String(staffId), date]
  );
  return rows[0] || null;
};

const updateStaffAttendanceRow = async ({
  id,
  status,
  remarks,
  updatedBy,
  administrationId,
}) => {
  await ensureTables();
  return queryAsync(
    `UPDATE tbl_staff_attendance
        SET status = ?, remarks = ?, updatedBy = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ? AND administrationId = ?`,
    [
      status,
      remarks == null ? null : String(remarks),
      String(updatedBy),
      Number(id),
      Number(administrationId),
    ]
  );
};

const getMyStaffAttendance = async ({
  administrationId,
  staffId,
  monthStart,
  monthEnd,
}) => {
  await ensureTables();
  const weight = weightExpr("sa.status");
  const history = await queryAsync(
    `SELECT
        sa.id,
        DATE_FORMAT(sa.attendanceDate, '%Y-%m-%d') AS date,
        sa.status,
        sa.remarks,
        sa.createdBy AS markedBy
       FROM tbl_staff_attendance sa
      WHERE sa.administrationId = ? AND sa.staffId = ?
      ORDER BY sa.attendanceDate DESC
      LIMIT 120`,
    [Number(administrationId), String(staffId)]
  );
  const monthly = await queryAsync(
    `SELECT
        COUNT(*) AS daysMarked,
        SUM(CASE WHEN sa.status = 'Present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN sa.status = 'Absent' THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN sa.status = 'Leave' THEN 1 ELSE 0 END) AS onLeave,
        SUM(CASE WHEN sa.status = 'Late' THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN sa.status = 'Half Day' THEN 1 ELSE 0 END) AS halfDay,
        ROUND(SUM(${weight}), 1) AS presentEquivalent,
        ROUND(SUM(${weight}) / NULLIF(COUNT(*), 0) * 100, 2) AS percentage
       FROM tbl_staff_attendance sa
      WHERE sa.administrationId = ? AND sa.staffId = ?
        AND sa.attendanceDate BETWEEN ? AND ?`,
    [Number(administrationId), String(staffId), monthStart, monthEnd]
  );
  return { history, monthly: monthly[0] || null };
};

/* -------------------------- report queries -------------------------- */

const studentStatusCountColumns = `
        SUM(CASE WHEN d.status = 'Present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN d.status = 'Absent' THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN d.status = 'Leave' THEN 1 ELSE 0 END) AS onLeave,
        SUM(CASE WHEN d.status = 'Late' THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN d.status = 'Half Day' THEN 1 ELSE 0 END) AS halfDay,
        SUM(CASE WHEN d.status = 'Medical Leave' THEN 1 ELSE 0 END) AS medicalLeave`;

const buildRangeCondition = (conditions, params, startDate, endDate) => {
  if (startDate) {
    conditions.push("h.attendanceDate >= ?");
    params.push(startDate);
  }
  if (endDate) {
    conditions.push("h.attendanceDate <= ?");
    params.push(endDate);
  }
};

const reportStudent = async ({
  administrationId,
  classId,
  sectionId,
  studentId,
  startDate,
  endDate,
}) => {
  await ensureTables();
  const weight = weightExpr("d.status");
  const conditions = ["h.administrationId = ?"];
  const params = [Number(administrationId)];
  if (classId && String(classId) !== "All") {
    conditions.push("h.classId = ?");
    params.push(Number(classId));
  }
  if (sectionId && String(sectionId) !== "All") {
    conditions.push("h.sectionId = ?");
    params.push(Number(sectionId));
  }
  if (studentId && String(studentId) !== "All") {
    conditions.push("d.studentId = ?");
    params.push(String(studentId));
  }
  buildRangeCondition(conditions, params, startDate, endDate);

  const build = (withName) => `
    SELECT
        d.studentId,
        ${withName ? `MIN(${STUDENT_NAME_EXPR})` : "d.studentId"} AS studentName,
        h.classId,
        MIN(cm.name) AS className,
        h.sectionId,
        MIN(sm.name) AS sectionName,
        COUNT(*) AS totalRecords,
        COUNT(DISTINCT h.attendanceDate) AS daysMarked,
        ${studentStatusCountColumns},
        ROUND(SUM(${weight}) / COUNT(*) * 100, 2) AS percentage
      FROM tbl_student_attendance_detail d
      JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
      LEFT JOIN classmaster cm ON cm.id = h.classId AND cm.administrationId = h.administrationId
      LEFT JOIN sectionmaster sm ON sm.id = h.sectionId AND sm.administrationId = h.administrationId
      ${withName ? "LEFT JOIN student st ON st.admissionNo = d.studentId AND st.administrationId = h.administrationId" : ""}
     WHERE ${conditions.join(" AND ")}
     GROUP BY d.studentId, h.classId, h.sectionId
     ORDER BY className, sectionName, studentName`;

  return tryQueries([
    { sql: build(true), params },
    { sql: build(false), params },
  ]);
};

const reportStaff = async ({ administrationId, staffId, startDate, endDate }) => {
  await ensureTables();
  const weight = weightExpr("sa.status");
  const conditions = ["sa.administrationId = ?"];
  const params = [Number(administrationId)];
  if (staffId && String(staffId) !== "All") {
    conditions.push("sa.staffId = ?");
    params.push(String(staffId));
  }
  if (startDate) {
    conditions.push("sa.attendanceDate >= ?");
    params.push(startDate);
  }
  if (endDate) {
    conditions.push("sa.attendanceDate <= ?");
    params.push(endDate);
  }
  return queryAsync(
    `SELECT
        sa.staffId,
        MIN(${STAFF_NAME_EXPR}) AS staffName,
        COUNT(*) AS daysMarked,
        SUM(CASE WHEN sa.status = 'Present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN sa.status = 'Absent' THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN sa.status = 'Leave' THEN 1 ELSE 0 END) AS onLeave,
        SUM(CASE WHEN sa.status = 'Late' THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN sa.status = 'Half Day' THEN 1 ELSE 0 END) AS halfDay,
        ROUND(SUM(${weight}), 1) AS presentEquivalent,
        ROUND(SUM(${weight}) / COUNT(*) * 100, 2) AS percentage
       FROM tbl_staff_attendance sa
       LEFT JOIN staff s
         ON s.staffId = sa.staffId AND s.administrationId = sa.administrationId
      WHERE ${conditions.join(" AND ")}
      GROUP BY sa.staffId
      ORDER BY staffName`,
    params
  );
};

const reportDaily = async ({ administrationId, date, classId, sectionId }) => {
  await ensureTables();
  const conditions = ["h.administrationId = ?", "h.attendanceDate = ?"];
  const params = [Number(administrationId), date];
  if (classId && String(classId) !== "All") {
    conditions.push("h.classId = ?");
    params.push(Number(classId));
  }
  if (sectionId && String(sectionId) !== "All") {
    conditions.push("h.sectionId = ?");
    params.push(Number(sectionId));
  }
  const build = (withName) => `
    SELECT
        d.studentId,
        ${withName ? STUDENT_NAME_EXPR : "d.studentId"} AS studentName,
        cm.name AS className,
        sm.name AS sectionName,
        h.attendanceMode,
        h.subjectId,
        sb.name AS subjectName,
        h.periodSlotId,
        d.status,
        d.remarks,
        h.staffId AS markedBy,
        DATE_FORMAT(h.attendanceDate, '%Y-%m-%d') AS date
      FROM tbl_student_attendance_detail d
      JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
      LEFT JOIN classmaster cm ON cm.id = h.classId AND cm.administrationId = h.administrationId
      LEFT JOIN sectionmaster sm ON sm.id = h.sectionId AND sm.administrationId = h.administrationId
      LEFT JOIN subject sb ON sb.id = h.subjectId AND sb.administrationId = h.administrationId
      ${withName ? "LEFT JOIN student st ON st.admissionNo = d.studentId AND st.administrationId = h.administrationId" : ""}
     WHERE ${conditions.join(" AND ")}
     ORDER BY className, sectionName, h.periodSlotId, studentName`;

  return tryQueries([
    { sql: build(true), params },
    { sql: build(false), params },
  ]);
};

const reportMonthly = async ({
  administrationId,
  monthStart,
  monthEnd,
  classId,
  sectionId,
}) => {
  await ensureTables();
  const weight = weightExpr("d.status");
  const conditions = [
    "h.administrationId = ?",
    "h.attendanceDate BETWEEN ? AND ?",
  ];
  const params = [Number(administrationId), monthStart, monthEnd];
  if (classId && String(classId) !== "All") {
    conditions.push("h.classId = ?");
    params.push(Number(classId));
  }
  if (sectionId && String(sectionId) !== "All") {
    conditions.push("h.sectionId = ?");
    params.push(Number(sectionId));
  }

  const inner = `
    SELECT d.studentId, h.classId, h.sectionId, h.administrationId, h.attendanceDate,
           AVG(${weight}) AS dayWeight
      FROM tbl_student_attendance_detail d
      JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
     WHERE ${conditions.join(" AND ")}
     GROUP BY d.studentId, h.classId, h.sectionId, h.administrationId, h.attendanceDate`;

  const build = (withName) => `
    SELECT
        t.studentId,
        ${withName
          ? `MIN(COALESCE(NULLIF(TRIM(CONCAT_WS(' ', st.firstName, st.middleName, st.lastName)), ''), t.studentId))`
          : "t.studentId"} AS studentName,
        MIN(cm.name) AS className,
        MIN(sm.name) AS sectionName,
        COUNT(*) AS daysMarked,
        ROUND(SUM(t.dayWeight), 1) AS presentDays,
        ROUND(SUM(t.dayWeight) / COUNT(*) * 100, 2) AS percentage
      FROM (${inner}) t
      LEFT JOIN classmaster cm ON cm.id = t.classId AND cm.administrationId = t.administrationId
      LEFT JOIN sectionmaster sm ON sm.id = t.sectionId AND sm.administrationId = t.administrationId
      ${withName ? "LEFT JOIN student st ON st.admissionNo = t.studentId AND st.administrationId = t.administrationId" : ""}
     GROUP BY t.studentId, t.classId, t.sectionId
     ORDER BY className, sectionName, studentName`;

  return tryQueries([
    { sql: build(true), params },
    { sql: build(false), params },
  ]);
};

const reportClassWise = async ({ administrationId, startDate, endDate }) => {
  await ensureTables();
  const weight = weightExpr("d.status");
  const conditions = ["h.administrationId = ?"];
  const params = [Number(administrationId)];
  buildRangeCondition(conditions, params, startDate, endDate);
  return queryAsync(
    `SELECT
        MIN(cm.name) AS className,
        MIN(sm.name) AS sectionName,
        COUNT(DISTINCT h.attendanceDate) AS daysMarked,
        COUNT(DISTINCT d.studentId) AS students,
        COUNT(*) AS totalRecords,
        ${studentStatusCountColumns},
        ROUND(SUM(${weight}) / COUNT(*) * 100, 2) AS percentage
       FROM tbl_student_attendance_detail d
       JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
       LEFT JOIN classmaster cm ON cm.id = h.classId AND cm.administrationId = h.administrationId
       LEFT JOIN sectionmaster sm ON sm.id = h.sectionId AND sm.administrationId = h.administrationId
      WHERE ${conditions.join(" AND ")}
      GROUP BY h.classId, h.sectionId
      ORDER BY className, sectionName`,
    params
  );
};

const reportSubjectWise = async ({
  administrationId,
  classId,
  sectionId,
  startDate,
  endDate,
}) => {
  await ensureTables();
  const weight = weightExpr("d.status");
  const conditions = ["h.administrationId = ?", "h.subjectId <> 0"];
  const params = [Number(administrationId)];
  if (classId && String(classId) !== "All") {
    conditions.push("h.classId = ?");
    params.push(Number(classId));
  }
  if (sectionId && String(sectionId) !== "All") {
    conditions.push("h.sectionId = ?");
    params.push(Number(sectionId));
  }
  buildRangeCondition(conditions, params, startDate, endDate);
  return queryAsync(
    `SELECT
        h.subjectId,
        MIN(sb.name) AS subjectName,
        COUNT(DISTINCT h.attendanceDate) AS daysMarked,
        COUNT(DISTINCT d.studentId) AS students,
        COUNT(*) AS totalRecords,
        ${studentStatusCountColumns},
        ROUND(SUM(${weight}) / COUNT(*) * 100, 2) AS percentage
       FROM tbl_student_attendance_detail d
       JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
       LEFT JOIN subject sb ON sb.id = h.subjectId AND sb.administrationId = h.administrationId
      WHERE ${conditions.join(" AND ")}
      GROUP BY h.subjectId
      ORDER BY subjectName`,
    params
  );
};

const reportAbsentStudents = async ({
  administrationId,
  date,
  classId,
  sectionId,
}) => {
  await ensureTables();
  const conditions = [
    "h.administrationId = ?",
    "h.attendanceDate = ?",
    "d.status IN ('Absent', 'Leave')",
  ];
  const params = [Number(administrationId), date];
  if (classId && String(classId) !== "All") {
    conditions.push("h.classId = ?");
    params.push(Number(classId));
  }
  if (sectionId && String(sectionId) !== "All") {
    conditions.push("h.sectionId = ?");
    params.push(Number(sectionId));
  }
  const build = (withName) => `
    SELECT DISTINCT
        d.studentId,
        ${withName ? STUDENT_NAME_EXPR : "d.studentId"} AS studentName,
        cm.name AS className,
        sm.name AS sectionName,
        h.attendanceMode,
        h.subjectId,
        sb.name AS subjectName,
        d.status,
        d.remarks,
        DATE_FORMAT(h.attendanceDate, '%Y-%m-%d') AS date
      FROM tbl_student_attendance_detail d
      JOIN tbl_student_attendance_header h ON h.id = d.attendanceId
      LEFT JOIN classmaster cm ON cm.id = h.classId AND cm.administrationId = h.administrationId
      LEFT JOIN sectionmaster sm ON sm.id = h.sectionId AND sm.administrationId = h.administrationId
      LEFT JOIN subject sb ON sb.id = h.subjectId AND sb.administrationId = h.administrationId
      ${withName ? "LEFT JOIN student st ON st.admissionNo = d.studentId AND st.administrationId = h.administrationId" : ""}
     WHERE ${conditions.join(" AND ")}
     ORDER BY className, sectionName, studentName`;

  return tryQueries([
    { sql: build(true), params },
    { sql: build(false), params },
  ]);
};

const reportAbsentStaff = async ({ administrationId, date }) => {
  await ensureTables();
  return queryAsync(
    `SELECT
        sa.staffId,
        ${STAFF_NAME_EXPR} AS staffName,
        sa.status,
        sa.remarks,
        DATE_FORMAT(sa.attendanceDate, '%Y-%m-%d') AS date,
        sa.createdBy AS markedBy
       FROM tbl_staff_attendance sa
       LEFT JOIN staff s
         ON s.staffId = sa.staffId AND s.administrationId = sa.administrationId
      WHERE sa.administrationId = ?
        AND sa.attendanceDate = ?
        AND sa.status IN ('Absent', 'Leave')
      ORDER BY staffName`,
    [Number(administrationId), date]
  );
};

module.exports = {
  ensureTables,
  STUDENT_STATUSES,
  STAFF_STATUSES,
  canonicalStatus,
  getActiveAcademicYear,
  isClassTeacher,
  getClassTeacherAssignments,
  isPeriodAuthorized,
  getRoster,
  getStaffPeriodsForDate,
  findHeader,
  getHeaderById,
  getHeadersForDate,
  getDetailsForHeaders,
  saveStudentAttendance,
  updateStudentAttendanceDetails,
  getStudentSummary,
  getActiveStaffList,
  saveStaffAttendance,
  getStaffAttendanceForDate,
  getStaffAttendanceRow,
  updateStaffAttendanceRow,
  getMyStaffAttendance,
  reportStudent,
  reportStaff,
  reportDaily,
  reportMonthly,
  reportClassWise,
  reportSubjectWise,
  reportAbsentStudents,
  reportAbsentStaff,
};
