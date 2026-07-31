const substituteModel = require("../models/substitute");
const notificationService = require("../services/notificationService");

const toDateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const eachDateInclusive = (startDate, endDate) => {
  const dates = [];
  const start = new Date(`${toDateOnly(startDate)}T00:00:00`);
  const end = new Date(`${toDateOnly(endDate)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return dates;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
};

/** Convert YYYY-MM-DD to timetable dayId (Mon=1 .. Sat=6). Sunday => null. */
const dateToDayId = (dateStr) => {
  const d = new Date(`${toDateOnly(dateStr)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const jsDay = d.getDay(); // 0=Sun .. 6=Sat
  if (jsDay === 0) return null;
  return jsDay; // Mon=1 .. Sat=6
};

const notifyStaff = (title, message, staffId, administrationId, senderUserName) =>
  notificationService
    .createNotification({
      title,
      message,
      receiverId: staffId,
      receiverRole: "Staff",
      administrationId,
      senderId: senderUserName || null,
      notificationType: "Timetable",
    })
    .catch(() => null);

const createRequestsForApprovedLeave = (leave, administrationId, senderUserName) =>
  new Promise((resolve) => {
    const absentStaffId = String(
      leave.staffId || leave.userName || leave.staffID || ""
    ).trim();
    if (!absentStaffId) {
      resolve({ created: 0, reason: "missing staffId" });
      return;
    }

    const dates = eachDateInclusive(leave.startDate || leave.fromDate, leave.endDate || leave.toDate);
    const absentName =
      leave.staffName ||
      [leave.firstName, leave.lastName].filter(Boolean).join(" ").trim() ||
      absentStaffId;

    let created = 0;
    let pending = 0;
    let finished = false;

    const doneOne = () => {
      pending -= 1;
      if (pending <= 0 && !finished) {
        finished = true;
        resolve({ created, dates: dates.length });
      }
    };

    if (!dates.length) {
      resolve({ created: 0, reason: "no dates" });
      return;
    }

    dates.forEach((dateStr) => {
      const dayId = dateToDayId(dateStr);
      if (!dayId) return;

      pending += 1;
      substituteModel.getTimetablePeriodsForStaffOnDay(
        absentStaffId,
        dayId,
        administrationId,
        (err, periods) => {
          if (err || !periods || !periods.length) {
            doneOne();
            return;
          }

          let inner = periods.length;
          periods.forEach((period) => {
            substituteModel.createSubstituteRequest(
              {
                administrationId,
                timetableId: period.timetableId,
                leaveId: leave.id,
                absentStaffId,
                subjectId: period.subjectId,
                classId: period.classId,
                sectionId: period.sectionId,
                periodSlotId: period.periodSlotId,
                dayId: period.dayId,
                substituteDate: dateStr,
              },
              (createErr) => {
                if (!createErr) created += 1;

                substituteModel.getPeerStaffForSubject(
                  period.subjectId,
                  absentStaffId,
                  administrationId,
                  async (peerErr, peers) => {
                    if (!peerErr && peers && peers.length) {
                      const classLabel = `${period.className || period.classId}-${period.sectionName || period.sectionId}`;
                      const msg = `${absentName} is on approved leave on ${dateStr}. Please check whether you are available to handle ${period.subjectName || "this subject"} (${classLabel}) from ${period.startTime} to ${period.endTime}.`;
                      await Promise.all(
                        peers.map((peer) =>
                          notifyStaff(
                            "Substitute Request",
                            msg,
                            peer.staffId,
                            administrationId,
                            senderUserName
                          )
                        )
                      );
                    }
                    inner -= 1;
                    if (inner <= 0) doneOne();
                  }
                );
              }
            );
          });
        }
      );
    });

    if (pending === 0) {
      resolve({ created: 0, reason: "weekend only" });
    }
  });

module.exports = {
  getMyRequests: async (req, res) => {
    const staffId = req.user.userName;
    const administrationId = req.user.administrationId;
    if (!staffId || !administrationId) {
      return res.status(400).send({ status: "Error", message: "Missing Credential" });
    }
    substituteModel.getMySubstituteRequests(staffId, administrationId, (err, rows) => {
      if (err) {
        return res.status(500).send({
          status: "Error",
          message: "Unable to retrieve substitute requests",
          data: err.sqlMessage || err.message || err,
        });
      }
      return res.send({
        status: "success",
        message: "Substitute requests retrieved",
        data: rows || [],
      });
    });
  },

  accept: async (req, res) => {
    const id = Number(req.params.id || 0);
    const staffId = String(req.user.userName || "").trim();
    const administrationId = Number(req.user.administrationId || 0);
    if (!id || !staffId || !administrationId) {
      return res.status(400).send({ status: "Error", message: "Missing Credential" });
    }

    substituteModel.getSubstituteById(id, administrationId, (err, row) => {
      if (err) {
        return res.status(500).send({
          status: "Error",
          message: "Unable to load substitute request",
          data: err.sqlMessage || err.message || err,
        });
      }
      if (!row || String(row.status).toLowerCase() !== "pending") {
        return res.status(400).send({
          status: "Error",
          message: "Substitute request is not pending",
        });
      }
      if (String(row.absentStaffId) === staffId) {
        return res.status(400).send({
          status: "Error",
          message: "Absent staff cannot accept their own substitute request",
        });
      }

      substituteModel.getPeerStaffForSubject(
        row.subjectId,
        row.absentStaffId,
        administrationId,
        (peerErr, peers) => {
          if (peerErr) {
            return res.status(500).send({
              status: "Error",
              message: "Unable to validate subject staff",
              data: peerErr.sqlMessage || peerErr.message || peerErr,
            });
          }
          const allowed = (peers || []).some((p) => String(p.staffId) === staffId);
          if (!allowed) {
            return res.status(403).send({
              status: "Error",
              message: "Only same-subject staff can accept this request",
            });
          }

          substituteModel.hasStaffConflict(
            staffId,
            row.periodSlotId,
            toDateOnly(row.substituteDate),
            administrationId,
            (conflictErr, conflict) => {
              if (conflictErr) {
                return res.status(500).send({
                  status: "Error",
                  message: "Unable to check timetable conflict",
                  data: conflictErr.sqlMessage || conflictErr.message || conflictErr,
                });
              }
              if (conflict) {
                return res.status(400).send({
                  status: "Error",
                  message: "You already have a period at this time",
                });
              }

              substituteModel.acceptSubstitute(
                id,
                staffId,
                administrationId,
                async (acceptErr, result) => {
                  if (acceptErr) {
                    return res.status(500).send({
                      status: "Error",
                      message: "Unable to accept substitute request",
                      data: acceptErr.sqlMessage || acceptErr.message || acceptErr,
                    });
                  }
                  if (!result?.affectedRows) {
                    return res.status(400).send({
                      status: "Error",
                      message: "Substitute request could not be accepted",
                    });
                  }

                  const classLabel = `${row.className || row.classId}-${row.sectionName || row.sectionId}`;
                  await notifyStaff(
                    "Substitute Accepted",
                    `${req.user.userName} accepted the substitute for ${row.subjectName || "subject"} (${classLabel}) on ${toDateOnly(row.substituteDate)} (${row.startTime} - ${row.endTime}).`,
                    row.absentStaffId,
                    administrationId,
                    staffId
                  );

                  return res.send({
                    status: "success",
                    message: "Substitute accepted",
                    data: { id, substituteStaffId: staffId },
                  });
                }
              );
            }
          );
        }
      );
    });
  },

  reject: async (req, res) => {
    const id = Number(req.params.id || 0);
    const staffId = String(req.user.userName || "").trim();
    const administrationId = Number(req.user.administrationId || 0);
    if (!id || !staffId || !administrationId) {
      return res.status(400).send({ status: "Error", message: "Missing Credential" });
    }

    substituteModel.getSubstituteById(id, administrationId, (err, row) => {
      if (err || !row) {
        return res.status(404).send({
          status: "Error",
          message: "Substitute request not found",
        });
      }
      if (String(row.status).toLowerCase() !== "pending") {
        return res.status(400).send({
          status: "Error",
          message: "Substitute request is not pending",
        });
      }

      substituteModel.rejectSubstitute(id, administrationId, async (rejectErr, result) => {
        if (rejectErr) {
          return res.status(500).send({
            status: "Error",
            message: "Unable to reject substitute request",
            data: rejectErr.sqlMessage || rejectErr.message || rejectErr,
          });
        }
        if (!result?.affectedRows) {
          return res.status(400).send({
            status: "Error",
            message: "Substitute request could not be rejected",
          });
        }

        await notifyStaff(
          "Substitute Rejected",
          `${staffId} rejected the substitute request for ${row.subjectName || "subject"} on ${toDateOnly(row.substituteDate)}.`,
          row.absentStaffId,
          administrationId,
          staffId
        );

        return res.send({
          status: "success",
          message: "Substitute rejected",
          data: { id },
        });
      });
    });
  },

  // Used by leave controller after approval / cancel
  createRequestsForApprovedLeave,
  cancelForLeave: (leaveId, administrationId, callback) => {
    substituteModel.cancelSubstitutesForLeave(leaveId, administrationId, callback);
  },
  getStaffLeaveById: substituteModel.getStaffLeaveById,
  notifyStaff,
  toDateOnly,
  eachDateInclusive,
  dateToDayId,
};
