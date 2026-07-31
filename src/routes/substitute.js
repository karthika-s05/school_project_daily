const express = require("express");
const router = express.Router();
const substituteControllers = require("../controllers/substitute");

router.get("/my_requests", substituteControllers.getMyRequests);
router.post("/:id/accept", substituteControllers.accept);
router.post("/:id/reject", substituteControllers.reject);

module.exports = router;
