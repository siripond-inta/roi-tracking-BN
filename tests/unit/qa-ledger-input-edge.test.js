// tests/qa-ledger-input-edge.test.js — QA: กรณีขอบของ services/ledger-input.js
const assert = require('node:assert/strict');
const { expandLedgerItems, periodDate, MAX_ITEMS, MAX_AMOUNT, MAX_QTY } = require('../../services/ledger-input');

const categories = new Map([
  ['INV001', { type_id: 1, category_name: 'ลงทุน', unit_label: null, rate_label: null, allow_custom_name: 0 }],
  ['REV001', { type_id: 2, category_name: 'รายได้', unit_label: null, rate_label: null, allow_custom_name: 0 }],
  ['BEN001', { type_id: 2, category_name: 'ลดเวลา', unit_label: 'ชม.', rate_label: 'บาท/ชม.', allow_custom_name: 0 }],
  ['OPCOTH', { type_id: 1, category_name: 'อื่นๆ', unit_label: null, rate_label: null, allow_custom_name: 1 }],
]);
const project = { duration_months: 6, created_at: '2026-01-20T00:00:00Z' };
const expand = (items) => expandLedgerItems(items, categories, project);

test('ตัวเลขที่ส่งมาเป็น string ถูกแปลงเป็นตัวเลข', () => {
  const { rows, error } = expand([{ category_id: 'INV001', total_value: '1500', period_from: '1', period_to: '2' }]);
  assert.equal(error, undefined);
  assert.deepEqual(rows.map((r) => r.total_value), [1500, 1500]);
});

test('ปฏิเสธ NaN / Infinity / ข้อความ', () => {
  for (const v of ['abc', Infinity, NaN]) {
    assert.ok(expand([{ category_id: 'INV001', total_value: v, period_from: 1 }]).error, `ควรปฏิเสธ ${v}`);
  }
});

test('ปฏิเสธเดือนที่เป็นทศนิยมหรือ 0', () => {
  assert.ok(expand([{ category_id: 'INV001', total_value: 1, period_from: 1.5 }]).error);
  assert.ok(expand([{ category_id: 'INV001', total_value: 1, period_from: 0 }]).error);
});

test('ไม่ระบุ total_value → บันทึกเป็น 0', () => {
  assert.equal(expand([{ category_id: 'INV001', period_from: 1 }]).rows[0].total_value, 0);
});

test('หมวดแบบปริมาณ: ส่งแค่ total_value (ไม่มี qty/rate) ใช้ยอดเงินตรงๆ', () => {
  const { rows } = expand([{ category_id: 'BEN001', total_value: 900, period_from: 1 }]);
  assert.equal(rows[0].total_value, 900);
  assert.equal(rows[0].unit_qty, null);
});

test('หมวดแบบปริมาณ: qty × rate และเก็บ qty/rate ไว้ครบทุกเดือน', () => {
  const { rows } = expand([{ category_id: 'BEN001', unit_qty: 12.5, unit_cost: 200, period_from: 2, period_to: 4 }]);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.total_value === 2500 && r.unit_qty === 12.5 && r.unit_cost === 200));
});

test('หมวดปกติไม่เก็บ custom_name แม้จะส่งมา', () => {
  assert.equal(expand([{ category_id: 'INV001', total_value: 1, custom_name: 'x' }]).rows[0].custom_name, null);
});

test('ชื่อรายการ "อื่นๆ" ยาวเกิน 255 ตัวอักษรถูกปฏิเสธ', () => {
  assert.ok(expand([{ category_id: 'OPCOTH', total_value: 1, custom_name: 'ก'.repeat(256) }]).error);
});

test('หมายเหตุถูกตัดที่ 1000 ตัวอักษร', () => {
  assert.equal(expand([{ category_id: 'INV001', total_value: 1, note: 'x'.repeat(1500) }]).rows[0].note.length, 1000);
});

test(`ส่งรายการเกิน ${MAX_ITEMS} รายการถูกปฏิเสธ`, () => {
  const items = Array.from({ length: MAX_ITEMS + 1 }, () => ({ category_id: 'INV001', total_value: 1 }));
  assert.ok(expand(items).error);
});

test('วันที่ของงวดข้ามปีถูกต้อง (เริ่ม พ.ย. → เดือนที่ 3 = ม.ค. ปีถัดไป)', () => {
  assert.equal(periodDate('2026-11-03T00:00:00Z', 3), '2027-01-15');
});

test('ยอดเงินเกินความจุคอลัมน์ DECIMAL(15,2) ถูกปฏิเสธ (เดิม API ตอบ 500)', () => {
  assert.ok(expand([{ category_id: 'INV001', total_value: 1e16, period_from: 1 }]).error);
  assert.equal(expand([{ category_id: 'INV001', total_value: MAX_AMOUNT, period_from: 1 }]).error, undefined);
});

test('ปริมาณเกิน DECIMAL(10,2) และ ปริมาณ × อัตรา ที่เกินเพดานถูกปฏิเสธ', () => {
  assert.ok(expand([{ category_id: 'BEN001', unit_qty: 1e9, unit_cost: 1, period_from: 1 }]).error);
  assert.ok(expand([{ category_id: 'BEN001', unit_qty: MAX_QTY, unit_cost: 1e7, period_from: 1 }]).error);
});
