// controllers/category.controller.js
// จัดการหมวดหมู่รายรับ/รายจ่าย (categories) — อ่านได้ทุก user ที่ login แล้ว, เพิ่ม/แก้/ลบได้แค่ admin

const db = require('../config/db.config');

// สร้างรหัสหมวดหมู่อัตโนมัติ — admin ไม่ต้องคิด/พิมพ์รหัสเอง
// รูปแบบยึดตามข้อมูลเดิม: รายรับ = REVxxx, รายจ่าย = CATxxx (เลขวิ่งต่อจากตัวที่มากสุดของ prefix นั้น)
async function generateCategoryId(prefix) {
  const [rows] = await db.query(
    'SELECT category_id FROM categories WHERE category_id LIKE ? ORDER BY LENGTH(category_id) DESC, category_id DESC LIMIT 1',
    [`${prefix}%`]
  );
  let nextNum = 1;
  if (rows.length > 0) {
    const match = rows[0].category_id.match(/(\d+)$/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(3, '0')}`;
}

// ══════════════════════════════════════════════════════════
// GET /api/categories — หมวดหมู่ทั้งหมด (ทุก user ที่ login แล้วเรียกได้ ใช้เติม dropdown ในฟอร์ม)
// ══════════════════════════════════════════════════════════
exports.getAll = async (req, res) => {
  try {
    const sql = `
      SELECT
        c.category_id, c.category_name, c.type_id, c.category_group,
        et.type_name, et.is_inflow
      FROM categories c
      LEFT JOIN entry_types et ON c.type_id = et.type_id
      ORDER BY et.is_inflow DESC, c.category_id ASC
    `;
    const [rows] = await db.query(sql);
    res.json({ status: 'success', data: rows });
  } catch (error) {
    console.error('[Category] getAll Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve categories' });
  }
};

// ══════════════════════════════════════════════════════════
// GET /api/categories/entry-types — รายรับ/รายจ่าย (ใช้เป็นตัวเลือกตอนสร้าง/แก้ไขหมวดหมู่)
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
// POST /api/categories — สร้างหมวดหมู่ใหม่ (admin เท่านั้น) — รหัสหมวดหมู่ระบบสร้างให้อัตโนมัติ
// ══════════════════════════════════════════════════════════
exports.create = async (req, res) => {
  try {
    const { category_name, type_id, category_group } = req.body;

    if (!category_name || !type_id || !category_group) {
      return res.status(400).json({ status: 'error', message: 'กรุณากรอกข้อมูลให้ครบ' });
    }
    const validGroups = ['INV', 'OPC', 'ADC', 'BEN'];
    if (!validGroups.includes(category_group)) {
      return res.status(400).json({ status: 'error', message: 'category_group ไม่ถูกต้อง' });
    }

    const [[entryType]] = await db.query('SELECT is_inflow FROM entry_types WHERE type_id = ?', [type_id]);
    if (!entryType) {
      return res.status(400).json({ status: 'error', message: 'ประเภทรายรับ/รายจ่ายไม่ถูกต้อง' });
    }
    const prefix = entryType.is_inflow ? 'REV' : 'CAT';

    // แข่งกันสร้างพร้อมกันได้ยากมากสำหรับหน้า admin แต่กันไว้เผื่อชนกัน — ลองใหม่ได้ถึง 3 ครั้ง
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const category_id = await generateCategoryId(prefix);
      try {
        await db.query(
          'INSERT INTO categories (category_id, category_name, type_id, category_group) VALUES (?, ?, ?, ?)',
          [category_id, category_name, type_id, category_group]
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
// PUT /api/categories/:id — แก้ไขหมวดหมู่ (admin เท่านั้น) — แก้ชื่อ/type/group ได้ ไม่แก้ id
// ══════════════════════════════════════════════════════════
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { category_name, type_id, category_group } = req.body;

    if (category_group) {
      const validGroups = ['INV', 'OPC', 'ADC', 'BEN'];
      if (!validGroups.includes(category_group)) {
        return res.status(400).json({ status: 'error', message: 'category_group ไม่ถูกต้อง' });
      }
    }

    const [[existing]] = await db.query('SELECT category_id FROM categories WHERE category_id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'ไม่พบหมวดหมู่นี้' });
    }

    await db.query(
      `UPDATE categories SET
        category_name = COALESCE(?, category_name),
        type_id = COALESCE(?, type_id),
        category_group = COALESCE(?, category_group)
       WHERE category_id = ?`,
      [category_name || null, type_id || null, category_group || null, id]
    );

    res.json({ status: 'success', message: 'แก้ไขหมวดหมู่สำเร็จ' });
  } catch (error) {
    console.error('[Category] update Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update category' });
  }
};

// ══════════════════════════════════════════════════════════
// DELETE /api/categories/:id — ลบหมวดหมู่ (admin เท่านั้น) — ห้ามลบถ้ามี ledger ใช้อยู่แล้ว
// ══════════════════════════════════════════════════════════
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const [[existing]] = await db.query('SELECT category_id FROM categories WHERE category_id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'ไม่พบหมวดหมู่นี้' });
    }

    const [[{ usageCount }]] = await db.query(
      'SELECT COUNT(*) AS usageCount FROM project_ledger WHERE category_id = ?',
      [id]
    );
    if (usageCount > 0) {
      return res.status(400).json({
        status: 'error',
        message: `ลบไม่ได้ — มีรายการ ledger ที่ใช้หมวดหมู่นี้อยู่ ${usageCount} รายการ`
      });
    }

    await db.query('DELETE FROM categories WHERE category_id = ?', [id]);
    res.json({ status: 'success', message: 'ลบหมวดหมู่สำเร็จ' });
  } catch (error) {
    console.error('[Category] remove Error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete category' });
  }
};
