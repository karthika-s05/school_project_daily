const leaveModel = require("../models/leave");
const logger = require("../config/winston");
const { localeData } = require("moment/moment");
const notificationService = require("../services/notificationService");
const substituteController = require("./substitute");
const con = require("../config/dbConfig");

const queryAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    con.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

// Staff display name for notification messages; falls back to the login id.
const getStaffDisplayName = async (staffId, administrationId) => {
  try {
    const rows = await queryAsync(
      "SELECT * FROM staff WHERE staffId = ? AND administrationId = ? LIMIT 1",
      [String(staffId), Number(administrationId)]
    );
    const row = rows?.[0];
    if (!row) return String(staffId);
    const name =
      row.staffName ||
      row.name ||
      [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ");
    return String(name || staffId).trim();
  } catch (err) {
    console.error("[leave-notify] staff name lookup failed:", err.message);
    return String(staffId);
  }
};

// Leave type label; the master table name differs across deployments.
const getLeaveTypeName = async (leaveTypeId, administrationId) => {
  if (!leaveTypeId) return null;
  const candidates = [
    "SELECT * FROM tbl_leavetype WHERE id = ? LIMIT 1",
    "SELECT * FROM leavetype WHERE id = ? LIMIT 1",
    "SELECT * FROM tbl_leave_type WHERE id = ? LIMIT 1",
  ];
  for (const sql of candidates) {
    try {
      const rows = await queryAsync(sql, [Number(leaveTypeId)]);
      const row = rows?.[0];
      if (row) {
        return String(
          row.leaveType || row.leaveTypeName || row.name || row.type || ""
        ).trim() || null;
      }
    } catch (_) {
      // table doesn't exist in this deployment; try the next candidate
    }
  }
  return null;
};

const createTargetedNotification = ({
  title,
  message,
  recipientUserName,
  administrationId,
  senderUserName,
  notificationType = "Leave",
  receiverRole,
  classId,
  sectionId,
  referenceId,
}) => {
  const recipient = String(recipientUserName || "").trim();
  if (!recipient) return;
  notificationService.createNotification({
    title,
    message,
    receiverId: recipient,
    receiverRole: receiverRole || "Staff",
    administrationId,
    senderId: senderUserName,
    notificationType,
    classId,
    sectionId,
    referenceId,
  }).catch((err) => {
    console.error("Targeted notification failed:", err.message || err);
  });
};


module.exports = {
  getLeaveType: async (req, res) => {
    const userName = req.user.userName;
    const adminstrationId = req.user.administrationId;
    try {
      await leaveModel.getLeaveType(
        userName,
        adminstrationId,
        (err, leaveType) => {
          if (err) {
            logger.info(`${req.path} -- ${req.method} -- Success`);
            res.send({
              status: "Error",
              message: "LeaveType list not retrived",
              data: err,
            });
          } else {
            logger.info(`${req.path} -- ${req.method} -- Success`);
            res.send({
              status: "success",
              message: "LeaveType list  retrived",
              data: leaveType[0],
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },
  createLeaveType: async (req, res) => {
    const id = req.body.id;
    const leaveType = req.body.leaveType;
    const role = req.body.role;
    const administrationId = req.user.administrationId;
    try {
      if (!leaveType || !role || !administrationId) {
        throw "Missing Credential";
      }
      await leaveModel.createLeaveType(
        id,
        leaveType,
        role,
        administrationId,
        (err, leaveType) => {
          const message = id == 0 ? "created" : "updated";

          if (err) {
            res.send({
              status: "Error",
              message: `LeaveType list not ${message}`,
              data: err,
            });
          } else {
            res.send({
              status: "success",
              message: `LeaveType list ${message}`,
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },
  deleteLeaveType: async (req, res) => {
    const id = req.params.id;
    const administrationId = req.user.administrationId;
    try {
      if (!id || !administrationId) {
        throw `Missing Credential`;
      }
      await leaveModel.deleteLeaveType(
        id,
        administrationId,
        (err, localeData) => {
          if (err) {
            res.send({
              status: "Error",
              message: "LeaveType not deleted",
              data: err,
            });
          } else {
            res.send({
              status: "success",
              message: "LeaveType deleted success",
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },

  getStudentLeave: async (req, res) => {
    const userName = req.user.userName;
    const classId = req.user.classId || req.body.classId || 0;
    const sectionId = req.user.sectionId || req.body.sectionId || 0;
    const adminstrationId = req.user.administrationId;
    try {
      await leaveModel.getStudentLeave(
        userName,
        classId,
        sectionId,
        adminstrationId,
        (err, leaveType) => {
          if (err) {
            logger.info(`${req.path} -- ${req.method} -- Success`);
            res.send({
              status: "Error",
              message: "Leave list not retrived",
              data: err,
            });
          } else {
            logger.info(`${req.path} -- ${req.method} -- Success`);
            res.send({
              status: "success",
              message: "Leave list  retrived",
              data: leaveType[0],
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },
  createStudentLeave: async (req, res) => {
    const { startDate, endDate, reason } = req.body;
    const userId = req.user.userName;
    const classId = req.user.classId || req.body.classId;
    const sectionId = req.user.sectionId || req.body.sectionId;
    const administrationId = req.user.administrationId;
    const newStartDate = new Date(startDate);
    const newEndDate = new Date(endDate);
    const timeDifference = newEndDate - newStartDate;
    console.log(parseInt(timeDifference));
    const noOfDays = timeDifference / (1000 * 60 * 60 * 24) + 1;
    console.log(noOfDays);
    try {
      if (!administrationId) {
        throw "Missing Credential";
      }
      await leaveModel.createStudentLeave(
        userId,
        classId,
        sectionId,
        startDate,
        endDate,
        reason,
        noOfDays,
        administrationId,
        (err, leaveType) => {
          if (err) {
            res.send({
              status: "Error",
              message: `LeaveType list not Created`,
              data: err,
            });
          } else {
            // A student leave application belongs only to that student's
            // configured class teacher, not every staff/admin account.
            leaveModel.getClassTeacherForStudent(
              classId,
              sectionId,
              administrationId,
              (teacherErr, teacher) => {
                if (teacherErr) {
                  console.error(
                    "Class teacher lookup failed:",
                    teacherErr.message || teacherErr
                  );
                  return;
                }
                const classTeacherId =
                  teacher?.staffId ||
                  teacher?.userName ||
                  teacher?.staffID ||
                  teacher?.teacherId;
                createTargetedNotification({
                  title: "Student Leave Request",
                  message: `${
                    req.user.studentName || req.user.name || userId
                  } applied for leave from ${startDate} to ${endDate}. Reason: ${
                    reason || "Not specified"
                  }`,
                  recipientUserName: classTeacherId,
                  receiverRole: "Staff",
                  administrationId,
                  senderUserName: userId,
                  notificationType: "Leave",
                  classId,
                  sectionId,
                  referenceId: leaveType?.insertId || leaveType?.[0]?.insertId,
                });
              }
            );
            res.send({
              status: "success",
              message: `LeaveType list Created`,
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },
  deleteStudentLeave: async (req, res) => {
    const id = req.body.id;
    const userName = req.user.userName;
    const administrationId = req.user.administrationId;
    try {
      if (!id || !administrationId) {
        throw `Missing Credential`;
      }
      await leaveModel.deleteStudentLeave(
        id,
        userName,
        administrationId,
        (err, localeData) => {
          if (err) {
            res.send({
              status: "Error",
              message: "LeaveType not deleted",
              data: err,
            });
          } else {
            res.send({
              status: "success",
              message: "LeaveType deleted success",
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },
  updateStuLeaveStatus: async (req, res) => {
    const { id, status, remarks } = req.body;
    const { userName, role } = req.user;
    const administrationId = req.user.administrationId;
    try {
      if (!id || !administrationId) {
        throw `Missing Credential`;
      }
      await leaveModel.updateStuLeaveStatus(
        id,
        status,
        remarks || "",
        userName,
        role,
        administrationId,
        (err, data) => {
          if (err) {
            res.send({
              status: "Error",
              message: "Status Updated Success", // keeping legacy message naming if any
              data: err,
            });
          } else {
            // Resolve the leave owner from the saved leave row. Never use the
            // approving staff member or request-body IDs as the recipient.
            leaveModel.getStudentLeaveById(
              id,
              administrationId,
              userName,
              (leaveErr, leaveRow) => {
                if (leaveErr) {
                  console.error(
                    "Student leave recipient lookup failed:",
                    leaveErr.message || leaveErr
                  );
                  return;
                }
                const studentUserName =
                  leaveRow?.userId ||
                  leaveRow?.userName ||
                  leaveRow?.studentUserName ||
                  leaveRow?.studentId ||
                  leaveRow?.admissionNo ||
                  leaveRow?.admissionNumber;
                createTargetedNotification({
                  title: "Leave Request Update",
                  message: `Your leave request has been ${
                    String(status).toLowerCase() === "accepted" ? "Approved" : status
                  }.`,
                  recipientUserName: studentUserName,
                  receiverRole: "Student",
                  administrationId,
                  senderUserName: userName,
                  notificationType: "Leave",
                  referenceId: id,
                });
              }
            );
            res.send({
              status: "success",
              message: "Status  Updated",
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },
  //staff
  getstaffLeave: async (req, res) => {
    console.log("fsdgsdf");
    const { userName, role } = req.user;
    const adminstrationId = req.user.administrationId;
    console.log("userName", userName);
    try {
      await leaveModel.getstaffLeave(
        userName,
        role,
        adminstrationId,
        (err, leaveType) => {
          if (err) {
            logger.info(`${req.path} -- ${req.method} -- Success`);
            res.send({
              status: "Error",
              message: "Leave list not retrived",
              data: err,
            });
          } else {
            logger.info(`${req.path} -- ${req.method} -- Success`);
            res.send({
              status: "success",
              message: "Leave list  retrived",
              data: leaveType[0],
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },
  createstaffLeave: async (req, res) => {
    const { leaveTime, leaveTypeId, startDate, endDate, reason } = req.body;
    const userId = req.user.userName;
    const administrationId = req.user.administrationId;
    const newStartDate = new Date(startDate);
    const newEndDate = new Date(endDate);
    const timeDifference = newEndDate - newStartDate;

    console.log(startDate);
    console.log(endDate);

    console.log("vbfbfgbfdbdf", typeof timeDifference);
    let totalDays = timeDifference / (1000 * 60 * 60 * 24);
    totalDays = totalDays + 1;
    console.log("bgbfgbfgbdfgbfg", totalDays);
    const noOfDays = leaveTime === "Half day" ? totalDays / 2 : totalDays;
    console.log("noOfDays", noOfDays);
    try {
      if (!administrationId) {
        throw "Missing Credential";
      }
      await leaveModel.createstaffLeave(
        userId,
        leaveTime,
        leaveTypeId,
        startDate,
        endDate,
        reason,
        // noOfDays,
        administrationId,
        (err, leaveResult) => {
          if (err) {
            res.send({
              status: "Error",
              message: `LeaveType list not Created`,
              data: err,
            });
          } else {
            // Respond immediately; the admin notification runs after the
            // insert and must never block or fail the leave application.
            res.send({
              status: "success",
              message: `LeaveType list Created`,
            });

            (async () => {
              console.log(
                `[leave-notify] staff leave saved for ${userId}, resolving leave id...`
              );
              let leaveId =
                leaveResult?.insertId ||
                leaveResult?.[0]?.insertId ||
                leaveResult?.[0]?.[0]?.id ||
                leaveResult?.[0]?.[0]?.insertId ||
                null;
              if (!leaveId) {
                // The SP doesn't return the new id; take the newest leave row
                // for this staff member so the notification can reference it.
                leaveId = await new Promise((resolve) => {
                  leaveModel.getMyStaffLeave(
                    userId,
                    administrationId,
                    (listErr, listData) => {
                      if (listErr) return resolve(null);
                      const rows = Array.isArray(listData)
                        ? listData[0] || []
                        : [];
                      const newest = rows.reduce(
                        (max, row) => (Number(row.id) > max ? Number(row.id) : max),
                        0
                      );
                      resolve(newest || null);
                    }
                  );
                });
              }
              console.log(`[leave-notify] leave id resolved: ${leaveId}`);

              const [staffName, leaveTypeName] = await Promise.all([
                getStaffDisplayName(userId, administrationId),
                getLeaveTypeName(leaveTypeId, administrationId),
              ]);
              const typeLabel =
                req.body.leaveType || req.body.leaveTypeName || leaveTypeName;

              try {
                const result = await notificationService.notifyAudience({
                  audience: "Admin",
                  title: "New Leave Application",
                  message: `${staffName} has applied for ${
                    typeLabel ? `${typeLabel} leave` : "leave"
                  } from ${startDate} to ${endDate}.`,
                  notificationType: "Leave",
                  senderId: userId,
                  referenceId: leaveId,
                  administrationId,
                });
                console.log(
                  `[leave-notify] admin notification created (rows: ${
                    result?.created ?? 0
                  }) for leave ${leaveId}, administrationId ${administrationId}`
                );
              } catch (notificationError) {
                console.error(
                  "[leave-notify] admin leave notification failed:",
                  notificationError.message || notificationError
                );
              }
            })().catch((flowError) => {
              console.error(
                "[leave-notify] notification flow failed:",
                flowError.message || flowError
              );
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },
  deletestaffLeave: async (req, res) => {
    const id = req.body.id;
    const userName = req.user.userName;
    const administrationId = req.user.administrationId;
    try {
      if (!id || !administrationId) {
        throw `Missing Credential`;
      }
      await leaveModel.deletestaffLeave(
        id,
        userName,
        administrationId,
        (err, localeData) => {
          if (err) {
            res.send({
              status: "Error",
              message: "LeaveType not deleted",
              data: err,
            });
          } else {
            // Cancel open substitute requests linked to this leave
            substituteController.cancelForLeave(id, administrationId, () => {});
            createTargetedNotification({
              title: "Leave Cancelled",
              message:
                "Your staff leave request was cancelled. Related substitute requests (if any) were cancelled.",
              recipientUserName: userName,
              receiverRole: "Staff",
              administrationId,
              senderUserName: userName,
              notificationType: "Leave",
              referenceId: id,
            });
            res.send({
              status: "success",
              message: "LeaveType deleted success",
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },
  updateStffLeaveStatus: async (req, res) => {
    const { id, status, remarks } = req.body;
    const { userName, role } = req.user;
    const administrationId = req.user.administrationId;
    try {
      if (!id || !status || !administrationId) {
        throw `Missing Credential`;
      }
      await leaveModel.updateStaffLeaveStatus(
        id,
        status,
        remarks || "",
        userName,
        role,
        administrationId,
        (err) => {
          if (err) {
            res.send({
              status: "Error",
              message: "Staff leave status not updated",
              data: err,
            });
          } else {
            const normalized = String(status || "").trim().toLowerCase();

            // Targeted leave status notification to the staff member when possible.
            substituteController.getStaffLeaveById(id, administrationId, async (leaveErr, leaveRow) => {
              const targetStaff =
                leaveRow?.staffId ||
                leaveRow?.staffID ||
                leaveRow?.userName ||
                null;

              createTargetedNotification({
                title:
                  normalized === "accepted"
                    ? "Leave Approved"
                    : normalized === "rejected"
                      ? "Leave Rejected"
                      : "Staff Leave Request Update",
                message: `Your leave request has been ${
                  normalized === "accepted" ? "Approved" : status
                }.`,
                recipientUserName: targetStaff,
                receiverRole: "Staff",
                administrationId,
                senderUserName: userName,
                notificationType: "Leave",
                referenceId: id,
              });

              if (normalized === "accepted") {
                const leavePayload = leaveRow || {
                  id,
                  staffId: req.body.staffId || req.body.userName || null,
                  staffName: req.body.staffName,
                  startDate: req.body.startDate || req.body.fromDate,
                  endDate: req.body.endDate || req.body.toDate,
                  leaveTime: req.body.leaveTime || "Full day",
                };
                // If staffId still missing, try SP list again with Admin role
                if (!leavePayload.staffId && !leavePayload.userName) {
                  leaveModel.getstaffLeave(userName, "Admin", administrationId, async (listErr, listData) => {
                    const list = Array.isArray(listData) ? listData[0] || [] : [];
                    const found = list.find((item) => Number(item.id) === Number(id));
                    if (found) {
                      try {
                        await substituteController.createRequestsForApprovedLeave(
                          found,
                          administrationId,
                          userName
                        );
                      } catch (subErr) {
                        console.error("Substitute create failed:", subErr);
                      }
                    }
                    res.send({
                      status: "success",
                      message: "Staff leave status updated",
                    });
                  });
                  return;
                }

                try {
                  await substituteController.createRequestsForApprovedLeave(
                    leavePayload,
                    administrationId,
                    userName
                  );
                } catch (subErr) {
                  console.error("Substitute create failed:", subErr);
                }
              }

              res.send({
                status: "success",
                message: "Staff leave status updated",
              });
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },

  getMyStaffLeave: async (req, res) => {
  const { userName, administrationId } = req.user;

  leaveModel.getMyStaffLeave(
    userName,
    administrationId,
    (err, data) => {
      if (err) {
        return res.send({
          status: "Error",
          message: "Staff leave not retrieved",
          data: err.sqlMessage,
        });
      }

      res.send({
        status: "Success",
        message: "Staff leave retrieved successfully",
        data: data[0],
      });
    }
  );
}
};


