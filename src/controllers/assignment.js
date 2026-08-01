const assignmentModel = require("../models/assignment");
const logger = require("../config/winston");
const { getStudentClassSection } = require("../models/studentInfo");
const notificationService = require("../services/notificationService");

module.exports = {
  getAssignment: async (req, res) => {
    const role = req.user.role || "";
    const administrationId = Number(req.user.administrationId || 0);
    let classId = role === "Student" ? null : req.body.classId;
    let sectionId = role === "Student" ? null : req.body.sectionId;
    const studentId = role === "Student" ? req.user.userName : null;
    if (role === "Student") {
      console.log("req.user.userName", req.user.userName);
      console.log("administrationId", administrationId);
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
            role === "student"
              ? "No class/section is mapped to this student. Please contact the school admin."
              : "classId and sectionId are required",
          data: [],
        });
      }

      await assignmentModel.getAssignment(
        classId,
        sectionId,
        administrationId,
        studentId,
        (err, assignment) => {
          if (err) {
            res.send({
              status: "Error",
              message: "Assignment list not retrived",
              data: err,
            });
          } else {
            const data = {
              status: "success",
              message: "Assignment list retrived success",
              data: assignment[0],
            };
            logger.info(`${req.path} -- ${req.method} -- Success`);
            res.send(data);
          }
        }
      );
    } catch (error) {
      logger.error(`${req.path} -- ${req.method} -- ${error.message || error}`);
      res.send(error);
    }
  },
  getAssignmentStaff: async (req, res) => {
    const { administrationId, userName } = req.user;
    const classId = Number(req.body.classId) || 0;
    const sectionId = Number(req.body.sectionId) || 0;
    let pageNo = parseInt(req.body.pageNo, 10) || 1;
    pageNo = (pageNo - 1) * 10;

    try {
      if (!administrationId) {
        throw "Missing Credential";
      }

      await assignmentModel.getAssignmentStaff(
        classId,
        sectionId,
        administrationId,
        userName,
        pageNo,
        (err, assignment) => {
          if (err) {
            res.send({
              status: "Error",
              message: "Assignment list not retrived",
              data: err,
            });
          } else {
            const assignmentCount =
              assignment[1]?.[0]?.assignmentCount ?? assignment[0]?.length ?? 0;
            const data = {
              status: "success",
              message: "Assignment list retrived success",
              count: assignmentCount,
              data: assignment[0],
            };
            logger.info(`${req.path} -- ${req.method} -- Success`);
            res.send(data);
          }
        }
      );
    } catch (error) {
      logger.error(`${req.path} -- ${req.method} -- ${error.message || error}`);
      res.send(error);
    }
  },

  getAssignmentStaffReport: async (req, res) => {
    const { administrationId, userName, role } = req.user;
    const classId = Number(req.body.classId) || 0;
    const sectionId = Number(req.body.sectionId) || 0;
    const toSqlDate = (value, fallback) => {
      const raw = String(value || "").trim();
      if (!raw) return fallback;
      const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
      return match ? match[1] : fallback;
    };
    const startDate = toSqlDate(req.body.startDate, "2000-01-01");
    const endDate = toSqlDate(req.body.endDate, "2099-12-31");
    let pageNo = parseInt(req.body.pageNo, 10) || 1;
    pageNo = (pageNo - 1) * 10;

    try {
      if (!administrationId) {
        throw "Missing Credential";
      }

      await assignmentModel.getAssignmentStaffReport(
        classId,
        sectionId,
        administrationId,
        userName,
        pageNo,
        startDate,
        endDate,
        (err, assignment) => {
          if (err) {
            res.send({
              status: "Error",
              message: "Assignment list not retrived",
              data: err,
            });
          } else {
            const assignmentCount =
              assignment[1]?.[0]?.assignmentCount ?? assignment[0]?.length ?? 0;
            const data = {
              status: "success",
              message: "Assignment list retrived success",
              count: assignmentCount,
              data: assignment[0],
            };
            logger.info(`${req.path} -- ${req.method} -- Success`);
            res.send(data);
          }
        },
        { role, allRows: String(role || "").toLowerCase().includes("admin") }
      );
    } catch (error) {
      logger.error(`${req.path} -- ${req.method} -- ${error.message || error}`);
      res.send(error);
    }
  },

  createUpdateAssignment: async (req, res) => {
    const id = req.body.id;
    const assignmentInfo = req.body;
    const administrationId = req.user.administrationId;
    const staffId = req.user.userName;

    try {
      if (!assignmentInfo) {
        throw "Missing Credential";
      }

      await assignmentModel.createUpdateAssignment(
        id,
        assignmentInfo,
        staffId,
        administrationId,
        (err, assignment) => {
          const message = id == 0 ? "created" : "updated";
          if (err) {
            res.send({
              status: "Error",
              message: err.sqlMessage || err.message || err,
            });
          } else {
            const assignmentId = Number(id) || Number(assignment?.insertId) || 0;
            notificationService
              .notifyAudience({
                audience: "Selected Class",
                title: id == 0 ? "New Assignment" : "Assignment Updated",
                message: `${assignmentInfo.title || "An assignment"} has been ${
                  id == 0 ? "assigned" : "updated"
                }.`,
                notificationType: "Assignment",
                senderId: staffId,
                classId: assignmentInfo.classId,
                sectionId: assignmentInfo.sectionId,
                referenceId: assignmentId || null,
                administrationId,
              })
              .catch((notificationError) => {
                console.error(
                  "Assignment notification failed:",
                  notificationError.message || notificationError
                );
              });

            logger.info(`${req.path} -- ${req.method} -- Success`);
            res.send({
              status: "success",
              message: `Assignment ${message} success`,
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },

  updateAssignmentProgress: async (req, res) => {
    const { id, status } = req.body;
    const { userName: studentId, administrationId } = req.user;
    let classId = null;
    let sectionId = null;

    try {
      if (!id || !status || !studentId || !administrationId) {
        throw "Missing Credential";
      }

      const live = await getStudentClassSection(studentId, administrationId);
      if (live) {
        classId = live.classId;
        sectionId = live.sectionId;
      }

      if (!classId || !sectionId) {
        return res.status(400).send({
          status: "Error",
          message:
            "No class/section is mapped to this student. Please contact the school admin.",
        });
      }
      console.log("Class Id", classId);
      console.log("Section Id", sectionId);
      console.log("Administration Id", administrationId);
      console.log("Id", id);
      console.log("Status", status);
      console.log("Student Id", studentId);
      console.log("Administration Id", administrationId);
      await assignmentModel.canStudentUpdateAssignmentProgress(
        id,
        classId,
        sectionId,
        administrationId,
        (ownershipErr, canUpdate) => {
          console.log("ownershipErr", ownershipErr);
          console.log("canUpdate", canUpdate);
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
              message: "Assignment does not belong to this student",
            });
          }

          return assignmentModel.updateAssignmentProgress(
            id,
            studentId,
            status,
            administrationId,
            (err) => {
              if (err) {
                res.send({
                  status: "Error",
                  message: "Progress not updated",
                  data: err.sqlMessage || err,
                });
              } else {
                logger.info(`${req.path} -- ${req.method} -- Success`);
                res.send({ status: "success", message: "Progress updated" });
              }
            }
          );
        }
      );
    } catch (error) {
      res.send(error);
    }
  },

  updateAssignmentStatus: async (req, res) => {
    const id = req.params.id;
    const administrationId = req.user.administrationId;

    try {
      if (!id || !administrationId) {
        throw "Missing Credential";
      }

      await assignmentModel.updateAssignmentStatus(
        id,
        administrationId,
        (err) => {
          if (err) {
            res.send({
              status: "Error",
              message: "Assignment status not updated",
              data: err.sqlMessage || err,
            });
          } else {
            logger.info(`${req.path} -- ${req.method} -- Success`);
            res.send({
              status: "success",
              message: "Assignment status updated",
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },

  deleteAssignment: async (req, res) => {
    const id = req.params.id;
    const administrationId = req.user.administrationId;

    try {
      if (!id || !administrationId) {
        throw "Missing Credential";
      }

      await assignmentModel.deleteAssignment(id, administrationId, (err, assignment) => {
        if (err) {
          res.send({
            status: "Error",
            message: "Assignment not deleted",
            data: err.sqlMessage || err,
          });
        } else {
          const data = {
            status: "success",
            message: "Assignment deleted success",
            data: assignment,
          };
          logger.info(`${req.path} -- ${req.method} -- Success`);
          res.send(data);
        }
      });
    } catch (error) {
      res.send(error);
    }
  },
};
