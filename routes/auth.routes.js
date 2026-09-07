// routes/auth.routes.js
// กำหนด URL endpoint สำหรับ Authentication

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// POST /api/auth/signup — สมัครสมาชิก
router.post('/signup', authController.signup);

// POST /api/auth/login — เข้าสู่ระบบ
router.post('/login', authController.login);

module.exports = router;
