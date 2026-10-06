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
  queueLimit: 0,
  // คอลัมน์ DATE (เช่น transaction_date) ส่งกลับเป็น 'YYYY-MM-DD' ตรงๆ — ถ้าแปลงเป็น JS Date
  // จะถูกตีความเป็นเที่ยงคืนเวลาเครื่อง (UTC+7) แล้วออกมาเป็นวันก่อนหน้าใน JSON (เช่น 15 → 14T17:00Z)
  dateStrings: ['DATE']
});

// แปลงให้รองรับ Promise (async/await)
const promisePool = pool.promise();

module.exports = promisePool;