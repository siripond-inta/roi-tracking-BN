// controllers/admin.controller.js
// Admin-only APIs: จัดการ Users และดูโปรเจกต์ทั้งระบบ

const db = require('../config/db.config');
const bcrypt = require('bcryptjs');

// ══════════════════════════════════════════════════════════
// 1. GET /api/admin/projects — ดึงโปรเจกต์ทั้งหมดในระบบ (Admin เท่านั้น)
// ══════════════════════════════════════════════════════════
exports.getAllProjects = async (req, res) => {
  try {
    const sql = `
      SELECT
        p.project_id,
        p.project_name,
        p.duration_months,
        p.initial_budget,
        p.created_at,
        p.status AS project_status,
        pt.calculation_method,
        EXISTS(
          SELECT 1 FROM project_access pa
          WHERE pa.project_id = p.project_id AND pa.user_id <> p.user_id AND pa.permission_level = 'viewer'
        ) AS is_public,
        u.full_name AS owner_name,
        u.email AS owner_email,
        pt.type_name AS project_type,
        CASE WHEN EXISTS(
          SELECT 1 FROM project_ledger pl
          WHERE pl.project_id = p.project_id AND pl.phase = 'ACTUAL'
        ) THEN 'Actual' ELSE 'Estimated' END AS status
      FROM projects p
      LEFT JOIN users u ON p.user_id = u.user_id
      LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
      ORDER BY p.created_at DESC
    `;

    const [rows] = await db.query(sql);
    res.json({ status: 'success', data: rows });
  } catch (error) {
    console.error('[Admin] getAllProjects Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve projects' });
  }
};

// ══════════════════════════════════════════════════════════
// 2. GET /api/admin/users — ดึง User ทั้งหมด
// ══════════════════════════════════════════════════════════
exports.getAllUsers = async (req, res) => {
  try {
    const sql = `
      SELECT
        u.user_id,
        u.full_name,
        u.email,
        u.role,
        u.is_active,
        u.last_login_at,
        u.created_at,
        COUNT(p.project_id) AS project_count,
        (
          u.is_active = 1
          AND COALESCE(u.last_login_at, u.created_at) < DATE_SUB(NOW(), INTERVAL 3 YEAR)
        ) AS is_dormant
      FROM users u
      LEFT JOIN projects p ON u.user_id = p.user_id
      GROUP BY u.user_id
      ORDER BY u.created_at DESC
    `;
    const [rows] = await db.query(sql);
    res.json({ status: 'success', data: rows });
  } catch (error) {
    console.error('[Admin] getAllUsers Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve users' });
  }
};

// ══════════════════════════════════════════════════════════
// 3. PUT /api/admin/users/:id — แก้ไขข้อมูล User (role, company_name, full_name)
// ══════════════════════════════════════════════════════════
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, role } = req.body;

    // ห้าม Admin แก้ไขตัวเอง
    if (Number(id) === req.user.userId) {
      return res.status(400).json({ status: 'error', message: 'ไม่สามารถแก้ไขบัญชีตัวเองผ่าน Admin ได้' });
    }

    const validRoles = ['admin', 'project_owner', 'viewer'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ status: 'error', message: 'Role ไม่ถูกต้อง' });
    }

    await db.query(
      `UPDATE users SET
        full_name = COALESCE(?, full_name),
        role = COALESCE(?, role)
       WHERE user_id = ?`,
      [full_name || null, role || null, id]
    );

    res.json({ status: 'success', message: 'อัปเดตข้อมูล User สำเร็จ' });
  } catch (error) {
    console.error('[Admin] updateUser Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update user' });
  }
};

// ══════════════════════════════════════════════════════════
// 3.5. PATCH /api/admin/users/:id/deactivate — Soft delete บัญชีที่ไม่ active เกิน 3 ปี
// ══════════════════════════════════════════════════════════
exports.softDeleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // ห้าม Admin ปิดใช้งานบัญชีตัวเอง
    if (Number(id) === req.user.userId) {
      return res.status(400).json({ status: 'error', message: 'ไม่สามารถปิดใช้งานบัญชีตัวเองได้' });
    }

    // ตรวจสอบฝั่ง server ด้วยว่า user นี้เข้าเงื่อนไข "ไม่ active เกิน 3 ปี" จริง — ป้องกันไม่ให้
    // ปิดใช้งานบัญชีที่ยัง active อยู่ผ่าน endpoint นี้ (ต่อให้ frontend ส่ง request มาผิดก็ตาม)
    const [[user]] = await db.query(
      `SELECT user_id, is_active,
         (COALESCE(last_login_at, created_at) < DATE_SUB(NOW(), INTERVAL 3 YEAR)) AS is_dormant
       FROM users WHERE user_id = ?`,
      [id]
    );
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'ไม่พบ User' });
    }
    if (!user.is_active) {
      return res.status(400).json({ status: 'error', message: 'บัญชีนี้ถูกปิดใช้งานไปแล้ว' });
    }
    if (!user.is_dormant) {
      return res.status(400).json({ status: 'error', message: 'บัญชีนี้ยังไม่ active เกิน 3 ปี จึง soft delete ไม่ได้' });
    }

    await db.query('UPDATE users SET is_active = 0 WHERE user_id = ?', [id]);

    res.json({ status: 'success', message: 'ปิดใช้งานบัญชี (soft delete) สำเร็จ' });
  } catch (error) {
    console.error('[Admin] softDeleteUser Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to deactivate user' });
  }
};

// ══════════════════════════════════════════════════════════
// 4. DELETE /api/admin/users/:id — ลบ User และโปรเจกต์ทั้งหมดของ User นั้น
// ══════════════════════════════════════════════════════════
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // ห้ามลบตัวเอง
    if (Number(id) === req.user.userId) {
      return res.status(400).json({ status: 'error', message: 'ไม่สามารถลบบัญชีตัวเองได้' });
    }

    // ลบ ledger/access ของโปรเจกต์ที่เป็นเจ้าของ → projects → access ที่ user นี้เกี่ยวข้อง (ในฐานะ
    // viewer/editor ของโปรเจกต์คนอื่น หรือเป็นคนแชร์ให้คนอื่น) → user ตามลำดับ FK
    await db.query(
      'DELETE pl FROM project_ledger pl INNER JOIN projects p ON pl.project_id = p.project_id WHERE p.user_id = ?',
      [id]
    );
    await db.query(
      'DELETE pa FROM project_access pa INNER JOIN projects p ON pa.project_id = p.project_id WHERE p.user_id = ?',
      [id]
    );
    await db.query('DELETE FROM projects WHERE user_id = ?', [id]);
    await db.query('DELETE FROM project_access WHERE user_id = ? OR shared_by = ?', [id, id]);
    await db.query('DELETE FROM users WHERE user_id = ?', [id]);

    res.json({ status: 'success', message: 'ลบ User สำเร็จ' });
  } catch (error) {
    console.error('[Admin] deleteUser Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete user' });
  }
};
