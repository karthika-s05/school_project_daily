const con = require("../config/dbConfig");

const getStudentClassSection = (userName, administrationId) =>
  new Promise((resolve) => {
    console.log("userName", userName);
    console.log("administrationId", administrationId);
    const admissionNo = userName || "";
    const adminId = String(administrationId || "").trim();
    if (!admissionNo || !adminId) return resolve(null);
    const query = con.query(
      `SELECT
          s.classId,
          s.sectionId,
          cm.name AS className,
          sm.name AS sectionName
         FROM student s
         JOIN classMaster cm
           ON s.classId = cm.id
         JOIN sectionMaster sm
           ON s.sectionId = sm.id
        WHERE s.admissionNo = ?
          AND s.isActive = '1'
        LIMIT 1`,
      [admissionNo],
      (err, rows) => {
        console.log("err", err);
        console.log("rows", rows);
        if (err || !rows?.length) return resolve(null);
        resolve({
          classId: rows[0].classId,
          sectionId: rows[0].sectionId,
          className: rows[0].className,
          sectionName: rows[0].sectionName,
        });
      }
    );
  });

module.exports = { getStudentClassSection };
