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

// PUT /api/admin/users/:id — แก้ไข User (role, full_name)
router.put('/users/:id', verifyAdmin, adminController.updateUser);

// PATCH /api/admin/users/:id/deactivate — Soft delete บัญชีที่ไม่ active เกิน 3 ปี
router.patch('/users/:id/deactivate', verifyAdmin, adminController.softDeleteUser);

// DELETE /api/admin/users/:id — ลบ User (hard delete)
router.delete('/users/:id', verifyAdmin, adminController.deleteUser);

module.exports = router;
