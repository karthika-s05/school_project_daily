const express = require("express");
const router = express.Router();

const timeTableControllers = require("../controllers/timeTable");

router.get("/get_period_slot/:classId", timeTableControllers.getPeriodSlot);
router.get(
  "/get_period_slot_by_id/:id",
  timeTableControllers.getPeriodSlotById
);
router.post("/create_period_slot", timeTableControllers.createUpdatePeriodSlot);
router.post("/delete_period_slot/:id", timeTableControllers.deletePeriodSlot);
router.get(
  "/get_subject_staff/:subjectId",
  timeTableControllers.getSubjectStaff
);

router.get("/get_class_timetable", timeTableControllers.getClasstimeTable);
router.post("/get_class_timetable", timeTableControllers.getClasstimeTable);
router.post("/get_class_timetable/:id", timeTableControllers.getClasstimeTable);
router.post(
  "/create_class_timetable",
  timeTableControllers.createUpdateClasstimeTable
);
router.post(
  "/delete_class_timetable/:id",
  timeTableControllers.deleteClasstimeTable
);
router.get("/get_staff_timetable", timeTableControllers.getStafftimeTable);
router.post("/get_staff_timetable", timeTableControllers.getStafftimeTable);

router.get("/getDay", timeTableControllers.getDay);

module.exports = router;
