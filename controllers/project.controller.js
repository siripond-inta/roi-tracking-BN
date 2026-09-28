// controllers/project.controller.js
// จัดการ Logic ทั้งหมดของ Project และ Ledger API
// ตรรกะการเงินอยู่ที่ services/finance.js, การตรวจ/กระจายรายการอยู่ที่ services/ledger-input.js

const db = require('../config/db.config');
const { analyzeProject, summarizeForList } = require('../services/finance');
const { expandLedgerItems } = require('../services/ledger-input');

// เพดานระยะเวลาโครงการ (10 ปี) — กันค่าที่ใหญ่เกินจริงจนรายงานรายเดือนยาวจนใช้งานไม่ได้
const MAX_DURATION_MONTHS = 120;
// target_roi_percent เป็น DECIMAL(5,2) เก็บได้ไม่เกิน 999.99
const MAX_TARGET_ROI = 999.99;

// Schema เก็บ phase เป็น 'ESTIMATED'/'ACTUAL' แต่ API/frontend ใช้ 'Estimated'/'Actual'
const PHASE_TO_DB = { Estimated: 'ESTIMATED', Actual: 'ACTUAL' };
const PHASE_FROM_DB = { ESTIMATED: 'Estimated', ACTUAL: 'Actual' };
const mapLedgerPhase = (row) => ({ ...row, phase: PHASE_FROM_DB[row.phase] || row.phase });

// สถานะโครงการที่ผู้ใช้ตั้งได้ (Should-Have: Project Status Management)
//   planning    กำลังวางแผน — กรอกประมาณการ
//   in_progress กำลังดำเนินการ — บันทึกผลจริงได้ (ระบบตั้งให้เองเมื่อบันทึกผลจริงครั้งแรก)
//   completed   สิ้นสุดโครงการแล้ว — ล็อกข้อมูลไม่ให้แก้ จนกว่าจะเปลี่ยนสถานะกลับ
const EDITABLE_STATUSES = ['planning', 'in_progress', 'completed'];
const LOCKED_STATUSES = ['completed', 'archived'];

const LEDGER_SELECT_COLUMNS = `
  pl.ledger_id, pl.project_id, pl.phase, pl.period_index, pl.type_id, pl.category_id,
  pl.unit_qty, pl.unit_cost, pl.total_value, pl.note, pl.transaction_date, pl.created_at,
  c.category_name, c.category_group, c.unit_label, c.rate_label,
  et.type_name, et.is_inflow
`;

// "สาธารณะ" = มีการแชร์สิทธิ์ viewer ให้คนอื่นอย่างน้อยหนึ่งคน — เช็คจากตัวโปรเจกต์ ไม่ใช่รายคน
// (ถ้าเช็ครายคน ผู้ใช้ที่สมัครหลังจากเจ้าของกดเปิดสาธารณะจะมองไม่เห็นโปรเจกต์นั้นเลย)
const IS_PUBLIC_SQL = `EXISTS(
  SELECT 1 FROM project_access pa
  WHERE pa.project_id = p.project_id AND pa.user_id <> p.user_id AND pa.permission_level = 'viewer'
)`;

// อ่านได้: เจ้าของ / คนที่ถูกแชร์ให้โดยตรง / หรือโปรเจกต์เปิดสาธารณะอยู่
const CAN_READ_SQL = `(
  p.user_id = ?
  OR EXISTS(SELECT 1 FROM project_access pa WHERE pa.project_id = p.project_id AND pa.user_id = ?)
  OR ${IS_PUBLIC_SQL}
)`;

const HAS_ACTUAL_SQL = `EXISTS(
  SELECT 1 FROM project_ledger pl WHERE pl.project_id = p.project_id AND pl.phase = 'ACTUAL'
)`;

// คอลัมน์โปรเจกต์ที่ทุก endpoint ส่งกลับ
const PROJECT_COLUMNS = `
  p.project_id, p.project_name, p.duration_months, p.initial_budget, p.target_roi_percent,
  p.project_type_id, p.user_id, p.created_at,
  p.status AS project_status,
  ${IS_PUBLIC_SQL} AS is_public,
  pt.type_name AS project_type,
  pt.calculation_method,
  CASE WHEN ${HAS_ACTUAL_SQL} THEN 'Actual' ELSE 'Estimated' END AS status
`;

const num = (v) => Number(v) || 0;

function badRequest(res, message) {
  return res.status(400).json({ status: 'error', message });
}

function notFound(res) {
  // ทั้ง "ไม่มี project" และ "project ของคนอื่น" ตอบ 404 เหมือนกัน ไม่บอกว่า id นั้นมีอยู่จริงไหม
  return res.status(404).json({ status: 'error', message: 'Project not found' });
}

async function getOwnedProject(projectId, userId) {
  const [[row]] = await db.query(
    `SELECT p.project_id, p.duration_months, p.created_at, p.status
     FROM projects p WHERE p.project_id = ? AND p.user_id = ?`,
    [projectId, userId]
  );
  return row || null;
}

async function hasActualData(projectId, conn = db) {
  const [[{ n }]] = await conn.query(
    "SELECT COUNT(*) AS n FROM project_ledger WHERE project_id = ? AND phase = 'ACTUAL'",
    [projectId]
  );
  return n > 0;
}

async function loadCategoryMap(items) {
  const ids = [...new Set((items || []).map((i) => i && i.category_id).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const [rows] = await db.query(
    `SELECT c.category_id, c.category_name, c.type_id, c.category_group, c.unit_label, c.rate_label, et.is_inflow
     FROM categories c LEFT JOIN entry_types et ON c.type_id = et.type_id
     WHERE c.category_id IN (?)`,
    [ids]
  );
  return new Map(rows.map((r) => [r.category_id, r]));
}

// ตรวจข้อมูลพื้นฐานของโครงการ ใช้ร่วมกันทั้งตอนสร้างและแก้ไข (ค่า undefined = ไม่ได้ส่งมา ข้ามได้)
function validateProjectFields({ project_name, duration_months, initial_budget, target_roi_percent }, isCreate) {
  if (isCreate || project_name !== undefined) {
    if (!project_name || !String(project_name).trim()) return 'กรุณากรอกชื่อโครงการ';
    if (String(project_name).trim().length > 255) return 'ชื่อโครงการยาวเกิน 255 ตัวอักษร';
  }
  if (duration_months !== undefined && duration_months !== null) {
    const d = Number(duration_months);
    if (!Number.isInteger(d) || d < 1 || d > MAX_DURATION_MONTHS) {
      return `ระยะเวลาโครงการต้องเป็นจำนวนเต็มระหว่าง 1–${MAX_DURATION_MONTHS} เดือน`;
    }
  }
  if (isCreate || initial_budget !== undefined) {
    const b = Number(initial_budget);
    if (!Number.isFinite(b) || b <= 0) return 'งบลงทุนเริ่มต้นต้องมากกว่า 0';
  }
  if (target_roi_percent !== undefined && target_roi_percent !== null && target_roi_percent !== '') {
    const t = Number(target_roi_percent);
    if (!Number.isFinite(t) || t < 0 || t > MAX_TARGET_ROI) {
      return `เป้าหมาย ROI ต้องอยู่ระหว่าง 0–${MAX_TARGET_ROI}%`;
    }
  }
  return null;
}

async function insertLedgerRows(conn, projectId, dbPhase, rows, createdBy) {
  if (rows.length === 0) return;
  await conn.query(
    `INSERT INTO project_ledger
       (project_id, phase, period_index, type_id, category_id,
        unit_qty, unit_cost, amount_base, total_value, transaction_date, note, created_by)
     VALUES ?`,
    [
      rows.map((r) => [
        projectId, dbPhase, r.period_index, r.type_id, r.category_id,
        r.unit_qty, r.unit_cost, r.total_value, r.total_value, r.transaction_date, r.note, createdBy || null,
      ]),
    ]
  );
}

// ปรับสถานะให้สอดคล้องกับข้อมูลหลังบันทึกผลจริง: บันทึกผลจริงครั้งแรก → กำลังดำเนินการ,
// ลบผลจริงออกหมด → กลับไปกำลังวางแผน
async function syncStatusAfterActual(conn, projectId) {
  const [[p]] = await conn.query('SELECT status FROM projects WHERE project_id = ?', [projectId]);
  const hasActual = await hasActualData(projectId, conn);
  if (hasActual && p.status === 'planning') {
    await conn.query("UPDATE projects SET status = 'in_progress' WHERE project_id = ?", [projectId]);
  } else if (!hasActual && p.status !== 'planning') {
    await conn.query("UPDATE projects SET status = 'planning' WHERE project_id = ?", [projectId]);
  }
}

// แทนที่ ledger ของ phase หนึ่งทั้งหมดใน transaction เดียว — ถ้าขั้นไหนพัง ข้อมูลเดิมต้องไม่หาย
async function replaceLedgers(projectId, dbPhase, rows, userId, { append = false } = {}) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (!append) {
      await conn.query('DELETE FROM project_ledger WHERE project_id = ? AND phase = ?', [projectId, dbPhase]);
    }
    await insertLedgerRows(conn, projectId, dbPhase, rows, userId);
    if (dbPhase === 'ACTUAL') await syncStatusAfterActual(conn, projectId);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ตรวจสิทธิ์ + สถานะ + ข้อมูล แล้วคืนแถวที่พร้อมบันทึก (ใช้ร่วมกันทั้ง 3 endpoint ที่เขียน ledger)
async function prepareLedgerWrite(req, res, { requireRows }) {
  const project = await getOwnedProject(req.params.id, req.user.userId);
  if (!project) {
    notFound(res);
    return null;
  }
  if (LOCKED_STATUSES.includes(project.status)) {
    badRequest(res, 'โครงการนี้สิ้นสุดแล้ว — เปลี่ยนสถานะเป็น "กำลังดำเนินการ" ก่อนจึงจะแก้ไขข้อมูลได้');
    return null;
  }

  const items = req.body.ledgers;
  if (!Array.isArray(items) || (requireRows && items.length === 0)) {
    badRequest(res, 'กรุณาระบุข้อมูลรายการ');
    return null;
  }

  const categories = await loadCategoryMap(items);
  const { rows, error } = expandLedgerItems(items, categories, project);
  if (error) {
    badRequest(res, error);
    return null;
  }
  return { project, rows };
}

// ══════════════════════════════════════════════════════════
// 1. GET /api/projects — โปรเจกต์ของผู้ใช้ พร้อมตัวชี้วัดสรุป (คำนวณฝั่ง server ด้วยสูตรเดียวกับรายงาน)
// ══════════════════════════════════════════════════════════
exports.getAllProjects = async (req, res) => {
  try {
    const userId = req.user.userId;

    const [projects] = await db.query(
      `SELECT ${PROJECT_COLUMNS}
       FROM projects p
       LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`,
      [userId]
    );

    // ดึงยอดรวมรายเดือนของทุกโปรเจกต์ในครั้งเดียว แล้วส่งให้ finance คำนวณทีละโปรเจกต์
    const [ledgerRows] = await db.query(
      `SELECT pl.project_id, pl.phase, pl.period_index, pl.category_id,
              c.category_name, c.category_group, et.is_inflow,
              SUM(pl.total_value) AS total_value
       FROM project_ledger pl
       INNER JOIN projects p ON pl.project_id = p.project_id AND p.user_id = ?
       LEFT JOIN categories c ON pl.category_id = c.category_id
       LEFT JOIN entry_types et ON pl.type_id = et.type_id
       GROUP BY pl.project_id, pl.phase, pl.period_index, pl.category_id,
                c.category_name, c.category_group, et.is_inflow`,
      [userId]
    );

    const byProject = new Map();
    for (const r of ledgerRows) {
      if (!byProject.has(r.project_id)) byProject.set(r.project_id, []);
      byProject.get(r.project_id).push(r);
    }

    const data = projects.map((p) => ({ ...p, ...summarizeForList(p, byProject.get(p.project_id) || []) }));
    res.json({ status: 'success', message: 'Projects retrieved successfully', data });
  } catch (error) {
    console.error('[Project] getAllProjects Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve projects' });
  }
};

// ══════════════════════════════════════════════════════════
// 2. GET /api/projects/:id
// ══════════════════════════════════════════════════════════
exports.getProjectById = async (req, res) => {
  try {
    const userId = req.user.userId;
    const [rows] = await db.query(
      `SELECT ${PROJECT_COLUMNS}, u.full_name AS owner_name
       FROM projects p
       LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
       LEFT JOIN users u ON p.user_id = u.user_id
       WHERE p.project_id = ? AND ${CAN_READ_SQL}`,
      [req.params.id, userId, userId]
    );
    if (rows.length === 0) return notFound(res);
    res.json({ status: 'success', data: rows[0] });
  } catch (error) {
    console.error('[Project] getProjectById Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve project' });
  }
};

// ══════════════════════════════════════════════════════════
// 2.5. GET /api/projects/community — โปรเจกต์สาธารณะของคนอื่น
// ══════════════════════════════════════════════════════════
exports.getCommunityProjects = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ${PROJECT_COLUMNS}, u.full_name AS owner_name
       FROM projects p
       LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
       LEFT JOIN users u ON p.user_id = u.user_id
       WHERE p.user_id <> ? AND ${IS_PUBLIC_SQL}
       ORDER BY p.created_at DESC`,
      [req.user.userId]
    );
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
    const { project_name, project_type_id, duration_months, initial_budget, target_roi_percent } = req.body;
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized: ไม่พบข้อมูล User' });

    const invalid = validateProjectFields(req.body, true);
    if (invalid) return badRequest(res, invalid);

    if (project_type_id != null) {
      const [[type]] = await db.query('SELECT type_id FROM project_types WHERE type_id = ?', [project_type_id]);
      if (!type) return badRequest(res, 'ไม่พบประเภทโครงการที่เลือก');
    }

    const [result] = await db.query(
      `INSERT INTO projects (user_id, project_name, project_type_id, duration_months, initial_budget, target_roi_percent, status)
       VALUES (?, ?, ?, ?, ?, ?, 'planning')`,
      [
        userId,
        String(project_name).trim(),
        project_type_id || 1,
        duration_months || 12,
        initial_budget,
        target_roi_percent != null && target_roi_percent !== '' ? target_roi_percent : null,
      ]
    );
    const newProjectId = result.insertId;

    // เจ้าของโปรเจกต์ต้องมีแถวใน project_access เสมอ (permission_level = 'owner')
    await db.query(
      `INSERT INTO project_access (project_id, user_id, permission_level) VALUES (?, ?, 'owner')`,
      [newProjectId, userId]
    );

    res.status(201).json({ status: 'success', message: 'สร้างโปรเจกต์สำเร็จ', data: { project_id: newProjectId } });
  } catch (error) {
    console.error('[Project] createProject Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create project' });
  }
};

// ══════════════════════════════════════════════════════════
// 3.5. PUT /api/projects/:id — แก้ไขข้อมูลพื้นฐานและสถานะของโครงการ
// ══════════════════════════════════════════════════════════
exports.updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { project_name, project_type_id, duration_months, initial_budget, target_roi_percent, status } = req.body;

    const project = await getOwnedProject(id, req.user.userId);
    if (!project) return notFound(res);

    const invalid = validateProjectFields(req.body, false);
    if (invalid) return badRequest(res, invalid);

    if (project_type_id != null) {
      const [[type]] = await db.query('SELECT type_id FROM project_types WHERE type_id = ?', [project_type_id]);
      if (!type) return badRequest(res, 'ไม่พบประเภทโครงการที่เลือก');
    }

    // ลดระยะเวลาจนมีรายการเกินงวดสุดท้าย จะทำให้ข้อมูลเดือนนั้นหายไปจากรายงาน
    if (duration_months != null) {
      const [[{ maxPeriod }]] = await db.query(
        'SELECT COALESCE(MAX(period_index), 0) AS maxPeriod FROM project_ledger WHERE project_id = ?',
        [id]
      );
      if (maxPeriod > Number(duration_months)) {
        return badRequest(res, `ลดระยะเวลาโครงการไม่ได้ — มีรายการบันทึกไว้ถึงเดือนที่ ${maxPeriod} แล้ว`);
      }
    }

    if (status !== undefined && status !== null) {
      if (!EDITABLE_STATUSES.includes(status)) return badRequest(res, 'สถานะโครงการไม่ถูกต้อง');
      const hasActual = await hasActualData(id);
      if (status === 'completed' && !hasActual) {
        return badRequest(res, 'ต้องบันทึกผลการดำเนินงานจริงก่อน จึงจะปิดโครงการ (สิ้นสุดโครงการ) ได้');
      }
      if (status === 'planning' && hasActual) {
        return badRequest(res, 'โครงการนี้มีผลการดำเนินงานจริงแล้ว จึงกลับไปสถานะกำลังวางแผนไม่ได้');
      }
    }

    await db.query(
      `UPDATE projects SET
         project_name = COALESCE(?, project_name),
         project_type_id = COALESCE(?, project_type_id),
         duration_months = COALESCE(?, duration_months),
         initial_budget = COALESCE(?, initial_budget),
         target_roi_percent = IF(?, ?, target_roi_percent),
         status = COALESCE(?, status)
       WHERE project_id = ?`,
      [
        project_name != null ? String(project_name).trim() : null,
        project_type_id ?? null,
        duration_months ?? null,
        initial_budget ?? null,
        // ไม่ได้ส่ง target_roi_percent มา (เช่นเปลี่ยนแค่สถานะ) = คงค่าเดิม, ส่ง null/ว่าง = ล้างเป้าหมาย
        target_roi_percent !== undefined,
        target_roi_percent != null && target_roi_percent !== '' ? target_roi_percent : null,
        status ?? null,
        id,
      ]
    );

    res.json({ status: 'success', message: 'บันทึกการแก้ไขโครงการสำเร็จ' });
  } catch (error) {
    console.error('[Project] updateProject Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update project' });
  }
};

// ══════════════════════════════════════════════════════════
// 4. DELETE /api/projects/:id
// ══════════════════════════════════════════════════════════
exports.deleteProject = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    const project = await getOwnedProject(id, req.user.userId);
    if (!project) return notFound(res);

    // ต้องลบ ledger/access ก่อน projects เพราะมี Foreign Key อ้างถึง
    await conn.beginTransaction();
    await conn.query('DELETE FROM project_ledger WHERE project_id = ?', [id]);
    await conn.query('DELETE FROM project_access WHERE project_id = ?', [id]);
    await conn.query('DELETE FROM projects WHERE project_id = ?', [id]);
    await conn.commit();

    res.json({ status: 'success', message: 'ลบโปรเจกต์สำเร็จ' });
  } catch (error) {
    await conn.rollback();
    console.error('[Project] deleteProject Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete project' });
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════
// 4.5. GET /api/projects/ledgers — Ledger ทั้งหมดของผู้ใช้
// ══════════════════════════════════════════════════════════
exports.getAllLedgers = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ${LEDGER_SELECT_COLUMNS}
       FROM project_ledger pl
       INNER JOIN projects p ON pl.project_id = p.project_id AND p.user_id = ?
       LEFT JOIN categories c ON pl.category_id = c.category_id
       LEFT JOIN entry_types et ON pl.type_id = et.type_id
       ORDER BY pl.ledger_id ASC`,
      [req.user.userId]
    );
    res.json({ status: 'success', data: rows.map(mapLedgerPhase) });
  } catch (error) {
    console.error('[Project] getAllLedgers Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve all ledgers' });
  }
};

// ══════════════════════════════════════════════════════════
// 5. GET /api/projects/:id/ledgers
// ══════════════════════════════════════════════════════════
exports.getLedgersByProject = async (req, res) => {
  try {
    const userId = req.user.userId;
    const [[readable]] = await db.query(
      `SELECT 1 AS ok FROM projects p WHERE p.project_id = ? AND ${CAN_READ_SQL}`,
      [req.params.id, userId, userId]
    );
    if (!readable) return notFound(res);

    const [rows] = await db.query(
      `SELECT ${LEDGER_SELECT_COLUMNS}
       FROM project_ledger pl
       LEFT JOIN categories c ON pl.category_id = c.category_id
       LEFT JOIN entry_types et ON pl.type_id = et.type_id
       WHERE pl.project_id = ?
       ORDER BY pl.phase DESC, pl.category_id ASC, pl.period_index ASC, pl.ledger_id ASC`,
      [req.params.id]
    );
    res.json({ status: 'success', data: rows.map(mapLedgerPhase) });
  } catch (error) {
    console.error('[Project] getLedgersByProject Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve ledgers' });
  }
};

// ══════════════════════════════════════════════════════════
// 5.5. GET /api/projects/:id/analytics — ตัวชี้วัดทั้งหมดของโครงการ (ดู services/finance.js)
// ══════════════════════════════════════════════════════════
async function loadAnalysisProject(projectId, userId) {
  const [[project]] = await db.query(
    `SELECT p.project_id, p.project_name, p.duration_months, p.initial_budget, p.target_roi_percent,
            p.user_id, p.created_at, p.status AS project_status,
            pt.type_name AS project_type, pt.calculation_method
     FROM projects p
     LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
     WHERE p.project_id = ? AND ${CAN_READ_SQL}`,
    [projectId, userId, userId]
  );
  return project || null;
}

async function loadAnalysisRows(projectId) {
  const [rows] = await db.query(
    `SELECT pl.phase, pl.period_index, pl.category_id, pl.total_value,
            c.category_name, c.category_group, et.is_inflow
     FROM project_ledger pl
     LEFT JOIN categories c ON pl.category_id = c.category_id
     LEFT JOIN entry_types et ON pl.type_id = et.type_id
     WHERE pl.project_id = ?`,
    [projectId]
  );
  return rows;
}

function analysisResponse(project, rows) {
  return {
    project: {
      project_id: project.project_id,
      project_name: project.project_name,
      project_type: project.project_type,
      calculation_method: project.calculation_method || 'MIXED',
      project_status: project.project_status,
      duration_months: Math.max(1, num(project.duration_months) || 12),
      initial_budget: num(project.initial_budget),
      target_roi_percent: project.target_roi_percent != null ? num(project.target_roi_percent) : null,
    },
    ...analyzeProject(project, rows),
  };
}

exports.getProjectAnalytics = async (req, res) => {
  try {
    const project = await loadAnalysisProject(req.params.id, req.user.userId);
    if (!project) return notFound(res);
    const rows = await loadAnalysisRows(req.params.id);
    res.json({ status: 'success', data: analysisResponse(project, rows) });
  } catch (error) {
    console.error('[Project] getProjectAnalytics Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to calculate project analytics' });
  }
};

// ══════════════════════════════════════════════════════════
// 5.6. POST /api/projects/:id/analytics/preview — คำนวณผลจากรายการที่กำลังกรอก (ยังไม่บันทึก)
// ให้ฟอร์มแสดง ROI/ระยะคืนทุนสดได้ด้วยสูตรเดียวกับรายงาน โดยไม่ต้องคำนวณซ้ำใน frontend
// ══════════════════════════════════════════════════════════
exports.previewProjectAnalytics = async (req, res) => {
  try {
    const { phase, ledgers } = req.body;
    if (!PHASE_TO_DB[phase]) return badRequest(res, 'phase ต้องเป็น Estimated หรือ Actual');

    const project = await loadAnalysisProject(req.params.id, req.user.userId);
    if (!project || project.user_id !== req.user.userId) return notFound(res);

    const categories = await loadCategoryMap(ledgers);
    const { rows: draft, error } = expandLedgerItems(ledgers, categories, project);
    if (error) return badRequest(res, error);

    const dbPhase = PHASE_TO_DB[phase];
    const saved = (await loadAnalysisRows(req.params.id)).filter((r) => r.phase !== dbPhase);
    const draftRows = draft.map((r) => {
      const c = categories.get(r.category_id);
      return { ...r, phase: dbPhase, category_name: c.category_name, category_group: c.category_group, is_inflow: c.is_inflow };
    });

    res.json({ status: 'success', data: analysisResponse(project, [...saved, ...draftRows]) });
  } catch (error) {
    console.error('[Project] previewProjectAnalytics Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to preview project analytics' });
  }
};

// ══════════════════════════════════════════════════════════
// 6. POST /api/projects/:id/ledgers — เพิ่มรายการ (ต่อท้ายของเดิม)
// ══════════════════════════════════════════════════════════
exports.saveLedgers = async (req, res) => {
  try {
    const { phase } = req.body;
    if (!phase || !PHASE_TO_DB[phase]) return badRequest(res, 'phase ต้องเป็น Estimated หรือ Actual');

    const prepared = await prepareLedgerWrite(req, res, { requireRows: true });
    if (!prepared) return;

    if (phase === 'Estimated' && (await hasActualData(req.params.id))) {
      return badRequest(res, 'ไม่สามารถแก้ไข Estimated ได้ เนื่องจากมีข้อมูล Actual แล้ว');
    }

    await replaceLedgers(req.params.id, PHASE_TO_DB[phase], prepared.rows, req.user.userId, { append: true });
    res.status(201).json({
      status: 'success',
      message: `บันทึก Ledger (${phase}) สำเร็จ ${prepared.rows.length} รายการ`,
    });
  } catch (error) {
    console.error('[Project] saveLedgers Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to save ledgers' });
  }
};

// ══════════════════════════════════════════════════════════
// 7. PATCH /api/projects/:id/visibility — สลับ Public/Private
// ══════════════════════════════════════════════════════════
exports.toggleVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { is_public } = req.body;

    const project = await getOwnedProject(id, userId);
    if (!project) return notFound(res);

    // โครงการที่ยังไม่มีข้อมูล Actual ห้ามเปิดเป็นสาธารณะ (เช็คฝั่ง server ด้วย)
    if (is_public && !(await hasActualData(id))) {
      return badRequest(res, 'ต้องมีข้อมูล Actual ก่อน ถึงจะเปิดโปรเจกต์เป็นสาธารณะได้');
    }

    if (is_public) {
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
      await db.query('DELETE FROM project_access WHERE project_id = ? AND user_id <> ?', [id, userId]);
    }

    res.json({
      status: 'success',
      message: is_public ? 'เปลี่ยนสถานะเป็นสาธารณะแล้ว' : 'เปลี่ยนสถานะเป็นส่วนตัวแล้ว',
    });
  } catch (error) {
    console.error('[Project] toggleVisibility Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update visibility' });
  }
};

// ══════════════════════════════════════════════════════════
// 8. PUT /api/projects/:id/ledgers/estimated — แทนที่ Estimated ทั้งหมด
// ══════════════════════════════════════════════════════════
exports.updateEstimatedLedgers = async (req, res) => {
  try {
    const prepared = await prepareLedgerWrite(req, res, { requireRows: false });
    if (!prepared) return;

    if (await hasActualData(req.params.id)) {
      return badRequest(res, 'ไม่สามารถแก้ไข Estimated ได้ เนื่องจากมีข้อมูล Actual แล้ว');
    }

    await replaceLedgers(req.params.id, 'ESTIMATED', prepared.rows, req.user.userId);
    res.json({ status: 'success', message: 'อัปเดต Estimated สำเร็จ' });
  } catch (error) {
    console.error('[Project] updateEstimatedLedgers Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update ledgers' });
  }
};

// ══════════════════════════════════════════════════════════
// 9. PUT /api/projects/:id/ledgers/actual — แทนที่ Actual ทั้งหมด
// ══════════════════════════════════════════════════════════
exports.updateActualLedgers = async (req, res) => {
  try {
    const prepared = await prepareLedgerWrite(req, res, { requireRows: false });
    if (!prepared) return;

    await replaceLedgers(req.params.id, 'ACTUAL', prepared.rows, req.user.userId);
    res.json({ status: 'success', message: 'อัปเดต Actual สำเร็จ' });
  } catch (error) {
    console.error('[Project] updateActualLedgers Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update actual ledgers' });
  }
};
