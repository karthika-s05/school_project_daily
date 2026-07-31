const express = require("express");
const router = express.Router();

const homeWorkControllers = require("../controllers/homeWork");
const authorize = require("../middleware/authorize");

router.get("/get_homework", homeWorkControllers.getHomeWork); //working
router.post("/get_homework", homeWorkControllers.getHomeWork); //working
router.post("/get_homework_by_id", homeWorkControllers.getHomeWorkId); 
router.post(
  "/create_update_homework",
  authorize("Staff", "Admin"),
  homeWorkControllers.createUpdateHomeWork
);
router.post(
  "/update_homework_progress",
  authorize("Student"),
  homeWorkControllers.updateHomeworkProgress
);
router.delete(
  "/delete_homework/:id",
  authorize("Staff", "Admin"),
  homeWorkControllers.deleteHomeWork
);
router.post(
  "/delete_homework/:id",
  authorize("Staff", "Admin"),
  homeWorkControllers.deleteHomeWork
);

module.exports = router;
