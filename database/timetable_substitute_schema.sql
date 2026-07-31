-- Date-specific substitute / borrow-period records (run once on MySQL)
-- Does NOT overwrite tbl_classtimetable.staffId permanently.

CREATE TABLE IF NOT EXISTS tbl_timetable_substitute (
  id INT AUTO_INCREMENT PRIMARY KEY,
  administrationId INT NOT NULL,
  timetableId INT NOT NULL,
  leaveId INT DEFAULT NULL,
  absentStaffId VARCHAR(50) NOT NULL,
  substituteStaffId VARCHAR(50) DEFAULT NULL,
  subjectId INT NOT NULL,
  classId INT NOT NULL,
  sectionId INT NOT NULL,
  periodSlotId INT NOT NULL,
  dayId INT NOT NULL,
  substituteDate DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sub_open (administrationId, timetableId, substituteDate, absentStaffId),
  KEY idx_sub_staff_date (administrationId, substituteStaffId, substituteDate),
  KEY idx_sub_absent_date (administrationId, absentStaffId, substituteDate),
  KEY idx_sub_status (administrationId, status),
  KEY idx_sub_leave (leaveId)
);
