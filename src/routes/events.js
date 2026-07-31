const express = require("express");
const router = express.Router();

const eventControllers = require("../controllers/events");
const upload = require("../middleware/eventUpload");
const authorize = require("../middleware/authorize");

router.get("/get_events", eventControllers.getEvent);
router.post("/get_events", eventControllers.getEvent);
router.post("/get_eventsById", eventControllers.getEventById);
router.get("/get_eventsById/:id", eventControllers.getEventById);
router.get("/meta", eventControllers.getEventMeta);
router.get("/summary", eventControllers.getEventSummary);

router.post(
  "/create_update_events",
  authorize("Admin", "Staff"),
  eventControllers.createUpdateEvents
);
router.post(
  "/create_update_eventsImage",
  authorize("Admin", "Staff"),
  upload.single("photoUrl"),
  eventControllers.createUpdateEventsImage
);
router.post(
  "/upload_attachment",
  authorize("Admin", "Staff"),
  upload.single("attachment"),
  eventControllers.createUpdateEventsImage
);

router.post(
  "/publish/:id",
  authorize("Admin", "Staff"),
  eventControllers.publishEvent
);
router.post(
  "/unpublish/:id",
  authorize("Admin", "Staff"),
  eventControllers.unpublishEvent
);
router.get(
  "/history/:id",
  authorize("Admin", "Staff"),
  eventControllers.getEventHistory
);

router.post(
  "/delete_events/:id",
  authorize("Admin", "Staff"),
  eventControllers.deleteEvent
);
router.delete(
  "/delete_events/:id",
  authorize("Admin", "Staff"),
  eventControllers.deleteEvent
);

module.exports = router;
