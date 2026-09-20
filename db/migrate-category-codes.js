// db/migrate-category-codes.js
// ย้ายรหัสหมวดหมู่เดิม (REVxxx/CATxxx) ไปเป็นรหัสที่อิงกลุ่มค่าใช้จ่ายตาม FR03-3
// (INVxxx/OPCxxx/ADCxxx/BENxxx) และเพิ่มหมวดประโยชน์ทางอ้อม 4 หมวดตาม FR03-4
//
// ต่างจาก db/seed.js ตรงที่สคริปต์นี้ "ไม่ลบข้อมูลโครงการ" — ใช้กับฐานข้อมูลที่มีข้อมูลจริง
// อยู่แล้ว รันซ้ำได้ (idempotent): ถ้าย้ายไปแล้วจะข้ามให้เอง
//
// Usage:
//   node db/migrate-category-codes.js                (local, uses .env)
//   docker compose run --rm --entrypoint node backend db/migrate-category-codes.js

require('dotenv').config();
const db = require('../config/db.config');

// รหัสเดิม → รหัสใหม่ (ตามกลุ่มค่าใช้จ่ายที่หมวดนั้นสังกัดอยู่)
const RENAMES = [
  { from: 'REV001', to: 'BEN001' },
  { from: 'REV002', to: 'BEN002' },
  { from: 'CAT001', to: 'OPC001' },
  { from: 'CAT002', to: 'INV001' },
  { from: 'CAT003', to: 'ADC001' },
];

// FR03-4: ประโยชน์ทางอ้อม 4 หมวด ที่ตีมูลค่าจาก ปริมาณที่ลดได้ × อัตราต่อหน่วย
const INTANGIBLE_BENEFITS = [
  {
    categoryId: 'BEN003', categoryName: 'การลดเวลาทำงาน', typeId: 2, categoryGroup: 'BEN',
    unitLabel: 'ชั่วโมงที่ประหยัดได้ (ชม.)', rateLabel: 'อัตราค่าจ้าง (บาท/ชม.)',
  },
  {
    categoryId: 'BEN004', categoryName: 'การลดค่าเอกสาร', typeId: 2, categoryGroup: 'BEN',
    unitLabel: 'จำนวนชุดที่ลดได้ (ชุด)', rateLabel: 'ต้นทุนต่อชุด (บาท/ชุด)',
  },
  {
    categoryId: 'BEN005', categoryName: 'การลดค่าใช้จ่ายวิเคราะห์โครงการ', typeId: 2, categoryGroup: 'BEN',
    unitLabel: 'ชั่วโมงที่ลดได้ (ชม.)', rateLabel: 'อัตราตอบแทนผู้วิเคราะห์ (บาท/ชม.)',
  },
  {
    categoryId: 'BEN006', categoryName: 'การลดความผิดพลาด', typeId: 2, categoryGroup: 'BEN',
    unitLabel: 'จำนวนครั้งที่ลดได้ (ครั้ง)', rateLabel: 'ต้นทุนการแก้ไขต่อครั้ง (บาท/ครั้ง)',
  },
];

async function renameCategory(from, to) {
  const [[oldRow]] = await db.query('SELECT * FROM categories WHERE category_id = ?', [from]);
  if (!oldRow) {
    console.log(`  - ${from}: ไม่พบ (ย้ายไปแล้วหรือไม่เคยมี) — ข้าม`);
    return;
  }

  const [[existingNew]] = await db.query('SELECT category_id FROM categories WHERE category_id = ?', [to]);
  if (!existingNew) {
    await db.query(
      'INSERT INTO categories (category_id, category_name, type_id, category_group, unit_label, rate_label) VALUES (?, ?, ?, ?, ?, ?)',
      [to, oldRow.category_name, oldRow.type_id, oldRow.category_group, oldRow.unit_label, oldRow.rate_label]
    );
  }

  // ย้าย ledger ที่อ้างรหัสเดิมมาชี้รหัสใหม่ก่อน แล้วค่อยลบรหัสเดิม (กัน FK constraint error)
  const [result] = await db.query('UPDATE project_ledger SET category_id = ? WHERE category_id = ?', [to, from]);
  await db.query('DELETE FROM categories WHERE category_id = ?', [from]);

  console.log(`  - ${from} → ${to} (ย้าย ledger ${result.affectedRows} รายการ)`);
}

async function main() {
  console.log('ย้ายรหัสหมวดหมู่เดิมไปเป็นรหัสตามกลุ่ม (FR03-3)...');
  for (const { from, to } of RENAMES) {
    await renameCategory(from, to);
  }

  console.log('\nเพิ่มหมวดประโยชน์ทางอ้อม 4 หมวด (FR03-4)...');
  for (const cat of INTANGIBLE_BENEFITS) {
    const [[existing]] = await db.query('SELECT category_id FROM categories WHERE category_id = ?', [cat.categoryId]);
    if (existing) {
      console.log(`  - ${cat.categoryId}: มีอยู่แล้ว — ข้าม`);
      continue;
    }
    await db.query(
      'INSERT INTO categories (category_id, category_name, type_id, category_group, unit_label, rate_label) VALUES (?, ?, ?, ?, ?, ?)',
      [cat.categoryId, cat.categoryName, cat.typeId, cat.categoryGroup, cat.unitLabel, cat.rateLabel]
    );
    console.log(`  - ${cat.categoryId}: ${cat.categoryName} (เพิ่มแล้ว)`);
  }

  const [rows] = await db.query('SELECT category_id, category_name, category_group FROM categories ORDER BY category_id');
  console.log('\nหมวดหมู่ทั้งหมดหลังย้าย:');
  rows.forEach((r) => console.log(`  ${r.category_id.padEnd(8)} ${r.category_group}  ${r.category_name}`));
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
