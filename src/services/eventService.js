const con = require("../config/dbConfig");
const notificationService = require("../services/notificationService");
const fs = require("fs");
const path = require("path");

const query = (sql, params = []) =>
  new Promise((resolve, reject) => {
    con.query(sql, params, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });

const ADMIN_EVENT_TYPES = [
  "School Event",
  "Holiday",
  "Sports",
  "Cultural",
  "Examination",
  "Parent Meeting",
  "Circular",
  "General Announcement",
];

const STAFF_EVENT_TYPES = [
  "Parent Meeting",
  "Class Announcement",
  "Homework Reminder",
  "Assignment Reminder",
  "Exam Reminder",
];

const AUDIENCE_TYPES = [
  "All Staff",
  "All Students",
  "All Staff & Students",
  "Selected Class",
  "Selected Section",
  "Multiple Classes",
  "Entire School",
  "Entire Class",
  "Selected Student",
  "Selected Students",
];

const PRIORITIES = ["High", "Medium", "Low"];
const STATUSES = ["Draft", "Published", "Unpublished"];

let tablesReady = false;
let eventColumnSet = null; // lowercased column names
let eventColumnMap = null; // lowercase -> actual COLUMN_NAME

const ensureColumn = async (table, column, definition) => {
  try {
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (_) {
    // Column already exists (or table missing - create runs separately).
  }
};

const relaxColumn = async (table, column, definition) => {
  try {
    await query(`ALTER TABLE ${table} MODIFY COLUMN \`${column}\` ${definition}`);
  } catch (_) {
    // Column missing or incompatible - ignore.
  }
};

const loadEventColumns = async ({ force = false } = {}) => {
  if (eventColumnSet && eventColumnMap && !force) {
    return { set: eventColumnSet, map: eventColumnMap };
  }
  try {
    // SHOW COLUMNS is more reliable than INFORMATION_SCHEMA across hosts.
    const rows = await query("SHOW COLUMNS FROM tbl_events");
    eventColumnSet = new Set();
    eventColumnMap = new Map();
    (rows || []).forEach((r) => {
      const actual = String(r.Field || r.field || r.COLUMN_NAME || "").trim();
      if (!actual) return;
      const key = actual.toLowerCase();
      eventColumnSet.add(key);
      eventColumnMap.set(key, actual);
    });
  } catch (err) {
    console.error("[events] SHOW COLUMNS failed:", err.sqlMessage || err.message);
    eventColumnSet = new Set();
    eventColumnMap = new Map();
  }
  return { set: eventColumnSet, map: eventColumnMap };
};

const resolveCol = (map, logicalName) =>
  map.get(String(logicalName).toLowerCase()) || null;

const buildLegacyMappedRow = (fields, colSet) => {
  const row = { ...fields };

  // Always mirror new fields onto legacy names when those columns exist.
  if (colSet.has("eventname") && row.title != null) row.eventName = row.title;
  if (colSet.has("eventtitle") && row.title != null) row.eventTitle = row.title;
  if (colSet.has("fromdate") && row.eventDate != null) row.fromDate = row.eventDate;
  if (colSet.has("todate") && row.eventDate != null) row.toDate = row.eventDate;
  if (colSet.has("content") && row.description != null) row.content = row.description;
  if (colSet.has("photourl") && row.attachmentUrl != null) row.photoUrl = row.attachmentUrl;

  // Hard requirement on older DBs - never leave eventName empty if column exists.
  if (colSet.has("eventname") && (row.eventName == null || row.eventName === "")) {
    row.eventName = row.title || row.eventTitle || "Event";
  }

  return row;
};

const insertEventRecord = async (fields) => {
  // Always populate legacy mirrors up front (do not depend on SHOW COLUMNS).
  const title = fields.title || fields.eventName || "Event";
  const row = {
    ...fields,
    title,
    eventName: title,
    eventTitle: title,
    fromDate: fields.eventDate || fields.fromDate || null,
    toDate: fields.eventDate || fields.toDate || fields.eventDate || null,
    content: fields.description != null ? fields.description : fields.content || "",
    photoUrl: fields.attachmentUrl || fields.photoUrl || null,
  };

  // Best-effort: make legacy NOT NULL columns nullable / defaulted before insert.
  await relaxColumn("tbl_events", "eventName", "VARCHAR(255) NULL DEFAULT NULL");
  await relaxColumn("tbl_events", "fromDate", "DATE NULL");
  await relaxColumn("tbl_events", "toDate", "DATE NULL");
  await relaxColumn("tbl_events", "content", "TEXT NULL");
  await relaxColumn("tbl_events", "photoUrl", "VARCHAR(500) NULL");

  const { set: colSet, map: colMap } = await loadEventColumns({ force: true });

  let useLogical = Object.keys(row).filter((key) => colSet.has(key.toLowerCase()));

  // FORCE eventName into the INSERT when the table has that column OR when
  // detection failed - missing eventName is the known production failure.
  const forceLegacy = ["eventName", "fromDate", "toDate", "content", "photoUrl"];
  forceLegacy.forEach((name) => {
    const exists = !colSet.size || colSet.has(name.toLowerCase());
    if (exists && !useLogical.some((k) => k.toLowerCase() === name.toLowerCase())) {
      useLogical.unshift(name);
      if (!colMap.has(name.toLowerCase())) colMap.set(name.toLowerCase(), name);
    }
  });

  // If detection returned nothing, insert a fixed legacy-compatible row.
  if (!colSet.size) {
    useLogical = [
      "eventName",
      "title",
      "eventType",
      "description",
      "content",
      "eventDate",
      "fromDate",
      "toDate",
      "eventTime",
      "venue",
      "attachmentUrl",
      "photoUrl",
      "priority",
      "audienceType",
      "status",
      "createdBy",
      "createdByRole",
      "administrationId",
      "publishedAt",
      "publishedBy",
      "classId",
      "sectionId",
      "isDeleted",
    ];
    useLogical.forEach((n) => colMap.set(n.toLowerCase(), n));
  }

  if (!useLogical.length) {
    throw new Error("tbl_events has no compatible columns to insert");
  }

  const useActual = useLogical.map((key) => resolveCol(colMap, key) || key);
  const sql = `INSERT INTO tbl_events (${useActual
    .map((c) => `\`${c}\``)
    .join(", ")}) VALUES (${useActual.map(() => "?").join(", ")})`;
  const params = useLogical.map((key) => row[key]);

  console.log("[events] insert columns:", useActual.join(", "));

  try {
    return await query(sql, params);
  } catch (err) {
    const msg = String(err.sqlMessage || err.message || "");
    console.error("[events] insert failed:", msg);

    // Drop unknown columns and retry (e.g. title missing on pure-legacy table).
    if (/unknown column/i.test(msg)) {
      const unknown = msg.match(/unknown column ['`]([^'`]+)['`]/i);
      const bad = unknown ? unknown[1].toLowerCase() : null;
      if (bad) {
        useLogical = useLogical.filter((k) => k.toLowerCase() !== bad);
        const actual2 = useLogical.map((key) => resolveCol(colMap, key) || key);
        return query(
          `INSERT INTO tbl_events (${actual2.map((c) => `\`${c}\``).join(", ")}) VALUES (${actual2
            .map(() => "?")
            .join(", ")})`,
          useLogical.map((key) => row[key])
        );
      }
    }

    // Still missing default - run ALTER again and retry with eventName first.
    if (/doesn't have a default value|cannot be null/i.test(msg)) {
      await query(
        "ALTER TABLE tbl_events MODIFY COLUMN `eventName` VARCHAR(255) NULL DEFAULT ''"
      ).catch(() => {});
      // Ensure eventName is the first inserted column.
      useLogical = [
        "eventName",
        ...useLogical.filter((k) => k.toLowerCase() !== "eventname"),
      ];
      row.eventName = title;
      const actual3 = useLogical.map((key) => resolveCol(colMap, key) || key);
      return query(
        `INSERT INTO tbl_events (${actual3.map((c) => `\`${c}\``).join(", ")}) VALUES (${actual3
          .map(() => "?")
          .join(", ")})`,
        useLogical.map((key) => row[key])
      );
    }
    throw err;
  }
};

const updateEventRecord = async (id, administrationId, fields) => {
  const { set: colSet, map: colMap } = await loadEventColumns({ force: true });
  const row = buildLegacyMappedRow(fields, colSet);

  const useLogical = Object.keys(row).filter(
    (key) => key !== "id" && colSet.has(key.toLowerCase())
  );
  if (!useLogical.length) {
    throw new Error("tbl_events has no compatible columns to update");
  }
  const useActual = useLogical.map((key) => resolveCol(colMap, key));
  const sets = useActual.map((c) => `\`${c}\` = ?`).join(", ");
  const where = colSet.has("isdeleted")
    ? "WHERE id = ? AND administrationId = ? AND IFNULL(`isDeleted`, 0) = 0"
    : "WHERE id = ? AND administrationId = ?";
  await query(`UPDATE tbl_events SET ${sets} ${where}`, [
    ...useLogical.map((key) => row[key]),
    Number(id),
    Number(administrationId),
  ]);
};

const SCHEMA_VERSION = 3; // bump to force re-migrate after legacy fixes
let appliedSchemaVersion = 0;

const ensureTables = async () => {
  if (tablesReady && appliedSchemaVersion >= SCHEMA_VERSION) return;

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS tbl_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        eventType VARCHAR(80) NOT NULL DEFAULT 'General Announcement',
        description TEXT NULL,
        eventDate DATE NOT NULL,
        eventTime VARCHAR(20) DEFAULT NULL,
        venue VARCHAR(255) DEFAULT NULL,
        attachmentUrl VARCHAR(500) DEFAULT NULL,
        priority VARCHAR(20) NOT NULL DEFAULT 'Medium',
        audienceType VARCHAR(50) NOT NULL DEFAULT 'Entire School',
        status VARCHAR(20) NOT NULL DEFAULT 'Draft',
        createdBy VARCHAR(100) NOT NULL,
        createdByRole VARCHAR(30) NOT NULL,
        publishedAt DATETIME NULL DEFAULT NULL,
        publishedBy VARCHAR(100) DEFAULT NULL,
        administrationId INT NOT NULL,
        isDeleted TINYINT(1) NOT NULL DEFAULT 0,
        deletedAt DATETIME NULL DEFAULT NULL,
        deletedBy VARCHAR(100) DEFAULT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_events_admin_status (administrationId, status, isDeleted, eventDate),
        KEY idx_events_creator (administrationId, createdBy, createdByRole),
        KEY idx_events_type (administrationId, eventType, eventDate)
      )
    `);
  } catch (error) {
    console.error("[events] create tbl_events:", error.sqlMessage || error.message);
  }

  // Migrate older/partial tbl_events schemas so INSERT does not fail.
  await ensureColumn("tbl_events", "title", "VARCHAR(255) NULL");
  await ensureColumn("tbl_events", "eventType", "VARCHAR(80) NULL DEFAULT 'General Announcement'");
  await ensureColumn("tbl_events", "description", "TEXT NULL");
  await ensureColumn("tbl_events", "eventDate", "DATE NULL");
  await ensureColumn("tbl_events", "eventTime", "VARCHAR(20) DEFAULT NULL");
  await ensureColumn("tbl_events", "venue", "VARCHAR(255) DEFAULT NULL");
  await ensureColumn("tbl_events", "attachmentUrl", "VARCHAR(500) DEFAULT NULL");
  await ensureColumn("tbl_events", "priority", "VARCHAR(20) NULL DEFAULT 'Medium'");
  await ensureColumn("tbl_events", "audienceType", "VARCHAR(50) NULL DEFAULT 'Entire School'");
  await ensureColumn("tbl_events", "status", "VARCHAR(20) NULL DEFAULT 'Draft'");
  await ensureColumn("tbl_events", "createdBy", "VARCHAR(100) NULL");
  await ensureColumn("tbl_events", "createdByRole", "VARCHAR(30) NULL");
  await ensureColumn("tbl_events", "publishedAt", "DATETIME NULL DEFAULT NULL");
  await ensureColumn("tbl_events", "publishedBy", "VARCHAR(100) DEFAULT NULL");
  await ensureColumn("tbl_events", "administrationId", "INT NULL");
  await ensureColumn("tbl_events", "isDeleted", "TINYINT(1) NOT NULL DEFAULT 0");
  await ensureColumn("tbl_events", "deletedAt", "DATETIME NULL DEFAULT NULL");
  await ensureColumn("tbl_events", "deletedBy", "VARCHAR(100) DEFAULT NULL");
  await ensureColumn("tbl_events", "createdAt", "DATETIME NULL");
  await ensureColumn("tbl_events", "updatedAt", "DATETIME NULL");

  // Legacy NOT NULL columns without defaults (old SP schema).
  await relaxColumn("tbl_events", "eventName", "VARCHAR(255) NULL DEFAULT NULL");
  await relaxColumn("tbl_events", "eventTitle", "VARCHAR(255) NULL DEFAULT NULL");
  await relaxColumn("tbl_events", "fromDate", "DATE NULL");
  await relaxColumn("tbl_events", "toDate", "DATE NULL");
  await relaxColumn("tbl_events", "content", "TEXT NULL");
  await relaxColumn("tbl_events", "photoUrl", "VARCHAR(500) NULL");
  await relaxColumn("tbl_events", "classId", "INT NULL");
  await relaxColumn("tbl_events", "sectionId", "INT NULL");

  await loadEventColumns({ force: true });

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS tbl_event_targets (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        eventId BIGINT UNSIGNED NOT NULL,
        targetType VARCHAR(40) NOT NULL,
        classId INT DEFAULT NULL,
        sectionId INT DEFAULT NULL,
        studentId VARCHAR(100) DEFAULT NULL,
        administrationId INT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_event_targets_event (eventId, administrationId),
        KEY idx_event_targets_class (administrationId, classId, sectionId),
        KEY idx_event_targets_student (administrationId, studentId)
      )
    `);
  } catch (error) {
    console.error("[events] create tbl_event_targets:", error.sqlMessage || error.message);
  }

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS tbl_event_history (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        eventId BIGINT UNSIGNED NOT NULL,
        action VARCHAR(40) NOT NULL,
        actorId VARCHAR(100) NOT NULL,
        actorRole VARCHAR(30) NOT NULL,
        snapshotJson LONGTEXT NULL,
        administrationId INT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_event_history_event (eventId, createdAt)
      )
    `);
  } catch (error) {
    console.error("[events] create tbl_event_history:", error.sqlMessage || error.message);
  }
  await ensureColumn("tbl_event_history", "snapshotJson", "LONGTEXT NULL");

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
  try {
    await query(
      "ALTER TABLE tbl_notification_center ADD KEY idx_notification_event (administrationId, eventId)"
    );
  } catch (_) {}

  tablesReady = true;
  appliedSchemaVersion = SCHEMA_VERSION;
};

const cleanPriority = (value) => {
  const match = PRIORITIES.find(
    (item) => item.toLowerCase() === String(value || "").trim().toLowerCase()
  );
  return match || "Medium";
};

const cleanStatus = (value) => {
  const match = STATUSES.find(
    (item) => item.toLowerCase() === String(value || "").trim().toLowerCase()
  );
  return match || "Draft";
};

const mapNotificationType = (eventType) => {
  const type = String(eventType || "").trim().toLowerCase();
  if (type.includes("parent meeting")) return "Parent Meeting";
  if (type.includes("holiday")) return "Holiday";
  if (type.includes("circular")) return "Circular";
  if (type.includes("exam")) return "Examination";
  if (
    type.includes("announcement") ||
    type.includes("homework") ||
    type.includes("assignment")
  ) {
    return "Announcement";
  }
  return "Event";
};

const normalizeIdList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter((item) => item && item !== "0" && item.toLowerCase() !== "null");
  }
  if (value == null || value === "") return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item !== "0");
};

const resolveClassIds = (payload = {}) => {
  let classIds = normalizeIdList(payload.classIds);
  if (!classIds.length) {
    classIds = normalizeIdList(payload.classId);
  }
  // Also accept common alternate keys from API clients.
  if (!classIds.length) {
    classIds = normalizeIdList(payload.class_ids || payload.ClassId || payload.ClassIds);
  }
  return classIds;
};

const parseTargets = (payload = {}) => {
  let targets = payload.targets;
  if (typeof targets === "string") {
    try {
      targets = JSON.parse(targets);
    } catch (_) {
      targets = [];
    }
  }
  if (!Array.isArray(targets)) targets = [];

  const audienceType = String(payload.audienceType || "").trim();
  if (!targets.length) {
    if (["All Staff", "All Students", "All Staff & Students", "Entire School"].includes(audienceType)) {
      targets = [{ targetType: audienceType }];
    } else if (audienceType === "Selected Class" || audienceType === "Entire Class") {
      // Prefer classIds when provided, otherwise fall back to single classId.
      // Important: empty classIds [] must NOT block classId.
      const classIds = resolveClassIds(payload);
      targets = classIds.map((classId) => ({
        targetType: audienceType,
        classId: Number(classId),
        sectionId: payload.sectionId ? Number(payload.sectionId) : null,
      }));
    } else if (audienceType === "Selected Section") {
      const classId = resolveClassIds(payload)[0] || payload.classId || null;
      targets = [
        {
          targetType: audienceType,
          classId: classId ? Number(classId) : null,
          sectionId: payload.sectionId ? Number(payload.sectionId) : null,
        },
      ];
    } else if (audienceType === "Multiple Classes") {
      const classIds = resolveClassIds(payload);
      targets = classIds.map((classId) => ({
        targetType: "Multiple Classes",
        classId: Number(classId),
      }));
    } else if (
      audienceType === "Selected Student" ||
      audienceType === "Selected Students"
    ) {
      const studentIds = normalizeIdList(payload.studentIds);
      const classId = resolveClassIds(payload)[0] || payload.classId || null;
      targets = studentIds.map((studentId) => ({
        targetType: "Selected Student",
        studentId: String(studentId),
        classId: classId ? Number(classId) : null,
        sectionId: payload.sectionId ? Number(payload.sectionId) : null,
      }));
    }
  }

  return targets
    .map((item) => ({
      targetType: String(item.targetType || audienceType || "").trim(),
      classId: item.classId && Number(item.classId) > 0 ? Number(item.classId) : null,
      sectionId: item.sectionId && Number(item.sectionId) > 0 ? Number(item.sectionId) : null,
      studentId: item.studentId ? String(item.studentId).trim() : null,
    }))
    .filter((item) => {
      if (!item.targetType) return false;
      if (
        ["Selected Class", "Entire Class", "Multiple Classes"].includes(item.targetType)
      ) {
        return Boolean(item.classId);
      }
      if (item.targetType === "Selected Section") {
        return Boolean(item.classId && item.sectionId);
      }
      if (
        item.targetType === "Selected Student" ||
        item.targetType === "Selected Students"
      ) {
        return Boolean(item.studentId);
      }
      return true;
    });
};

const writeHistory = async ({
  eventId,
  action,
  actorId,
  actorRole,
  snapshot,
  administrationId,
}) => {
  try {
    await query(
      `INSERT INTO tbl_event_history
        (eventId, action, actorId, actorRole, snapshotJson, administrationId)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        Number(eventId),
        String(action),
        String(actorId),
        String(actorRole),
        snapshot ? JSON.stringify(snapshot) : null,
        Number(administrationId),
      ]
    );
  } catch (error) {
    console.error(
      "[events] history write failed:",
      error.sqlMessage || error.message || error
    );
  }
};

const replaceTargets = async (eventId, administrationId, targets) => {
  await query(
    "DELETE FROM tbl_event_targets WHERE eventId = ? AND administrationId = ?",
    [Number(eventId), Number(administrationId)]
  );
  if (!targets.length) return;
  const values = targets.map((item) => [
    Number(eventId),
    item.targetType,
    item.classId,
    item.sectionId,
    item.studentId,
    Number(administrationId),
  ]);
  await query(
    `INSERT INTO tbl_event_targets
      (eventId, targetType, classId, sectionId, studentId, administrationId)
     VALUES ?`,
    [values]
  );
};

const getTargets = async (eventId, administrationId) =>
  query(
    `SELECT id, eventId, targetType, classId, sectionId, studentId, administrationId
       FROM tbl_event_targets
      WHERE eventId = ? AND administrationId = ?
      ORDER BY id ASC`,
    [Number(eventId), Number(administrationId)]
  );

const getEventById = async (id, administrationId, { includeDeleted = false } = {}) => {
  await ensureTables();
  const where = ["id = ?", "administrationId = ?"];
  const params = [Number(id), Number(administrationId)];
  if (!includeDeleted) where.push("isDeleted = 0");
  const rows = await query(
    `SELECT * FROM tbl_events WHERE ${where.join(" AND ")} LIMIT 1`,
    params
  );
  if (!rows.length) return null;
  const event = rows[0];
  if (!event.title && (event.eventName || event.eventTitle)) {
    event.title = event.eventName || event.eventTitle;
  }
  if (!event.eventDate && event.fromDate) {
    event.eventDate = event.fromDate;
  }
  if (!event.description && event.content) {
    event.description = event.content;
  }
  if (!event.attachmentUrl && event.photoUrl) {
    event.attachmentUrl = event.photoUrl;
  }
  event.targets = await getTargets(id, administrationId);
  return event;
};

const assertStaffOwnership = (event, user) => {
  const role = notificationService.canonicalRole(user.role);
  if (role !== "Staff") return;
  if (String(event.createdBy) !== String(user.userName)) {
    throw new Error("You can only manage events you created");
  }
};

const validatePayload = (payload, user) => {
  const role = notificationService.canonicalRole(user.role);
  const title = String(payload.title || payload.eventName || "").trim();
  const eventType = String(payload.eventType || "").trim();
  const eventDate = payload.eventDate || payload.fromDate || payload.date;
  const audienceType = String(payload.audienceType || "").trim();
  const priority = cleanPriority(payload.priority);

  if (!title) throw new Error("Event title is required");
  if (!eventDate) throw new Error("Event date is required");
  if (!audienceType || !AUDIENCE_TYPES.includes(audienceType)) {
    throw new Error("Valid audience type is required");
  }

  if (role === "Admin") {
    if (!ADMIN_EVENT_TYPES.includes(eventType)) {
      throw new Error("Invalid admin event type");
    }
  } else if (role === "Staff") {
    if (!STAFF_EVENT_TYPES.includes(eventType)) {
      throw new Error("Invalid staff event type");
    }
    const allowedAudiences = [
      "Entire Class",
      "Selected Section",
      "Selected Student",
      "Selected Students",
    ];
    if (!allowedAudiences.includes(audienceType)) {
      throw new Error("Staff audience must be Entire Class, Selected Section, or Selected Student(s)");
    }
  } else {
    throw new Error("Only Admin or Staff can create events");
  }

  const targets = parseTargets({ ...payload, audienceType });
  if (!targets.length) {
    if (["Selected Class", "Entire Class"].includes(audienceType)) {
      throw new Error("Please select a class for this audience");
    }
    if (audienceType === "Selected Section") {
      throw new Error("Please select class and section for this audience");
    }
    if (audienceType === "Multiple Classes") {
      throw new Error("Please select at least one class");
    }
    if (["Selected Student", "Selected Students"].includes(audienceType)) {
      throw new Error("Please select at least one student");
    }
    throw new Error("At least one audience target is required");
  }

  if (
    ["Selected Class", "Entire Class", "Multiple Classes"].includes(audienceType) &&
    targets.every((t) => !t.classId)
  ) {
    throw new Error("Please select a valid class for this audience");
  }
  if (
    audienceType === "Selected Section" &&
    targets.some((t) => !t.classId || !t.sectionId)
  ) {
    throw new Error("Please select both class and section");
  }
  if (
    ["Selected Student", "Selected Students"].includes(audienceType) &&
    targets.every((t) => !t.studentId)
  ) {
    throw new Error("Please select at least one student");
  }

  return {
    title,
    eventType,
    description: String(payload.description || payload.content || "").trim(),
    eventDate,
    eventTime: payload.eventTime || payload.startTime || null,
    venue: payload.venue ? String(payload.venue).trim() : null,
    attachmentUrl: payload.attachmentUrl || payload.photoUrl || null,
    priority,
    audienceType,
    targets,
  };
};

const createEvent = async (payload, user) => {
  await ensureTables();
  const data = validatePayload(payload, user);
  const role = notificationService.canonicalRole(user.role);
  // Create is always Draft. Publish is a separate explicit step (avoids double notify).
  const status = "Draft";

  // Guard against accidental duplicate posts within a short window.
  try {
    const recent = await query(
      `SELECT id FROM tbl_events
        WHERE administrationId = ? AND createdBy = ? AND isDeleted = 0
          AND title = ? AND eventDate = ?
          AND createdAt >= (NOW() - INTERVAL 8 SECOND)
        ORDER BY id DESC LIMIT 1`,
      [
        Number(user.administrationId),
        String(user.userName),
        data.title,
        data.eventDate,
      ]
    );
    if (recent?.length) {
      const existing = await getEventById(recent[0].id, user.administrationId);
      if (existing) return existing;
    }
  } catch (_) {
    /* createdAt may be missing on legacy tables - ignore dedupe */
  }

  const firstTarget = data.targets[0] || {};
  const result = await insertEventRecord({
    title: data.title,
    eventType: data.eventType,
    description: data.description,
    eventDate: data.eventDate,
    eventTime: data.eventTime,
    venue: data.venue,
    attachmentUrl: data.attachmentUrl,
    priority: data.priority,
    audienceType: data.audienceType,
    status,
    createdBy: String(user.userName),
    createdByRole: role,
    administrationId: Number(user.administrationId),
    publishedAt: null,
    publishedBy: null,
    classId: firstTarget.classId || null,
    sectionId: firstTarget.sectionId || null,
    isDeleted: 0,
  });

  const eventId = result.insertId;
  await replaceTargets(eventId, user.administrationId, data.targets);
  const event = await getEventById(eventId, user.administrationId);
  await writeHistory({
    eventId,
    action: "created",
    actorId: user.userName,
    actorRole: role,
    snapshot: event,
    administrationId: user.administrationId,
  });

  return event;
};

const updateEvent = async (id, payload, user) => {
  await ensureTables();
  const existing = await getEventById(id, user.administrationId);
  if (!existing) throw new Error("Event not found");
  assertStaffOwnership(existing, user);

  const data = validatePayload({ ...existing, ...payload }, user);
  const keepStatus = cleanStatus(payload.status || existing.status);
  const firstTarget = data.targets[0] || {};

  await updateEventRecord(id, user.administrationId, {
    title: data.title,
    eventType: data.eventType,
    description: data.description,
    eventDate: data.eventDate,
    eventTime: data.eventTime,
    venue: data.venue,
    attachmentUrl: data.attachmentUrl,
    priority: data.priority,
    audienceType: data.audienceType,
    status: keepStatus === "Published" ? existing.status : keepStatus,
    classId: firstTarget.classId || null,
    sectionId: firstTarget.sectionId || null,
    updatedAt: new Date(),
  });

  await replaceTargets(id, user.administrationId, data.targets);
  const event = await getEventById(id, user.administrationId);
  await writeHistory({
    eventId: id,
    action: "updated",
    actorId: user.userName,
    actorRole: notificationService.canonicalRole(user.role),
    snapshot: event,
    administrationId: user.administrationId,
  });
  return event;
};

const softDeleteEvent = async (id, user) => {
  await ensureTables();
  const existing = await getEventById(id, user.administrationId);
  if (!existing) throw new Error("Event not found");
  assertStaffOwnership(existing, user);

  await query(
    `UPDATE tbl_events
        SET isDeleted = 1, deletedAt = CURRENT_TIMESTAMP, deletedBy = ?, status = 'Unpublished'
      WHERE id = ? AND administrationId = ?`,
    [String(user.userName), Number(id), Number(user.administrationId)]
  );
  await writeHistory({
    eventId: id,
    action: "deleted",
    actorId: user.userName,
    actorRole: notificationService.canonicalRole(user.role),
    snapshot: existing,
    administrationId: user.administrationId,
  });
  return { id: Number(id) };
};

const SCHOOL_WIDE_AUDIENCES = new Set([
  "Entire School",
  "All Staff & Students",
  "All Staff",
  "All Students",
]);

const resolveEventRecipients = async (
  event,
  targets,
  administrationId,
  publisher = null
) => {
  const recipients = [];
  for (const target of targets) {
    const type = String(target.targetType || "").trim();
    if (type === "All Staff") {
      recipients.push(
        ...(await notificationService.resolveRecipients({
          audience: "All Staff",
          administrationId,
        }))
      );
    } else if (type === "All Students") {
      recipients.push(
        ...(await notificationService.resolveRecipients({
          audience: "All Students",
          administrationId,
        }))
      );
    } else if (type === "All Staff & Students" || type === "Entire School") {
      recipients.push(
        ...(await notificationService.resolveRecipients({
          audience: "Entire School",
          administrationId,
        }))
      );
    } else if (
      type === "Selected Class" ||
      type === "Entire Class" ||
      type === "Multiple Classes"
    ) {
      if (!target.classId) continue;
      recipients.push(
        ...(await notificationService.resolveRecipients({
          audience: "Selected Class",
          administrationId,
          classId: target.classId,
          sectionId: target.sectionId || null,
        }))
      );
    } else if (type === "Selected Section") {
      if (!target.classId || !target.sectionId) continue;
      recipients.push(
        ...(await notificationService.resolveRecipients({
          audience: "Selected Class",
          administrationId,
          classId: target.classId,
          sectionId: target.sectionId,
        }))
      );
    } else if (type === "Selected Student" || type === "Selected Students") {
      if (!target.studentId) continue;
      recipients.push({
        receiverId: String(target.studentId),
        receiverRole: "Student",
        classId: target.classId || null,
        sectionId: target.sectionId || null,
      });
    }
  }

  const audienceType = String(event?.audienceType || "").trim();
  const isSchoolWide =
    SCHOOL_WIDE_AUDIENCES.has(audienceType) ||
    (targets || []).some((t) => SCHOOL_WIDE_AUDIENCES.has(String(t.targetType || "").trim()));

  // School-wide announcements must reach every admin, including the publisher.
  if (isSchoolWide) {
    try {
      recipients.push(
        ...(await notificationService.resolveRecipients({
          audience: "Admin",
          administrationId,
        }))
      );
    } catch (err) {
      console.error("[events] admin recipient resolve failed:", err.message || err);
    }
  }

  const publisherRole = notificationService.canonicalRole(publisher?.role);
  // Publisher also receives the school-wide announcement in their notification center.
  if (publisher?.userName && isSchoolWide) {
    recipients.push({
      receiverId: String(publisher.userName),
      receiverRole: publisherRole === "Staff" ? "Staff" : "Admin",
    });
  }

  const unique = [
    ...new Map(
      recipients
        .filter((item) => item?.receiverId && item?.receiverRole)
        .map((item) => [
          `${String(item.receiverRole).toLowerCase()}:${String(item.receiverId)}`,
          item,
        ])
    ).values(),
  ];
  return unique;
};

const publishEvent = async (
  id,
  user,
  { alreadyPublished = false, skipStatusUpdate = false } = {}
) => {
  await ensureTables();
  const event = await getEventById(id, user.administrationId);
  if (!event) throw new Error("Event not found");
  assertStaffOwnership(event, user);

  // Idempotent: already published → do not insert/notify again.
  if (String(event.status) === "Published" && !skipStatusUpdate && !alreadyPublished) {
    return {
      event,
      recipients: 0,
      notifications: { created: 0, skipped: true },
    };
  }

  if (!skipStatusUpdate) {
    await query(
      `UPDATE tbl_events
          SET status = 'Published', publishedAt = CURRENT_TIMESTAMP, publishedBy = ?
        WHERE id = ? AND administrationId = ? AND isDeleted = 0`,
      [String(user.userName), Number(id), Number(user.administrationId)]
    );
  }

  const targets = event.targets || [];
  const recipients = await resolveEventRecipients(
    event,
    targets,
    user.administrationId,
    user
  );

  console.log(
    `[events] publish #${id} recipients=${recipients.length} ` +
      `admins=${recipients.filter((r) => String(r.receiverRole).toLowerCase() === "admin").length} ` +
      `publisher=${user.userName || "?"}`
  );

  const notificationType = mapNotificationType(event.eventType);
  const message =
    event.description ||
    `${event.title} on ${event.eventDate}${
      event.eventTime ? ` at ${event.eventTime}` : ""
    }${event.venue ? ` (${event.venue})` : ""}`;

  let notifyResult = { created: 0 };
  try {
    notifyResult = await notificationService.createNotifications(
      {
        title: event.title,
        message,
        notificationType,
        senderId: user.userName,
        senderRole: notificationService.canonicalRole(user.role),
        referenceId: String(id),
        eventId: Number(id),
        administrationId: user.administrationId,
        classId: targets[0]?.classId || null,
        sectionId: targets[0]?.sectionId || null,
      },
      recipients
    );
  } catch (error) {
    console.error(
      "[events] notification publish failed:",
      error.message || error
    );
  }

  const published = await getEventById(id, user.administrationId);
  if (!alreadyPublished) {
    await writeHistory({
      eventId: id,
      action: "published",
      actorId: user.userName,
      actorRole: notificationService.canonicalRole(user.role),
      snapshot: { ...published, recipients: recipients.length, notifyResult },
      administrationId: user.administrationId,
    });
  }

  return {
    event: published,
    recipients: recipients.length,
    notifications: notifyResult,
  };
};

const unpublishEvent = async (id, user) => {
  await ensureTables();
  const event = await getEventById(id, user.administrationId);
  if (!event) throw new Error("Event not found");
  assertStaffOwnership(event, user);

  await query(
    `UPDATE tbl_events
        SET status = 'Unpublished'
      WHERE id = ? AND administrationId = ? AND isDeleted = 0`,
    [Number(id), Number(user.administrationId)]
  );

  const updated = await getEventById(id, user.administrationId);
  await writeHistory({
    eventId: id,
    action: "unpublished",
    actorId: user.userName,
    actorRole: notificationService.canonicalRole(user.role),
    snapshot: updated,
    administrationId: user.administrationId,
  });
  return updated;
};

const listEvents = async (user, filters = {}) => {
  await ensureTables();
  const role = notificationService.canonicalRole(user.role);
  const administrationId = Number(user.administrationId);
  const where = ["e.administrationId = ?", "e.isDeleted = 0"];
  const params = [administrationId];

  if (filters.status && String(filters.status).toLowerCase() !== "all") {
    where.push("e.status = ?");
    params.push(cleanStatus(filters.status));
  }
  if (filters.eventType && String(filters.eventType).toLowerCase() !== "all") {
    where.push("e.eventType = ?");
    params.push(String(filters.eventType));
  }
  if (filters.title) {
    where.push("e.title LIKE ?");
    params.push(`%${String(filters.title).trim()}%`);
  }
  if (filters.date) {
    where.push("e.eventDate = ?");
    params.push(String(filters.date));
  }
  if (filters.fromDate) {
    where.push("e.eventDate >= ?");
    params.push(String(filters.fromDate));
  }
  if (filters.toDate) {
    where.push("e.eventDate <= ?");
    params.push(String(filters.toDate));
  }
  if (filters.classId) {
    where.push(
      `EXISTS (
         SELECT 1 FROM tbl_event_targets t
          WHERE t.eventId = e.id AND t.administrationId = e.administrationId
            AND t.classId = ?
       )`
    );
    params.push(Number(filters.classId));
  }
  if (filters.sectionId) {
    where.push(
      `EXISTS (
         SELECT 1 FROM tbl_event_targets t
          WHERE t.eventId = e.id AND t.administrationId = e.administrationId
            AND t.sectionId = ?
       )`
    );
    params.push(Number(filters.sectionId));
  }

  if (role === "Staff") {
    // Staff see school-wide published events plus their own creations.
    where.push(
      `((e.createdBy = ? AND e.createdByRole = 'Staff') OR (e.status = 'Published' AND e.createdByRole = 'Admin'))`
    );
    params.push(String(user.userName));
  } else if (role === "Student") {
    where.push("e.status = 'Published'");
    const identity = await notificationService.resolveNotificationIdentity(user);
    const studentIds = identity.receiverIds.length
      ? identity.receiverIds
      : [user.userName, user.admissionNo].filter(Boolean);
    const classId = Number(user.classId || 0) || null;
    const sectionId = Number(user.sectionId || 0) || null;

    // Prefer live class/section when available.
    let liveClassId = classId;
    let liveSectionId = sectionId;
    try {
      const { getStudentClassSection } = require("../models/studentInfo");
      const live = await getStudentClassSection(
        user.userName,
        administrationId
      );
      if (live) {
        liveClassId = live.classId;
        liveSectionId = live.sectionId;
      }
    } catch (_) {}

    const studentPlaceholders = studentIds.length
      ? studentIds.map(() => "?").join(",")
      : "'__none__'";
    where.push(`(
      EXISTS (
        SELECT 1 FROM tbl_event_targets t
         WHERE t.eventId = e.id AND t.administrationId = e.administrationId
           AND (
             t.targetType IN ('All Students', 'All Staff & Students', 'Entire School')
             OR (t.targetType IN ('Selected Class', 'Entire Class', 'Multiple Classes') AND t.classId = ?)
             OR (t.targetType = 'Selected Section' AND t.classId = ? AND t.sectionId = ?)
             OR (
               t.targetType IN ('Selected Student', 'Selected Students')
               AND t.studentId IN (${studentPlaceholders})
             )
           )
      )
    )`);
    params.push(
      Number(liveClassId || 0),
      Number(liveClassId || 0),
      Number(liveSectionId || 0)
    );
    if (studentIds.length) {
      params.push(...studentIds.map(String));
    }
  }

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 250);
  params.push(limit);

  const rows = await query(
    `SELECT e.*
       FROM tbl_events e
      WHERE ${where.join(" AND ")}
      ORDER BY e.createdAt DESC, e.id DESC
      LIMIT ?`,
    params
  );

  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const targets = await query(
    `SELECT * FROM tbl_event_targets
      WHERE administrationId = ? AND eventId IN (?)
      ORDER BY id ASC`,
    [administrationId, ids]
  );
  const targetMap = new Map();
  targets.forEach((item) => {
    if (!targetMap.has(item.eventId)) targetMap.set(item.eventId, []);
    targetMap.get(item.eventId).push(item);
  });

  // Attach read status for student notification linkage when possible.
  let readMap = new Map();
  if (role === "Student") {
    try {
      const identity = await notificationService.resolveNotificationIdentity(user);
      if (identity.receiverIds.length) {
        const notes = await query(
          `SELECT referenceId, isRead
             FROM tbl_notification_center
            WHERE administrationId = ?
              AND receiverId IN (?)
              AND LOWER(receiverRole) = 'student'
              AND referenceId IN (?)`,
          [
            administrationId,
            identity.receiverIds,
            ids.map(String),
          ]
        );
        readMap = new Map(
          notes.map((item) => [String(item.referenceId), Number(item.isRead)])
        );
      }
    } catch (_) {}
  }

  return rows.map((row) => ({
    ...row,
    targets: targetMap.get(row.id) || [],
    isRead: readMap.has(String(row.id)) ? readMap.get(String(row.id)) : null,
    postedBy: row.createdBy,
  }));
};

const getHistory = async (eventId, administrationId) => {
  await ensureTables();
  return query(
    `SELECT id, eventId, action, actorId, actorRole, snapshotJson, createdAt
       FROM tbl_event_history
      WHERE eventId = ? AND administrationId = ?
      ORDER BY createdAt DESC, id DESC`,
    [Number(eventId), Number(administrationId)]
  );
};

const getSummary = async (user) => {
  await ensureTables();
  const role = notificationService.canonicalRole(user.role);
  const events = await listEvents(user, { limit: 250 });
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const published = events.filter((item) => item.status === "Published");
  const upcoming = published
    .filter((item) => String(item.eventDate) >= todayStr)
    .slice(0, 8);
  const todays = published.filter((item) => String(item.eventDate) === todayStr);
  const recentAnnouncements = published
    .filter((item) =>
      /announcement|circular|parent meeting/i.test(String(item.eventType || ""))
    )
    .slice(0, 8);
  const holidays = published
    .filter((item) => /holiday/i.test(String(item.eventType || "")))
    .slice(0, 8);
  const parentMeetings = published
    .filter((item) => /parent meeting/i.test(String(item.eventType || "")))
    .slice(0, 8);
  const exams = published
    .filter((item) => /exam/i.test(String(item.eventType || "")))
    .slice(0, 8);

  if (role === "Admin") {
    return {
      upcomingEvents: upcoming,
      todaysEvents: todays,
      recentAnnouncements,
      counts: {
        upcoming: upcoming.length,
        today: todays.length,
        announcements: recentAnnouncements.length,
        total: published.length,
      },
    };
  }
  if (role === "Staff") {
    const createdByMe = events.filter(
      (item) =>
        String(item.createdBy) === String(user.userName) &&
        /parent meeting|announcement|reminder/i.test(String(item.eventType || ""))
    );
    return {
      upcomingSchoolEvents: upcoming.filter(
        (item) => String(item.createdByRole).toLowerCase() === "admin"
      ),
      parentMeetingsCreated: createdByMe,
      counts: {
        upcoming: upcoming.length,
        created: createdByMe.length,
      },
    };
  }

  return {
    upcomingEvents: upcoming,
    holidayAnnouncements: holidays,
    parentMeetingNotifications: parentMeetings,
    examNotifications: exams,
    counts: {
      upcoming: upcoming.length,
      holidays: holidays.length,
      parentMeetings: parentMeetings.length,
      exams: exams.length,
    },
  };
};

const setAttachment = async (id, attachmentUrl, user) => {
  await ensureTables();
  const existing = await getEventById(id, user.administrationId);
  if (!existing) throw new Error("Event not found");
  assertStaffOwnership(existing, user);
  await query(
    `UPDATE tbl_events SET attachmentUrl = ?
      WHERE id = ? AND administrationId = ? AND isDeleted = 0`,
    [String(attachmentUrl), Number(id), Number(user.administrationId)]
  );
  return getEventById(id, user.administrationId);
};

const ensureUploadDir = () => {
  const dir = path.join(process.cwd(), "uploads", "events");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

module.exports = {
  ADMIN_EVENT_TYPES,
  STAFF_EVENT_TYPES,
  AUDIENCE_TYPES,
  PRIORITIES,
  ensureTables,
  ensureUploadDir,
  createEvent,
  updateEvent,
  softDeleteEvent,
  publishEvent,
  unpublishEvent,
  getEventById,
  listEvents,
  getHistory,
  getSummary,
  setAttachment,
  mapNotificationType,
};
