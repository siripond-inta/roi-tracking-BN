// middleware/auth.middleware.js
// หน้าที่: ตรวจสอบ JWT Token ก่อนอนุญาตให้เข้าถึง Protected API Routes
// ใช้ใน route ที่ต้องการ auth เช่น: router.get('/profile', verifyToken, getProfile)
//
// สำคัญ: token มีอายุ 24 ชม. แต่ role / สถานะบัญชีเปลี่ยนได้ระหว่างนั้น (admin ลดสิทธิ์ หรือ
// soft delete บัญชี) จึงต้องอ่าน role และ is_active ล่าสุดจาก database ทุก request
// ไม่เชื่อค่า role ที่ฝังอยู่ใน token — ไม่งั้นคนที่ถูกลดสิทธิ์/ปิดบัญชีแล้วยังใช้ token เดิมแก้ข้อมูลได้

const jwt = require('jsonwebtoken');

// โหลด db แบบ lazy — ให้ unit test ส่งฟังก์ชันอ่าน user ของตัวเองเข้ามาได้โดยไม่ต้องต่อ MySQL
async function loadUserFromDb(userId) {
  const db = require('../config/db.config');
  const [[user]] = await db.query(
    'SELECT user_id, email, role, is_active FROM users WHERE user_id = ?',
    [userId]
  );
  return user || null;
}

function createAuthMiddleware({ loadUser = loadUserFromDb, secret = () => process.env.JWT_SECRET } = {}) {
  const verifyToken = async (req, res, next) => {
    // ดึง Token จาก Authorization Header — รูปแบบ: "Authorization: Bearer eyJhbGci..."
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'Access denied: ไม่มี Token กรุณา Login ก่อน' });
    }

    let decoded;
    try {
      // jwt.verify() ตรวจสอบ signature และ expiry ของ token
      decoded = jwt.verify(token, secret());
    } catch (error) {
      // token ปลอม, หมดอายุ, หรือถูกแก้ไข
      return res.status(403).json({ message: 'Access denied: Token ไม่ถูกต้องหรือหมดอายุ' });
    }

    try {
      const user = await loadUser(decoded.userId);
      if (!user) {
        return res.status(401).json({ message: 'Access denied: ไม่พบบัญชีผู้ใช้นี้แล้ว กรุณา Login ใหม่' });
      }
      if (!Number(user.is_active)) {
        return res.status(403).json({ message: 'บัญชีนี้ถูกปิดใช้งานแล้ว กรุณาติดต่อผู้ดูแลระบบ' });
      }
      // ใช้ข้อมูลล่าสุดจาก database แทนค่าใน token
      req.user = { userId: user.user_id, email: user.email, role: user.role };
      return next();
    } catch (error) {
      console.error('[Auth] verifyToken Error:', error);
      return res.status(500).json({ message: 'เกิดข้อผิดพลาดที่ Server กรุณาลองใหม่' });
    }
  };

  // Middleware สำหรับตรวจสอบว่าเป็น Admin
  const verifyAdmin = (req, res, next) =>
    verifyToken(req, res, () => {
      if (req.user?.role === 'admin') return next();
      return res.status(403).json({ message: 'Access denied: ต้องการสิทธิ์ Admin เท่านั้น' });
    });

  // FR01-2: แยกสิทธิ์ 3 ระดับ — role 'viewer' ดูได้อย่างเดียว ห้ามสร้าง/แก้ไข/ลบโครงการหรือ ledger
  // (project_owner และ admin เท่านั้นที่เขียนได้) บังคับที่ฝั่ง server ไม่พึ่งการซ่อนปุ่มใน frontend
  const verifyProjectWriter = (req, res, next) =>
    verifyToken(req, res, () => {
      if (req.user?.role === 'project_owner' || req.user?.role === 'admin') return next();
      return res.status(403).json({
        message: 'Access denied: บัญชีระดับ Viewer ดูข้อมูลได้อย่างเดียว ไม่สามารถแก้ไขโครงการได้'
      });
    });

  return { verifyToken, verifyAdmin, verifyProjectWriter };
}

module.exports = { ...createAuthMiddleware(), createAuthMiddleware };
