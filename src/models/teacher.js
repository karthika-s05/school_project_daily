const con = require("../config/dbConfig");

module.exports = {
  getTeacher: async (classId, sectionId, administrationId, callback) => {
    const sql = `call sp_GetTeacherPosition(${classId},${sectionId},${administrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  getTeacherClass: async (userName, administrationId, callback) => {
    const sql = `call sp_GetStaffClass('${userName}',${administrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  getSubjectClass: async (classId, sectionId, administrationId, callback) => {
    const sql = `call sp_subjectforclass(${classId},${sectionId},${administrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
};
