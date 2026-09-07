// controllers/auth.controller.js
// หน้าที่: จัดการ Logic ทั้งหมดสำหรับ Signup และ Login

const db = require('../config/db.config');
const bcrypt = require('bcryptjs'); // bcryptjs = pure JS ไม่ต้องการ native build (ปลอดภัยกว่าบน Windows)
const jwt = require('jsonwebtoken');

// ─────────────────────────────────────────────
// POST /api/auth/signup — สมัครสมาชิกใหม่
// ─────────────────────────────────────────────
exports.signup = async (req, res) => {
  try {
    const { full_name, email, password } = req.body;

    // 1. ตรวจสอบว่ากรอกข้อมูลครบหรือไม่
    if (!full_name || !email || !password) {
      return res.status(400).json({ message: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' });
    }

    // 2. ตรวจสอบว่า email ซ้ำกับในระบบหรือไม่
    const [existing] = await db.query(
      'SELECT user_id FROM users WHERE email = ?',
      [email]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email นี้ถูกใช้งานแล้ว' });
    }

    // 3. Hash password ก่อนเก็บลงฐานข้อมูล (ไม่เก็บ plain text เด็ดขาด!)
    // saltRounds = 10 หมายถึง hash ซ้ำ 2^10 = 1024 รอบ (ยิ่งมากยิ่งปลอดภัย แต่ช้ากว่า)
    const password_hash = await bcrypt.hash(password, 10);

    // 4. บันทึก user ใหม่ลงฐานข้อมูล โดยให้ role = 'user' เป็น default
    await db.query(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [full_name, email, password_hash, 'user']
    );

    res.status(201).json({ message: 'สมัครสมาชิกสำเร็จ! กรุณา Login' });

  } catch (error) {
    console.error('[Auth] Signup Error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดที่ Server กรุณาลองใหม่' });
  }
};

// ─────────────────────────────────────────────
// POST /api/auth/login — เข้าสู่ระบบ
// ─────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. ตรวจสอบ input
    if (!email || !password) {
      return res.status(400).json({ message: 'กรุณากรอก Email และ Password' });
    }

    // 2. ค้นหา user จาก email ในฐานข้อมูล
    const [rows] = await db.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    // ส่ง error message เดียวกันสำหรับทั้ง "ไม่มี email" และ "password ผิด"
    // เพื่อป้องกัน user enumeration attack (ไม่ให้คนอื่นรู้ว่า email มีในระบบหรือไม่)
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Email หรือ Password ไม่ถูกต้อง' });
    }

    const user = rows[0];

    // 3. เปรียบเทียบ password ที่กรอกกับ hash ในฐานข้อมูล
    // bcrypt.compare() จะ hash password ที่กรอกแล้วเทียบกับ hash เดิม
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Email หรือ Password ไม่ถูกต้อง' });
    }

    // 4. สร้าง JWT Token โดย sign ด้วย JWT_SECRET
    // Payload ที่แนบไปใน token: userId, email, role (ข้อมูลที่ Guard จะอ่านได้)
    const token = jwt.sign(
      {
        userId: user.user_id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' } // token หมดอายุใน 24 ชั่วโมง
    );

    // 5. ส่ง token และข้อมูล user กลับ (ไม่ส่ง password_hash กลับ!)
    res.json({
      token,
      user: {
        userId: user.user_id,
        fullName: user.full_name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('[Auth] Login Error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดที่ Server กรุณาลองใหม่' });
  }
};
