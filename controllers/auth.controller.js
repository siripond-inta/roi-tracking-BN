// controllers/auth.controller.js
// หน้าที่: จัดการ Logic ทั้งหมดสำหรับ Signup และ Login

const db = require('../config/db.config');
const bcrypt = require('bcryptjs'); // bcryptjs = pure JS ไม่ต้องการ native build (ปลอดภัยกว่าบน Windows)
const jwt = require('jsonwebtoken');

// ตรวจรูปแบบอีเมลแบบพื้นฐาน (มี @ และโดเมนที่มีจุด ไม่มีช่องว่าง) — ความยาวตามคอลัมน์ VARCHAR(255)
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
const isValidEmail = (email) => typeof email === 'string' && email.length <= 255 && EMAIL_PATTERN.test(email);

// ─────────────────────────────────────────────
// POST /api/auth/signup — สมัครสมาชิกใหม่
// ─────────────────────────────────────────────
exports.isValidEmail = isValidEmail;

exports.signup = async (req, res) => {
  try {
    // หมายเหตุ: schema v1.2 ไม่มีคอลัมน์ users.company_name แล้ว (ถ้า frontend ส่งมาจะถูกละเว้น)
    const full_name = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    const { password } = req.body;

    // 1. ตรวจสอบว่ากรอกข้อมูลครบและถูกรูปแบบหรือไม่ (ตรวจที่ server ด้วย ไม่พึ่ง frontend อย่างเดียว)
    if (!full_name || !email || !password) {
      return res.status(400).json({ message: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' });
    }
    if (full_name.length > 255) {
      return res.status(400).json({ message: 'ชื่อยาวเกิน 255 ตัวอักษร' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'รูปแบบอีเมลไม่ถูกต้อง' });
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `Password ต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร` });
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

    // 4. บันทึก user ใหม่ลงฐานข้อมูล โดยให้ role = 'project_owner' เป็น default สำหรับผู้ที่สมัครเอง
    await db.query(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [full_name, email, password_hash, 'project_owner']
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

    // 3.5. บัญชีที่ถูก admin ปิดใช้งาน (soft delete) แล้ว ห้าม login
    if (!user.is_active) {
      return res.status(403).json({ message: 'บัญชีนี้ถูกปิดใช้งานแล้ว กรุณาติดต่อผู้ดูแลระบบ' });
    }

    // บันทึกเวลา login ล่าสุด ใช้ตรวจสอบบัญชีที่ไม่ได้ใช้งานนาน (ฟีเจอร์ soft delete ของ admin)
    await db.query('UPDATE users SET last_login_at = NOW() WHERE user_id = ?', [user.user_id]);

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

// ─────────────────────────────────────────────
// PUT /api/auth/profile — แก้ไขชื่อ/อีเมลของตัวเอง
// ─────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { full_name, email, current_password } = req.body;

    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ message: 'กรุณากรอกชื่อ' });
    }

    const [[user]] = await db.query('SELECT * FROM users WHERE user_id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
    }

    const emailChanged = email && email.trim() !== user.email;
    if (emailChanged && !isValidEmail(email.trim())) {
      return res.status(400).json({ message: 'รูปแบบอีเมลไม่ถูกต้อง' });
    }
    if (full_name.trim().length > 255) {
      return res.status(400).json({ message: 'ชื่อยาวเกิน 255 ตัวอักษร' });
    }

    // เปลี่ยนอีเมลต้องยืนยันด้วยรหัสผ่านปัจจุบัน (ป้องกันคนอื่นแอบเปลี่ยนถ้า session หลุด)
    if (emailChanged) {
      if (!current_password) {
        return res.status(400).json({ message: 'กรุณากรอกรหัสผ่านปัจจุบันเพื่อยืนยันการเปลี่ยนอีเมล' });
      }
      const isMatch = await bcrypt.compare(current_password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
      }

      const [existing] = await db.query(
        'SELECT user_id FROM users WHERE email = ? AND user_id <> ?',
        [email.trim(), userId]
      );
      if (existing.length > 0) {
        return res.status(409).json({ message: 'อีเมลนี้ถูกใช้งานโดยบัญชีอื่นแล้ว' });
      }
    }

    await db.query(
      'UPDATE users SET full_name = ?, email = ? WHERE user_id = ?',
      [full_name.trim(), emailChanged ? email.trim() : user.email, userId]
    );

    res.json({
      message: 'บันทึกข้อมูลโปรไฟล์สำเร็จ',
      user: {
        userId: user.user_id,
        fullName: full_name.trim(),
        email: emailChanged ? email.trim() : user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('[Auth] updateProfile Error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดที่ Server กรุณาลองใหม่' });
  }
};

// ─────────────────────────────────────────────
// PUT /api/auth/password — เปลี่ยนรหัสผ่านของตัวเอง
// ─────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ message: 'กรุณากรอกรหัสผ่านปัจจุบันและรหัสผ่านใหม่' });
    }
    if (typeof new_password !== 'string' || new_password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `รหัสผ่านใหม่ต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร` });
    }

    const [[user]] = await db.query('SELECT * FROM users WHERE user_id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
    }

    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [newHash, userId]);

    res.json({ message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
  } catch (error) {
    console.error('[Auth] changePassword Error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดที่ Server กรุณาลองใหม่' });
  }
};
