const express = require("express");
const cors = require("cors");
require("dotenv").config();
const con = require("./src/config/dbConfig");
const bodyParser = require("body-parser");
const errorHandler = require("./errorHandler");
const auth = require("./src/middleware/auth");
const app = express();
app.use((req, res, next) => {
  if (req.url.startsWith("/index.js")) {
    req.url = req.url.substring(9) || "/";
  }
  next();
});
const corsOptions = {
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
// Answer every preflight before auth/routes so PATCH/DELETE are never blocked.
app.options("*", cors(corsOptions));

const path = require("path");
global.appRoot = path.resolve(__dirname);

app.use(bodyParser.urlencoded({ extended: true }));

app.use("/uploads", express.static("uploads"));
// Parse JSON bodies (for JSON data)
app.use(bodyParser.json());

const port = process.env.PORT || 90;

const homeWorkRoutes = require("./src/routes/homeWork");
app.use("/homework", auth, homeWorkRoutes);
// //ROUTING FOR EVENT
const eventRoutes = require("./src/routes/events");
app.use("/events", auth, eventRoutes);

const timeTableRoutes = require("./src/routes/timeTable");
app.use("/timetable", auth, timeTableRoutes);

const assignmentRoutes = require("./src/routes/assignment");
app.use("/assignment", auth, assignmentRoutes);

const leaveRoutes = require("./src/routes/leave");
app.use("/leave", auth, leaveRoutes);

const notificationRoutes = require("./src/routes/notification");
app.use("/notification", auth, notificationRoutes);

try {
  const notificationService = require("./src/services/notificationService");
  notificationService.ensureTable().catch((err) => {
    console.error("notification ensureTable:", err.message || err);
  });
} catch (err) {
  console.error("notification bootstrap:", err.message || err);
}

try {
  const eventService = require("./src/services/eventService");
  eventService.ensureTables().catch((err) => {
    console.error("event ensureTables:", err.message || err);
  });
} catch (err) {
  console.error("event bootstrap:", err.message || err);
}

const substituteRoutes = require("./src/routes/substitute");
app.use("/substitute", auth, substituteRoutes);

const teacherRoutes = require("./src/routes/teacher");
app.use("/teacher", auth, teacherRoutes);

const attendanceRoute = require("./src/routes/attendance");
app.use("/attendance", auth, attendanceRoute);

const dashboardRoute = require("./src/routes/dashboard");
app.use("/dashboard", auth, dashboardRoute);

const reportsRoute = require("./src/routes/reports");
app.use("/reports", auth, reportsRoute);

// Ensure substitute table exists (non-blocking)
try {
  const substituteModel = require("./src/models/substitute");
  substituteModel.ensureTables().catch((err) => {
    console.error("substitute ensureTables:", err.message || err);
  });
} catch (err) {
  console.error("substitute bootstrap:", err.message || err);
}

// Ensure normalized attendance tables exist (non-blocking; models also
// create them lazily on first use)
try {
  const attendanceV2Model = require("./src/models/attendanceV2");
  attendanceV2Model.ensureTables().catch((err) => {
    console.error("attendanceV2 ensureTables:", err.message || err);
  });
} catch (err) {
  console.error("attendanceV2 bootstrap:", err.message || err);
}

app.listen(port, (req, res) => {
  console.log(`server is running the port at ${port}`);
});