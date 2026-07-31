const express = require("express");
const router = express.Router();

const notificationControllers = require("../controllers/notification");
const authorize = require("../middleware/authorize");

router.get("/get_notification", notificationControllers.getnotification);
router.post(
  "/create_notification",
  authorize("Admin"),
  notificationControllers.createnotification
);
router.patch("/:id/read", notificationControllers.markAsRead);
// POST alias: PATCH preflights fail on deployments running the older CORS
// config, and browsers block the request entirely.
router.post("/mark_read/:id", notificationControllers.markAsRead);
router.delete("/delete_notification/:id", notificationControllers.deletenotification);
router.post("/update_notification", notificationControllers.updatenotificationTime);

module.exports = router;