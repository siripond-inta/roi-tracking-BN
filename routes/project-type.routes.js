// routes/project-type.routes.js
// FR07-4: GET เปิดให้ user ที่ login แล้วทุกคน (ใช้เติม dropdown ตอนสร้างโครงการ)
// เพิ่ม/แก้/ลบ เฉพาะ admin

const express = require('express');
const router = express.Router();
const projectTypeController = require('../controllers/project-type.controller');
const { verifyToken, verifyAdmin } = require('../middleware/auth.middleware');

router.get('/', verifyToken, projectTypeController.getAll);
router.post('/', verifyAdmin, projectTypeController.create);
router.put('/:id', verifyAdmin, projectTypeController.update);
router.delete('/:id', verifyAdmin, projectTypeController.remove);

module.exports = router;
