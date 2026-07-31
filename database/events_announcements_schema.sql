-- Events & Announcements schema
-- Safe to re-run for CREATE TABLE IF NOT EXISTS.
-- ALTER statements may error if columns already exist; the app also applies
-- these changes lazily via eventService.ensureTables() / notificationService.ensureTable().

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
);

CREATE TABLE IF NOT EXISTS tbl_event_targets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  eventId BIGINT UNSIGNED NOT NULL,
  targetType VARCHAR(40) NOT NULL,
  classId INT DEFAULT NULL,
  sectionId INT DEFAULT NULL,
  studentId VARCHAR(100) DEFAULT NULL,
  administrationId INT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_event_targets_event (eventId, administrationId),
  KEY idx_event_targets_class (administrationId, classId, sectionId),
  KEY idx_event_targets_student (administrationId, studentId)
);

CREATE TABLE IF NOT EXISTS tbl_event_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  eventId BIGINT UNSIGNED NOT NULL,
  action VARCHAR(40) NOT NULL,
  actorId VARCHAR(100) NOT NULL,
  actorRole VARCHAR(30) NOT NULL,
  snapshotJson LONGTEXT NULL,
  administrationId INT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_event_history_event (eventId, createdAt)
);

-- Optional notification extensions (skip if columns already exist):
-- ALTER TABLE tbl_notification_center ADD COLUMN senderRole VARCHAR(30) DEFAULT NULL AFTER senderId;
-- ALTER TABLE tbl_notification_center ADD COLUMN eventId BIGINT UNSIGNED DEFAULT NULL AFTER referenceId;
-- ALTER TABLE tbl_notification_center ADD KEY idx_notification_event (administrationId, eventId);
