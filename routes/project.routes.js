const express = require('express');
const router = express.Router();
const projectController = require('../controllers/project.controller');
const { verifyToken, verifyProjectWriter } = require('../middleware/auth.middleware');

// ── Ledger (ประกาศก่อน /:id ไม่งั้น express จะตีความว่า 'ledgers' คือ id) ──
router.get('/ledgers', verifyToken, projectController.getAllLedgers);

// โปรเจกต์ public ของคนอื่น (Community) — ประกาศก่อน /:id เช่นกัน
router.get('/community', verifyToken, projectController.getCommunityProjects);

// Ledger ของโปรเจกต์เดียว
router.get('/:id/ledgers', verifyToken, projectController.getLedgersByProject);
router.post('/:id/ledgers', verifyProjectWriter, projectController.saveLedgers);

// ผลการคำนวณทั้งหมดของโครงการ (NCF, กระแสเงินสดสะสม, ROI, ระยะคืนทุน, ส่วนต่าง)
router.get('/:id/analytics', verifyToken, projectController.getProjectAnalytics);
// พรีวิวผลการคำนวณจากรายการที่กำลังกรอกในฟอร์ม (ไม่บันทึกลงฐานข้อมูล)
router.post('/:id/analytics/preview', verifyProjectWriter, projectController.previewProjectAnalytics);

// อัปเดต Estimated Ledger (ใช้เมื่อแก้ไขหลังบันทึกแล้ว)
router.put('/:id/ledgers/estimated', verifyProjectWriter, projectController.updateEstimatedLedgers);

// อัปเดต Actual Ledger
router.put('/:id/ledgers/actual', verifyProjectWriter, projectController.updateActualLedgers);

// ── Projects ──────────────────────────────────────────────
router.get('/', verifyToken, projectController.getAllProjects);
router.get('/:id', verifyToken, projectController.getProjectById);
router.post('/', verifyProjectWriter, projectController.createProject);
router.put('/:id', verifyProjectWriter, projectController.updateProject);
router.delete('/:id', verifyProjectWriter, projectController.deleteProject);

// สลับ Public/Private
router.patch('/:id/visibility', verifyProjectWriter, projectController.toggleVisibility);

module.exports = router;
