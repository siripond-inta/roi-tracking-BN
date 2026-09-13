const express = require('express');
const router = express.Router();
const projectController = require('../controllers/project.controller');
const { verifyToken } = require('../middleware/auth.middleware');

// ── Ledger (ประกาศก่อน /:id ไม่งั้น express จะตีความว่า 'ledgers' คือ id) ──
router.get('/ledgers', verifyToken, projectController.getAllLedgers);

// โปรเจกต์ public ของคนอื่น (Community) — ประกาศก่อน /:id เช่นกัน
router.get('/community', verifyToken, projectController.getCommunityProjects);

// Ledger ของโปรเจกต์เดียว
router.get('/:id/ledgers', verifyToken, projectController.getLedgersByProject);
router.post('/:id/ledgers', verifyToken, projectController.saveLedgers);

// อัปเดต Estimated Ledger (ใช้เมื่อแก้ไขหลังบันทึกแล้ว)
router.put('/:id/ledgers/estimated', verifyToken, projectController.updateEstimatedLedgers);

// อัปเดต Actual Ledger
router.put('/:id/ledgers/actual', verifyToken, projectController.updateActualLedgers);

// ── Projects ──────────────────────────────────────────────
router.get('/', verifyToken, projectController.getAllProjects);
router.get('/:id', verifyToken, projectController.getProjectById);
router.post('/', verifyToken, projectController.createProject);
router.delete('/:id', verifyToken, projectController.deleteProject);

// สลับ Public/Private
router.patch('/:id/visibility', verifyToken, projectController.toggleVisibility);

module.exports = router;