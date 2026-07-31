const path = require("path");
const mysql = require("mysql2");

require("dotenv").config({
  path: path.join(__dirname, "../../.env"),
  override: true,
});

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "schoolmgt",
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
});

pool.getConnection((err, connection) => {
  if (err) {
    console.error("Database connection failed:", err.message);
    return;
  }
  console.log("Database Connected Successfully!!!");
  connection.release();
});

module.exports = pool;
