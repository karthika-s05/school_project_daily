const express = require("express");
const router = express.Router();

const teacherController = require("../controllers/teacher");

router.get("/get_Teacher", teacherController.getTeacher);
router.get("/get_Teacher_class", teacherController.getTeacherClass);
router.get("/get_Subject_class", teacherController.getSubjectClass);

module.exports = router;
