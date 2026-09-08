const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./config/db.config');

const app = express();

// ปิด ETag ป้องกัน browser ส่ง 304 ซึ่ง Angular Fetch API จัดการไม่ได้
// ทำให้ Express ตอบ 200 + full body ทุกครั้งแทน
app.set('etag', false);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// ปิด cache ทุก API response — ให้ Angular ได้ข้อมูลสดเสมอ
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ทดสอบ Route พื้นฐาน
app.get('/', (req, res) => {
  res.json({ message: "Welcome to ROI Tracker API." });
});

const projectRoutes = require('./routes/project.routes');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');

// บอกแอปว่า ถ้า URL ขึ้นต้นด้วย /api/projects ให้ไปดูไฟล์ projectRoutes
app.use('/api/projects', projectRoutes);
// ถ้า URL ขึ้นต้นด้วย /api/auth ให้ไปดูไฟล์ authRoutes (login, signup)
app.use('/api/auth', authRoutes);
// Admin routes (ต้องการสิทธิ์ Admin)
app.use('/api/admin', adminRoutes);


// ตั้งค่า Port และ Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}.`);
});