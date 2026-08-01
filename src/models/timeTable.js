const con = require("../config/dbConfig");

const ACTIVE_ACADEMIC_YEAR_SQL = `
  SELECT academicYear
  FROM tbl_academicyear
  WHERE administrationId = ?
    AND isActive = '1'
  LIMIT 1
`;

module.exports = {
  getPeriodSlot: async (classId, administrationId, callback) => {
    const safeClassId = Number(classId ?? 0);
    const safeAdministrationId = Number(administrationId ?? 0);
    const conditions = [
      "p.administrationId = ?",
      "p.isActive = '1'",
      `p.academicYear = (${ACTIVE_ACADEMIC_YEAR_SQL})`,
    ];
    const params = [safeAdministrationId, safeAdministrationId];

    if (safeClassId > 0) {
      conditions.push("p.classId = ?");
      params.push(safeClassId);
    }

    const sql = `
      SELECT
        p.id,
        p.startTime,
        p.endTime,
        p.classId,
        cm.name AS className,
        CONCAT(p.startTime, ' - ', p.endTime) AS slotName
      FROM tbl_periodslot p
      JOIN classmaster cm
        ON p.classId = cm.id
       AND cm.administrationId = p.administrationId
      WHERE ${conditions.join(" AND ")}
      ORDER BY p.classId, p.startTime
    `;

    con.query(sql, params, (err, rows) => {
      if (err) {
        console.error("getPeriodSlot SQL error:", err.sqlMessage || err.message || err);
        callback(err, null);
      } else {
        callback(null, [rows || []]);
      }
    });
  },
  getPeriodSlotById: async (id, administrationId, callback) => {
    const sql = `
      SELECT
        p.id,
        p.startTime,
        p.endTime,
        p.classId,
        cm.name AS className,
        CONCAT(p.startTime, ' - ', p.endTime) AS slotName
      FROM tbl_periodslot p
      JOIN classmaster cm
        ON p.classId = cm.id
       AND cm.administrationId = p.administrationId
      WHERE p.id = ?
        AND p.administrationId = ?
        AND p.isActive = '1'
      LIMIT 1
    `;

    con.query(
      sql,
      [Number(id) || 0, Number(administrationId) || 0],
      (err, rows) => {
        if (err) {
          callback(err, null);
          return;
        }
        const normalized = (rows || []).map((row) => ({
          ...row,
          startTime: String(row.startTime ?? "").slice(0, 5),
          endTime: String(row.endTime ?? "").slice(0, 5),
        }));
        callback(null, normalized);
      }
    );
  },
  createUpdatePeriodSlot: async (
    id,
    classId,
    startTime,
    endTime,
    administrationId,
    callback
  ) => {
    const safeId = Number(id) || 0;
    const safeClassId = Number(classId) || 0;
    const safeAdministrationId = Number(administrationId) || 0;

    con.query(ACTIVE_ACADEMIC_YEAR_SQL, [safeAdministrationId], (yearErr, yearRows) => {
      if (yearErr) {
        callback(yearErr, null);
        return;
      }

      const academicYear = yearRows?.[0]?.academicYear;
      if (!academicYear) {
        callback(new Error("Active academic year not found"), null);
        return;
      }

      if (safeId === 0) {
        const insertSql = `
          INSERT INTO tbl_periodslot (
            startTime,
            endTime,
            classId,
            administrationId,
            isActive,
            academicYear
          )
          VALUES (?, ?, ?, ?, '1', ?)
        `;
        con.query(
          insertSql,
          [startTime, endTime, safeClassId, safeAdministrationId, academicYear],
          (err, result) => {
            callback(err, err ? null : result);
          }
        );
        return;
      }

      const updateSql = `
        UPDATE tbl_periodslot
        SET startTime = ?,
            endTime = ?,
            classId = ?,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
          AND administrationId = ?
          AND isActive = '1'
      `;
      con.query(
        updateSql,
        [startTime, endTime, safeClassId, safeId, safeAdministrationId],
        (err, result) => {
          callback(err, err ? null : result);
        }
      );
    });
  },
  deletePeriodSlot: async (id, administrationId, callback) => {
    const sql = `
      UPDATE tbl_periodslot
      SET isActive = '0',
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
        AND administrationId = ?
        AND isActive = '1'
    `;
    con.query(
      sql,
      [Number(id) || 0, Number(administrationId) || 0],
      (err, result) => {
        if (err) {
          callback(err, null);
        } else {
          callback(null, result);
        }
      }
    );
  },

  getClasstimeTable: async (
    id,
    dayId,
    classId,
    sectionId,
    administrationId,
    callback
  ) => {
    const conditions = [
      "ctt.classId = ?",
      "ctt.sectionId = ?",
      "ctt.administrationId = ?",
      "ctt.isActive = '1'",
      "ctt.academicYear = (SELECT academicYear FROM tbl_academicyear WHERE administrationId = ? AND isActive = '1' LIMIT 1)",
    ];
    const params = [classId, sectionId, administrationId, administrationId];

    if (id) {
      conditions.push("ctt.id = ?");
      params.push(id);
    }
    if (dayId) {
      conditions.push("ctt.dayId = ?");
      params.push(dayId);
    }

    const sql = `
      SELECT
        ctt.id,
        ctt.periodSlotId,
        ctt.periodSlotId AS slotId,
        ctt.dayId,
        d.dayName AS day,
        ctt.subjectId,
        sb.name AS subjectName,
        sb.name AS subject,
        COALESCE(assignedStaff.staffId, '') AS staffId,
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' ', assignedStaff.firstName, assignedStaff.lastName)), ''),
          ''
        ) AS staffName,
        ctt.classId,
        cm.name AS className,
        ctt.sectionId,
        sm.name AS sectionName,
        TIME_FORMAT(ps.startTime, '%h:%i %p') AS startTime,
        TIME_FORMAT(ps.endTime, '%h:%i %p') AS endTime
      FROM tbl_classtimetable ctt
      JOIN tbl_periodslot ps
        ON ps.id = ctt.periodSlotId
       AND ps.administrationId = ctt.administrationId
      JOIN subject sb
        ON sb.id = ctt.subjectId
       AND sb.administrationId = ctt.administrationId
      LEFT JOIN tbl_calendar d ON d.id = ctt.dayId
      LEFT JOIN classmaster cm
        ON cm.id = ctt.classId
       AND cm.administrationId = ctt.administrationId
      LEFT JOIN sectionmaster sm
        ON sm.id = ctt.sectionId
       AND sm.administrationId = ctt.administrationId
      LEFT JOIN staff assignedStaff
        ON assignedStaff.staffId = ctt.staffId
       AND assignedStaff.administrationId = ctt.administrationId
       AND assignedStaff.isActive = '1'
      WHERE ${conditions.join(" AND ")}
      ORDER BY ctt.dayId, ps.startTime
    `;

    con.query(sql, params, (err, TimeTable) => {
      if (err) {
        callback(err, null);
      } else {
        // Preserve the stored-procedure result shape expected by the controller.
        callback(null, [TimeTable]);
      }
    });
  },
  getStaffForSubject: async (subjectId, administrationId, callback) => {
    const subjectSql = `
      SELECT id AS subjectId, name AS subjectName
      FROM subject
      WHERE id = ?
        AND administrationId = ?
        AND isActive = '1'
      LIMIT 1
    `;
    console.log("Subject Sql:", subjectSql)
    con.query(
      subjectSql,
      [subjectId, administrationId],
      (subjectErr, subjectRows) => {
        if (subjectErr) {
          callback(subjectErr, null);
          return;
        }
        if (!subjectRows.length) {
          callback(null, null);
          return;
        }

        // All active staff teaching this subject (staff.department = subject name)
        const staffSql = `
          SELECT
            staffId,
            COALESCE(
                NULLIF(TRIM(CONCAT_WS(' ', firstName, lastName)), ''),
                staffId
            ) AS staffName
        FROM staff
        WHERE administrationId = ?
          AND isActive = '1'
          AND LOWER(TRIM(department)) = LOWER(TRIM(?))
        ORDER BY firstName, lastName, staffId;
        `;

        con.query(
          staffSql,
          [administrationId, subjectRows[0].subjectName],
          (staffErr, staffRows) => {
            if (staffErr) {
              callback(staffErr, null);
              return;
            }
            callback(null, {
              ...subjectRows[0],
              staff: staffRows,
            });
          }
        );
      }
    );
  },
  createUpdateClasstimeTable: async (
    id,
    periodSlotId,
    dayId,
    subjectId,
    staffId,
    classId,
    sectionId,
    administrationId,
    callback
  ) => {
    const safeStaffId =
      staffId === undefined || staffId === null || staffId === ""
        ? 0
        : String(staffId).trim();
    const sql = `CALL sp_InsertOrUpdateclasstimetable(?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      Number(id) || 0,
      Number(periodSlotId),
      Number(dayId),
      Number(subjectId),
      safeStaffId,
      Number(classId),
      Number(sectionId),
      Number(administrationId),
    ];
    con.query(sql, params, (err, TimeTable) => {
      if (err) {
        callback(err, null);
      } else {
        callback(null, TimeTable);
      }
    });
  },
  deleteClasstimeTable: async (id, administrationId, callback) => {
    const sql = `call sp_Deleteclasstimetable(${id},${administrationId})`;
    con.query(sql, (err, TimeTable) => {
      if (err) {
        callback(err, null);
      } else {
        callback(null, TimeTable);
      }
    });
  },
  getStafftimeTable: async (userName, dayId, administrationId, callback) => {
    const conditions = [
      "ctt.administrationId = ?",
      "ctt.staffId = ?",
      "ctt.isActive = '1'",
      "ctt.academicYear = (SELECT academicYear FROM tbl_academicyear WHERE administrationId = ? AND isActive = '1' LIMIT 1)",
    ];
    const params = [
      Number(administrationId),
      String(userName),
      Number(administrationId),
    ];
    if (dayId && Number(dayId) !== 0) {
      conditions.push("ctt.dayId = ?");
      params.push(Number(dayId));
    }

    const sql = `
      SELECT
        ctt.id,
        ctt.periodSlotId,
        ctt.periodSlotId AS slotId,
        ctt.dayId,
        d.dayName AS day,
        ctt.subjectId,
        sb.name AS subjectName,
        sb.name AS subject,
        ctt.staffId,
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' ', st.firstName, st.lastName)), ''),
          ctt.staffId
        ) AS staffName,
        ctt.classId,
        cm.name AS className,
        ctt.sectionId,
        sm.name AS sectionName,
        TIME_FORMAT(ps.startTime, '%h:%i %p') AS startTime,
        TIME_FORMAT(ps.endTime, '%h:%i %p') AS endTime,
        'assigned' AS cellType
      FROM tbl_classtimetable ctt
      JOIN tbl_periodslot ps
        ON ps.id = ctt.periodSlotId
       AND ps.administrationId = ctt.administrationId
      JOIN subject sb
        ON sb.id = ctt.subjectId
       AND sb.administrationId = ctt.administrationId
      LEFT JOIN staff st
        ON st.staffId = ctt.staffId
       AND st.administrationId = ctt.administrationId
      LEFT JOIN tbl_calendar d ON d.id = ctt.dayId
      LEFT JOIN classmaster cm
        ON cm.id = ctt.classId
       AND cm.administrationId = ctt.administrationId
      LEFT JOIN sectionmaster sm
        ON sm.id = ctt.sectionId
       AND sm.administrationId = ctt.administrationId
      WHERE ${conditions.join(" AND ")}
      ORDER BY ctt.dayId, ps.startTime
    `;

    con.query(sql, params, (err, rows) => {
      if (err) {
        // Fallback to legacy SP if direct SQL fails
        const legacy = `CALL sp_GetStaffTimeTable(?, ?, ?)`;
        con.query(
          legacy,
          [String(userName), Number(dayId) || 0, Number(administrationId)],
          (spErr, TimeTable) => {
            if (spErr) callback(err, null);
            else callback(null, TimeTable);
          }
        );
      } else {
        callback(null, [rows || []]);
      }
    });
  },
};
