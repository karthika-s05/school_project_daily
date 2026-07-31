const { createLogger } = require("logger");
const con = require("../config/dbConfig");
const moment = require("moment");
const cron = require("node-cron");

module.exports = {
  createStdAttendance: async (
    stdAttendance,
    classId,
    sectionId,
    administrationId,
    userName,
    callback
  ) => {
    try {
      const value = await Promise.all(
        stdAttendance.map(async (data, index) => {
          console.log(data.studentId);
          const status = !data.status ? "A" : data.status ? "P" : "H";
          const sql = `CALL sp_InsertStudentAttendances('${
            data.studentId
          }', '${status}',${classId},${sectionId},${index + 1},${
            stdAttendance.length
          }, ${administrationId},'${userName}')`;
          console.log(sql);
          return new Promise((resolve, reject) => {
            con.query(sql, (err, result) => {
              if (err) {
                reject(err);
              } else {
                resolve(result);
              }
            });
          });
        })
      );
      callback(null, value);
    } catch (err) {
      callback(err, null);
    }
  },
  createStffAttendance: async (
    stffAttendance,
    administrationId,
    userName,
    callback
  ) => {
    try {
      const value = await Promise.all(
        stffAttendance.map(async (data) => {
          const status = !data.status ? "A" : data.status ? "P" : "H";
          const sql = `CALL sp_InsertStaffAttendance('${data.staffId}','${status}',${administrationId},'${userName}')`;
          console.log(sql);
          return new Promise((resolve, reject) => {
            con.query(sql, (err, result) => {
              if (err) {
                reject(err);
              } else {
                resolve(result);
              }
            });
          });
        })
      );
      callback(null, value);
    } catch (err) {
      callback(err, null);
    }
  },
  getStdAttendance: async (
    studentId,
    classId,
    sectionId,
    month,
    administrationId,
    callback
  ) => {
    try {
      const sql = `call sp_GetStdAttendance('${studentId}',${classId},${sectionId},${month},${administrationId})`;
      con.query(sql, (err, attendance) => {
        if (err) {
          callback(err, null);
        } else {
          callback(null, attendance);
        }
      });
    } catch (error) {
      callback(error, null);
    }
  },
  studentAttendanceView: async (
    classId,
    sectionId,
    studentId,
    date,
    administrationId,
    callback
  ) => {
    const sql = `call sp_studentAttendanceView("${studentId}",${classId},${sectionId},"${date}",${administrationId})`;
    con.query(sql, (err, attendance) => {
      if (err) {
        callback(err, null);
      } else {
        callback(null, attendance);
      }
    });
  },
};
// cron.schedule("*/55 * * * * *", () => {
//   // const currentDate = new Date();
//   // const year = currentDate.getFullYear();
//   // const month = String(currentDate.getMonth() + 1).padStart(2, '0'); // Month is 0-based, so add 1 and pad with '0' if needed
//   // const day = String(currentDate.getDate()).padStart(2, '0');
//   // const formattedDate = `${year}-${month}-${day}`;

//   // console.log(formattedDate); // Output: "2023-08-23"
//   const currentDate = moment().format("YYYY-MM-DD");
//   const adIdsql = `select id from administration`;
//   con.query(adIdsql, (err, value) => {
//     if (err) {
//       console.log(err);
//     } else {
//       value.map(async (data) => {
//         const sql = `CALL sp_StdAutoAttendance('${currentDate}',${data.id})`;
//         con.query(sql, (data) => {
//           console.log(sql, moment().format("YYYY-MM-DD HH:mm:ss"));
//         });
//       });
//     }
//   });
// });
