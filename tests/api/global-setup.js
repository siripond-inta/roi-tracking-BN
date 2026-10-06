// เตรียม database ทดสอบก่อนรัน integration test: สร้าง → migrate → seed ข้อมูลตัวอย่าง
// ใช้ root (MYSQL_ROOT_PASSWORD ใน .env) สร้าง database และให้สิทธิ์ user ของแอป
const { execSync } = require('node:child_process');
const path = require('node:path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

module.exports = async () => {
  const testDb = process.env.TEST_DB_NAME || 'roi_tracking_test';
  if (testDb === process.env.DB_NAME) {
    throw new Error(`TEST_DB_NAME (${testDb}) ต้องไม่ใช่ database จริง — test จะล้างข้อมูลทั้งหมด`);
  }

  const root = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: 'root',
    password: process.env.MYSQL_ROOT_PASSWORD,
  });
  await root.query(`DROP DATABASE IF EXISTS \`${testDb}\``);
  await root.query(`CREATE DATABASE \`${testDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.query(`GRANT ALL PRIVILEGES ON \`${testDb}\`.* TO ?@'%'`, [process.env.DB_USER]);
  await root.end();

  const env = { ...process.env, DB_NAME: testDb };
  const cwd = path.join(__dirname, '..', '..');
  execSync('npx drizzle-kit migrate', { cwd, env, stdio: 'ignore' });
  execSync('node db/seed.js', { cwd, env, stdio: 'ignore' });
};
