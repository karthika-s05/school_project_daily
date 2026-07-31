const con = require("../config/dbConfig");

const queryAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    con.query(sql, params, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

let targetedTableReady = false;

const ensureTargetedTable = async () => {
  if (targetedTableReady) return;
  await queryAsync(`
    CREATE TABLE IF NOT EXISTS tbl_targeted_notification (
      id INT AUTO_INCREMENT PRIMARY KEY,
      administrationId INT NOT NULL,
      recipientUserName VARCHAR(100) NOT NULL,
      senderUserName VARCHAR(100) DEFAULT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      notificationType VARCHAR(50) DEFAULT 'General',
      isRead TINYINT(1) NOT NULL DEFAULT 0,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      readAt DATETIME DEFAULT NULL,
      KEY idx_targeted_recipient (
        administrationId, recipientUserName, isRead, createdAt
      )
    )
  `);
  targetedTableReady = true;
};

module.exports = {
  ensureTargetedTable,

  getnotification: async (
    userName,
    classId,
    sectionId,
    administrationId,
    callback
  ) => {
    const sql = `call sp_GetNotification('${userName}',${classId},${sectionId},${administrationId})`;
    con.query(sql, (err, data) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, data);
      }
    });
  },
  createnotification: async (
    title,
    message,
    classId,
    sectionId,
    administrationId,
    userName,
    callback
  ) => {
    const sql = `call sp_InsertNotification("${title}","${message}",${classId},${sectionId},${administrationId},'${userName}')`;
    con.query(sql, (err, notification) => {
      console.log(sql);
      if (err) {
        callback(err, null);
      } else {
        callback(null, notification);
      }
    });
  },

  createTargetedNotification: async (
    title,
    message,
    recipientUserName,
    administrationId,
    senderUserName,
    notificationType,
    callback
  ) => {
    try {
      const recipient = String(recipientUserName || "").trim();
      if (!recipient) {
        throw new Error("Notification recipient is required");
      }
      await ensureTargetedTable();
      const result = await queryAsync(
        `INSERT INTO tbl_targeted_notification
          (administrationId, recipientUserName, senderUserName, title, message, notificationType)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          Number(administrationId),
          recipient,
          String(senderUserName || "").trim() || null,
          String(title || "Notification"),
          String(message || ""),
          String(notificationType || "General"),
        ]
      );
      callback(null, result);
    } catch (err) {
      callback(err, null);
    }
  },

  getTargetedNotifications: async (userName, administrationId, callback) => {
    try {
      await ensureTargetedTable();
      const rows = await queryAsync(
        `SELECT id, title, message, notificationType, isRead, createdAt,
                recipientUserName, senderUserName
         FROM tbl_targeted_notification
         WHERE administrationId = ? AND recipientUserName = ?
         ORDER BY createdAt DESC`,
        [Number(administrationId), String(userName)]
      );
      callback(null, rows || []);
    } catch (err) {
      callback(err, null);
    }
  },

  markTargetedNotificationsRead: async (userName, administrationId, callback) => {
    try {
      await ensureTargetedTable();
      const result = await queryAsync(
        `UPDATE tbl_targeted_notification
         SET isRead = 1, readAt = COALESCE(readAt, NOW())
         WHERE administrationId = ? AND recipientUserName = ? AND isRead = 0`,
        [Number(administrationId), String(userName)]
      );
      callback(null, result);
    } catch (err) {
      callback(err, null);
    }
  },
  deletenotification: async (id, administrationId, callback) => {
    const sql = `call sp_DeleteNotification(${id},${administrationId})`;
    con.query(sql, (err, notification) => {
      if (err) {
        callback(err, null);
      } else {
        callback(null, notification);
      }
    });
  },
  updatenotificationTime: async (userName, administrationId, callback) => {
    const sql = `call sp_notificationTime('${userName}',${administrationId})`;
    con.query(sql, (err, notification) => {
      console.log(sql);
      console.log(userName, administrationId);
      if (err) {
        callback(err, null);
      } else {
        callback(null, notification);
      }
    });
  },
};
