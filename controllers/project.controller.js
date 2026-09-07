// controllers/project.controller.js
// จัดการ Logic ทั้งหมดของ Project และ Ledger API

const db = require('../config/db.config');

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
        pt.type_name AS project_type,
        -- คำนวณ status จาก project_ledger.phase
        -- ถ้ามี record phase='Actual' อยู่ → สถานะ='Actual' ไม่งั้นเป็น 'Estimated'
        CASE WHEN EXISTS(
          SELECT 1 FROM project_ledger pl 
          WHERE pl.project_id = p.project_id AND pl.phase = 'Actual'
        ) THEN 'Actual' ELSE 'Estimated' END AS status
      FROM projects p
      LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
      WHERE p.user_id = ?            -- กรองเฉพาะโปรเจกต์ของ user คนนี้
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
    // เพิ่ม AND p.user_id = ? ป้องกัน User B เรียก /api/projects/101 แล้วเห็นข้อมูล User A
    // ถ้าไม่พบหรือไม่ใช่ของตัวเอง → 404 เหมือนกัน (ไม่บอกว่ามีอยู่จริงหรือเปล่า)
    const userId = req.user.userId;

    const sql = `
      SELECT 
        p.project_id, p.project_name, p.duration_months, 
        p.initial_budget, p.user_id, p.created_at,
        pt.type_name AS project_type,
        CASE WHEN EXISTS(
          SELECT 1 FROM project_ledger pl 
          WHERE pl.project_id = p.project_id AND pl.phase = 'Actual'
        ) THEN 'Actual' ELSE 'Estimated' END AS status
      FROM projects p
      LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
      WHERE p.project_id = ? AND p.user_id = ?   -- ตรวจทั้ง ID และ ownership
    `;

    const [rows] = await db.query(sql, [id, userId]);

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
// 3. POST /api/projects — สร้างโปรเจกต์ใหม่
// ══════════════════════════════════════════════════════════
exports.createProject = async (req, res) => {
  try {
    const { project_name, project_type_id, duration_months, initial_budget } = req.body;

    // ── Security Fix #3 ─────────────────────────────────────────────────────
    // ดึง user_id จาก JWT token ที่ถูก decode ใน verifyToken middleware
    // ลบ '|| 1' fallback เดิมออก — ถ้าไม่มี userId ใน token หมายถึง token ผิดปกติ
    const user_id = req.user?.userId;
    if (!user_id) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized: ไม่พบข้อมูล User' });
    }

    if (!project_name || !initial_budget) {
      return res.status(400).json({ status: 'error', message: 'กรุณากรอกข้อมูลให้ครบ' });
    }

    // ตาราง projects ไม่มี AUTO_INCREMENT จึงต้องหา ID ถัดไปด้วย MAX() + 1
    // COALESCE(MAX, 100): ถ้าตารางว่าง ให้เริ่มต้นที่ 101
    const [[{ maxId }]] = await db.query(
      'SELECT COALESCE(MAX(project_id), 100) AS maxId FROM projects'
    );
    const newProjectId = maxId + 1;

    await db.query(
      `INSERT INTO projects (project_id, user_id, project_name, project_type_id, duration_months, initial_budget)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newProjectId, user_id, project_name, project_type_id || 1, duration_months || 12, initial_budget]
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

    // ต้องลบ project_ledger ก่อนเสมอ เพราะมี Foreign Key อ้างถึง projects.project_id
    // ถ้าลบ projects ก่อน จะเกิด FK Constraint Error
    await db.query('DELETE FROM project_ledger WHERE project_id = ?', [id]);
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
    res.json({ status: 'success', data: rows });

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

    res.json({ status: 'success', data: rows });

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

    // ตาราง project_ledger ไม่มี AUTO_INCREMENT จึงต้องหา ID ถัดไป
    const [[{ maxId }]] = await db.query(
      'SELECT COALESCE(MAX(ledger_id), 0) AS maxId FROM project_ledger'
    );
    let nextId = maxId + 1;

    // วันที่ default = วันนี้ (ถ้า frontend ไม่ส่งมา)
    const today = new Date().toISOString().split('T')[0];

    // Insert ทีละรายการในลูป
    for (const item of ledgers) {
      await db.query(
        `INSERT INTO project_ledger 
         (ledger_id, project_id, phase, type_id, category_id, total_value, transaction_date, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nextId++,
          id,
          phase,
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