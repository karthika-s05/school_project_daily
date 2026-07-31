const express = require("express");
const router = express.Router();

const leaveControllers = require("../controllers/leave");

router.get("/get_leaveType",leaveControllers.getLeaveType);
router.post("/create_leaveType",leaveControllers.createLeaveType);
router.delete("/delete_leaveType/:id",leaveControllers.deleteLeaveType);


router.get("/get_student_leave", leaveControllers.getStudentLeave);
router.post("/get_student_leave", leaveControllers.getStudentLeave);
router.post("/create_student_leave",leaveControllers.createStudentLeave);
router.delete("/delete_student_leave",leaveControllers.deleteStudentLeave);
router.post("/update_student_leave_status",leaveControllers.updateStuLeaveStatus);

router.get("/get_staff_leave",leaveControllers.getstaffLeave);
router.post("/create_staff_leave",leaveControllers.createstaffLeave);
router.delete("/delete_staff_leave",leaveControllers.deletestaffLeave);
router.post("/update_staff_leave_status",leaveControllers.updateStffLeaveStatus);

router.get("/my_staff_leave", leaveControllers.getMyStaffLeave);



//  router.get("/get_leave", leaveControllers.getLeave);
// router.post("/create_leave", leaveControllers.createUpdateLeave);
// router.delete("/delete_leave/:id", leaveControllers.deleteLeave);


module.exports = router;
