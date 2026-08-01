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
    CREATE TABLE IF NOT EXISTS tbl_homework_progress (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      homeworkId INT NOT NULL,
      studentId VARCHAR(100) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Pending',
      administrationId INT NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_homework_student (administrationId, homeworkId, studentId)
    )
  `);
  progressTableReady = true;
};

module.exports = {
  getHomeWork: async (classId, sectionId, administrationId, studentId, callback) => {
    const resolvedStudentId =
      typeof studentId === "function" ? null : studentId || null;
    const resolvedCallback =
      typeof studentId === "function" ? studentId : callback;

    try {
      await ensureProgressTable();

      const hasStudent = Boolean(resolvedStudentId);
      const sql = `
        SELECT
          hw.id,
          hw.description,
          cm.id AS classId,
          cm.name AS class,
          cm.name AS className,
          sm.id AS sectionId,
          sm.name AS section,
          sm.name AS sectionName,
          sb.id AS subjectId,
          sb.name AS subject,
          sb.name AS subjectName,
          CONCAT(st.firstName, ' ', st.lastName) AS staffName,
          st.staffId AS staffId,
          hw.administrationId,
          sb.photoUrl AS photo,
          DATE_FORMAT(DATE(hw.createdDate), '%Y-%m-%d') AS date,
          ${
            hasStudent
              ? `COALESCE(hp.status, 'Pending') AS progressStatus`
              : `'Pending' AS progressStatus`
          }
        FROM tbl_homework hw
        JOIN classmaster cm ON cm.id = hw.classId
        JOIN sectionmaster sm ON sm.id = hw.sectionId
        JOIN subject sb ON sb.id = hw.subjectId
        JOIN staff st ON st.staffId = hw.staffId
        ${
          hasStudent
            ? `LEFT JOIN tbl_homework_progress hp
                 ON hp.homeworkId = hw.id
                AND hp.administrationId = hw.administrationId
                AND hp.studentId = ?`
            : ""
        }
        WHERE hw.classId = ?
          AND hw.sectionId = ?
          AND hw.administrationId = ?
          AND hw.isActive = '1'
          AND hw.academicYear = (
            SELECT academicYear
            FROM tbl_academicyear
            WHERE administrationId = ?
              AND isActive = '1'
            LIMIT 1
          )
        ORDER BY hw.createdDate DESC
      `;

      const params = hasStudent
        ? [
            String(resolvedStudentId),
            classId,
            sectionId,
            administrationId,
            administrationId,
          ]
        : [classId, sectionId, administrationId, administrationId];

      const rows = await queryAsync(sql, params);
      resolvedCallback(null, [Array.isArray(rows) ? rows : []]);
    } catch (err) {
      resolvedCallback(err, null);
    }
  },

  getHomeWorkId: async (id, classId, sectionId, administrationId, callback) => {
    try {
      const rows = await queryAsync(
        `
          SELECT
            hw.id,
            hw.description,
            cm.id AS classId,
            cm.name AS class,
            sm.id AS sectionId,
            sm.name AS section,
            sb.id AS subjectId,
            sb.name AS subject,
            CONCAT(st.firstName, ' ', st.lastName) AS staffName,
            st.staffId AS staffId,
            hw.administrationId,
            DATE_FORMAT(DATE(hw.createdDate), '%Y-%m-%d') AS date
          FROM tbl_homework hw
          JOIN classmaster cm ON cm.id = hw.classId
          JOIN sectionmaster sm ON sm.id = hw.sectionId
          JOIN subject sb ON sb.id = hw.subjectId
          JOIN staff st ON st.staffId = hw.staffId
          WHERE hw.id = ?
            AND hw.classId = ?
            AND hw.sectionId = ?
            AND hw.administrationId = ?
            AND hw.isActive = '1'
          LIMIT 1
        `,
        [id, classId, sectionId, administrationId]
      );
      callback(null, [Array.isArray(rows) ? rows : []]);
    } catch (err) {
      callback(err, null);
    }
  },

  createUpdateHomeWork: async (
    id,
    homeworkInfo,
    staffId,
    administrationId,
    callback
  ) => {
    const { description, classId, sectionId, subjectId } = homeworkInfo;
    const sql = `call sp_InsertOrUpdateHomeWork(?, ?, ?, ?, ?, ?, ?)`;
    con.query(
      sql,
      [id, description, classId, sectionId, subjectId, staffId, administrationId],
      (err, homework) => {
        if (err) {
          callback(err, null);
        } else {
          callback(null, homework);
        }
      }
    );
  },

  deleteHomeWork: async (id, administrationId, callback) => {
    const sql = `call sp_DeleteHomeWork(?, ?)`;
    con.query(sql, [id, administrationId], (err, homework) => {
      if (err) {
        callback(err, null);
      } else {
        callback(null, homework);
      }
    });
  },

  updateHomeworkProgress: async (id, studentId, status, administrationId, callback) => {
    try {
      await ensureProgressTable();
    } catch (err) {
      return callback(err, null);
    }
    const sql = `INSERT INTO tbl_homework_progress (homeworkId, studentId, status, administrationId)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE status=?, updatedAt=NOW()`;
    con.query(
      sql,
      [id, studentId, status, administrationId, status],
      (err, data) => {
        if (err) callback(err, null);
        else callback(null, data);
      }
    );
  },

  canStudentUpdateHomeworkProgress: async (
    id,
    classId,
    sectionId,
    administrationId,
    callback
  ) => {
    try {
      const rows = await queryAsync(
        `
          SELECT id
          FROM tbl_homework
          WHERE id = ?
            AND classId = ?
            AND sectionId = ?
            AND administrationId = ?
            AND isActive = '1'
          LIMIT 1
        `,
        [id, classId, sectionId, administrationId]
      );
      callback(null, Array.isArray(rows) && rows.length > 0);
    } catch (err) {
      callback(err, null);
    }
  },
};
