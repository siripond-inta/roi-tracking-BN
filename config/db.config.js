const mysql = require('mysql2');
require('dotenv').config();

// สร้าง Connection Pool เพื่อการจัดการ connection ที่มีประสิทธิภาพ
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// แปลงให้รองรับ Promise (async/await)
const promisePool = pool.promise();

module.exports = promisePool;