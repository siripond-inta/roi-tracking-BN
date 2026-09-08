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
        p.is_public,
        p.custom_project_type,
        p.created_at,
        u.full_name AS owner_name,
        u.email AS owner_email,
        u.company_name AS owner_company,
        pt.type_name AS project_type,
        CASE WHEN EXISTS(
          SELECT 1 FROM project_ledger pl 
          WHERE pl.project_id = p.project_id AND pl.phase = 'Actual'
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
        u.company_name,
        u.role,
        u.created_at,
        COUNT(p.project_id) AS project_count
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
    const { full_name, company_name, role } = req.body;

    // ห้าม Admin แก้ไขตัวเอง
    if (Number(id) === req.user.userId) {
      return res.status(400).json({ status: 'error', message: 'ไม่สามารถแก้ไขบัญชีตัวเองผ่าน Admin ได้' });
    }

    const validRoles = ['user', 'admin'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ status: 'error', message: 'Role ไม่ถูกต้อง' });
    }

    await db.query(
      `UPDATE users SET 
        full_name = COALESCE(?, full_name),
        company_name = COALESCE(?, company_name),
        role = COALESCE(?, role)
       WHERE user_id = ?`,
      [full_name || null, company_name || null, role || null, id]
    );

    res.json({ status: 'success', message: 'อัปเดตข้อมูล User สำเร็จ' });
  } catch (error) {
    console.error('[Admin] updateUser Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update user' });
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

    // ลบ ledger → projects → user ตามลำดับ FK
    await db.query(
      'DELETE pl FROM project_ledger pl INNER JOIN projects p ON pl.project_id = p.project_id WHERE p.user_id = ?',
      [id]
    );
    await db.query('DELETE FROM projects WHERE user_id = ?', [id]);
    await db.query('DELETE FROM users WHERE user_id = ?', [id]);

    res.json({ status: 'success', message: 'ลบ User สำเร็จ' });
  } catch (error) {
    console.error('[Admin] deleteUser Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete user' });
  }
};
