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
      const data = await queryAsync(`call sp_GetHomeWork(?, ?, ?)`, [
        classId,
        sectionId,
        administrationId,
      ]);
      const rows = Array.isArray(data?.[0]) ? data[0] : [];

      if (!resolvedStudentId || !rows.length) {
        resolvedCallback(null, [rows]);
        return;
      }

      await ensureProgressTable();
      const progressRows = await queryAsync(
        `
          SELECT homeworkId, status
          FROM tbl_homework_progress
          WHERE administrationId = ?
            AND studentId = ?
            AND homeworkId IN (?)
        `,
        [administrationId, resolvedStudentId, rows.map((row) => row.id)]
      );

      const progressMap = new Map(
        (progressRows || []).map((row) => [Number(row.homeworkId), row.status])
      );

      resolvedCallback(null, [
        rows.map((row) => ({
          ...row,
          progressStatus: progressMap.get(Number(row.id)) || row.progressStatus || "Pending",
        })),
      ]);
    } catch (err) {
      resolvedCallback(err, null);
    }
  },
  getHomeWorkId: async (id, classId, sectionId, administrationId, callback) => {
    const sql = `call sp_GetHomeWorkId(?, ?, ?, ?)`;
    con.query(sql, [id, classId, sectionId, administrationId], (err, data) => {
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
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
    con.query(sql, [id, description, classId, sectionId, subjectId, staffId, administrationId], (err, homework) => {
      if (err) {
        callback(err, null);
      } else {
        callback(null, homework);
      }
    });
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
    con.query(sql, [id, studentId, status, administrationId, status], (err, data) => {
      if (err) callback(err, null);
      else callback(null, data);
    });
  },
  canStudentUpdateHomeworkProgress: async (
    id,
    classId,
    sectionId,
    administrationId,
    callback
  ) => {
    try {
      const data = await queryAsync(`call sp_GetHomeWorkId(?, ?, ?, ?)`, [
        id,
        classId,
        sectionId,
        administrationId,
      ]);
      const rows = Array.isArray(data?.[0]) ? data[0] : [];
      callback(null, rows.length > 0);
    } catch (err) {
      callback(err, null);
    }
  },
};
