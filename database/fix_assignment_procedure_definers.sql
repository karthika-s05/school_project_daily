-- Fix stored procedures imported from production with missing DEFINER user.
-- Error: ER_NO_SUCH_USER - The user specified as a definer ('dbadmin'@'49.207.183.18') does not exist
-- Run against schoolmgt: mysql -u root -p schoolmgt < fix_assignment_procedure_definers.sql

USE schoolmgt;

DROP PROCEDURE IF EXISTS sp_getAssignmentStaff;
DELIMITER //
CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_getAssignmentStaff`(
  IN _classId INT,
  IN _sectionId INT,
  IN _administrationId INT,
  IN _userName VARCHAR(200),
  IN _pageNo INT
)
BEGIN
  SELECT ass.id, cm.id as classId, cm.name as className, sm.id as sectionId, sm.name as section,
    s.id as subjectIt, s.name as subject, ass.title, ass.description,
    DATE_FORMAT(DATE(ass.startDate), '%Y-%m-%d') as startDate,
    DATE_FORMAT(DATE(ass.endDate), '%Y-%m-%d') as endDate,
    CONCAT(tt.firstName, ' ', tt.lastName) as staffName,
    ass.status
  FROM tbl_assignment ass
  JOIN subject s ON ass.subjectId = s.id AND ass.administrationId = s.administrationId
  JOIN classMaster cm ON ass.classId = cm.id AND cm.administrationId = ass.administrationId
  JOIN sectionMaster sm ON ass.sectionId = sm.id AND sm.administrationId = ass.administrationId
  JOIN tbl_teachers tt ON tt.staffID = ass.createdBy AND tt.administrationId = ass.administrationId
  WHERE
    1 = CASE WHEN _classId = 0 THEN 1 WHEN _classId = ass.classId THEN 1 ELSE 0 END AND
    1 = CASE WHEN _sectionId = 0 THEN 1 WHEN _sectionId = ass.sectionId THEN 1 ELSE 0 END AND
    ass.endDate >= CURDATE() AND ass.isActive = '1' AND
    ass.administrationId = _administrationId AND
    ass.createdBy = _userName
  ORDER BY ass.id DESC
  LIMIT 10 OFFSET _pageNo;

  SELECT COUNT(*) as assignmentCount
  FROM tbl_assignment ass
  JOIN subject s ON ass.subjectId = s.id AND ass.administrationId = s.administrationId
  JOIN classMaster cm ON ass.classId = cm.id AND cm.administrationId = ass.administrationId
  JOIN sectionMaster sm ON ass.sectionId = sm.id AND sm.administrationId = ass.administrationId
  JOIN tbl_teachers tt ON tt.staffID = ass.createdBy AND tt.administrationId = ass.administrationId
  WHERE
    1 = CASE WHEN _classId = 0 THEN 1 WHEN _classId = ass.classId THEN 1 ELSE 0 END AND
    1 = CASE WHEN _sectionId = 0 THEN 1 WHEN _sectionId = ass.sectionId THEN 1 ELSE 0 END AND
    ass.endDate >= CURDATE() AND ass.isActive = '1' AND
    ass.administrationId = _administrationId AND
    ass.createdBy = _userName;
END//
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_assignmentReportCount;
DELIMITER //
CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_assignmentReportCount`(
  IN _classId INT,
  IN _sectionId INT,
  IN _administrationId INT,
  IN _userName VARCHAR(200),
  IN _startDate date,
  IN _endDate date
)
BEGIN
  SELECT COUNT(*) AS assignmentCount
  FROM tbl_assignment ass
  JOIN subject s ON ass.subjectId = s.id AND ass.administrationId = s.administrationId
  JOIN classMaster cm ON ass.classId = cm.id AND cm.administrationId = ass.administrationId
  JOIN sectionMaster sm ON ass.sectionId = sm.id AND sm.administrationId = ass.administrationId
  JOIN tbl_teachers tt ON tt.staffID = ass.createdBy AND tt.administrationId = ass.administrationId
  WHERE
    1 = CASE WHEN _classId = 0 THEN 1 WHEN _classId = ass.classId THEN 1 ELSE 0 END AND
    1 = CASE WHEN _sectionId = 0 THEN 1 WHEN _sectionId = ass.sectionId THEN 1 ELSE 0 END AND
    ass.startDate >= _startDate AND ass.endDate <= _endDate AND ass.isActive = '1' AND
    ass.administrationId = _administrationId AND
    ass.createdBy = _userName;
END//
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_countAssignmentView;
DELIMITER //
CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_countAssignmentView`(
  IN _id INT,
  IN _classId INT,
  IN _sectionId INT,
  IN _administrationId INT,
  IN _userName VARCHAR(200)
)
BEGIN
  SELECT COUNT(*) AS assignmentCount
  FROM tbl_assignment ass
  JOIN subject s ON ass.subjectId = s.id AND ass.administrationId = s.administrationId
  JOIN classMaster cm ON ass.classId = cm.id AND cm.administrationId = ass.administrationId
  JOIN sectionMaster sm ON ass.sectionId = sm.id AND sm.administrationId = ass.administrationId
  JOIN tbl_teachers tt ON tt.staffID = ass.createdBy AND tt.administrationId = ass.administrationId
  WHERE
    1 = CASE WHEN _id = 0 THEN 1 WHEN _id = ass.id THEN 1 ELSE 0 END AND
    1 = CASE WHEN _classId = 0 THEN 1 WHEN _classId = ass.classId THEN 1 ELSE 0 END AND
    1 = CASE WHEN _sectionId = 0 THEN 1 WHEN _sectionId = ass.sectionId THEN 1 ELSE 0 END AND
    ass.endDate >= CURDATE() AND ass.isActive = '1' AND
    ass.administrationId = _administrationId AND
    ass.createdBy = _userName;
END//
DELIMITER ;
