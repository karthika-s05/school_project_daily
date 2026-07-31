const model = require("../models/attendanceV2");
const logger = require("../config/winston");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const todayStr = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const normalizeDate = (value) => {
  const date = String(value || "").trim().slice(0, 10);
  return DATE_RE.test(date) ? date : null;
};

const monthRange = (input) => {
  let year;
  let month;
  const now = new Date();
  const str = String(input || "").trim();
  if (/^\d{4}-\d{2}/.test(str)) {
    year = Number(str.slice(0, 4));
    month = Number(str.slice(5, 7));
  } else if (/^\d{1,2}$/.test(str) && Number(str) >= 1 && Number(str) <= 12) {
    year = now.getFullYear();
    month = Number(str);
  } else {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    monthStart: `${year}-${pad(month)}-01`,
    monthEnd: `${year}-${pad(month)}-${pad(lastDay)}`,
    label: `${year}-${pad(month)}`,
  };
};

const sendOk = (res, message, data, summary = null) =>
  res.send({ status: "success", message, data, summary, canEdit: false });

const sendError = (res, message, data = []) =>
  res.send({ status: "Error", message, data, summary: null, canEdit: false });

const handleError = (req, res, err, message) => {
  logger.error(`${req.path} -- ${req.method} -- ${err?.message || err}`);
  sendError(res, message, err?.sqlMessage || err?.message || String(err));
};

const percentAverage = (rows) =>
  rows.length
    ? Math.round(
        (rows.reduce((sum, row) => sum + Number(row.percentage || 0), 0) /
          rows.length) *
          100
      ) / 100
    : 0;

/* ------------------------------ exporters ------------------------------ */

const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const toCsv = (rows, headers) =>
  [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(",")),
  ].join("\n");

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Excel-compatible SpreadsheetML (XML Spreadsheet 2003); opens in Excel
// without an xlsx library.
const toXmlSpreadsheet = (rows, headers, sheetName) => {
  const cell = (value) => {
    const num = Number(value);
    const isNumber =
      value !== null && value !== "" && value !== undefined && !isNaN(num) &&
      String(value).trim() !== "";
    return isNumber
      ? `<Cell><Data ss:Type="Number">${num}</Data></Cell>`
      : `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
  };
  const headerRow = `<Row>${headers
    .map((h) => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`)
    .join("")}</Row>`;
  const bodyRows = rows
    .map((row) => `<Row>${headers.map((h) => cell(row[h])).join("")}</Row>`)
    .join("");
  return (
    `<?xml version="1.0"?>` +
    `<?mso-application progid="Excel.Sheet"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"` +
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="${escapeXml(sheetName).slice(0, 31) || "Report"}">` +
    `<Table>${headerRow}${bodyRows}</Table>` +
    `</Worksheet></Workbook>`
  );
};

const escapeHtml = escapeXml;

// Printable HTML labelled PDF: no PDF library is present in this service, so
// the client can open this in a new window and print/save as PDF.
const toPrintableHtml = (rows, headers, title) => {
  const headerCells = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${headers.map((h) => `<td>${escapeHtml(row[h])}</td>`).join("")}</tr>`
    )
    .join("");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 24px; }
  h2 { margin-bottom: 4px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
  th { background: #f0f0f0; }
  @media print { body { margin: 8px; } }
</style>
</head>
<body>
<h2>${escapeHtml(title)}</h2>
<div class="meta">Generated: ${escapeHtml(new Date().toISOString())} &mdash; ${rows.length} rows</div>
<table>
<thead><tr>${headerCells}</tr></thead>
<tbody>${bodyRows}</tbody>
</table>
<script>if (window.matchMedia) { /* open and use browser Print to save as PDF */ }</script>
</body>
</html>`;
};

const buildExport = (format, rows, headers, baseName, title) => {
  if (format === "xlsx") {
    return {
      format: "xlsx",
      filename: `${baseName}.xls`,
      mimeType: "application/vnd.ms-excel",
      content: toXmlSpreadsheet(rows, headers, title),
      note: "XML Spreadsheet 2003 (Excel-compatible)",
    };
  }
  if (format === "pdf") {
    return {
      format: "pdf",
      filename: `${baseName}.html`,
      mimeType: "text/html",
      content: toPrintableHtml(rows, headers, title),
      note: "Printable HTML (no PDF library installed); use browser Print > Save as PDF",
    };
  }
  return {
    format: "csv",
    filename: `${baseName}.csv`,
    mimeType: "text/csv",
    content: toCsv(rows, headers),
    csv: toCsv(rows, headers),
  };
};

const headersFromRows = (rows, preferred) => {
  if (!rows.length) return preferred;
  const present = preferred.filter((h) => h in rows[0]);
  return present.length ? present : Object.keys(rows[0]);
};

/* ------------------------- report data fetchers ------------------------- */

const REPORT_HEADERS = {
  student: [
    "studentId",
    "studentName",
    "className",
    "sectionName",
    "daysMarked",
    "present",
    "absent",
    "onLeave",
    "late",
    "halfDay",
    "medicalLeave",
    "percentage",
  ],
  staff: [
    "staffId",
    "staffName",
    "daysMarked",
    "present",
    "absent",
    "onLeave",
    "late",
    "halfDay",
    "presentEquivalent",
    "percentage",
  ],
  daily: [
    "studentId",
    "studentName",
    "className",
    "sectionName",
    "attendanceMode",
    "subjectName",
    "status",
    "remarks",
    "markedBy",
    "date",
  ],
  monthly: [
    "studentId",
    "studentName",
    "className",
    "sectionName",
    "daysMarked",
    "presentDays",
    "percentage",
  ],
  "class-wise": [
    "className",
    "sectionName",
    "students",
    "daysMarked",
    "present",
    "absent",
    "onLeave",
    "late",
    "halfDay",
    "medicalLeave",
    "percentage",
  ],
  "subject-wise": [
    "subjectName",
    "students",
    "daysMarked",
    "present",
    "absent",
    "onLeave",
    "late",
    "halfDay",
    "medicalLeave",
    "percentage",
  ],
  "absent-students": [
    "studentId",
    "studentName",
    "className",
    "sectionName",
    "attendanceMode",
    "subjectName",
    "status",
    "remarks",
    "date",
  ],
  "absent-staff": ["staffId", "staffName", "status", "remarks", "date", "markedBy"],
};

const fetchReport = async (reportType, body, user) => {
  const administrationId = user.administrationId;
  const { classId, sectionId, studentId, staffId } = body;
  const startDate = normalizeDate(body.startDate);
  const endDate = normalizeDate(body.endDate);
  const date = normalizeDate(body.date || body.reqDate) || todayStr();

  switch (reportType) {
    case "student": {
      const rows = await model.reportStudent({
        administrationId,
        classId,
        sectionId,
        studentId,
        startDate,
        endDate,
      });
      return {
        rows,
        summary: {
          students: rows.length,
          averagePercentage: percentAverage(rows),
        },
      };
    }
    case "staff": {
      const rows = await model.reportStaff({
        administrationId,
        staffId,
        startDate,
        endDate,
      });
      return {
        rows,
        summary: {
          staff: rows.length,
          averagePercentage: percentAverage(rows),
        },
      };
    }
    case "daily": {
      const rows = await model.reportDaily({
        administrationId,
        date,
        classId,
        sectionId,
      });
      return {
        rows,
        summary: {
          date,
          total: rows.length,
          present: rows.filter((r) => r.status === "Present").length,
          absent: rows.filter((r) => r.status === "Absent").length,
        },
      };
    }
    case "monthly": {
      const { monthStart, monthEnd, label } = monthRange(body.month);
      const rows = await model.reportMonthly({
        administrationId,
        monthStart,
        monthEnd,
        classId,
        sectionId,
      });
      return {
        rows,
        summary: {
          month: label,
          students: rows.length,
          averagePercentage: percentAverage(rows),
        },
      };
    }
    case "class-wise": {
      const rows = await model.reportClassWise({
        administrationId,
        startDate,
        endDate,
      });
      return {
        rows,
        summary: {
          classes: rows.length,
          averagePercentage: percentAverage(rows),
        },
      };
    }
    case "subject-wise": {
      const rows = await model.reportSubjectWise({
        administrationId,
        classId,
        sectionId,
        startDate,
        endDate,
      });
      return {
        rows,
        summary: {
          subjects: rows.length,
          averagePercentage: percentAverage(rows),
        },
      };
    }
    case "absent-students": {
      const rows = await model.reportAbsentStudents({
        administrationId,
        date,
        classId,
        sectionId,
      });
      return { rows, summary: { date, absent: rows.length } };
    }
    case "absent-staff": {
      const rows = await model.reportAbsentStaff({ administrationId, date });
      return { rows, summary: { date, absent: rows.length } };
    }
    default:
      return null;
  }
};

const makeReportHandler = (reportType, message) => async (req, res) => {
  try {
    const result = await fetchReport(reportType, req.body || {}, req.user);
    if (!result) return sendError(res, "Unknown report type");
    sendOk(res, message, result.rows, result.summary);
  } catch (err) {
    handleError(req, res, err, `${message} failed`);
  }
};

module.exports = {
  studentReport: makeReportHandler("student", "Student attendance report retrieved"),
  staffReport: makeReportHandler("staff", "Staff attendance report retrieved"),
  dailyReport: makeReportHandler("daily", "Daily attendance report retrieved"),
  monthlyReport: makeReportHandler("monthly", "Monthly attendance report retrieved"),
  classWiseReport: makeReportHandler("class-wise", "Class-wise attendance report retrieved"),
  subjectWiseReport: makeReportHandler("subject-wise", "Subject-wise attendance report retrieved"),
  absentStudentsReport: makeReportHandler("absent-students", "Absent students report retrieved"),
  absentStaffReport: makeReportHandler("absent-staff", "Absent staff report retrieved"),

  exportReport: async (req, res) => {
    try {
      const reportType = String(req.body?.reportType || "daily").trim().toLowerCase();
      const format = ["csv", "xlsx", "pdf"].includes(
        String(req.body?.format || "").trim().toLowerCase()
      )
        ? String(req.body.format).trim().toLowerCase()
        : "csv";
      if (!REPORT_HEADERS[reportType]) {
        return sendError(
          res,
          `Unknown reportType '${reportType}'. Allowed: ${Object.keys(REPORT_HEADERS).join(", ")}`
        );
      }
      const result = await fetchReport(reportType, req.body || {}, req.user);
      const rows = result.rows || [];
      const headers = headersFromRows(rows, REPORT_HEADERS[reportType]);
      const stamp = todayStr();
      const exportData = buildExport(
        format,
        rows,
        headers,
        `attendance_${reportType}_${stamp}`,
        `Attendance ${reportType} report`
      );
      sendOk(res, "Export ready", exportData, {
        ...result.summary,
        rows: rows.length,
        format: exportData.format,
      });
    } catch (err) {
      handleError(req, res, err, "Attendance export failed");
    }
  },
};
