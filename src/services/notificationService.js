const con = require("../config/dbConfig");

const query = (sql, params = []) =>
  new Promise((resolve, reject) => {
    con.query(sql, params, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });

const TYPES = new Set([
  "Leave",
  "Homework",
  "Assignment",
  "Exam",
  "Attendance",
  "Event",
  "Announcement",
  "Timetable",
  "Parent Meeting",
  "Circular",
  "Holiday",
  "Examination",
]);

let tableReady = false;

const ensureTable = async () => {
  if (tableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS tbl_notification_center (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      notificationType VARCHAR(50) NOT NULL DEFAULT 'Announcement',
      senderId VARCHAR(100) DEFAULT NULL,
      senderRole VARCHAR(30) DEFAULT NULL,
      receiverId VARCHAR(100) NOT NULL,
      receiverRole VARCHAR(30) NOT NULL,
      classId INT DEFAULT NULL,
      sectionId INT DEFAULT NULL,
      referenceId VARCHAR(100) DEFAULT NULL,
      eventId BIGINT UNSIGNED DEFAULT NULL,
      isRead TINYINT(1) NOT NULL DEFAULT 0,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      administrationId INT NOT NULL,
      PRIMARY KEY (id),
      KEY idx_notification_receiver
        (administrationId, receiverId, isRead, createdAt),
      KEY idx_notification_type
        (administrationId, notificationType, createdAt),
      KEY idx_notification_reference
        (administrationId, referenceId),
      KEY idx_notification_event
        (administrationId, eventId),
      UNIQUE KEY uk_notification_recipient_reference
        (administrationId, notificationType, referenceId, receiverId, receiverRole)
    )
  `);
  try {
    await query(
      "ALTER TABLE tbl_notification_center ADD COLUMN senderRole VARCHAR(30) DEFAULT NULL AFTER senderId"
    );
  } catch (_) {}
  try {
    await query(
      "ALTER TABLE tbl_notification_center ADD COLUMN eventId BIGINT UNSIGNED DEFAULT NULL AFTER referenceId"
    );
  } catch (_) {}
  tableReady = true;
};

const cleanType = (value) => {
  const requested = String(value || "Announcement").trim();
  const match = [...TYPES].find(
    (type) => type.toLowerCase() === requested.toLowerCase()
  );
  return match || "Announcement";
};

const normalizeReferenceId = (value) => {
  if (value == null || value === "") return "";
  return String(value).trim();
};

const dedupeNotificationRows = (rows = []) => {
  const seen = new Map();
  for (const row of rows) {
    const key = [
      row.notificationType,
      normalizeReferenceId(row.referenceId),
      row.title,
      row.message,
      row.receiverRole,
    ].join("|");
    const existing = seen.get(key);
    if (!existing || Number(row.id) > Number(existing.id)) {
      seen.set(key, row);
    }
  }
  return [...seen.values()].sort(
    (a, b) =>
      new Date(b.createdAt || 0).getTime() -
      new Date(a.createdAt || 0).getTime()
  );
};

const canonicalRole = (value) => {
  const role = String(value || "").trim().toLowerCase();
  if (role.includes("admin")) return "Admin";
  if (role.includes("staff") || role.includes("teacher")) return "Staff";
  if (role.includes("student")) return "Student";
  return String(value || "").trim();
};

const uniqueIds = (values) =>
  [...new Set((values || []).filter(Boolean).map((value) => String(value).trim()))]
    .filter(Boolean);

const rowIdentityValues = (row) =>
  uniqueIds([
    row?.userName,
    row?.userId,
    row?.admissionNo,
    row?.AdmissionNo,
    row?.registrationNo,
    row?.staffId,
    row?.staffID,
    row?.adminUserId,
    row?.adminId,
    row?.email,
    row?.emailId,
  ]);

/**
 * Resolve every identifier that can legitimately represent the logged-in
 * person. Older notification producers use profile IDs while newer ones use
 * the login userName, so retrieval must safely support both.
 */
const resolveNotificationIdentity = async (user = {}) => {
  const administrationId = Number(user.administrationId || 0);
  const receiverRole = canonicalRole(user.role);
  const tokenIds = uniqueIds([
    user.userName,
    user.admissionNo,
    user.AdmissionNo,
    user.registrationNo,
    user.staffId,
    user.adminUserId,
    user.emailId,
  ]);
  const receiverIds = new Set(tokenIds);

  if (!administrationId || !receiverRole || !tokenIds.length) {
    return { administrationId, receiverRole, receiverIds: tokenIds };
  }

  try {
    // Link a login name to its profile identifier (userId) when they differ.
    try {
      const loginRows = await query(
        "SELECT * FROM user WHERE administrationId = ? AND userName IN (?)",
        [administrationId, tokenIds]
      );
      loginRows.forEach((row) =>
        rowIdentityValues(row).forEach((id) => receiverIds.add(id))
      );
    } catch (error) {
      console.error(
        "[notification] login identity lookup failed:",
        error.message || error
      );
    }

    const lookupIds = [...receiverIds];
    let rows = [];
    if (receiverRole === "Student") {
      rows = await query(
        `SELECT * FROM student
          WHERE administrationId = ?
            AND (admissionNo IN (?) OR registrationNo IN (?))`,
        [administrationId, lookupIds, lookupIds]
      );
    } else if (receiverRole === "Staff") {
      rows = await query(
        "SELECT * FROM staff WHERE administrationId = ? AND staffId IN (?)",
        [administrationId, lookupIds]
      );
    } else if (receiverRole === "Admin") {
      const profiles = await query(
        "SELECT * FROM tbl_adminuser WHERE administrationId = ?",
        [administrationId]
      );
      const tokenIdSet = new Set(lookupIds.map((id) => id.toLowerCase()));
      rows = profiles.filter((row) =>
        rowIdentityValues(row).some((id) => tokenIdSet.has(id.toLowerCase()))
      );
      // Older admin notifications may have used the profile primary key.
      rows.forEach((row) => {
        if (row.id) receiverIds.add(String(row.id));
      });
    }
    rows.forEach((row) =>
      rowIdentityValues(row).forEach((id) => receiverIds.add(id))
    );
  } catch (error) {
    // Token identities are still valid if a profile table/column differs in
    // an older deployment.
    console.error(
      "[notification] identity alias lookup failed:",
      error.message || error
    );
  }

  const resolvedIds = [...receiverIds];
  return { administrationId, receiverRole, receiverIds: resolvedIds };
};

const createNotification = async ({
  title,
  message,
  notificationType = "Announcement",
  senderId = null,
  senderRole = null,
  receiverId,
  receiverRole,
  classId = null,
  sectionId = null,
  referenceId = null,
  eventId = null,
  administrationId,
}) => {
  const recipient = String(receiverId || "").trim();
  const role = String(receiverRole || "").trim();
  if (!recipient || !role || !administrationId || !message) {
    throw new Error("receiverId, receiverRole, administrationId and message are required");
  }

  await ensureTable();
  const result = await query(
    `INSERT INTO tbl_notification_center
      (title, message, notificationType, senderId, senderRole, receiverId, receiverRole,
       classId, sectionId, referenceId, eventId, administrationId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       message = VALUES(message),
       senderId = VALUES(senderId),
       senderRole = VALUES(senderRole),
       classId = VALUES(classId),
       sectionId = VALUES(sectionId),
       eventId = VALUES(eventId),
       isRead = 0,
       createdAt = CURRENT_TIMESTAMP`,
    [
      String(title || "Notification").trim(),
      String(message).trim(),
      cleanType(notificationType),
      senderId == null ? null : String(senderId),
      senderRole == null ? null : String(senderRole),
      recipient,
      role,
      classId ? Number(classId) : null,
      sectionId ? Number(sectionId) : null,
      normalizeReferenceId(referenceId),
      eventId == null ? null : Number(eventId),
      Number(administrationId),
    ]
  );
  return { id: result.insertId, receiverId: recipient };
};

const createNotifications = async (payload, recipients) => {
  const uniqueRecipients = [
    ...new Map(
      (recipients || [])
        .filter((item) => item?.receiverId && item?.receiverRole)
        .map((item) => [
          `${String(item.receiverRole).toLowerCase()}:${String(item.receiverId)}`,
          item,
        ])
    ).values(),
  ];
  if (!uniqueRecipients.length) return { created: 0 };

  await ensureTable();
  const values = uniqueRecipients.map((recipient) => [
    String(payload.title || "Notification").trim(),
    String(payload.message || "").trim(),
    cleanType(payload.notificationType),
    payload.senderId == null ? null : String(payload.senderId),
    payload.senderRole == null ? null : String(payload.senderRole),
    String(recipient.receiverId),
    String(recipient.receiverRole),
    recipient.classId || payload.classId
      ? Number(recipient.classId || payload.classId)
      : null,
    recipient.sectionId || payload.sectionId
      ? Number(recipient.sectionId || payload.sectionId)
      : null,
    normalizeReferenceId(payload.referenceId),
    payload.eventId == null ? null : Number(payload.eventId),
    Number(payload.administrationId),
  ]);

  const result = await query(
    `INSERT INTO tbl_notification_center
      (title, message, notificationType, senderId, senderRole, receiverId, receiverRole,
       classId, sectionId, referenceId, eventId, administrationId)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       message = VALUES(message),
       senderId = VALUES(senderId),
       senderRole = VALUES(senderRole),
       classId = VALUES(classId),
       sectionId = VALUES(sectionId),
       eventId = VALUES(eventId),
       isRead = 0,
       createdAt = CURRENT_TIMESTAMP`,
    [values]
  );
  return { created: result.affectedRows || uniqueRecipients.length };
};

const getStudents = async (administrationId, classId, sectionId) => {
  const where = ["administrationId = ?", "isActive = '1'"];
  const params = [Number(administrationId)];
  if (classId) {
    where.push("classId = ?");
    params.push(Number(classId));
  }
  if (sectionId) {
    where.push("sectionId = ?");
    params.push(Number(sectionId));
  }
  const rows = await query(
    `SELECT admissionNo AS receiverId, classId, sectionId
       FROM student WHERE ${where.join(" AND ")}`,
    params
  );
  return rows.map((row) => ({ ...row, receiverRole: "Student" }));
};

const getStaff = async (administrationId, department) => {
  const where = ["administrationId = ?", "isActive = '1'"];
  const params = [Number(administrationId)];
  if (department) {
    where.push("LOWER(TRIM(department)) = LOWER(TRIM(?))");
    params.push(String(department));
  }
  const rows = await query(
    `SELECT staffId AS receiverId FROM staff WHERE ${where.join(" AND ")}`,
    params
  );
  return rows.map((row) => ({ ...row, receiverRole: "Staff" }));
};

const getAdmins = async (administrationId) => {
  // Notifications are retrieved by matching receiverId against the login
  // userName in the JWT, so the login `user` table is the source of truth.
  // Different deployments name the role column userType or role.
  const loginQueries = [
    `SELECT userName FROM user
      WHERE administrationId = ? AND LOWER(TRIM(userType)) LIKE 'admin%'`,
    `SELECT userName FROM user
      WHERE administrationId = ? AND LOWER(TRIM(role)) LIKE 'admin%'`,
    `SELECT userName FROM user
      WHERE administrationId = ? AND LOWER(TRIM(userType)) IN ('admin', 'administrator', 'superadmin')`,
    `SELECT userName FROM \`user\`
      WHERE administrationId = ? AND (
        LOWER(TRIM(IFNULL(userType,''))) LIKE '%admin%'
        OR LOWER(TRIM(IFNULL(role,''))) LIKE '%admin%'
      )`,
  ];
  for (const sql of loginQueries) {
    try {
      const rows = await query(sql, [Number(administrationId)]);
      if (rows.length) {
        const admins = rows
          .filter((row) => row.userName)
          .map((row) => ({
            receiverId: String(row.userName),
            receiverRole: "Admin",
          }));
        console.log(
          `[notification] getAdmins via user table: ${admins
            .map((a) => a.receiverId)
            .join(", ")}`
        );
        return admins;
      }
    } catch (err) {
      console.error("[notification] getAdmins user-table lookup failed:", err.message);
    }
  }

  // Fallback: guess the login id from the admin profile table.
  let rows = [];
  try {
    rows = await query(
      "SELECT * FROM tbl_adminuser WHERE administrationId = ? AND isActive = '1'",
      [Number(administrationId)]
    );
  } catch (_) {
    try {
      rows = await query(
        "SELECT * FROM tbl_adminuser WHERE administrationId = ?",
        [Number(administrationId)]
      );
    } catch (err) {
      console.error("[notification] getAdmins tbl_adminuser lookup failed:", err.message);
    }
  }
  const admins = rows
    .map((row) => ({
      receiverId:
        row.admissionNo ||
        row.adminUserId ||
        row.userName ||
        row.adminId ||
        row.email ||
        row.id,
      receiverRole: "Admin",
    }))
    .filter((row) => row.receiverId)
    .map((row) => ({ ...row, receiverId: String(row.receiverId) }));
  console.log(
    `[notification] getAdmins via tbl_adminuser: ${admins
      .map((a) => a.receiverId)
      .join(", ") || "none found"}`
  );
  return admins;
};

const resolveRecipients = async ({
  audience,
  administrationId,
  classId,
  sectionId,
  department,
}) => {
  const target = String(audience || "").trim().toLowerCase().replace(/[\s_-]/g, "");
  if (["admin", "admins"].includes(target)) return getAdmins(administrationId);
  if (["staff", "staffonly", "allstaff"].includes(target)) {
    return getStaff(administrationId);
  }
  if (["student", "students", "studentsonly", "allstudents"].includes(target)) {
    return getStudents(administrationId);
  }
  if (["class", "selectedclass"].includes(target)) {
    if (!classId) throw new Error("classId is required for selected class");
    return getStudents(administrationId, classId, sectionId);
  }
  if (["department", "selecteddepartment"].includes(target)) {
    if (!department) throw new Error("department is required for selected department");
    return getStaff(administrationId, department);
  }
  if (["school", "allschool", "entireschool", "all"].includes(target)) {
    const [admins, staff, students] = await Promise.all([
      getAdmins(administrationId),
      getStaff(administrationId),
      getStudents(administrationId),
    ]);
    return [...admins, ...staff, ...students];
  }
  throw new Error("Unsupported notification audience");
};

const notifyAudience = async (payload) => {
  const recipients = await resolveRecipients(payload);
  return createNotifications(payload, recipients);
};

const listNotifications = async ({
  receiverId,
  receiverIds,
  receiverRole,
  administrationId,
  notificationType,
  unreadOnly = false,
  limit = 100,
}) => {
  await ensureTable();
  const ids = uniqueIds(receiverIds?.length ? receiverIds : [receiverId]);
  if (!ids.length) return [];
  const role = canonicalRole(receiverRole);
  const where = [
    "administrationId = ?",
    "receiverId IN (?)",
    "LOWER(receiverRole) = LOWER(?)",
  ];
  const params = [
    Number(administrationId),
    ids,
    role,
  ];
  if (notificationType && String(notificationType).toLowerCase() !== "all") {
    where.push("notificationType = ?");
    params.push(cleanType(notificationType));
  }
  if (unreadOnly) where.push("isRead = 0");
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 250));

  return dedupeNotificationRows(
    await query(
      `SELECT id, title, message, notificationType, senderId, senderRole, receiverId,
              receiverRole, classId, sectionId, referenceId, eventId, isRead, createdAt,
              administrationId
         FROM tbl_notification_center
        WHERE ${where.join(" AND ")}
        ORDER BY createdAt DESC, id DESC
        LIMIT ?`,
      params
    )
  );
};

const unreadCount = async (receiverIds, administrationId, receiverRole) => {
  await ensureTable();
  const ids = uniqueIds(Array.isArray(receiverIds) ? receiverIds : [receiverIds]);
  if (!ids.length) return 0;
  const rows = await query(
    `SELECT COUNT(*) AS count FROM tbl_notification_center
      WHERE administrationId = ? AND receiverId IN (?)
        AND LOWER(receiverRole) = LOWER(?) AND isRead = 0`,
    [Number(administrationId), ids, canonicalRole(receiverRole)]
  );
  return Number(rows?.[0]?.count || 0);
};

const markAsRead = async (id, receiverIds, administrationId, receiverRole) => {
  await ensureTable();
  const ids = uniqueIds(Array.isArray(receiverIds) ? receiverIds : [receiverIds]);
  if (!ids.length) return { found: false, affectedRows: 0 };

  // MySQL reports affectedRows = 0 for an UPDATE that changes nothing, so an
  // already-read notification would look like "not found". Check ownership
  // first and treat "already read" as success (idempotent endpoint).
  const rows = await query(
    `SELECT id, isRead FROM tbl_notification_center
      WHERE id = ? AND receiverId IN (?) AND administrationId = ?
        AND LOWER(receiverRole) = LOWER(?)
      LIMIT 1`,
    [Number(id), ids, Number(administrationId), canonicalRole(receiverRole)]
  );
  if (!rows.length) return { found: false, affectedRows: 0 };
  if (Number(rows[0].isRead) === 1) {
    return { found: true, affectedRows: 1, alreadyRead: true };
  }

  const result = await query(
    `UPDATE tbl_notification_center SET isRead = 1
      WHERE id = ? AND receiverId IN (?) AND administrationId = ?
        AND LOWER(receiverRole) = LOWER(?)`,
    [Number(id), ids, Number(administrationId), canonicalRole(receiverRole)]
  );
  return { found: true, affectedRows: result.affectedRows };
};

const markAllAsRead = async (receiverIds, administrationId, receiverRole) => {
  await ensureTable();
  const ids = uniqueIds(Array.isArray(receiverIds) ? receiverIds : [receiverIds]);
  if (!ids.length) return { affectedRows: 0 };
  return query(
    `UPDATE tbl_notification_center SET isRead = 1
      WHERE receiverId IN (?) AND administrationId = ?
        AND LOWER(receiverRole) = LOWER(?) AND isRead = 0`,
    [ids, Number(administrationId), canonicalRole(receiverRole)]
  );
};

const deleteNotification = async (id, receiverIds, administrationId, receiverRole) => {
  await ensureTable();
  const ids = uniqueIds(Array.isArray(receiverIds) ? receiverIds : [receiverIds]);
  if (!ids.length) return { affectedRows: 0 };
  return query(
    `DELETE FROM tbl_notification_center
      WHERE id = ? AND receiverId IN (?) AND administrationId = ?
        AND LOWER(receiverRole) = LOWER(?)`,
    [Number(id), ids, Number(administrationId), canonicalRole(receiverRole)]
  );
};

module.exports = {
  TYPES: [...TYPES],
  ensureTable,
  canonicalRole,
  resolveNotificationIdentity,
  createNotification,
  createNotifications,
  resolveRecipients,
  notifyAudience,
  listNotifications,
  unreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
