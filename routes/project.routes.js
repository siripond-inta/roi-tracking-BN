const express = require('express');
const router = express.Router();
const projectController = require('../controllers/project.controller');
const { verifyToken } = require('../middleware/auth.middleware');

// กำหนดเส้นทาง และใช้ verifyToken เพื่อความปลอดภัย
// ดึง Ledger ทั้งหมดในระบบ (ประกาศก่อน /:id)
router.get('/ledgers', verifyToken, projectController.getAllLedgers);

// ดึง Ledger รายโปรเจกต์ (ประกาศก่อน /:id เพื่อไม่ให้ชนกัน)
router.get('/:id/ledgers', verifyToken, projectController.getLedgersByProject);
router.post('/:id/ledgers', verifyToken, projectController.saveLedgers);

// ดึงโปรเจกต์ทั้งหมด
router.get('/', verifyToken, projectController.getAllProjects);

// ดึงโปรเจกต์ตาม ID
router.get('/:id', verifyToken, projectController.getProjectById);

// สร้างโปรเจกต์ใหม่
router.post('/', verifyToken, projectController.createProject);

// ลบโปรเจกต์
router.delete('/:id', verifyToken, projectController.deleteProject);

module.exports = router;