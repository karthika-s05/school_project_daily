const assignmentModel = require("../models/attendance");
const attendanceV2Model = require("../models/attendanceV2");
const logger = require("../config/winston");
const con = require("../config/dbConfig");

const { createLogger } = require("logger");
const attendance = require("../models/attendance");
const { log, Logform } = require("winston");

const isAdminRole = (role) =>
  String(role || "").trim().toLowerCase() === "admin";

module.exports = {
  createStdAttendance: async (req, res) => {
    const { classId, sectionId, stdAttendance } = req.body;
    const { administrationId, userName, role } = req.user;
    try {
      if (
        !classId ||
        !sectionId ||
        !stdAttendance ||
        !administrationId ||
        !userName
      ) {
        return res.send({
          status: "Error",
          message: "Missing Credential",
          data: null,
        });
      }

      // Only Admin or the mapped class teacher may mark this class/section
      if (!isAdminRole(role)) {
        const allowed = await attendanceV2Model.isClassTeacher(
          userName,
          classId,
          sectionId,
          administrationId
        );
        if (!allowed) {
          return res.status(403).send({
            status: "Error",
            message:
              "Only the class teacher or admin can mark attendance for this class",
            data: null,
          });
        }
      }

      await assignmentModel.createStdAttendance(
        stdAttendance,
        classId,
        sectionId,
        administrationId,
        userName,
        async (err, Attendance) => {
          if (err) {
            logger.info(`${req.path} -- ${req.method} -- Error`);
            return res.send({
              status: "Error",
              message: `Attendance list not created`,
              data: err.sqlMessage || err.message,
            });
          }
          logger.info(`${req.path} -- ${req.method} -- Success`);
          return res.send({
            status: "success",
            message: `Attendance created success`,
          });
        }
      );
    } catch (error) {
      res.send({
        status: "Error",
        message: error.message || String(error),
        data: null,
      });
    }
  },
  createStffAttendance: async (req, res) => {
    const { stffAttendance } = req.body;
    const { administrationId, userName } = req.user;
    try {
      console.log("open");
      if (!stffAttendance || !administrationId || !userName) {
        throw "Missing Credential";
      } else {
        await assignmentModel.createStffAttendance(
          stffAttendance,
          administrationId,
          userName,
          async (err, Attendance) => {
            if (err) {
              console.log("fsdfsd");
              logger.info(`${req.path} -- ${req.method} -- Success`);
              await res.send({
                status: "Error",
                message: `Attendance list not created`,
                data: err.sqlMessage,
              });
              return;
            } else {
              logger.info(`${req.path} -- ${req.method} -- Success`);
              data = {
                status: "success",
                message: `Attendance created success`,
              };
              await res.send(data);
              return;
            }
          }
        );
      }
    } catch (error) {
      console.log("errro catch");
      res.send(error);
    }
  },
  getStdAttendance: async (req, res) => {
    const { month } = req.body;
    const { administrationId } = req.user;
    const role = req.user.role;
    const studentId =
      role === "Student" ? req.user.userName : req.body.userName;
    const classId = role === "Student" ? req.user.classId : req.body.classId;
    const sectionId =
      role === "Student" ? req.user.sectionId : req.body.sectionId;
    try {
      if (!studentId || !classId || !sectionId || !administrationId) {
        throw "Missing Credential";
      } else {
        await assignmentModel.getStdAttendance(
          studentId,
          classId,
          sectionId,
          month,
          administrationId,
          async (err, Attendance) => {
            const absentDate = Attendance[2];

            if (err) {
              logger.info(`${req.path} -- ${req.method} -- Success`);
              await res.send({
                status: "Error",
                message: `Attendance list not created`,
                data: err.sqlMessage,
              });
            } else {
              console.log(Attendance, "Attendance");
              const leaveDate =
                month === 0 ? "" : Attendance[2].map((data) => data.date);
              let percentage =
                Attendance[1][0].presented === 0
                  ? 0
                  : (Attendance[1][0].presented /
                      Attendance[0][0].totalWorkingDays) *
                    100;
              logger.info(`${req.path} -- ${req.method} -- Success`);
              value = [
                {
                  WorkingDays: Attendance[0][0].totalWorkingDays,
                  prestent: Attendance[1][0].presented,
                  absent:
                    Attendance[0][0].totalWorkingDays -
                    Attendance[1][0].presented,
                  percentage,
                },
              ];
              if (month !== 0) {
                value[0].leaveDate = leaveDate;
              }
              data = {
                status: "success",
                message: "Attendance list retrived success",
                data: value,
              };

              await res.send(data);
              return;
            }
          }
        );
      }
    } catch (error) {
      console.log("errro catch");
      res.send(error);
    }
  },
  studentAttendanceView: async (req, res) => {
    const role = String(req.user.role || "").trim().toLowerCase();
    const classId = role === "student" ? req.user.classId : req.body.classId;
    const sectionId = role === "student" ? req.user.sectionId : req.body.sectionId;
    const studentId = role === "student" ? req.user.userName : req.body.studentId;
    const date = req.body.date;
    const { administrationId } = req.user;
    try {
      // The SP derives the month table name from the date; an undefined date
      // makes CONCAT(...) NULL and PREPARE fails with an opaque SQL error.
      if (!classId || !sectionId || !administrationId || !date) {
        throw "Missing Credential";
      } else {
        await assignmentModel.studentAttendanceView(
          classId,
          sectionId,
          studentId,
          date,
          administrationId,
          async (err, attendance) => {
            if (err) {
              logger.info(`${req.path} -- ${req.method} -- Success`);
              await res.send({
                status: "Error",
                message: `Attendance list not retrived`,
                data: err.sqlMessage,
              });
            } else {
              data = {
                status: "success",
                message: "Attendance list retrived success",
                data: attendance[0],
              };
              res.send(data);
            }
          }
        );
      }
    } catch (error) {
      res.send(error);
    }
  },
  staffAttendanceView: async (req, res) => {
    const { staffId, date } = req.body;
    const { administrationId } = req.user;
    try {
      if (!staffId || !date || !administrationId) {
        throw "Missing Credentail";
      } else {
        const sql = `call sp_GetStaffAttendanceDetails("${staffId}","${date}",${administrationId})`;
        con.query(sql, async (err, attendance) => {
          if (err) {
            logger.info(`${req.path} -- ${req.method} -- Success`);
            await res.send({
              status: "Error",
              message: `Attendance list not retrived`,
              data: err.sqlMessage,
            });
          } else {
            data = {
              status: "success",
              message: "Attendance list retrived success",
              data: attendance[0],
            };
            res.send(data);
          }
        });
      }
    } catch (error) {
      res.send(error);
    }
  },
};
