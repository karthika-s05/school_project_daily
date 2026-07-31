const teacherModel = require("../models/teacher");
const logger = require("../config/winston");
const { createLogger } = require("logger");

module.exports = {
  getTeacher: async (req, res) => {
    const { classId, sectionId, administrationId } = req.user;
    try {
      if (!classId || !sectionId || !administrationId) {
        throw "Missing Credential";
      } else {
        await teacherModel.getTeacher(
          classId,
          sectionId,
          administrationId,
          (err, teacher) => {
            if (err) {
              res.send({
                status: "Error",
                message: "teacher list not retrived",
                data: err,
              });
            } else {
              data = {
                status: "success",
                message: "teacher list retrived success",
                //  classTeacher: [teacher[0][0]],
                 subjectTeacher:teacher[0]
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
  getTeacherClass: async (req, res) => {
    const { userName, administrationId } = req.user;

    try {
      if (!userName || !administrationId) {
        throw "Missing Credential";
      } else {
        await teacherModel.getTeacherClass(
          userName,
          administrationId,
          (err, teacher) => {
            if (err) {
              res.send({
                status: "Error",
                message: "teacher list not retrived",
                data: err,
              });
            } else {
              data = {
                status: "success",
                message: "teacher list retrived success",
                //  classTeacher: [teacher[0][0]],
                 data:teacher[0]
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
  getSubjectClass: async (req, res) => {
    const classId =req.body.classId;
    const sectionId =req.body.sectionId;
    const {  administrationId } = req.user;

    try {
      if (!classId ||!sectionId || !administrationId) {
        throw "Missing Credential";
      } else {
        await teacherModel.getSubjectClass(
          classId,
          sectionId,
          administrationId,
          (err, teacher) => {
            if (err) {
              res.send({
                status: "Error",
                message: "subject list not retrived",
                data: err,
              });
            } else {
              data = {
                status: "success",
                message: "subject list retrived success",
                //  classTeacher: [teacher[0][0]],
                 data:teacher[0]
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
};
