const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboard");

router.get("/get_staff_summary", dashboardController.getStaffSummary);
router.post("/get_staff_summary", dashboardController.getStaffSummary);

module.exports = router;
