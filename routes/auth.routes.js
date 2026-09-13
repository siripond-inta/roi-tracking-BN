// routes/auth.routes.js
// กำหนด URL endpoint สำหรับ Authentication

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyToken } = require('../middleware/auth.middleware');

// POST /api/auth/signup — สมัครสมาชิก
router.post('/signup', authController.signup);

// POST /api/auth/login — เข้าสู่ระบบ
router.post('/login', authController.login);

// PUT /api/auth/profile — แก้ไขชื่อ/อีเมลของตัวเอง (ต้อง login)
router.put('/profile', verifyToken, authController.updateProfile);

// PUT /api/auth/password — เปลี่ยนรหัสผ่านของตัวเอง (ต้อง login)
router.put('/password', verifyToken, authController.changePassword);

module.exports = router;
