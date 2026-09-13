// drizzle.config.js
// ใช้โดย drizzle-kit CLI สำหรับ generate/migrate/push/studio
// อ่านค่าการเชื่อมต่อ DB จาก .env (เดียวกับที่ config/db.config.js ใช้)

const { defineConfig } = require('drizzle-kit');
require('dotenv').config();

module.exports = defineConfig({
  schema: './db/schema.js',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'roi_tracking_db',
  },
  verbose: true,
  strict: true,
});
