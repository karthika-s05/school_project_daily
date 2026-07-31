const con = require("../config/dbConfig");

const queryAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    con.query(sql, params, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

let tablesReady = false;

const ensureTables = async () => {
  if (tablesReady) return;
  await queryAsync(`
    CREATE TABLE IF NOT EXISTS tbl_timetable_substitute (
      id INT AUTO_INCREMENT PRIMARY KEY,
      administrationId INT NOT NULL,
      timetableId INT NOT NULL,
      leaveId INT DEFAULT NULL,
      absentStaffId VARCHAR(50) NOT NULL,
      substituteStaffId VARCHAR(50) DEFAULT NULL,
      subjectId INT NOT NULL,
      classId INT NOT NULL,
      sectionId INT NOT NULL,
      periodSlotId INT NOT NULL,
      dayId INT NOT NULL,
      substituteDate DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'Pending',
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_sub_open (administrationId, timetableId, substituteDate, absentStaffId),
      KEY idx_sub_staff_date (administrationId, substituteStaffId, substituteDate),
      KEY idx_sub_absent_date (administrationId, absentStaffId, substituteDate),
      KEY idx_sub_status (administrationId, status),
      KEY idx_sub_leave (leaveId)
    )
  `);
  tablesReady = true;
};

const formatStaffName = (row) =>
  String(
    row?.staffName ||
      [row?.firstName, row?.lastName].filter(Boolean).join(" ").trim() ||
      row?.staffId ||
      ""
  ).trim();

module.exports = {
  ensureTables,

  getStaffLeaveById: async (leaveId, administrationId, callback) => {
    try {
      const candidates = [
        `SELECT id, staffId, userName, staffName, startDate, endDate, leaveTime, status, reason
         FROM tbl_staffleave
         WHERE id = ? AND administrationId = ?
         LIMIT 1`,
        `SELECT id, staffId, userName, staffName, startDate, endDate, leaveTime, status, reason
         FROM staffleave
         WHERE id = ? AND administrationId = ?
         LIMIT 1`,
        `SELECT id, staffId, userName, staffName, startDate, endDate, leaveTime, status, reason
         FROM tbl_staff_leave
         WHERE id = ? AND administrationId = ?
         LIMIT 1`,
      ];
      let row = null;
      for (const sql of candidates) {
        try {
          const rows = await queryAsync(sql, [Number(leaveId), Number(administrationId)]);
          if (rows && rows[0]) {
            row = rows[0];
            break;
          }
        } catch (_) {
          /* try next table name */
        }
      }

      if (!row) {
        // Fallback: Admin SP list, then filter by id
        try {
          const spRows = await queryAsync(
            `CALL sp_GetStaffLeave(?, 'Admin', ?)`,
            ["0", Number(administrationId)]
          );
          const list = Array.isArray(spRows) ? spRows[0] || [] : [];
          row =
            list.find((item) => Number(item.id) === Number(leaveId)) || null;
        } catch (_) {
          /* ignore */
        }
      }

      if (row && !row.staffId && row.userName) {
        row.staffId = row.userName;
      }
      callback(null, row);
    } catch (err) {
      callback(err, null);
    }
  },

  getTimetablePeriodsForStaffOnDay: async (
    staffId,
    dayId,
    administrationId,
    callback
  ) => {
    const sql = `
      SELECT
        ctt.id AS timetableId,
        ctt.periodSlotId,
        ctt.dayId,
        ctt.subjectId,
        sb.name AS subjectName,
        ctt.staffId AS absentStaffId,
        ctt.classId,
        cm.name AS className,
        ctt.sectionId,
        sm.name AS sectionName,
        TIME_FORMAT(ps.startTime, '%h:%i %p') AS startTime,
        TIME_FORMAT(ps.endTime, '%h:%i %p') AS endTime,
        TIME_FORMAT(ps.startTime, '%H:%i') AS startTime24,
        TIME_FORMAT(ps.endTime, '%H:%i') AS endTime24
      FROM tbl_classtimetable ctt
      JOIN tbl_periodslot ps
        ON ps.id = ctt.periodSlotId
       AND ps.administrationId = ctt.administrationId
      JOIN subject sb
        ON sb.id = ctt.subjectId
       AND sb.administrationId = ctt.administrationId
      LEFT JOIN classmaster cm
        ON cm.id = ctt.classId
       AND cm.administrationId = ctt.administrationId
      LEFT JOIN sectionmaster sm
        ON sm.id = ctt.sectionId
       AND sm.administrationId = ctt.administrationId
      WHERE ctt.administrationId = ?
        AND ctt.staffId = ?
        AND ctt.dayId = ?
        AND ctt.isActive = '1'
        AND ctt.academicYear = (
          SELECT academicYear FROM tbl_academicyear
          WHERE administrationId = ? AND isActive = '1' LIMIT 1
        )
      ORDER BY ps.startTime
    `;
    con.query(
      sql,
      [administrationId, String(staffId), Number(dayId), administrationId],
      (err, rows) => {
        if (err) callback(err, null);
        else callback(null, rows || []);
      }
    );
  },

  getPeerStaffForSubject: async (
    subjectId,
    absentStaffId,
    administrationId,
    callback
  ) => {
    const sql = `
      SELECT
        s.staffId,
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' ', s.firstName, s.lastName)), ''),
          s.staffId
        ) AS staffName,
        sb.id AS subjectId,
        sb.name AS subjectName
      FROM subject sb
      JOIN staff s
        ON s.administrationId = sb.administrationId
       AND s.isActive = '1'
       AND LOWER(TRIM(s.department)) = LOWER(TRIM(sb.name))
      WHERE sb.id = ?
        AND sb.administrationId = ?
        AND sb.isActive = '1'
        AND s.staffId <> ?
      ORDER BY s.firstName, s.lastName, s.staffId
    `;
    con.query(
      sql,
      [Number(subjectId), Number(administrationId), String(absentStaffId)],
      (err, rows) => {
        if (err) callback(err, null);
        else callback(null, rows || []);
      }
    );
  },

  createSubstituteRequest: async (payload, callback) => {
    try {
      await ensureTables();
      const sql = `
        INSERT INTO tbl_timetable_substitute (
          administrationId, timetableId, leaveId, absentStaffId, substituteStaffId,
          subjectId, classId, sectionId, periodSlotId, dayId, substituteDate, status
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'Pending')
        ON DUPLICATE KEY UPDATE
          leaveId = VALUES(leaveId),
          status = IF(status = 'Accepted', status, 'Pending'),
          updatedAt = CURRENT_TIMESTAMP
      `;
      const params = [
        Number(payload.administrationId),
        Number(payload.timetableId),
        payload.leaveId == null ? null : Number(payload.leaveId),
        String(payload.absentStaffId),
        Number(payload.subjectId),
        Number(payload.classId),
        Number(payload.sectionId),
        Number(payload.periodSlotId),
        Number(payload.dayId),
        payload.substituteDate,
      ];
      const result = await queryAsync(sql, params);
      callback(null, result);
    } catch (err) {
      callback(err, null);
    }
  },

  getSubstituteById: async (id, administrationId, callback) => {
    try {
      await ensureTables();
      const sql = `
        SELECT
          sub.*,
          sb.name AS subjectName,
          cm.name AS className,
          sm.name AS sectionName,
          TIME_FORMAT(ps.startTime, '%h:%i %p') AS startTime,
          TIME_FORMAT(ps.endTime, '%h:%i %p') AS endTime,
          COALESCE(
            NULLIF(TRIM(CONCAT_WS(' ', absent.firstName, absent.lastName)), ''),
            sub.absentStaffId
          ) AS absentStaffName,
          COALESCE(
            NULLIF(TRIM(CONCAT_WS(' ', subst.firstName, subst.lastName)), ''),
            sub.substituteStaffId
          ) AS substituteStaffName,
          d.dayName AS day
        FROM tbl_timetable_substitute sub
        LEFT JOIN subject sb
          ON sb.id = sub.subjectId AND sb.administrationId = sub.administrationId
        LEFT JOIN classmaster cm
          ON cm.id = sub.classId AND cm.administrationId = sub.administrationId
        LEFT JOIN sectionmaster sm
          ON sm.id = sub.sectionId AND sm.administrationId = sub.administrationId
        LEFT JOIN tbl_periodslot ps
          ON ps.id = sub.periodSlotId AND ps.administrationId = sub.administrationId
        LEFT JOIN tbl_calendar d ON d.id = sub.dayId
        LEFT JOIN staff absent
          ON absent.staffId = sub.absentStaffId AND absent.administrationId = sub.administrationId
        LEFT JOIN staff subst
          ON subst.staffId = sub.substituteStaffId AND subst.administrationId = sub.administrationId
        WHERE sub.id = ? AND sub.administrationId = ?
        LIMIT 1
      `;
      const rows = await queryAsync(sql, [Number(id), Number(administrationId)]);
      callback(null, rows[0] || null);
    } catch (err) {
      callback(err, null);
    }
  },

  getMySubstituteRequests: async (staffId, administrationId, callback) => {
    try {
      await ensureTables();
      const sql = `
        SELECT
          sub.*,
          sb.name AS subjectName,
          cm.name AS className,
          sm.name AS sectionName,
          TIME_FORMAT(ps.startTime, '%h:%i %p') AS startTime,
          TIME_FORMAT(ps.endTime, '%h:%i %p') AS endTime,
          COALESCE(
            NULLIF(TRIM(CONCAT_WS(' ', absent.firstName, absent.lastName)), ''),
            sub.absentStaffId
          ) AS absentStaffName,
          d.dayName AS day
        FROM tbl_timetable_substitute sub
        LEFT JOIN subject sb
          ON sb.id = sub.subjectId AND sb.administrationId = sub.administrationId
        LEFT JOIN classmaster cm
          ON cm.id = sub.classId AND cm.administrationId = sub.administrationId
        LEFT JOIN sectionmaster sm
          ON sm.id = sub.sectionId AND sm.administrationId = sub.administrationId
        LEFT JOIN tbl_periodslot ps
          ON ps.id = sub.periodSlotId AND ps.administrationId = sub.administrationId
        LEFT JOIN tbl_calendar d ON d.id = sub.dayId
        LEFT JOIN staff absent
          ON absent.staffId = sub.absentStaffId AND absent.administrationId = sub.administrationId
        WHERE sub.administrationId = ?
          AND sub.status IN ('Pending', 'Accepted')
          AND (
            (sub.status = 'Pending' AND EXISTS (
              SELECT 1 FROM subject sb2
              JOIN staff me
                ON me.administrationId = sb2.administrationId
               AND me.isActive = '1'
               AND LOWER(TRIM(me.department)) = LOWER(TRIM(sb2.name))
               AND me.staffId = ?
              WHERE sb2.id = sub.subjectId
                AND sb2.administrationId = sub.administrationId
            ) AND sub.absentStaffId <> ?)
            OR (sub.status = 'Accepted' AND sub.substituteStaffId = ?)
          )
        ORDER BY sub.substituteDate, ps.startTime
      `;
      const rows = await queryAsync(sql, [
        Number(administrationId),
        String(staffId),
        String(staffId),
        String(staffId),
      ]);
      callback(null, rows);
    } catch (err) {
      callback(err, null);
    }
  },

  hasStaffConflict: async (
    staffId,
    periodSlotId,
    substituteDate,
    administrationId,
    callback
  ) => {
    try {
      await ensureTables();
      // Conflict if staff already has a permanent class that weekday OR accepted substitute same slot/date
      const daySql = `
        SELECT DAYOFWEEK(?) AS mysqlDow
      `;
      const dowRows = await queryAsync(daySql, [substituteDate]);
      // MySQL DAYOFWEEK: 1=Sunday .. 7=Saturday. Our calendar typically Mon=1..Sat=6.
      const mysqlDow = Number(dowRows?.[0]?.mysqlDow || 0);
      const dayId = mysqlDow === 1 ? 7 : mysqlDow - 1; // convert to Mon=1..Sun=7

      const permanentSql = `
        SELECT ctt.id
        FROM tbl_classtimetable ctt
        WHERE ctt.administrationId = ?
          AND ctt.staffId = ?
          AND ctt.periodSlotId = ?
          AND ctt.dayId = ?
          AND ctt.isActive = '1'
        LIMIT 1
      `;
      const permanent = await queryAsync(permanentSql, [
        Number(administrationId),
        String(staffId),
        Number(periodSlotId),
        dayId,
      ]);
      if (permanent.length) {
        callback(null, true);
        return;
      }

      const subSql = `
        SELECT id FROM tbl_timetable_substitute
        WHERE administrationId = ?
          AND substituteStaffId = ?
          AND periodSlotId = ?
          AND substituteDate = ?
          AND status = 'Accepted'
        LIMIT 1
      `;
      const accepted = await queryAsync(subSql, [
        Number(administrationId),
        String(staffId),
        Number(periodSlotId),
        substituteDate,
      ]);
      callback(null, accepted.length > 0);
    } catch (err) {
      callback(err, null);
    }
  },

  acceptSubstitute: async (id, substituteStaffId, administrationId, callback) => {
    try {
      await ensureTables();
      const sql = `
        UPDATE tbl_timetable_substitute
        SET substituteStaffId = ?, status = 'Accepted', updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
          AND administrationId = ?
          AND status = 'Pending'
      `;
      const result = await queryAsync(sql, [
        String(substituteStaffId),
        Number(id),
        Number(administrationId),
      ]);
      callback(null, result);
    } catch (err) {
      callback(err, null);
    }
  },

  rejectSubstitute: async (id, administrationId, callback) => {
    try {
      await ensureTables();
      const sql = `
        UPDATE tbl_timetable_substitute
        SET status = 'Rejected', updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
          AND administrationId = ?
          AND status = 'Pending'
      `;
      const result = await queryAsync(sql, [Number(id), Number(administrationId)]);
      callback(null, result);
    } catch (err) {
      callback(err, null);
    }
  },

  cancelSubstitutesForLeave: async (leaveId, administrationId, callback) => {
    try {
      await ensureTables();
      const sql = `
        UPDATE tbl_timetable_substitute
        SET status = 'Cancelled', updatedAt = CURRENT_TIMESTAMP
        WHERE leaveId = ?
          AND administrationId = ?
          AND status = 'Pending'
      `;
      const result = await queryAsync(sql, [Number(leaveId), Number(administrationId)]);
      callback(null, result);
    } catch (err) {
      callback(err, null);
    }
  },

  getSubstitutesForStaffWeek: async (
    staffId,
    weekStart,
    weekEnd,
    administrationId,
    callback
  ) => {
    try {
      await ensureTables();
      const sql = `
        SELECT
          sub.*,
          sb.name AS subjectName,
          cm.name AS className,
          sm.name AS sectionName,
          TIME_FORMAT(ps.startTime, '%h:%i %p') AS startTime,
          TIME_FORMAT(ps.endTime, '%h:%i %p') AS endTime,
          d.dayName AS day,
          COALESCE(
            NULLIF(TRIM(CONCAT_WS(' ', absent.firstName, absent.lastName)), ''),
            sub.absentStaffId
          ) AS absentStaffName
        FROM tbl_timetable_substitute sub
        LEFT JOIN subject sb
          ON sb.id = sub.subjectId AND sb.administrationId = sub.administrationId
        LEFT JOIN classmaster cm
          ON cm.id = sub.classId AND cm.administrationId = sub.administrationId
        LEFT JOIN sectionmaster sm
          ON sm.id = sub.sectionId AND sm.administrationId = sub.administrationId
        LEFT JOIN tbl_periodslot ps
          ON ps.id = sub.periodSlotId AND ps.administrationId = sub.administrationId
        LEFT JOIN tbl_calendar d ON d.id = sub.dayId
        LEFT JOIN staff absent
          ON absent.staffId = sub.absentStaffId AND absent.administrationId = sub.administrationId
        WHERE sub.administrationId = ?
          AND sub.substituteDate BETWEEN ? AND ?
          AND (
            (sub.status = 'Accepted' AND sub.substituteStaffId = ?)
            OR (sub.status = 'Pending' AND sub.absentStaffId = ?)
            OR (sub.status = 'Accepted' AND sub.absentStaffId = ?)
            OR (
              sub.status = 'Pending'
              AND sub.absentStaffId <> ?
              AND EXISTS (
                SELECT 1 FROM subject sb2
                JOIN staff me
                  ON me.administrationId = sb2.administrationId
                 AND me.isActive = '1'
                 AND LOWER(TRIM(me.department)) = LOWER(TRIM(sb2.name))
                 AND me.staffId = ?
                WHERE sb2.id = sub.subjectId
                  AND sb2.administrationId = sub.administrationId
              )
            )
          )
        ORDER BY sub.substituteDate, ps.startTime
      `;
      const rows = await queryAsync(sql, [
        Number(administrationId),
        weekStart,
        weekEnd,
        String(staffId),
        String(staffId),
        String(staffId),
        String(staffId),
        String(staffId),
      ]);
      callback(null, rows);
    } catch (err) {
      callback(err, null);
    }
  },

  formatStaffName,
};
