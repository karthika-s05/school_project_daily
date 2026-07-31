const homeWorkModel = require("../models/homeWork");
const logger = require("../config/winston");
const { getStudentClassSection } = require("../models/studentInfo");
const notificationService = require("../services/notificationService");

module.exports = {
  getHomeWork: async (req, res) => {
    const role = String(req.user.role || "").trim().toLowerCase();
    const administrationId = Number(req.user.administrationId || 0);
    let classId = role === "Student" ? req.user.classId : req.body.classId;
    let sectionId =
      role === "Student" ? req.user.sectionId : req.body.sectionId;
    const studentId = role === "Student" ? req.user.userName : null;
    if (role === "Student") {
      // JWT class/section can be stale or missing; prefer the live student row.
      const live = await getStudentClassSection(
        req.user.userName,
        administrationId
      );
      if (live) {
        classId = live.classId;
        sectionId = live.sectionId;
      }
    }

    try {
      if (!administrationId || !classId || !sectionId) {
        return res.status(400).send({
          status: "Error",
          message:
            role === "Student"
              ? "No class/section is mapped to this student. Please contact the school admin."
              : "classId and sectionId are required",
          data: [],
        });
      } else {
        await homeWorkModel.getHomeWork(
          classId,
          sectionId,
          administrationId,
          studentId,
          (err, homeWork) => {
            if (err) {
              res.send({
                status: "Error",
                message: "HomeWork list not retrived",
                data: err,
              });
            } else {
              data = {
                status: "success",
                message: "HomeWork list retrived success",
                data: homeWork[0],
              };
              logger.info(`${req.path} -- ${req.method} -- Success`);
              res.send(data);
            }
          }
        );
      }
    } catch (error) {
      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send(error);
    }
  },
  getHomeWorkId: async (req, res) => {
    const role = String(req.user.role || "").trim().toLowerCase();
    const administrationId = Number(req.user.administrationId || 0);
    const classId = role === "student" ? req.user.classId : req.body.classId;
    const sectionId =
      role === "student" ? req.user.sectionId : req.body.sectionId;
    const { id } = req.body;

    try {
      if (!administrationId || !classId || !sectionId || !id) {
        throw "Missing Credential";
      } else {
        await homeWorkModel.getHomeWorkId(
          id,
          classId,
          sectionId,
          administrationId,
          (err, homeWork) => {
            if (err) {
              res.send({
                status: "Error",
                message: "HomeWork list not retrived",
                data: err,
              });
            } else {
              data = {
                status: "success",
                message: "HomeWork list retrived success",
                data: homeWork[0],
              };
              logger.info(`${req.path} -- ${req.method} -- Success`);
              res.send(data);
            }
          }
        );
      }
    } catch (error) {
      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send(error);
    }
  },
  createUpdateHomeWork: async (req, res) => {
    const id = req.body.id;
    const homeWorkInfo = req.body;
    const administrationId = req.user.administrationId;
    const staffId = req.user.userName;
    console.log(req.body);
    try {
      if (!homeWorkInfo) {
        throw "Missing Credential";
      } else {
        await homeWorkModel.createUpdateHomeWork(
          id,
          homeWorkInfo,
          staffId,
          administrationId,
          (err, homework) => {
            const message = id == 0 ? "created" : "updated";
            if (err) {
              logger.info(`${req.path} -- ${req.method} -- Success`);
              res.send({
                status: "Error",
                message: err.sqlMessage,
              });
            } else {
              notificationService.notifyAudience({
                audience: "Selected Class",
                title: id == 0 ? "New Homework" : "Homework Updated",
                message: `${
                  homeWorkInfo.subjectName || homeWorkInfo.subject || "New"
                } Homework has been ${id == 0 ? "assigned" : "updated"}.`,
                notificationType: "Homework",
                senderId: staffId,
                classId: homeWorkInfo.classId,
                sectionId: homeWorkInfo.sectionId,
                referenceId: id || homework?.insertId || null,
                administrationId,
              }).catch((notificationError) => {
                console.error(
                  "Homework notification failed:",
                  notificationError.message || notificationError
                );
              });
              logger.info(`${req.path} -- ${req.method} -- Success`);
              data = {
                status: "success",
                message: `Homework ${message} success`,
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
  updateHomeworkProgress: async (req, res) => {
    const { id, status } = req.body;
    const {
      userName: studentId,
      administrationId,
      classId,
      sectionId,
    } = req.user;
    try {
      if (!id || !status || !studentId || !administrationId) throw "Missing Credential";
      await homeWorkModel.canStudentUpdateHomeworkProgress(
        id,
        classId,
        sectionId,
        administrationId,
        (ownershipErr, canUpdate) => {
          if (ownershipErr) {
            return res.send({
              status: "Error",
              message: "Progress not updated",
              data: ownershipErr.sqlMessage || ownershipErr,
            });
          }
          if (!canUpdate) {
            return res.status(403).send({
              status: "Error",
              message: "Homework does not belong to this student",
            });
          }
          return homeWorkModel.updateHomeworkProgress(
            id,
            studentId,
            status,
            administrationId,
            (err) => {
              if (err)
                res.send({ status: "Error", message: "Progress not updated", data: err.sqlMessage });
              else res.send({ status: "success", message: "Progress updated" });
            }
          );
        }
      );
    } catch (error) { res.send(error); }
  },
  deleteHomeWork: async (req, res) => {
    const id = req.params.id;
    const administrationId = req.user.administrationId;

    try {
      if (!id || !administrationId) {
        throw "Missing Credential";
      } else {
        await homeWorkModel.deleteHomeWork(
          id,
          administrationId,
          (err, HomeWork) => {
            if (err) {
              logger.info(`${req.path} -- ${req.method} -- Success`);
              res.send({
                status: "Error",
                message: "HomeWork list not deleted",
              });
            } else {
              data = {
                status: "success",
                message: "HomeWork deleted success",
                data: HomeWork,
              };
              logger.info(`${req.path} -- ${req.method} -- Success`);
              res.send(data);
            }
          }
        );
      }
    } catch (error) {
      res.send(error);
    }
  },
};
