// routes/category.routes.js
// GET เปิดให้ user ที่ login แล้วทุกคน (ใช้เติม dropdown หมวดหมู่ในฟอร์ม)
// เพิ่ม/แก้/ลบ เฉพาะ admin

const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/category.controller');
const { verifyToken, verifyAdmin } = require('../middleware/auth.middleware');

// ประกาศก่อน /:id ไม่งั้น express จะตีความว่า 'entry-types' คือ id
router.get('/entry-types', verifyToken, categoryController.getEntryTypes);

router.get('/', verifyToken, categoryController.getAll);
router.post('/', verifyAdmin, categoryController.create);
router.put('/:id', verifyAdmin, categoryController.update);
router.delete('/:id', verifyAdmin, categoryController.remove);

module.exports = router;
