-- Student assignment list: join class/section masters for display names.
-- Run: mysql -u root -p schoolmgt < fix_sp_get_assignment.sql

USE schoolmgt;

-- Backfill: assignments that already triggered notifications should be visible.
UPDATE tbl_assignment SET status = 'true' WHERE isActive = '1' AND status = 'false';

DROP PROCEDURE IF EXISTS sp_GetAssignment;
DELIMITER //
CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_GetAssignment`(
  IN _classId INT,
  IN _sectionId INT,
  IN _administrationId INT
)
BEGIN
  SELECT
    ass.id,
    cm.id AS classId,
    cm.name AS className,
    sm.id AS sectionId,
    sm.name AS section,
    sm.name AS sectionName,
    s.name AS subject,
    s.name AS subjectName,
    ass.title,
    ass.description,
    DATE_FORMAT(DATE(ass.startDate), '%Y-%m-%d') AS startDate,
    DATE_FORMAT(DATE(ass.endDate), '%Y-%m-%d') AS endDate,
    CONCAT(COALESCE(tt.firstName, ''), ' ', COALESCE(tt.lastName, '')) AS staffName,
    ass.status
  FROM tbl_assignment ass
  LEFT JOIN subject s
    ON ass.subjectId = s.id
   AND s.administrationId = ass.administrationId
  JOIN classMaster cm
    ON ass.classId = cm.id
   AND cm.administrationId = ass.administrationId
  JOIN sectionMaster sm
    ON ass.sectionId = sm.id
   AND sm.administrationId = ass.administrationId
  LEFT JOIN tbl_teachers tt
    ON tt.staffID = ass.createdBy
   AND tt.administrationId = ass.administrationId
  WHERE ass.classId = _classId
    AND ass.sectionId = _sectionId
    AND ass.isActive = '1'
    AND ass.status = 'true'
    AND ass.administrationId = _administrationId
  ORDER BY ass.endDate DESC;
END//
DELIMITER ;
