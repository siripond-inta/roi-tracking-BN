// routes/admin.routes.js
// Admin-only routes — ใช้ verifyAdmin middleware ตรวจสอบ role=admin

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { verifyAdmin } = require('../middleware/auth.middleware');

// ── Projects ───────────────────────────────────────────────
// GET /api/admin/projects — ดูโปรเจกต์ทั้งหมดในระบบ
router.get('/projects', verifyAdmin, adminController.getAllProjects);

// ── Users ──────────────────────────────────────────────────
// GET /api/admin/users — ดู User ทั้งหมด
router.get('/users', verifyAdmin, adminController.getAllUsers);

// PUT /api/admin/users/:id — แก้ไข User (role, company_name, full_name)
router.put('/users/:id', verifyAdmin, adminController.updateUser);

// DELETE /api/admin/users/:id — ลบ User
router.delete('/users/:id', verifyAdmin, adminController.deleteUser);

module.exports = router;
