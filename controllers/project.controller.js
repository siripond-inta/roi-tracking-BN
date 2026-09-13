// controllers/project.controller.js
// จัดการ Logic ทั้งหมดของ Project และ Ledger API

const db = require('../config/db.config');

// ── Schema v1.2 เก็บ phase เป็น 'ESTIMATED'/'ACTUAL' (ตัวใหญ่ทั้งหมด) แต่ API เดิม/frontend
// ยังใช้ 'Estimated'/'Actual' — แปลงค่าตรงนี้ที่เดียว ไม่ต้องแก้ frontend ────────────────────
const PHASE_TO_DB = { Estimated: 'ESTIMATED', Actual: 'ACTUAL' };
const PHASE_FROM_DB = { ESTIMATED: 'Estimated', ACTUAL: 'Actual' };
const mapLedgerPhase = (row) => ({ ...row, phase: PHASE_FROM_DB[row.phase] || row.phase });

// ══════════════════════════════════════════════════════════
// 1. GET /api/projects — ดึงโปรเจกต์ทั้งหมด
// ══════════════════════════════════════════════════════════
exports.getAllProjects = async (req, res) => {
  try {
    // ── Security Fix #1 ─────────────────────────────────────────────────────
    // อ่าน userId จาก JWT ที่ verifyToken decode ไว้แล้วใน req.user
    // → ดึงเฉพาะโปรเจกต์ที่เป็นของ user คนนี้เท่านั้น
    const userId = req.user.userId;

    const sql = `
      SELECT
        p.project_id,
        p.project_name,
        p.duration_months,
        p.initial_budget,
        p.user_id,
        p.created_at,
        EXISTS(
          SELECT 1 FROM project_access pa
          WHERE pa.project_id = p.project_id AND pa.user_id <> p.user_id AND pa.permission_level = 'viewer'
        ) AS is_public,
        pt.type_name AS project_type,
        CASE WHEN EXISTS(
          SELECT 1 FROM project_ledger pl
          WHERE pl.project_id = p.project_id AND pl.phase = 'ACTUAL'
        ) THEN 'Actual' ELSE 'Estimated' END AS status
      FROM projects p
      LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
    `;

    // ส่ง userId เป็น prepared statement parameter (ป้องกัน SQL Injection)
    const [rows] = await db.query(sql, [userId]);

    res.json({
      status: 'success',
      message: 'Projects retrieved successfully',
      data: rows
    });

  } catch (error) {
    console.error('[Project] getAllProjects Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve projects' });
  }
};

// ══════════════════════════════════════════════════════════
// 2. GET /api/projects/:id — ดึงโปรเจกต์เดียวตาม ID
// ══════════════════════════════════════════════════════════
exports.getProjectById = async (req, res) => {
  try {
    const { id } = req.params;
    // ── Security Fix #2 ─────────────────────────────────────────────────────
    // อนุญาตให้ดูได้ทั้งเจ้าของโปรเจกต์เอง หรือ user ที่มีสิทธิ์ใน project_access (เช่น
    // viewer ของโปรเจกต์ public ที่เห็นใน Community) — ป้องกัน User B เรียกดูโปรเจกต์ของ
    // User A ที่ไม่ได้แชร์ไว้ ถ้าไม่พบหรือไม่มีสิทธิ์ → 404 เหมือนกัน (ไม่บอกว่ามีอยู่จริงหรือเปล่า)
    const userId = req.user.userId;

    const sql = `
      SELECT
        p.project_id, p.project_name, p.duration_months,
        p.initial_budget, p.user_id, p.created_at,
        EXISTS(
          SELECT 1 FROM project_access pa
          WHERE pa.project_id = p.project_id AND pa.user_id <> p.user_id AND pa.permission_level = 'viewer'
        ) AS is_public,
        pt.type_name AS project_type,
        CASE WHEN EXISTS(
          SELECT 1 FROM project_ledger pl
          WHERE pl.project_id = p.project_id AND pl.phase = 'ACTUAL'
        ) THEN 'Actual' ELSE 'Estimated' END AS status
      FROM projects p
      LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
      WHERE p.project_id = ?
        AND (p.user_id = ? OR EXISTS(
          SELECT 1 FROM project_access pa WHERE pa.project_id = p.project_id AND pa.user_id = ?
        ))
    `;

    const [rows] = await db.query(sql, [id, userId, userId]);

    if (rows.length === 0) {
      // ทั้งกรณี "ไม่มี project" และ "project ของคนอื่น" ตอบ 404 เหมือนกัน
      // เพื่อป้องกัน Information Leakage (ไม่ให้รู้ว่า ID นั้นมีอยู่ในระบบหรือไม่)
      return res.status(404).json({ status: 'error', message: 'Project not found' });
    }

    res.json({ status: 'success', data: rows[0] });

  } catch (error) {
    console.error('[Project] getProjectById Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve project' });
  }
};

// ══════════════════════════════════════════════════════════
// 2.5. GET /api/projects/community — โปรเจกต์ public ของคนอื่นที่แชร์ให้เราดู (viewer)
// ══════════════════════════════════════════════════════════
exports.getCommunityProjects = async (req, res) => {
  try {
    const userId = req.user.userId;

    const sql = `
      SELECT
        p.project_id, p.project_name, p.duration_months,
        p.initial_budget, p.user_id, p.created_at,
        pt.type_name AS project_type,
        u.full_name AS owner_name,
        CASE WHEN EXISTS(
          SELECT 1 FROM project_ledger pl
          WHERE pl.project_id = p.project_id AND pl.phase = 'ACTUAL'
        ) THEN 'Actual' ELSE 'Estimated' END AS status
      FROM projects p
      INNER JOIN project_access pa ON pa.project_id = p.project_id AND pa.user_id = ? AND pa.permission_level = 'viewer'
      LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
      LEFT JOIN users u ON p.user_id = u.user_id
      ORDER BY p.created_at DESC
    `;

    const [rows] = await db.query(sql, [userId]);

    res.json({ status: 'success', data: rows });
  } catch (error) {
    console.error('[Project] getCommunityProjects Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve community projects' });
  }
};

// ══════════════════════════════════════════════════════════
// 3. POST /api/projects — สร้างโปรเจกต์ใหม่
// ══════════════════════════════════════════════════════════
exports.createProject = async (req, res) => {
  try {
    // หมายเหตุ: schema v1.2 ไม่มีคอลัมน์ custom_project_type แล้ว (ถ้า frontend ส่งมาจะถูกละเว้น)
    const { project_name, project_type_id, duration_months, initial_budget } = req.body;

    const user_id = req.user?.userId;
    if (!user_id) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized: ไม่พบข้อมูล User' });
    }

    if (!project_name || !initial_budget) {
      return res.status(400).json({ status: 'error', message: 'กรุณากรอกข้อมูลให้ครบ' });
    }

    // project_id เป็น AUTO_INCREMENT แล้ว ไม่ต้องหา MAX(project_id)+1 เอง
    const [result] = await db.query(
      `INSERT INTO projects (user_id, project_name, project_type_id, duration_months, initial_budget)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, project_name, project_type_id || 1, duration_months || 12, initial_budget]
    );
    const newProjectId = result.insertId;

    // เจ้าของโปรเจกต์ต้องมีแถวใน project_access เสมอ (permission_level = 'owner')
    await db.query(
      `INSERT INTO project_access (project_id, user_id, permission_level) VALUES (?, ?, 'owner')`,
      [newProjectId, user_id]
    );

    res.status(201).json({
      status: 'success',
      message: 'สร้างโปรเจกต์สำเร็จ',
      data: { project_id: newProjectId }
    });

  } catch (error) {
    console.error('[Project] createProject Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create project' });
  }
};

// ══════════════════════════════════════════════════════════
// 4. DELETE /api/projects/:id — ลบโปรเจกต์และ Ledger
// ══════════════════════════════════════════════════════════
exports.deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    // ── Security Fix #4 ─────────────────────────────────────────────────────
    // ตรวจ ownership ก่อนลบ — ป้องกัน User B ส่ง DELETE /api/projects/101
    // แล้วลบโปรเจกต์ของ User A ได้
    const userId = req.user.userId;

    // ค้นหาว่า project นี้มีอยู่จริงและเป็นของ user คนนี้หรือไม่
    const [[project]] = await db.query(
      'SELECT project_id FROM projects WHERE project_id = ? AND user_id = ?',
      [id, userId]
    );

    if (!project) {
      // ทั้งกรณี "ไม่มี project" และ "project ของคนอื่น" ตอบ 404 เหมือนกัน
      return res.status(404).json({ status: 'error', message: 'Project not found' });
    }

    // ต้องลบ project_ledger และ project_access ก่อนเสมอ เพราะมี Foreign Key อ้างถึง
    // projects.project_id — ถ้าลบ projects ก่อน จะเกิด FK Constraint Error
    await db.query('DELETE FROM project_ledger WHERE project_id = ?', [id]);
    await db.query('DELETE FROM project_access WHERE project_id = ?', [id]);
    await db.query('DELETE FROM projects WHERE project_id = ?', [id]);

    res.json({ status: 'success', message: 'ลบโปรเจกต์สำเร็จ' });

  } catch (error) {
    console.error('[Project] deleteProject Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete project' });
  }
};

// ══════════════════════════════════════════════════════════
// 4.5. GET /api/projects/ledgers — ดึง Ledger ทั้งหมดในระบบ
// ══════════════════════════════════════════════════════════
exports.getAllLedgers = async (req, res) => {
  try {
    // ── Security Fix #5 ─────────────────────────────────────────────────────
    // กรองเฉพาะ Ledger ของโปรเจกต์ที่เป็นของ user คนนี้
    // JOIN กับ projects เพื่อตรวจ user_id — ไม่ดึง ledger ของคนอื่น
    const userId = req.user.userId;

    const sql = `
      SELECT 
        pl.ledger_id,
        pl.project_id,
        pl.phase,
        pl.type_id,
        pl.category_id,
        pl.total_value,
        pl.note,
        pl.transaction_date,
        pl.created_at,
        c.category_name,
        et.type_name
      FROM project_ledger pl
      INNER JOIN projects p ON pl.project_id = p.project_id AND p.user_id = ?
      LEFT JOIN categories c ON pl.category_id = c.category_id
      LEFT JOIN entry_types et ON pl.type_id = et.type_id
      ORDER BY pl.ledger_id ASC
    `;

    const [rows] = await db.query(sql, [userId]);
    res.json({ status: 'success', data: rows.map(mapLedgerPhase) });

  } catch (error) {
    console.error('[Project] getAllLedgers Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve all ledgers' });
  }
};

// ══════════════════════════════════════════════════════════
// 5. GET /api/projects/:id/ledgers — ดึง Ledger รายโปรเจกต์
// ══════════════════════════════════════════════════════════
exports.getLedgersByProject = async (req, res) => {
  try {
    const { id } = req.params;

    // JOIN กับ categories และ entry_types เพื่อดึงชื่อ (ไม่ใช่แค่ ID)
    const sql = `
      SELECT 
        pl.ledger_id,
        pl.project_id,
        pl.phase,
        pl.type_id,
        pl.category_id,
        pl.total_value,
        pl.note,
        pl.transaction_date,
        pl.created_at,
        c.category_name,
        et.type_name
      FROM project_ledger pl
      LEFT JOIN categories c ON pl.category_id = c.category_id
      LEFT JOIN entry_types et ON pl.type_id = et.type_id
      WHERE pl.project_id = ?
      ORDER BY pl.phase DESC, pl.type_id ASC
    `;

    const [rows] = await db.query(sql, [id]);

    res.json({ status: 'success', data: rows.map(mapLedgerPhase) });

  } catch (error) {
    console.error('[Project] getLedgersByProject Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve ledgers' });
  }
};

// ══════════════════════════════════════════════════════════
// 6. POST /api/projects/:id/ledgers — บันทึก Ledger batch
// ══════════════════════════════════════════════════════════
exports.saveLedgers = async (req, res) => {
  try {
    const { id } = req.params;
    // ledgers = array ของรายการ, phase = 'Estimated' หรือ 'Actual'
    const { phase, ledgers } = req.body;

    if (!ledgers || !Array.isArray(ledgers) || ledgers.length === 0) {
      return res.status(400).json({ status: 'error', message: 'กรุณาระบุข้อมูล ledger' });
    }

    if (!phase || !['Estimated', 'Actual'].includes(phase)) {
      return res.status(400).json({ status: 'error', message: 'phase ต้องเป็น Estimated หรือ Actual' });
    }
    const dbPhase = PHASE_TO_DB[phase];

    // วันที่ default = วันนี้ (ถ้า frontend ไม่ส่งมา)
    const today = new Date().toISOString().split('T')[0];

    // Insert ทีละรายการในลูป (ledger_id เป็น AUTO_INCREMENT แล้ว)
    // period_index: ฟอร์มปัจจุบันยังไม่มีแนวคิดเรื่องงวด/period จึงคงที่เป็น 1 ไปก่อน
    for (const item of ledgers) {
      await db.query(
        `INSERT INTO project_ledger
         (project_id, phase, period_index, type_id, category_id, total_value, transaction_date, note)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
        [
          id,
          dbPhase,
          item.type_id,
          item.category_id,
          item.total_value,
          item.transaction_date || today,
          item.note || ''
        ]
      );
    }

    res.status(201).json({
      status: 'success',
      message: `บันทึก Ledger (${phase}) สำเร็จ ${ledgers.length} รายการ`
    });

  } catch (error) {
    console.error('[Project] saveLedgers Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to save ledgers' });
  }
};

// ══════════════════════════════════════════════════════════
// 7. PATCH /api/projects/:id/visibility — สลับ Public/Private
// ══════════════════════════════════════════════════════════
// หมายเหตุ: schema v1.2 ไม่มีคอลัมน์ projects.is_public แล้ว — "สาธารณะ" ตอนนี้หมายถึงมีแถวใน
// project_access ให้ user คนอื่นเป็น 'viewer' (ดูได้อย่างเดียว แก้ไขไม่ได้) แทน
exports.toggleVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { is_public } = req.body;

    // ตรวจ ownership
    const [[project]] = await db.query(
      'SELECT project_id FROM projects WHERE project_id = ? AND user_id = ?',
      [id, userId]
    );
    if (!project) {
      return res.status(404).json({ status: 'error', message: 'Project not found' });
    }

    // กติกา: โปรเจกต์ที่ยังไม่มีข้อมูล Actual (สถานะ Estimated) ห้ามเปิดเป็นสาธารณะ
    // เช็คฝั่ง server ด้วย ไม่พึ่ง frontend อย่างเดียว (ต่อให้ frontend ส่ง request มาผิดก็ตาม)
    if (is_public) {
      const [[{ hasActual }]] = await db.query(
        "SELECT COUNT(*) AS hasActual FROM project_ledger WHERE project_id = ? AND phase = 'ACTUAL'",
        [id]
      );
      if (hasActual === 0) {
        return res.status(400).json({
          status: 'error',
          message: 'ต้องมีข้อมูล Actual ก่อน ถึงจะเปิดโปรเจกต์เป็นสาธารณะได้'
        });
      }
    }

    if (is_public) {
      // แชร์สิทธิ์ viewer ให้ user อื่นทุกคนในระบบ
      const [otherUsers] = await db.query('SELECT user_id FROM users WHERE user_id <> ?', [userId]);
      for (const u of otherUsers) {
        await db.query(
          `INSERT INTO project_access (project_id, user_id, permission_level, shared_by)
           VALUES (?, ?, 'viewer', ?)
           ON DUPLICATE KEY UPDATE permission_level = 'viewer', shared_by = VALUES(shared_by)`,
          [id, u.user_id, userId]
        );
      }
    } else {
      // เอาสิทธิ์ของคนอื่น (ที่ไม่ใช่เจ้าของ) ออกทั้งหมด กลับไปเป็นส่วนตัว
      await db.query('DELETE FROM project_access WHERE project_id = ? AND user_id <> ?', [id, userId]);
    }

    res.json({
      status: 'success',
      message: is_public ? 'เปลี่ยนสถานะเป็นสาธารณะแล้ว' : 'เปลี่ยนสถานะเป็นส่วนตัวแล้ว'
    });
  } catch (error) {
    console.error('[Project] toggleVisibility Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update visibility' });
  }
};

// ══════════════════════════════════════════════════════════
// 8. PUT /api/projects/:id/ledgers/estimated — อัปเดต Estimated Ledger
// ══════════════════════════════════════════════════════════
exports.updateEstimatedLedgers = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { ledgers } = req.body;

    // ตรวจ ownership และยังไม่มี Actual
    const [[project]] = await db.query(
      'SELECT project_id FROM projects WHERE project_id = ? AND user_id = ?',
      [id, userId]
    );
    if (!project) {
      return res.status(404).json({ status: 'error', message: 'Project not found' });
    }

    // ตรวจว่ามี Actual แล้วหรือยัง (ถ้ามีแล้วห้ามแก้ Estimated)
    const [[{ hasActual }]] = await db.query(
      'SELECT COUNT(*) AS hasActual FROM project_ledger WHERE project_id = ? AND phase = "ACTUAL"',
      [id]
    );
    if (hasActual > 0) {
      return res.status(400).json({ status: 'error', message: 'ไม่สามารถแก้ไข Estimated ได้ เนื่องจากมีข้อมูล Actual แล้ว' });
    }

    // ลบ Estimated เก่าทั้งหมดแล้ว insert ใหม่
    await db.query('DELETE FROM project_ledger WHERE project_id = ? AND phase = "ESTIMATED"', [id]);

    if (ledgers && ledgers.length > 0) {
      const today = new Date().toISOString().split('T')[0];

      for (const item of ledgers) {
        await db.query(
          `INSERT INTO project_ledger (project_id, phase, period_index, type_id, category_id, total_value, transaction_date, note)
           VALUES (?, 'ESTIMATED', 1, ?, ?, ?, ?, ?)`,
          [id, item.type_id, item.category_id, item.total_value, item.transaction_date || today, item.note || '']
        );
      }
    }

    res.json({ status: 'success', message: 'อัปเดต Estimated สำเร็จ' });
  } catch (error) {
    console.error('[Project] updateEstimatedLedgers Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update ledgers' });
  }
};

// ══════════════════════════════════════════════════════════
// 9. PUT /api/projects/:id/ledgers/actual — อัปเดต Actual Ledger
// ══════════════════════════════════════════════════════════
exports.updateActualLedgers = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { ledgers } = req.body;

    const [[project]] = await db.query(
      'SELECT project_id FROM projects WHERE project_id = ? AND user_id = ?',
      [id, userId]
    );
    if (!project) {
      return res.status(404).json({ status: 'error', message: 'Project not found' });
    }

    await db.query('DELETE FROM project_ledger WHERE project_id = ? AND phase = "ACTUAL"', [id]);

    if (ledgers && ledgers.length > 0) {
      const today = new Date().toISOString().split('T')[0];

      for (const item of ledgers) {
        await db.query(
          `INSERT INTO project_ledger (project_id, phase, period_index, type_id, category_id, total_value, transaction_date, note)
           VALUES (?, 'ACTUAL', 1, ?, ?, ?, ?, ?)`,
          [id, item.type_id, item.category_id, item.total_value, item.transaction_date || today, item.note || '']
        );
      }
    }

    res.json({ status: 'success', message: 'อัปเดต Actual สำเร็จ' });
  } catch (error) {
    console.error('[Project] updateActualLedgers Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update actual ledgers' });
  }
};