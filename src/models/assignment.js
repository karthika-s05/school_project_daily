const con = require("../config/dbConfig");

const queryAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    con.query(sql, params, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

let progressTableReady = false;

const ensureProgressTable = async () => {
  if (progressTableReady) return;
  await queryAsync(`
    CREATE TABLE IF NOT EXISTS tbl_assignment_progress (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      assignmentId INT NOT NULL,
      studentId VARCHAR(100) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Not Started',
      administrationId INT NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_assignment_student (administrationId, assignmentId, studentId)
    )
  `);
  progressTableReady = true;
};

module.exports = {
  getAssignment: async (classId, sectionId, administrationId, studentId, callback) => {
    console.log("classId", classId);
    console.log("sectionId", sectionId);
    console.log("administrationId", administrationId);
    console.log("studentId", studentId);


    try {
      const data = await queryAsync(
        `SELECT
    ass.id,
    ass.subjectId,
    s.name AS subject,
    ass.title,
    ass.description,
    DATE_FORMAT(ass.startDate, '%Y-%m-%d') AS startDate,
    DATE_FORMAT(ass.endDate, '%Y-%m-%d') AS endDate,
    ass.status
FROM tbl_assignment ass
INNER JOIN subject s
    ON s.id = ass.subjectId
   AND s.administrationId = ass.administrationId
WHERE ass.classId = ?
  AND ass.sectionId = ?
  AND ass.administrationId = ?
  AND ass.isActive = '1'
ORDER BY ass.createdAt DESC;
        `,
        [classId, sectionId, administrationId]
      );
      console.log("data", data);
      let rows = Array.isArray(data) ? data : [];

      await ensureProgressTable();

      callback(null, [
        rows.map((row) => ({
          ...row,
        })),
      ]);
    } catch (err) {
      callback(err, null);
    }
  },
  createUpdateAssignment: async (
    id,
    assignmentInfo,
    userName,
    administrationId,
    callback
  ) => {
    const {
      subjectId,
      title,
      description,
      startDate,
      endDate,
      classId,
      sectionId,
    } = assignmentInfo;
    const sql = `call sp_InsOrUpAssignment(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    con.query(
      sql,
      [
        id,
        subjectId,
        classId,
        sectionId,
        title,
        description,
        startDate,
        endDate,
        administrationId,
        userName,
      ],
      (err, assignment) => {
        if (err) {
          callback(err, null);
          return;
        }

        const insertId = assignment?.insertId || id;
        if (Number(id) === 0 && insertId) {
          con.query(
            `UPDATE tbl_assignment SET status = 'true' WHERE id = ? AND administrationId = ?`,
            [insertId, administrationId],
            () => callback(null, assignment)
          );
          return;
        }

        callback(null, assignment);
      }
    );
  },

  updateAssignmentProgress: async (id, studentId, status, administrationId, callback) => {
    try {
      await ensureProgressTable();
    } catch (err) {
      return callback(err, null);
    }
    const sql = `INSERT INTO tbl_assignment_progress (assignmentId, studentId, status, administrationId)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE status=?, updatedAt=NOW()`;
    con.query(sql, [id, studentId, status, administrationId, status], (err, data) => {
      if (err) callback(err, null);
      else callback(null, data);
    });
  },

  deleteAssignment: async (id, administrationId, callback) => {
    const sql = `call sp_deleteAssignment(?, ?)`;
    await con.query(sql, [id, administrationId], (err, assignment) => {
      if (err) {
        callback(err, null);
      } else {
        callback(null, assignment);
      }
    });
  },

  updateAssignmentStatus: async (id, administrationId, callback) => {
    const sql = `call sp_AssignmentStatus(?, ?)`;
    await con.query(sql, [id, administrationId], (err, assignment) => {
      if (err) {
        callback(err, null);
      } else {
        callback(null, assignment);
      }
    });
  },

  canStudentUpdateAssignmentProgress: async (
    id,
    classId,
    sectionId,
    administrationId,
    callback
  ) => {
    try {
      const rows = await queryAsync(
        `SELECT id
           FROM tbl_assignment
          WHERE id = ?
            AND classId = ?
            AND sectionId = ?
            AND administrationId = ?
            AND isActive = '1'
            AND status = 'true'
          LIMIT 1`,
        [Number(id), Number(classId), Number(sectionId), Number(administrationId)]
      );
      callback(null, Array.isArray(rows) && rows.length > 0);
    } catch (err) {
      callback(err, null);
    }
  },

  getAssignmentStaff: async (
    classId,
    sectionId,
    administrationId,
    userName,
    pageNo,
    callback
  ) => {
    const offset = Math.max(Number(pageNo) || 0, 0);
    const where = [
      "CASE WHEN ? = 0 THEN 1 WHEN ass.classId = ? THEN 1 ELSE 0 END = 1",
      "CASE WHEN ? = 0 THEN 1 WHEN ass.sectionId = ? THEN 1 ELSE 0 END = 1",
      "ass.isActive = '1'",
      "ass.administrationId = ?",
      "ass.createdBy = ?",
    ];
    const params = [
      Number(classId) || 0,
      Number(classId) || 0,
      Number(sectionId) || 0,
      Number(sectionId) || 0,
      Number(administrationId),
      String(userName),
    ];

    const listSql = `
      SELECT
        ass.id,
        cm.id AS classId,
        cm.name AS className,
        sm.id AS sectionId,
        sm.name AS section,
        s.id AS subjectId,
        s.name AS subject,
        ass.title,
        ass.description,
        DATE_FORMAT(DATE(ass.startDate), '%Y-%m-%d') AS startDate,
        DATE_FORMAT(DATE(ass.endDate), '%Y-%m-%d') AS endDate,
        CONCAT(IFNULL(tt.firstName, ''), ' ', IFNULL(tt.lastName, '')) AS staffName,
        ass.status,
        ass.createdBy
      FROM tbl_assignment ass
      LEFT JOIN subject s
        ON ass.subjectId = s.id AND ass.administrationId = s.administrationId
      JOIN classMaster cm
        ON ass.classId = cm.id AND cm.administrationId = ass.administrationId
      JOIN sectionMaster sm
        ON ass.sectionId = sm.id AND sm.administrationId = ass.administrationId
      LEFT JOIN tbl_teachers tt
        ON tt.staffID = ass.createdBy AND tt.administrationId = ass.administrationId
      WHERE ${where.join(" AND ")}
      ORDER BY ass.id DESC
      LIMIT 10 OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(*) AS assignmentCount
      FROM tbl_assignment ass
      LEFT JOIN subject s
        ON ass.subjectId = s.id AND ass.administrationId = s.administrationId
      JOIN classMaster cm
        ON ass.classId = cm.id AND cm.administrationId = ass.administrationId
      JOIN sectionMaster sm
        ON ass.sectionId = sm.id AND sm.administrationId = ass.administrationId
      WHERE ${where.join(" AND ")}
    `;

    con.query(listSql, [...params, offset], (listErr, rows) => {
      if (listErr) {
        return con.query(
          `CALL sp_getAssignmentStaff(?, ?, ?, ?, ?)`,
          [classId, sectionId, administrationId, userName, pageNo],
          (err, data) => {
            if (err) callback(listErr, null);
            else callback(null, data);
          }
        );
      }
      con.query(countSql, params, (countErr, countRows) => {
        if (countErr) {
          callback(null, [rows, [{ assignmentCount: rows.length }]]);
          return;
        }
        callback(null, [rows, countRows]);
      });
    });
  },

  getAssignmentStaffReport: async (
    classId,
    sectionId,
    administrationId,
    userName,
    pageNo,
    startDate,
    endDate,
    callback,
    options = {}
  ) => {
    const role = String(options.role || "").trim().toLowerCase();
    const isAdmin = role.includes("admin");
    const offset = Math.max(Number(pageNo) || 0, 0);
    const limit = options.allRows === true || isAdmin ? 1000 : 10;

    const where = [
      "ass.isActive = '1'",
      "ass.administrationId = ?",
      "ass.startDate >= ?",
      "ass.endDate <= ?",
      "CASE WHEN ? = 0 THEN 1 WHEN ass.classId = ? THEN 1 ELSE 0 END = 1",
      "CASE WHEN ? = 0 THEN 1 WHEN ass.sectionId = ? THEN 1 ELSE 0 END = 1",
    ];
    const params = [
      Number(administrationId),
      startDate,
      endDate,
      Number(classId) || 0,
      Number(classId) || 0,
      Number(sectionId) || 0,
      Number(sectionId) || 0,
    ];

    if (!isAdmin) {
      where.push("ass.createdBy = ?");
      params.push(String(userName));
    }

    const listSql = `
      SELECT
        ass.id,
        cm.id AS classId,
        cm.name AS className,
        sm.id AS sectionId,
        sm.name AS section,
        s.id AS subjectId,
        s.name AS subject,
        ass.title,
        ass.description,
        DATE_FORMAT(DATE(ass.startDate), '%Y-%m-%d') AS startDate,
        DATE_FORMAT(DATE(ass.endDate), '%Y-%m-%d') AS endDate,
        CONCAT(IFNULL(tt.firstName, ''), ' ', IFNULL(tt.lastName, '')) AS staffName,
        ass.status,
        ass.createdBy
      FROM tbl_assignment ass
      JOIN subject s
        ON ass.subjectId = s.id AND ass.administrationId = s.administrationId
      JOIN classMaster cm
        ON ass.classId = cm.id AND cm.administrationId = ass.administrationId
      JOIN sectionMaster sm
        ON ass.sectionId = sm.id AND sm.administrationId = ass.administrationId
      LEFT JOIN tbl_teachers tt
        ON tt.staffID = ass.createdBy AND tt.administrationId = ass.administrationId
      WHERE ${where.join(" AND ")}
      ORDER BY ass.id DESC
      LIMIT ? OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(*) AS assignmentCount
      FROM tbl_assignment ass
      JOIN subject s
        ON ass.subjectId = s.id AND ass.administrationId = s.administrationId
      JOIN classMaster cm
        ON ass.classId = cm.id AND cm.administrationId = ass.administrationId
      JOIN sectionMaster sm
        ON ass.sectionId = sm.id AND sm.administrationId = ass.administrationId
      WHERE ${where.join(" AND ")}
    `;

    const listParams = [...params, limit, offset];
    const countParams = [...params];

    con.query(listSql, listParams, (listErr, rows) => {
      if (listErr) {
        return con.query(
          `CALL sp_getAssignmentReport(?, ?, ?, ?, ?, ?, ?)`,
          [
            classId,
            sectionId,
            administrationId,
            isAdmin ? "0" : userName,
            pageNo,
            startDate,
            endDate,
          ],
          (err, data) => {
            if (err) callback(listErr, null);
            else callback(null, data);
          }
        );
      }
      con.query(countSql, countParams, (countErr, countRows) => {
        if (countErr) {
          callback(null, [rows, [{ assignmentCount: rows.length }]]);
          return;
        }
        callback(null, [rows, countRows]);
      });
    });
  },

  getStudentSubmissions: async (assignmentId, classId, sectionId, administrationId) => {
    await ensureProgressTable();
    return queryAsync(
      `SELECT
          s.admissionNo AS studentId,
          TRIM(CONCAT_WS(' ', s.firstName, s.middleName, s.lastName)) AS studentName,
          s.admissionNo,
          IFNULL(p.status, 'Not Started') AS status,
          CASE WHEN p.status = 'Submitted' THEN 1 ELSE 0 END AS submitted,
          CASE WHEN p.status = 'Submitted' THEN 1 ELSE 0 END AS isSubmitted
         FROM student s
         LEFT JOIN tbl_assignment_progress p
           ON p.studentId = s.admissionNo
          AND p.assignmentId = ?
          AND p.administrationId = s.administrationId
        WHERE s.classId = ?
          AND s.sectionId = ?
          AND s.administrationId = ?
          AND s.isActive = '1'
        ORDER BY s.firstName, s.lastName, s.admissionNo`,
      [Number(assignmentId), Number(classId), Number(sectionId), Number(administrationId)]
    );
  },
};
