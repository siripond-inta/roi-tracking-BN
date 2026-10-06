// controllers/category.controller.js
// จัดการหมวดหมู่รายรับ/รายจ่าย — อ่านได้ทุก user ที่ login แล้ว, เพิ่ม/แก้/ลบได้แค่ admin
//
// กลุ่มหมวดหมู่ (category_group) และรหัสที่ระบบสร้างให้:
//   REVxxx รายได้โดยตรง         — กรอกยอดเงิน (หรือ ปริมาณ × ราคา ถ้าตั้งหน่วยไว้)
//   BENxxx ประโยชน์ทางอ้อม      — ต้องเป็นแบบ ปริมาณต่อเดือน × อัตราต่อหน่วย เสมอ
//   INVxxx เงินลงทุน / OPCxxx ต้นทุนดำเนินงาน / ADCxxx ค่าบริหารจัดการ

const db = require('../config/db.config');

const VALID_GROUPS = ['INV', 'OPC', 'ADC', 'REV', 'BEN'];
const INFLOW_GROUPS = ['REV', 'BEN'];

async function generateCategoryId(prefix) {
  const [rows] = await db.query(
    // นับเฉพาะรหัสที่ลงท้ายด้วยตัวเลข — ข้ามรหัสพิเศษอย่าง REVOTH ของหมวด "อื่นๆ"
    'SELECT category_id FROM categories WHERE category_id REGEXP ? ORDER BY LENGTH(category_id) DESC, category_id DESC LIMIT 1',
    [`^${prefix}[0-9]+$`]
  );
  let nextNum = 1;
  if (rows.length > 0) {
    const match = rows[0].category_id.match(/(\d+)$/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(3, '0')}`;
}

// ประเภทรายรับ/รายจ่ายกำหนดจากกลุ่มเสมอ — ถ้าให้เลือกแยกกัน admin อาจสร้าง "ต้นทุนดำเนินงาน"
// ที่เป็นรายรับ ซึ่งจะทำให้การคำนวณ ROI ผิดทั้งระบบ
async function entryTypeForGroup(group) {
  const isInflow = INFLOW_GROUPS.includes(group) ? 1 : 0;
  const [[row]] = await db.query('SELECT type_id FROM entry_types WHERE is_inflow = ? ORDER BY type_id LIMIT 1', [isInflow]);
  return row ? row.type_id : null;
}

function validateLabels(group, unitLabel, rateLabel) {
  if ((unitLabel && !rateLabel) || (!unitLabel && rateLabel)) {
    return 'หมวดหมู่แบบคำนวณจากปริมาณ ต้องระบุทั้งชื่อหน่วยปริมาณและชื่ออัตราต่อหน่วย';
  }
  if (group === 'BEN' && !unitLabel) {
    return 'หมวดประโยชน์ทางอ้อมต้องตีมูลค่าจาก ปริมาณ × อัตรา — กรุณาระบุชื่อหน่วยปริมาณและชื่ออัตราต่อหน่วย';
  }
  return null;
}

// ══════════════════════════════════════════════════════════
// GET /api/categories
// ══════════════════════════════════════════════════════════
exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        c.category_id, c.category_name, c.type_id, c.category_group,
        c.unit_label, c.rate_label, c.allow_custom_name,
        et.type_name, et.is_inflow,
        (SELECT COUNT(*) FROM project_ledger pl WHERE pl.category_id = c.category_id) AS usage_count
      FROM categories c
      LEFT JOIN entry_types et ON c.type_id = et.type_id
      ORDER BY FIELD(c.category_group, 'REV', 'BEN', 'INV', 'OPC', 'ADC'), c.category_id ASC
    `);
    res.json({ status: 'success', data: rows });
  } catch (error) {
    console.error('[Category] getAll Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve categories' });
  }
};

// ══════════════════════════════════════════════════════════
// GET /api/categories/entry-types
// ══════════════════════════════════════════════════════════
exports.getEntryTypes = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT type_id, type_name, is_inflow FROM entry_types ORDER BY type_id ASC');
    res.json({ status: 'success', data: rows });
  } catch (error) {
    console.error('[Category] getEntryTypes Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve entry types' });
  }
};

// ══════════════════════════════════════════════════════════
// POST /api/categories — รหัสหมวดหมู่ระบบสร้างให้อัตโนมัติจากกลุ่ม
// ══════════════════════════════════════════════════════════
exports.create = async (req, res) => {
  try {
    const { category_name, category_group, unit_label, rate_label, allow_custom_name } = req.body;

    if (!category_name || !String(category_name).trim() || !category_group) {
      return res.status(400).json({ status: 'error', message: 'กรุณากรอกข้อมูลให้ครบ' });
    }
    if (!VALID_GROUPS.includes(category_group)) {
      return res.status(400).json({ status: 'error', message: 'category_group ไม่ถูกต้อง' });
    }
    const labelError = validateLabels(category_group, unit_label, rate_label);
    if (labelError) return res.status(400).json({ status: 'error', message: labelError });

    const typeId = await entryTypeForGroup(category_group);
    if (!typeId) return res.status(500).json({ status: 'error', message: 'ไม่พบประเภทรายรับ/รายจ่ายในระบบ' });

    // สร้างพร้อมกันแล้วรหัสชนกันเกิดได้ยากมาก แต่กันไว้ — ลองใหม่ได้ถึง 3 ครั้ง
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const category_id = await generateCategoryId(category_group);
      try {
        await db.query(
          `INSERT INTO categories (category_id, category_name, type_id, category_group, unit_label, rate_label, allow_custom_name)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [category_id, String(category_name).trim(), typeId, category_group, unit_label || null, rate_label || null, !!allow_custom_name]
        );
        return res.status(201).json({ status: 'success', message: 'เพิ่มหมวดหมู่สำเร็จ', data: { category_id } });
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  } catch (error) {
    console.error('[Category] create Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create category' });
  }
};

// ══════════════════════════════════════════════════════════
// PUT /api/categories/:id — แก้ชื่อ/หน่วยได้ ส่วนกลุ่มเปลี่ยนได้เฉพาะหมวดที่ยังไม่มีข้อมูลใช้งาน
// ══════════════════════════════════════════════════════════
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { category_name, category_group, unit_label, rate_label, allow_custom_name } = req.body;

    const [[existing]] = await db.query(
      'SELECT category_group, unit_label, rate_label FROM categories WHERE category_id = ?',
      [id]
    );
    if (!existing) return res.status(404).json({ status: 'error', message: 'ไม่พบหมวดหมู่นี้' });
    if (category_name !== undefined && !String(category_name ?? '').trim()) {
      return res.status(400).json({ status: 'error', message: 'กรุณากรอกชื่อหมวดหมู่' });
    }

    // ไม่ได้ส่งชื่อหน่วยมา (undefined) = คงค่าเดิม, ส่ง null/ว่าง = ล้างค่า
    const nextUnit = unit_label === undefined ? existing.unit_label : unit_label || null;
    const nextRate = rate_label === undefined ? existing.rate_label : rate_label || null;

    const group = category_group || existing.category_group;
    if (!VALID_GROUPS.includes(group)) {
      return res.status(400).json({ status: 'error', message: 'category_group ไม่ถูกต้อง' });
    }

    if (group !== existing.category_group) {
      // ย้ายกลุ่มหมวดที่มีข้อมูลแล้ว จะเปลี่ยนรายรับเป็นรายจ่าย (หรือเปลี่ยนแหล่งผลประโยชน์)
      // ของโครงการที่บันทึกไปแล้วแบบเงียบๆ และรหัส (เช่น REV001) จะไม่ตรงกับกลุ่มอีกต่อไป
      const [[{ usedBy }]] = await db.query('SELECT COUNT(*) AS usedBy FROM project_ledger WHERE category_id = ?', [id]);
      if (usedBy > 0) {
        return res.status(400).json({
          status: 'error',
          message: `เปลี่ยนกลุ่มไม่ได้ — มีรายการที่ใช้หมวดหมู่นี้อยู่ ${usedBy} รายการ (สร้างหมวดใหม่ในกลุ่มที่ต้องการแทน)`,
        });
      }
    }

    const labelError = validateLabels(group, nextUnit, nextRate);
    if (labelError) return res.status(400).json({ status: 'error', message: labelError });

    const typeId = await entryTypeForGroup(group);

    await db.query(
      `UPDATE categories SET
        category_name = COALESCE(?, category_name),
        category_group = ?,
        type_id = ?,
        unit_label = ?,
        rate_label = ?,
        allow_custom_name = COALESCE(?, allow_custom_name)
       WHERE category_id = ?`,
      [
        category_name ? String(category_name).trim() : null, group, typeId, nextUnit, nextRate,
        allow_custom_name === undefined ? null : !!allow_custom_name, id,
      ]
    );

    res.json({ status: 'success', message: 'แก้ไขหมวดหมู่สำเร็จ' });
  } catch (error) {
    console.error('[Category] update Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update category' });
  }
};

// ══════════════════════════════════════════════════════════
// DELETE /api/categories/:id — ห้ามลบถ้ามี ledger ใช้อยู่แล้ว
// ══════════════════════════════════════════════════════════
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const [[existing]] = await db.query('SELECT category_id FROM categories WHERE category_id = ?', [id]);
    if (!existing) return res.status(404).json({ status: 'error', message: 'ไม่พบหมวดหมู่นี้' });

    const [[{ usageCount }]] = await db.query(
      'SELECT COUNT(*) AS usageCount FROM project_ledger WHERE category_id = ?',
      [id]
    );
    if (usageCount > 0) {
      return res.status(400).json({
        status: 'error',
        message: `ลบไม่ได้ — มีรายการ ledger ที่ใช้หมวดหมู่นี้อยู่ ${usageCount} รายการ`,
      });
    }

    await db.query('DELETE FROM categories WHERE category_id = ?', [id]);
    res.json({ status: 'success', message: 'ลบหมวดหมู่สำเร็จ' });
  } catch (error) {
    console.error('[Category] remove Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete category' });
  }
};
