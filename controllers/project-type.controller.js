// controllers/project-type.controller.js
// FR07-4: จัดการลิสต์ "ประเภทโครงการ" — อ่านได้ทุก user ที่ login แล้ว (ใช้เติม dropdown ตอนสร้าง
// โครงการ), เพิ่ม/แก้/ลบได้เฉพาะ admin

const db = require('../config/db.config');

const VALID_METHODS = ['REVENUE', 'COST_SAVING', 'MIXED'];

// ══════════════════════════════════════════════════════════
// GET /api/project-types — ประเภทโครงการทั้งหมด
// ══════════════════════════════════════════════════════════
exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pt.type_id, pt.type_name, pt.description, pt.calculation_method,
              (SELECT COUNT(*) FROM projects p WHERE p.project_type_id = pt.type_id) AS project_count
       FROM project_types pt
       ORDER BY pt.type_id ASC`
    );
    res.json({ status: 'success', data: rows });
  } catch (error) {
    console.error('[ProjectType] getAll Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve project types' });
  }
};

// ══════════════════════════════════════════════════════════
// POST /api/project-types — เพิ่มประเภทโครงการ (admin เท่านั้น)
// type_id ไม่ใช่ auto_increment ในสคีมา จึงหาเลขถัดไปให้เอง
// ══════════════════════════════════════════════════════════
exports.create = async (req, res) => {
  try {
    const { type_name, description, calculation_method } = req.body;

    if (!type_name || !type_name.trim()) {
      return res.status(400).json({ status: 'error', message: 'กรุณากรอกชื่อประเภทโครงการ' });
    }
    if (calculation_method && !VALID_METHODS.includes(calculation_method)) {
      return res.status(400).json({ status: 'error', message: 'calculation_method ไม่ถูกต้อง' });
    }

    const [[{ nextId }]] = await db.query('SELECT COALESCE(MAX(type_id), 0) + 1 AS nextId FROM project_types');

    await db.query(
      'INSERT INTO project_types (type_id, type_name, description, calculation_method) VALUES (?, ?, ?, ?)',
      [nextId, type_name.trim(), description || null, calculation_method || null]
    );

    res.status(201).json({ status: 'success', message: 'เพิ่มประเภทโครงการสำเร็จ', data: { type_id: nextId } });
  } catch (error) {
    console.error('[ProjectType] create Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create project type' });
  }
};

// ══════════════════════════════════════════════════════════
// PUT /api/project-types/:id — แก้ไขประเภทโครงการ (admin เท่านั้น)
// ══════════════════════════════════════════════════════════
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { type_name, description, calculation_method } = req.body;

    if (calculation_method && !VALID_METHODS.includes(calculation_method)) {
      return res.status(400).json({ status: 'error', message: 'calculation_method ไม่ถูกต้อง' });
    }

    const [[existing]] = await db.query(
      'SELECT type_id, description, calculation_method FROM project_types WHERE type_id = ?',
      [id]
    );
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'ไม่พบประเภทโครงการนี้' });
    }
    if (type_name !== undefined && (typeof type_name !== 'string' || !type_name.trim())) {
      return res.status(400).json({ status: 'error', message: 'กรุณากรอกชื่อประเภทโครงการ' });
    }

    // ฟิลด์ที่ไม่ได้ส่งมา (undefined) = คงค่าเดิม — กัน PUT ที่ส่งมาแค่บางฟิลด์ลบค่าอื่นทิ้ง
    const nextDescription = description === undefined ? existing.description : description || null;
    const nextMethod = calculation_method === undefined ? existing.calculation_method : calculation_method || null;

    // เปลี่ยนวิธีคำนวณของประเภทที่มีโครงการใช้อยู่ = ROI ของทุกโครงการประเภทนี้เปลี่ยนเงียบๆ
    // (รวมโครงการที่ปิดไปแล้ว) จึงไม่อนุญาต — ให้สร้างประเภทใหม่แทน
    if ((nextMethod || null) !== (existing.calculation_method || null)) {
      const [[{ usedBy }]] = await db.query('SELECT COUNT(*) AS usedBy FROM projects WHERE project_type_id = ?', [id]);
      if (usedBy > 0) {
        return res.status(400).json({
          status: 'error',
          message: `เปลี่ยนวิธีคำนวณไม่ได้ — มีโครงการใช้ประเภทนี้อยู่ ${usedBy} โครงการ (สร้างประเภทใหม่แทน)`,
        });
      }
    }

    await db.query(
      `UPDATE project_types SET
         type_name = COALESCE(?, type_name),
         description = ?,
         calculation_method = ?
       WHERE type_id = ?`,
      [type_name ? type_name.trim() : null, nextDescription, nextMethod, id]
    );

    res.json({ status: 'success', message: 'แก้ไขประเภทโครงการสำเร็จ' });
  } catch (error) {
    console.error('[ProjectType] update Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update project type' });
  }
};

// ══════════════════════════════════════════════════════════
// DELETE /api/project-types/:id — ลบ (admin เท่านั้น) — ห้ามลบถ้ามีโครงการใช้อยู่
// ══════════════════════════════════════════════════════════
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const [[existing]] = await db.query('SELECT type_id FROM project_types WHERE type_id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'ไม่พบประเภทโครงการนี้' });
    }

    const [[{ usageCount }]] = await db.query(
      'SELECT COUNT(*) AS usageCount FROM projects WHERE project_type_id = ?',
      [id]
    );
    if (usageCount > 0) {
      return res.status(400).json({
        status: 'error',
        message: `ลบไม่ได้ — มีโครงการที่ใช้ประเภทนี้อยู่ ${usageCount} โครงการ`
      });
    }

    await db.query('DELETE FROM project_types WHERE type_id = ?', [id]);
    res.json({ status: 'success', message: 'ลบประเภทโครงการสำเร็จ' });
  } catch (error) {
    console.error('[ProjectType] remove Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete project type' });
  }
};
