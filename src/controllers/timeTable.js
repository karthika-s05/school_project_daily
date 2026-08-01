const TimeTableModel = require("../models/timeTable");
const con = require("../config/dbConfig");
const notificationService = require("../services/notificationService");

module.exports = {
  getPeriodSlot: async (req, res) => {
  const administrationId = req.user.administrationId;
  const classId = req.params.classId;

  try {
    if (!administrationId) {
      return res.send({
        status: "Error",
        message: "Missing Credential",
      });
    }

    TimeTableModel.getPeriodSlot(
      classId,
      administrationId,
      (err, periodSlot) => {
        if (err) {
          return res.status(500).send({
            status: "Error",
            message: "Period Slot list not retrieved",
            error: err.sqlMessage || err.message || err,
          });
        }

        const rows = Array.isArray(periodSlot) ? periodSlot[0] ?? [] : [];
        return res.send({
          status: "success",
          message: "Period Slot list retrieved successfully",
          data: rows,
        });
      }
    );
  } catch (error) {
    res.send(error);
  }
},
  getPeriodSlotById: async (req, res) => {
    const id = Number(req.params.id ?? 0);
    const administrationId = Number(req.user.administrationId ?? 0);

    if (!id || !administrationId) {
      return res.status(400).send({
        status: "Error",
        message: "Period slot id is required",
      });
    }

    TimeTableModel.getPeriodSlotById(id, administrationId, (err, rows) => {
      if (err) {
        return res.status(500).send({
          status: "Error",
          message: "Period slot not retrieved",
          data: err.sqlMessage || err.message || err,
        });
      }
      if (!rows || !rows.length) {
        return res.status(404).send({
          status: "Error",
          message: "Period slot not found",
        });
      }
      return res.send({
        status: "success",
        message: "Period slot retrieved successfully",
        data: rows,
      });
    });
  },
  createUpdatePeriodSlot: async (req, res) => {
    const id = req.body.id ?? 0;
    const startTime = req.body.startTime;
    const endTime = req.body.endTime;
    const classId = req.body.classId;
    const administrationId = req.user.administrationId;
    try {
      if (!administrationId || !startTime || !endTime || !classId) {
        return res.send({
          status: "Error",
          message: "Missing Credential",
        });
      }
      await TimeTableModel.createUpdatePeriodSlot(
        id,
        classId,
        startTime,
        endTime,
        administrationId,
        (err, PeriodSlot) => {
          const message = Number(id) === 0 ? "created" : "updated";
          if (err) {
            res.send({
              status: "Error",
              message: `PeriodSlot list not ${message}`,
              data: err.sqlMessage,
            });
          } else {
            res.send({
              status: "success",
              message: `PeriodSlot ${message} success`,
              data: PeriodSlot,
            });
          }
        }
      );
    } catch (error) {
      res.send(error);
    }
  },
  deletePeriodSlot: async (req, res) => {
    const id = req.params.id;
    const administrationId = req.user.administrationId;

    try {
      if (!id && !administrationId) {
        res.send("Missing Credential");
      } else {
        await TimeTableModel.deletePeriodSlot(
          id,
          administrationId,
          (err, PeriodSlot) => {
            if (err) {
              res.send({
                status: "Error",
                message: "PeriodSlot list not deleted",
              });
            } else {
              data = {
                status: "success",
                message: "PeriodSlot deleted success",
                data: PeriodSlot,
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

  getClasstimeTable: async (req, res) => {
    const id = req.params.id;
    const dayId = req.body.dayId ?? 0;
    const role = String(req.user.role || "").toLowerCase();
    // Students may only view their own class/section from JWT.
    const classId =
      role === "student"
        ? Number(req.user.classId || 0)
        : Number(req.body.classId || req.user.classId || 0);
    const sectionId =
      role === "student"
        ? Number(req.user.sectionId || 0)
        : Number(req.body.sectionId || req.user.sectionId || 0);
    const administrationId = req.user.administrationId;
    try {
      if (!administrationId) {
        res.send("Missing Credential");
      } else if (role === "student" && (!classId || !sectionId)) {
        return res.status(400).send({
          status: "Error",
          message: "Student class and section are required",
        });
      } else {
        await TimeTableModel.getClasstimeTable(
          id,
          dayId,
          classId,
          sectionId,
          administrationId,
          (err, ClasstimeTable) => {
            if (err) {
              res.send({
                status: "Error",
                message: "Class timetable list not retrieved",
                data: err,
              });
            } else {
              const rows = Array.isArray(ClasstimeTable) ? ClasstimeTable[0] ?? [] : [];
              const filteredRows = rows.filter((row) => {
                const rowClassId = row?.classId ?? row?.class_id ?? row?.classid;
                const rowSectionId = row?.sectionId ?? row?.section_id ?? row?.sectionid;
                const rowDayId = row?.dayId ?? row?.day_id ?? row?.dayid;
                if (classId && Number(classId) !== Number(rowClassId)) return false;
                if (sectionId && Number(sectionId) !== Number(rowSectionId)) return false;
                if (dayId && Number(dayId) !== Number(rowDayId)) return false;
                return true;
              });
              const responseData = filteredRows.length ? filteredRows : [];
              const data = {
                status: "success",
                message: "Class timetable retrieved successfully",
                data: responseData,
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
  getSubjectStaff: async (req, res) => {
    const subjectId = Number(req.params.subjectId ?? 0);
    const administrationId = Number(req.user.administrationId ?? 0);

    if (!subjectId || !administrationId) {
      return res.status(400).send({
        status: "Error",
        message: "Subject is required",
      });
    }

    TimeTableModel.getStaffForSubject(
      subjectId,
      administrationId,
      (err, subjectStaff) => {
        if (err) {
          return res.status(500).send({
            status: "Error",
            message: "Unable to resolve staff for subject",
            data: err.sqlMessage || err.message || err,
          });
        }
        if (!subjectStaff) {
          return res.status(404).send({
            status: "Error",
            message: "Subject not found",
          });
        }
        return res.send({
          status: "success",
          message: subjectStaff.staff.length
            ? "Staff retrieved successfully"
            : "Staff Not Assigned",
          data: subjectStaff,
        });
      }
    );
  },
  createUpdateClasstimeTable: async (req, res) => {
    const id = Number(req.body.id ?? 0);
    const periodSlotId = Number(req.body.periodSlotId ?? 0);
    const dayId = Number(req.body.dayId ?? 0);
    const subjectId =
      req.body.subjectId === undefined || req.body.subjectId === null || req.body.subjectId === ""
        ? 0
        : Number(req.body.subjectId);
    const staffId = String(req.body.staffId ?? "").trim();
    const classId = Number(req.body.classId ?? 0);
    const sectionId = Number(req.body.sectionId ?? 0);
    const administrationId = req.user.administrationId;
    try {
      if (
        !administrationId ||
        !periodSlotId ||
        !dayId ||
        !subjectId ||
        !staffId ||
        !classId ||
        !sectionId
      ) {
        return res.status(400).send({
          status: "Error",
          message: "Period, day, subject, staff, class, and section are required",
        });
      }

      // Only accept an active staff member who teaches the selected subject.
      TimeTableModel.getStaffForSubject(
        subjectId,
        administrationId,
        (staffErr, subjectStaff) => {
          if (staffErr) {
            return res.status(500).send({
              status: "Error",
              message: "Unable to resolve staff for subject",
              data: staffErr.sqlMessage || staffErr.message || staffErr,
            });
          }

          const selectedStaff = subjectStaff?.staff?.find(
            (staff) => String(staff.staffId) === staffId
          );
          if (!selectedStaff) {
            return res.status(400).send({
              status: "Error",
              message: "Selected staff does not teach the selected subject",
            });
          }

          TimeTableModel.createUpdateClasstimeTable(
            id,
            periodSlotId,
            dayId,
            subjectId,
            staffId,
            classId,
            sectionId,
            administrationId,
            (err, classTimetable) => {
              const message = id === 0 ? "created" : "updated";
              if (err) {
                return res.send({
                  status: "Error",
                  message: `Class timetable not ${message}`,
                  data: err.sqlMessage,
                });
              }
              Promise.all([
                notificationService.notifyAudience({
                  audience: "Selected Class",
                  title: id === 0 ? "Timetable Published" : "Timetable Updated",
                  message: `Your class timetable has been ${
                    id === 0 ? "published" : "updated"
                  }.`,
                  notificationType: "Timetable",
                  senderId: req.user.userName,
                  classId,
                  sectionId,
                  referenceId: id || classTimetable?.insertId || null,
                  administrationId,
                }),
                notificationService.createNotification({
                  title: id === 0 ? "Timetable Published" : "Timetable Updated",
                  message: `Your timetable for class ${classId}, section ${sectionId} has been ${
                    id === 0 ? "published" : "updated"
                  }.`,
                  notificationType: "Timetable",
                  senderId: req.user.userName,
                  receiverId: staffId,
                  receiverRole: "Staff",
                  classId,
                  sectionId,
                  referenceId: id || classTimetable?.insertId || null,
                  administrationId,
                }),
              ]).catch((notificationError) => {
                console.error(
                  "Timetable notification failed:",
                  notificationError.message || notificationError
                );
              });
              return res.send({
                status: "success",
                message: `Class timetable ${message} successfully`,
                data: {
                  timetable: classTimetable[0],
                  subjectId,
                  subjectName: subjectStaff?.subjectName || "",
                  staffId: selectedStaff.staffId,
                  staffName: selectedStaff.staffName,
                },
              });
            }
          );
        }
      );
    } catch (error) {
      res.status(500).send({
        status: "Error",
        message: error.message || "Unable to save class timetable",
      });
    }
  },
  deleteClasstimeTable: async (req, res) => {
    const id = req.params.id;
    const administrationId = req.user.administrationId;

    try {
      if (!id && !administrationId) {
        res.send("Missing Credential");
      } else {
        await TimeTableModel.deleteClasstimeTable(
          id,
          administrationId,
          (err, ClasstimeTable) => {
            if (err) {
              res.send({
                status: "Error",
                message: "ClasstimeTable list not deleted",
              });
            } else {
              data = {
                status: "success",
                message: "ClasstimeTable deleted success",
                data: ClasstimeTable,
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
  getStafftimeTable: async (req, res) => {
    // dayId 0 / omitted = full week (Mon–Sat)
    const dayId = Number(req.body?.dayId ?? req.query?.dayId ?? 0);
    const userName = req.user.userName;
    const administrationId = req.user.administrationId;
    const weekStart = req.body?.weekStart || req.query?.weekStart || null;
    const weekEnd = req.body?.weekEnd || req.query?.weekEnd || null;
    try {
      if (!userName || !administrationId) {
        return res.send({ status: "Error", message: "Missing Credential" });
      }
      await TimeTableModel.getStafftimeTable(
        userName,
        dayId,
        administrationId,
        (err, StafftimeTable) => {
          if (err) {
            return res.send({
              status: "Error",
              message: "StafftimeTable list not retrieved",
              data: err,
            });
          }
          const baseRows = Array.isArray(StafftimeTable)
            ? StafftimeTable[0] ?? []
            : [];

          // Overlay date-specific substitutes for the requested week when provided.
          if (!weekStart || !weekEnd) {
            return res.send({
              status: "success",
              message: "StafftimeTable retrieved success",
              data: baseRows,
            });
          }

          const substituteModel = require("../models/substitute");
          substituteModel.getSubstitutesForStaffWeek(
            userName,
            weekStart,
            weekEnd,
            administrationId,
            (subErr, subs) => {
              if (subErr) {
                return res.send({
                  status: "success",
                  message: "StafftimeTable retrieved success",
                  data: baseRows,
                });
              }

              const overlay = (subs || []).map((sub) => {
                const status = String(sub.status || "").toLowerCase();
                let cellType = "pending_request";
                if (status === "accepted" && String(sub.substituteStaffId) === String(userName)) {
                  cellType = "accepted_substitute";
                } else if (status === "accepted" && String(sub.absentStaffId) === String(userName)) {
                  cellType = "free"; // covered by another teacher that date
                } else if (status === "pending" && String(sub.absentStaffId) === String(userName)) {
                  cellType = "pending_request";
                }
                return {
                  id: sub.timetableId,
                  substituteId: sub.id,
                  periodSlotId: sub.periodSlotId,
                  slotId: sub.periodSlotId,
                  dayId: sub.dayId,
                  day: sub.day,
                  subjectId: sub.subjectId,
                  subjectName: sub.subjectName,
                  subject: sub.subjectName,
                  staffId:
                    cellType === "accepted_substitute"
                      ? sub.substituteStaffId
                      : sub.absentStaffId,
                  staffName: sub.absentStaffName,
                  classId: sub.classId,
                  className: sub.className,
                  sectionId: sub.sectionId,
                  sectionName: sub.sectionName,
                  startTime: sub.startTime,
                  endTime: sub.endTime,
                  substituteDate: sub.substituteDate,
                  status: sub.status,
                  cellType,
                };
              });

              return res.send({
                status: "success",
                message: "StafftimeTable retrieved success",
                data: baseRows,
                substitutes: overlay,
              });
            }
          );
        }
      );
    } catch (error) {
      res.send(error);
    }
  },
  getDay: async (req, res) => {
    const sql = `
      SELECT dayNumber AS id, dayName
      FROM tbl_calendar
      LIMIT 7
    `;
    con.query(sql, (err, day) => {
      if (err) {
        data = {
          status: "Error",
          data: err.sqlMessage,
        };
        res.send(data);
      } else {
        data = {
          status: "success",
          data: day,
        };
        res.send(data);
      }
    });
  },
};
