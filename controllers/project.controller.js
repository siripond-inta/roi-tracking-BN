// controllers/project.controller.js
// จัดการ Logic ทั้งหมดของ Project และ Ledger API

const db = require('../config/db.config');

// ── Schema v1.2 เก็บ phase เป็น 'ESTIMATED'/'ACTUAL' (ตัวใหญ่ทั้งหมด) แต่ API เดิม/frontend
// ยังใช้ 'Estimated'/'Actual' — แปลงค่าตรงนี้ที่เดียว ไม่ต้องแก้ frontend ────────────────────
// เพดานระยะเวลาโครงการ (10 ปี) — กันค่าที่ใหญ่เกินจริงจนรายงานรายเดือนยาวจนใช้งานไม่ได้
const MAX_DURATION_MONTHS = 120;

const PHASE_TO_DB = { Estimated: 'ESTIMATED', Actual: 'ACTUAL' };
const PHASE_FROM_DB = { ESTIMATED: 'Estimated', ACTUAL: 'Actual' };
const mapLedgerPhase = (row) => ({ ...row, phase: PHASE_FROM_DB[row.phase] || row.phase });

// คอลัมน์ ledger ที่ API ส่งกลับ (ใช้ร่วมกันทุก endpoint ที่อ่าน ledger)
const LEDGER_SELECT_COLUMNS = `
  pl.ledger_id,
  pl.project_id,
  pl.phase,
  pl.period_index,
  pl.type_id,
  pl.category_id,
  pl.unit_qty,
  pl.unit_cost,
  pl.total_value,
  pl.note,
  pl.transaction_date,
  pl.created_at,
  c.category_name,
  c.category_group,
  et.type_name,
  et.is_inflow
`;

// ── ตรวจสิทธิ์เข้าถึงโปรเจกต์ ────────────────────────────────────────────────
// เงื่อนไขที่ใช้ร่วมกันทุก query: "สาธารณะ" = มีการแชร์สิทธิ์ viewer ให้คนอื่นอย่างน้อยหนึ่งคน
//
// เดิมตรวจว่า "ต้องมีแถว project_access ของ user คนนี้" ซึ่งพังเมื่อเจ้าของกดเปิดสาธารณะไปแล้ว
// ค่อยมีผู้ใช้สมัครเข้ามาทีหลัง — คนใหม่จะไม่มีแถวนั้น เลยมองไม่เห็นโปรเจกต์สาธารณะเลย
// ทั้งที่ควรเห็น ตอนนี้จึงเช็คจาก "สถานะสาธารณะของตัวโปรเจกต์" แทนการเช็ครายคน
const IS_PUBLIC_SQL = `EXISTS(
  SELECT 1 FROM project_access pa
  WHERE pa.project_id = p.project_id AND pa.user_id <> p.user_id AND pa.permission_level = 'viewer'
)`;

// อ่าน: เจ้าของ / คนที่ถูกแชร์ให้โดยตรง / หรือโปรเจกต์นั้นเปิดสาธารณะอยู่
async function canReadProject(projectId, userId) {
  const [[row]] = await db.query(
    `SELECT 1 AS ok FROM projects p
     WHERE p.project_id = ?
       AND (
         p.user_id = ?
         OR EXISTS(SELECT 1 FROM project_access pa WHERE pa.project_id = p.project_id AND pa.user_id = ?)
         OR ${IS_PUBLIC_SQL}
       )`,
    [projectId, userId, userId]
  );
  return !!row;
}

async function getProjectDuration(projectId) {
  const [[row]] = await db.query('SELECT duration_months FROM projects WHERE project_id = ?', [projectId]);
  return Number(row?.duration_months) || 12;
}

// เขียน: เจ้าของเท่านั้น — คนที่ถูกแชร์ให้ดูแก้ข้อมูลไม่ได้
async function isProjectOwner(projectId, userId) {
  const [[row]] = await db.query(
    'SELECT 1 AS ok FROM projects WHERE project_id = ? AND user_id = ?',
    [projectId, userId]
  );
  return !!row;
}

// บันทึก ledger หนึ่งแถว — ใช้ร่วมกันทั้งตอน create และ update ทั้ง 2 phase
// FR03-2: period_index = งวด/เดือนที่ของรายการ (1..duration_months)
// FR03-4: ผลประโยชน์ทางอ้อมเก็บ unit_qty (ปริมาณที่ลดได้) × unit_cost (อัตรา/ต้นทุนต่อหน่วย)
//         โดย total_value คำนวณจาก qty × cost ถ้าส่งทั้งคู่มา
// ตรวจว่า category_id / type_id ที่ส่งมามีอยู่จริงก่อน insert — ถ้าปล่อยให้ FK error เอง
// จะได้ 500 พร้อมข้อความกว้างๆ ที่ผู้ใช้ไม่รู้ว่าผิดตรงไหน
async function validateLedgerRefs(ledgers) {
  const categoryIds = [...new Set(ledgers.map((l) => l.category_id).filter(Boolean))];
  const typeIds = [...new Set(ledgers.map((l) => Number(l.type_id)).filter(Boolean))];

  if (categoryIds.length > 0) {
    const [rows] = await db.query('SELECT category_id FROM categories WHERE category_id IN (?)', [categoryIds]);
    const found = new Set(rows.map((r) => r.category_id));
    const missing = categoryIds.filter((id) => !found.has(id));
    if (missing.length > 0) return `ไม่พบหมวดหมู่: ${missing.join(', ')}`;
  }

  if (typeIds.length > 0) {
    const [rows] = await db.query('SELECT type_id FROM entry_types WHERE type_id IN (?)', [typeIds]);
    const found = new Set(rows.map((r) => Number(r.type_id)));
    const missing = typeIds.filter((id) => !found.has(id));
    if (missing.length > 0) return `ไม่พบประเภทรายการ: ${missing.join(', ')}`;
  }

  return null;
}

async function insertLedgerRow(projectId, dbPhase, item, fallbackDate, createdBy, maxPeriod) {
  const qty = item.unit_qty != null && item.unit_qty !== '' ? Number(item.unit_qty) : null;
  const cost = item.unit_cost != null && item.unit_cost !== '' ? Number(item.unit_cost) : null;
  const total = qty != null && cost != null ? qty * cost : Number(item.total_value) || 0;
  // งวดต้องอยู่ในช่วง 1..ระยะเวลาโครงการ — กันข้อมูลที่ยิงตรงมาที่ API ด้วยงวดเกินจริง
  // ซึ่งจะทำให้ตารางรายเดือนในรายงานยืดออกไปเป็นร้อยแถว
  const period = Math.min(Math.max(1, Number(item.period_index) || 1), maxPeriod || 12);

  await db.query(
    `INSERT INTO project_ledger
       (project_id, phase, period_index, type_id, category_id,
        unit_qty, unit_cost, amount_base, total_value, transaction_date, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      dbPhase,
      period,
      item.type_id,
      item.category_id,
      qty,
      cost,
      total,
      total,
      item.transaction_date || fallbackDate,
      item.note || '',
      createdBy || null
    ]
  );
}

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
        p.target_roi_percent,
        p.project_type_id,
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
        p.initial_budget, p.target_roi_percent, p.project_type_id,
        p.user_id, p.created_at,
        EXISTS(
          SELECT 1 FROM project_access pa
          WHERE pa.project_id = p.project_id AND pa.user_id <> p.user_id AND pa.permission_level = 'viewer'
        ) AS is_public,
        pt.type_name AS project_type,
        u.full_name AS owner_name,
        CASE WHEN EXISTS(
          SELECT 1 FROM project_ledger pl
          WHERE pl.project_id = p.project_id AND pl.phase = 'ACTUAL'
        ) THEN 'Actual' ELSE 'Estimated' END AS status
      FROM projects p
      LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
      LEFT JOIN users u ON p.user_id = u.user_id
      WHERE p.project_id = ?
        AND (
          p.user_id = ?
          OR EXISTS(SELECT 1 FROM project_access pa WHERE pa.project_id = p.project_id AND pa.user_id = ?)
          OR ${IS_PUBLIC_SQL}
        )
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
      LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
      LEFT JOIN users u ON p.user_id = u.user_id
      WHERE p.user_id <> ? AND ${IS_PUBLIC_SQL}
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
    // FR02-1: เป้าหมาย ROI (target_roi_percent) เป็นข้อมูลพื้นฐานของโครงการด้วย
    const { project_name, project_type_id, duration_months, initial_budget, target_roi_percent } = req.body;

    const user_id = req.user?.userId;
    if (!user_id) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized: ไม่พบข้อมูล User' });
    }

    if (!project_name || !initial_budget) {
      return res.status(400).json({ status: 'error', message: 'กรุณากรอกข้อมูลให้ครบ' });
    }
    if (duration_months != null && (Number(duration_months) < 1 || Number(duration_months) > MAX_DURATION_MONTHS)) {
      return res.status(400).json({
        status: 'error',
        message: `ระยะเวลาโครงการต้องอยู่ระหว่าง 1–${MAX_DURATION_MONTHS} เดือน`
      });
    }

    // project_id เป็น AUTO_INCREMENT แล้ว ไม่ต้องหา MAX(project_id)+1 เอง
    const [result] = await db.query(
      `INSERT INTO projects (user_id, project_name, project_type_id, duration_months, initial_budget, target_roi_percent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        project_name,
        project_type_id || 1,
        duration_months || 12,
        initial_budget,
        target_roi_percent != null && target_roi_percent !== '' ? target_roi_percent : null
      ]
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
// 3.5. PUT /api/projects/:id — แก้ไขข้อมูลพื้นฐานของโครงการ (FR02-2)
// ══════════════════════════════════════════════════════════
exports.updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { project_name, project_type_id, duration_months, initial_budget, target_roi_percent } = req.body;

    const [[project]] = await db.query(
      'SELECT project_id FROM projects WHERE project_id = ? AND user_id = ?',
      [id, userId]
    );
    if (!project) {
      return res.status(404).json({ status: 'error', message: 'Project not found' });
    }

    if (project_name != null && !String(project_name).trim()) {
      return res.status(400).json({ status: 'error', message: 'ชื่อโครงการห้ามเว้นว่าง' });
    }
    // จำกัดเพดานไว้ด้วย ไม่งั้นใส่ 999 เดือนแล้วตารางรายเดือน/dropdown เลือกงวดจะยาวจนหน้าค้าง
    if (duration_months != null && (Number(duration_months) < 1 || Number(duration_months) > MAX_DURATION_MONTHS)) {
      return res.status(400).json({
        status: 'error',
        message: `ระยะเวลาโครงการต้องอยู่ระหว่าง 1–${MAX_DURATION_MONTHS} เดือน`
      });
    }

    // ระยะเวลาโครงการสั้นลงจนมีรายการบันทึกไว้เกินงวดสุดท้าย จะทำให้ข้อมูลเดือนนั้นหายไปจากรายงาน
    if (duration_months != null) {
      const [[{ maxPeriod }]] = await db.query(
        'SELECT COALESCE(MAX(period_index), 0) AS maxPeriod FROM project_ledger WHERE project_id = ?',
        [id]
      );
      if (maxPeriod > Number(duration_months)) {
        return res.status(400).json({
          status: 'error',
          message: `ลดระยะเวลาโครงการไม่ได้ — มีรายการบันทึกไว้ถึงเดือนที่ ${maxPeriod} แล้ว`
        });
      }
    }

    await db.query(
      `UPDATE projects SET
         project_name = COALESCE(?, project_name),
         project_type_id = COALESCE(?, project_type_id),
         duration_months = COALESCE(?, duration_months),
         initial_budget = COALESCE(?, initial_budget),
         target_roi_percent = ?
       WHERE project_id = ?`,
      [
        project_name != null ? String(project_name).trim() : null,
        project_type_id ?? null,
        duration_months ?? null,
        initial_budget ?? null,
        target_roi_percent != null && target_roi_percent !== '' ? target_roi_percent : null,
        id
      ]
    );

    res.json({ status: 'success', message: 'บันทึกการแก้ไขโครงการสำเร็จ' });
  } catch (error) {
    console.error('[Project] updateProject Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update project' });
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
      SELECT ${LEDGER_SELECT_COLUMNS}
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

    // ต้องเป็นเจ้าของหรือถูกแชร์ให้ดูเท่านั้น ไม่งั้นใครก็ตามที่ login แล้วจะอ่าน ledger
    // ของโปรเจกต์ส่วนตัวคนอื่นได้ด้วยการเดา id
    if (!(await canReadProject(id, req.user.userId))) {
      return res.status(404).json({ status: 'error', message: 'Project not found' });
    }

    // JOIN กับ categories และ entry_types เพื่อดึงชื่อ (ไม่ใช่แค่ ID)
    const sql = `
      SELECT ${LEDGER_SELECT_COLUMNS}
      FROM project_ledger pl
      LEFT JOIN categories c ON pl.category_id = c.category_id
      LEFT JOIN entry_types et ON pl.type_id = et.type_id
      WHERE pl.project_id = ?
      ORDER BY pl.phase DESC, pl.period_index ASC, pl.type_id ASC
    `;

    const [rows] = await db.query(sql, [id]);

    res.json({ status: 'success', data: rows.map(mapLedgerPhase) });

  } catch (error) {
    console.error('[Project] getLedgersByProject Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve ledgers' });
  }
};

// ══════════════════════════════════════════════════════════
// 5.5. GET /api/projects/:id/analytics — ประมวลผลและคำนวณทั้งหมดของโครงการ
//
// รวม FR04 (คำนวณ) และ FR05 (วิเคราะห์) ไว้ที่เดียว คำนวณฝั่ง server เพื่อให้ทุกหน้า
// (รายงาน/แดชบอร์ด/กราฟ) ได้ตัวเลขชุดเดียวกันเสมอ:
//   FR04-1 Net Cash Flow (NCF) และกระแสเงินสดสะสมรายเดือน
//   FR04-2 ROI = ((ผลประโยชน์รวม - ต้นทุนรวม) / ต้นทุนรวม) × 100
//   FR04-3 ระยะเวลาคืนทุน = เดือนแรกที่กระแสเงินสดสะสม >= เงินลงทุนเริ่มต้น
//   FR04-4 สถานะ คุ้มค่า/ไม่คุ้มค่า เทียบ ROI กับเป้าหมายที่ตั้งไว้
//   FR05-2 ส่วนต่าง (variance) ระหว่างคาดการณ์กับจริง ทั้งรายเดือนและสะสม
// ══════════════════════════════════════════════════════════
const num = (v) => Number(v) || 0;

// FR04-2: ต้นทุนรวมเป็น 0 แปลว่ายังไม่มีข้อมูลต้นทุน คืน 0 แทนการหารด้วยศูนย์
function calcRoi(totalBenefit, totalCost) {
  if (totalCost <= 0) return 0;
  return ((totalBenefit - totalCost) / totalCost) * 100;
}

// FR04-3: เดือนแรกที่กระแสเงินสดสะสมมากกว่าหรือเท่ากับเงินลงทุนเริ่มต้น (null = ยังไม่คืนทุน)
function findPaybackMonth(monthlyRows, initialBudget) {
  for (const row of monthlyRows) {
    if (row.cumulative >= initialBudget && initialBudget > 0) return row.period;
  }
  return null;
}

exports.getProjectAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // สิทธิ์การเข้าถึงเหมือน getProjectById — เจ้าของ หรือผู้ที่ถูกแชร์ให้ดู
    const [[project]] = await db.query(
      `SELECT p.project_id, p.project_name, p.duration_months, p.initial_budget,
              p.target_roi_percent, p.user_id, p.created_at, pt.type_name AS project_type
       FROM projects p
       LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
       WHERE p.project_id = ?
         AND (
           p.user_id = ?
           OR EXISTS(SELECT 1 FROM project_access pa WHERE pa.project_id = p.project_id AND pa.user_id = ?)
           OR ${IS_PUBLIC_SQL}
         )`,
      [id, userId, userId]
    );

    if (!project) {
      return res.status(404).json({ status: 'error', message: 'Project not found' });
    }

    // รวมยอดรายรับ/รายจ่ายของแต่ละงวด แยกตาม phase
    const [periodRows] = await db.query(
      `SELECT pl.phase, pl.period_index,
              SUM(CASE WHEN et.is_inflow = 1 THEN pl.total_value ELSE 0 END) AS revenue,
              SUM(CASE WHEN et.is_inflow = 0 THEN pl.total_value ELSE 0 END) AS expense
       FROM project_ledger pl
       LEFT JOIN entry_types et ON pl.type_id = et.type_id
       WHERE pl.project_id = ?
       GROUP BY pl.phase, pl.period_index
       ORDER BY pl.period_index ASC`,
      [id]
    );

    const durationMonths = Math.max(1, num(project.duration_months) || 12);
    const initialBudget = num(project.initial_budget);

    // จำนวนงวดที่แสดง = ระยะเวลาโครงการ แต่ถ้ามีข้อมูลเลยไปกว่านั้น (เช่นแก้ระยะเวลาทีหลัง)
    // ก็ต้องแสดงให้ครบ ไม่งั้นยอดรวมรายเดือนจะไม่ตรงกับยอดรวมทั้งโครงการ
    const maxRecordedPeriod = periodRows.reduce((max, r) => Math.max(max, num(r.period_index)), 0);
    const periodCount = Math.max(durationMonths, maxRecordedPeriod);

    const bucket = (phase, period) =>
      periodRows.find((r) => r.phase === phase && num(r.period_index) === period);

    const monthly = [];
    let estCumulative = 0;
    let actCumulative = 0;
    const estMonthlyForPayback = [];
    const actMonthlyForPayback = [];
    let hasActualData = false;

    for (let period = 1; period <= periodCount; period++) {
      const est = bucket('ESTIMATED', period);
      const act = bucket('ACTUAL', period);

      const estRevenue = num(est?.revenue);
      const estExpense = num(est?.expense);
      const estNcf = estRevenue - estExpense;
      estCumulative += estNcf;

      const actRevenue = num(act?.revenue);
      const actExpense = num(act?.expense);
      const actNcf = actRevenue - actExpense;
      actCumulative += actNcf;

      if (act) hasActualData = true;

      estMonthlyForPayback.push({ period, cumulative: estCumulative });
      actMonthlyForPayback.push({ period, cumulative: actCumulative });

      monthly.push({
        period,
        estimated: { revenue: estRevenue, expense: estExpense, ncf: estNcf, cumulative: estCumulative },
        actual: {
          revenue: actRevenue,
          expense: actExpense,
          ncf: actNcf,
          cumulative: actCumulative,
          hasData: !!act
        },
        // FR05-2: ส่วนต่างรายเดือนและสะสม (จริง - คาดการณ์)
        variance: {
          revenue: actRevenue - estRevenue,
          expense: actExpense - estExpense,
          ncf: actNcf - estNcf,
          cumulative: actCumulative - estCumulative
        }
      });
    }

    const totalEstRevenue = monthly.reduce((s, m) => s + m.estimated.revenue, 0);
    const totalEstExpense = monthly.reduce((s, m) => s + m.estimated.expense, 0);
    const totalActRevenue = monthly.reduce((s, m) => s + m.actual.revenue, 0);
    const totalActExpense = monthly.reduce((s, m) => s + m.actual.expense, 0);

    const estRoi = calcRoi(totalEstRevenue, totalEstExpense);
    const actRoi = calcRoi(totalActRevenue, totalActExpense);

    const targetRoi = project.target_roi_percent != null ? num(project.target_roi_percent) : null;

    // FR04-4: เทียบกับ ROI จริงถ้ามีข้อมูล Actual แล้ว ถ้ายังไม่มีก็เทียบกับที่คาดการณ์ไว้
    // (แจ้งด้วยว่าใช้ฐานไหนตัดสิน เพื่อไม่ให้เข้าใจผิดว่าเป็นผลจริงทั้งที่ยังไม่ได้บันทึก)
    const worthwhileBasis = hasActualData ? 'actual' : 'estimated';
    const roiForComparison = hasActualData ? actRoi : estRoi;
    const isWorthwhile = targetRoi == null ? null : roiForComparison >= targetRoi;

    // สรุปตามหมวดหมู่ — ใช้ทำกราฟแท่งเปรียบเทียบผลประโยชน์ (FR05-1)
    const [categoryRows] = await db.query(
      `SELECT pl.category_id, c.category_name, c.category_group, et.is_inflow,
              SUM(CASE WHEN pl.phase = 'ESTIMATED' THEN pl.total_value ELSE 0 END) AS estimated,
              SUM(CASE WHEN pl.phase = 'ACTUAL' THEN pl.total_value ELSE 0 END) AS actual
       FROM project_ledger pl
       LEFT JOIN categories c ON pl.category_id = c.category_id
       LEFT JOIN entry_types et ON pl.type_id = et.type_id
       WHERE pl.project_id = ?
       GROUP BY pl.category_id, c.category_name, c.category_group, et.is_inflow
       ORDER BY et.is_inflow DESC, pl.category_id ASC`,
      [id]
    );

    const byCategory = categoryRows.map((r) => ({
      category_id: r.category_id,
      category_name: r.category_name,
      category_group: r.category_group,
      is_inflow: !!r.is_inflow,
      estimated: num(r.estimated),
      actual: num(r.actual),
      variance: num(r.actual) - num(r.estimated)
    }));

    res.json({
      status: 'success',
      data: {
        project: {
          project_id: project.project_id,
          project_name: project.project_name,
          project_type: project.project_type,
          duration_months: durationMonths,
          initial_budget: initialBudget,
          target_roi_percent: targetRoi
        },
        monthly,
        summary: {
          hasActualData,
          estimated: {
            totalRevenue: totalEstRevenue,
            totalExpense: totalEstExpense,
            netProfit: totalEstRevenue - totalEstExpense,
            roi: estRoi,
            paybackMonth: findPaybackMonth(estMonthlyForPayback, initialBudget)
          },
          actual: {
            totalRevenue: totalActRevenue,
            totalExpense: totalActExpense,
            netProfit: totalActRevenue - totalActExpense,
            roi: actRoi,
            paybackMonth: findPaybackMonth(actMonthlyForPayback, initialBudget)
          },
          variance: {
            revenue: totalActRevenue - totalEstRevenue,
            expense: totalActExpense - totalEstExpense,
            netProfit: (totalActRevenue - totalActExpense) - (totalEstRevenue - totalEstExpense),
            roi: actRoi - estRoi
          },
          targetRoi,
          roiForComparison,
          worthwhileBasis,
          isWorthwhile
        },
        byCategory
      }
    });
  } catch (error) {
    console.error('[Project] getProjectAnalytics Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to calculate project analytics' });
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

    // เฉพาะเจ้าของโปรเจกต์เท่านั้นที่บันทึกข้อมูลได้ (ตรงกับ endpoint อัปเดต ledger อีก 2 ตัว)
    if (!(await isProjectOwner(id, req.user.userId))) {
      return res.status(404).json({ status: 'error', message: 'Project not found' });
    }

    if (!ledgers || !Array.isArray(ledgers) || ledgers.length === 0) {
      return res.status(400).json({ status: 'error', message: 'กรุณาระบุข้อมูล ledger' });
    }

    if (!phase || !['Estimated', 'Actual'].includes(phase)) {
      return res.status(400).json({ status: 'error', message: 'phase ต้องเป็น Estimated หรือ Actual' });
    }
    const dbPhase = PHASE_TO_DB[phase];

    const refError = await validateLedgerRefs(ledgers);
    if (refError) {
      return res.status(400).json({ status: 'error', message: refError });
    }

    const maxPeriod = await getProjectDuration(id);

    // วันที่ default = วันนี้ (ถ้า frontend ไม่ส่งมา)
    const today = new Date().toISOString().split('T')[0];

    // Insert ทีละรายการในลูป (ledger_id เป็น AUTO_INCREMENT แล้ว)
    for (const item of ledgers) {
      await insertLedgerRow(id, dbPhase, item, today, req.user?.userId, maxPeriod);
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

    if (ledgers && ledgers.length > 0) {
      const refError = await validateLedgerRefs(ledgers);
      if (refError) {
        return res.status(400).json({ status: 'error', message: refError });
      }
    }

    // ลบ Estimated เก่าทั้งหมดแล้ว insert ใหม่
    await db.query('DELETE FROM project_ledger WHERE project_id = ? AND phase = "ESTIMATED"', [id]);

    if (ledgers && ledgers.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const maxPeriod = await getProjectDuration(id);

      for (const item of ledgers) {
        await insertLedgerRow(id, 'ESTIMATED', item, today, userId, maxPeriod);
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

    if (ledgers && ledgers.length > 0) {
      const refError = await validateLedgerRefs(ledgers);
      if (refError) {
        return res.status(400).json({ status: 'error', message: refError });
      }
    }

    await db.query('DELETE FROM project_ledger WHERE project_id = ? AND phase = "ACTUAL"', [id]);

    if (ledgers && ledgers.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const maxPeriod = await getProjectDuration(id);

      for (const item of ledgers) {
        await insertLedgerRow(id, 'ACTUAL', item, today, userId, maxPeriod);
      }
    }

    res.json({ status: 'success', message: 'อัปเดต Actual สำเร็จ' });
  } catch (error) {
    console.error('[Project] updateActualLedgers Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update actual ledgers' });
  }
};