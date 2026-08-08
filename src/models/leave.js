const con = require("../config/dbConfig");

module.exports = {
  getLeaveType: async (userName, adminstrationId, callback) => {
    const sql = `call sp_GetLeaveType('${userName}',${adminstrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  createLeaveType: async (id, leaveType, role, administrationId, callback) => {
    const sql = `call sp_InsOrUpLeaveType(${id},'${leaveType}','${role}',${administrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  deleteLeaveType: async (id, administrationId, callback) => {
    const sql = `call sp_deleteLeaveType(${id},${administrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  getStudentLeave: async (
    userName,
    classId,
    sectionId,
    adminstrationId,
    callback
  ) => {
    const sql = `call sp_GetStudentLeave('${userName}',${classId},${sectionId},${adminstrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  deleteStudentLeave: async (id, userName, administrationId, callback) => {
    const sql = `call sp_deletestdLeave(${id},'${userName}',${administrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  updateStuLeaveStatus: async (
    id,
    status,
    remarks,
    userName,
    role,
    administrationId,
    callback
  ) => {
    const sql = `call sp_UpdatestdLeaveStatus(${id},'${userName}','${role}','${status}','${remarks || ""}',${administrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  createStudentLeave: async (
    userId,
    classId,
    sectionId,
    startDate,
    endDate,
    reason,
    noOfDays,
    administrationId,
    leaveTypeId,
    callback
  ) => {
    const sql = `call sp_InsUpStdLeave('${userId}',${classId},${sectionId},'${startDate}','${endDate}','${reason}',${noOfDays},${administrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) return callback(err, null);
      if (!leaveTypeId) return callback(null, data);
      // Attach leaveTypeId via a follow-up UPDATE on the newest row for this student
      const updateSql = `UPDATE tbl_studentleave SET leaveTypeId = ? WHERE userId = ? AND administrationId = ? ORDER BY id DESC LIMIT 1`;
      con.query(updateSql, [Number(leaveTypeId), String(userId), Number(administrationId)], (updateErr) => {
        if (updateErr) console.error("[leave] leaveTypeId update failed:", updateErr.message);
        callback(null, data);
      });
    });
  },

  //staff
  getstaffLeave: async (
    userName,
    role,
    adminstrationId,
    callback
  ) => {
    const sql = `call sp_GetStaffLeave('${userName}','${role}',${adminstrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  createstaffLeave: async (
    userId,
    leaveTime,
    leaveTypeId,
    startDate,
    endDate,
    reason,
    // noOfDays,
    administrationId,
    callback
  ) => {
    const sql = `call sp_InsertStaffLeave('${userId}','${leaveTime}',${leaveTypeId},'${startDate}','${endDate}','${reason}',${administrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  deletestaffLeave: async (id, userName, administrationId, callback) => {
    const sql = `call sp_deleteStaffLeave(${id},'${userName}',${administrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  updateStaffLeaveStatus: async (
    id,
    status,
    remarks,
    userName,
    role,
    administrationId,
    callback
  ) => {
    const sql = `call sp_UpdateStaffLeaveStatus(${id},'${userName}','${role}','${status}','${remarks || ""}',${administrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  getMyStaffLeave: async (staffId, administrationId, callback) => {
    const sql = `CALL sp_GetMyStaffLeave('${staffId}', ${administrationId})`;

    con.query(sql, (err, data) => {
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },

  getClassTeacherForStudent: async (
    classId,
    sectionId,
    administrationId,
    callback
  ) => {
    con.query(
      "CALL sp_GetClassTeacher(?, ?, ?, ?)",
      [0, Number(classId), Number(sectionId), Number(administrationId)],
      (err, data) => {
        if (err) return callback(err, null);
        const rows = Array.isArray(data) ? data[0] || [] : [];
        const teacher = rows.find(
          (row) =>
            row.staffId || row.userName || row.staffID || row.teacherId
        );
        return callback(null, teacher || null);
      }
    );
  },

  getStudentLeaveById: async (
    leaveId,
    administrationId,
    viewerUserName,
    callback
  ) => {
    const candidates = [
      "SELECT * FROM tbl_studentleave WHERE id = ? AND administrationId = ? LIMIT 1",
      "SELECT * FROM studentleave WHERE id = ? AND administrationId = ? LIMIT 1",
      "SELECT * FROM tbl_student_leave WHERE id = ? AND administrationId = ? LIMIT 1",
      "SELECT * FROM tbl_stdleave WHERE id = ? AND administrationId = ? LIMIT 1",
    ];

    const tryCandidate = (index) => {
      if (index >= candidates.length) {
        // Deployments use different leave-table names. The list procedure is
        // retained as a fallback and the requested row is selected in Node.
        return con.query(
          "CALL sp_GetStudentLeave(?, ?, ?, ?)",
          [String(viewerUserName || "0"), 0, 0, Number(administrationId)],
          (spErr, data) => {
            if (spErr) return callback(spErr, null);
            const rows = Array.isArray(data) ? data[0] || [] : [];
            const row =
              rows.find((item) => Number(item.id) === Number(leaveId)) || null;
            return callback(null, row);
          }
        );
      }

      return con.query(
        candidates[index],
        [Number(leaveId), Number(administrationId)],
        (err, rows) => {
          if (err) return tryCandidate(index + 1);
          return callback(null, rows?.[0] || null);
        }
      );
    };

    tryCandidate(0);
  },
};
