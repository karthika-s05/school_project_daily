-- Assignment module schema (progress table bootstrap).
-- tbl_assignment already exists in production; this script ensures progress tracking exists.

USE schoolmgt;

CREATE TABLE IF NOT EXISTS tbl_assignment_progress (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assignmentId INT NOT NULL,
  studentId VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Not Started',
  administrationId INT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_assignment_student (administrationId, assignmentId, studentId),
  KEY idx_assignment_progress_assignment (administrationId, assignmentId)
);
