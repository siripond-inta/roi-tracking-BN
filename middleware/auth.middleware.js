// middleware/auth.middleware.js
// หน้าที่: ตรวจสอบ JWT Token ก่อนอนุญาตให้เข้าถึง Protected API Routes
// ใช้ใน route ที่ต้องการ auth เช่น: router.get('/profile', verifyToken, getProfile)

const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  // ดึง Token จาก Authorization Header
  // รูปแบบ: "Authorization: Bearer eyJhbGci..."
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // แยกเอาเฉพาะส่วน Token

  if (!token) {
    return res.status(401).json({ message: 'Access denied: ไม่มี Token กรุณา Login ก่อน' });
  }

  try {
    // jwt.verify() ตรวจสอบ signature และ expiry ของ token
    // ถ้าผ่าน → คืนค่า decoded payload (userId, email, role)
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // แนบข้อมูล user เข้าไปใน request object เพื่อให้ controller ต่อไปใช้ได้
    req.user = decoded;
    next(); // อนุญาตให้ดำเนินการต่อ

  } catch (error) {
    // token ปลอม, หมดอายุ, หรือถูกแก้ไข
    return res.status(403).json({ message: 'Access denied: Token ไม่ถูกต้องหรือหมดอายุ' });
  }
};

// Middleware สำหรับตรวจสอบว่าเป็น Admin
const verifyAdmin = (req, res, next) => {
  verifyToken(req, res, () => {
    if (req.user?.role === 'admin') {
      next();
    } else {
      res.status(403).json({ message: 'Access denied: ต้องการสิทธิ์ Admin เท่านั้น' });
    }
  });
};

module.exports = { verifyToken, verifyAdmin };
