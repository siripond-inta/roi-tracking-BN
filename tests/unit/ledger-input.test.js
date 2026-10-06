const assert = require('node:assert/strict');
const { expandLedgerItems, periodDate } = require('../../services/ledger-input');

const categories = new Map([
  ['REV001', { type_id: 2, category_name: 'รายได้จากการขาย', unit_label: null, rate_label: null }],
  ['BEN001', { type_id: 2, category_name: 'ลดเวลาทำงาน', unit_label: 'ชม./เดือน', rate_label: 'บาท/ชม.' }],
  ['OPC001', { type_id: 1, category_name: 'ค่าดำเนินการ', unit_label: null, rate_label: null }],
]);
const project = { duration_months: 12, created_at: '2026-01-10T00:00:00Z' };

test('กระจายช่วงเดือนเป็นหนึ่งแถวต่อเดือน และคูณ ปริมาณ × อัตรา', () => {
  const { rows, error } = expandLedgerItems(
    [{ category_id: 'BEN001', unit_qty: 80, unit_cost: 350, period_from: 2, period_to: 4 }],
    categories,
    project
  );
  assert.equal(error, undefined);
  assert.deepEqual(rows.map((r) => r.period_index), [2, 3, 4]);
  assert.ok(rows.every((r) => r.total_value === 28000 && r.unit_qty === 80 && r.unit_cost === 350));
});

test('รูปแบบเดิม period_index ยังใช้ได้', () => {
  const { rows } = expandLedgerItems([{ category_id: 'REV001', total_value: 500, period_index: 5 }], categories, project);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].period_index, 5);
});

test('ประเภทรายรับ/รายจ่ายยึดตามหมวดหมู่ ไม่ใช่ค่าที่ส่งมา', () => {
  const { rows } = expandLedgerItems([{ category_id: 'OPC001', type_id: 2, total_value: 100 }], categories, project);
  assert.equal(rows[0].type_id, 1);
});

test('ปฏิเสธตัวเลขติดลบ', () => {
  assert.match(expandLedgerItems([{ category_id: 'REV001', total_value: -1 }], categories, project).error, /ไม่ติดลบ/);
  assert.match(expandLedgerItems([{ category_id: 'BEN001', unit_qty: -5, unit_cost: 10 }], categories, project).error, /ไม่ติดลบ/);
  assert.match(expandLedgerItems([{ category_id: 'REV001', total_value: 'abc' }], categories, project).error, /ไม่ติดลบ/);
});

test('หมวดแบบปริมาณต้องกรอกครบทั้งสองช่อง', () => {
  assert.match(expandLedgerItems([{ category_id: 'BEN001', unit_qty: 5 }], categories, project).error, /ต้องกรอกทั้ง/);
});

test('ช่วงเดือนต้องอยู่ในระยะเวลาโครงการ', () => {
  assert.match(expandLedgerItems([{ category_id: 'REV001', total_value: 1, period_from: 3, period_to: 13 }], categories, project).error, /ช่วงเดือน/);
  assert.match(expandLedgerItems([{ category_id: 'REV001', total_value: 1, period_from: 5, period_to: 2 }], categories, project).error, /ช่วงเดือน/);
  assert.match(expandLedgerItems([{ category_id: 'REV001', total_value: 1, period_from: 0 }], categories, project).error, /ช่วงเดือน/);
});

test('หมวดหมู่ที่ไม่มีจริงถูกปฏิเสธ', () => {
  assert.match(expandLedgerItems([{ category_id: 'NOPE', total_value: 1 }], categories, project).error, /ไม่พบหมวดหมู่/);
});

test('วันที่ของงวดนับจากเดือนเริ่มโครงการ', () => {
  assert.equal(periodDate('2026-01-10T00:00:00Z', 1), '2026-01-15');
  assert.equal(periodDate('2026-11-10T00:00:00Z', 3), '2027-01-15');
});

test('หมวด "อื่นๆ" ต้องระบุชื่อรายการ และเก็บชื่อที่ตัดช่องว่างแล้ว', () => {
  const cats = new Map([['OPCOTH', { type_id: 1, category_name: 'อื่นๆ', unit_label: null, rate_label: null, allow_custom_name: 1 }]]);
  const project = { duration_months: 6, created_at: '2026-01-10' };
  assert.match(expandLedgerItems([{ category_id: 'OPCOTH', total_value: 100 }], cats, project).error, /ระบุชื่อรายการ/);
  const { rows } = expandLedgerItems([{ category_id: 'OPCOTH', total_value: 100, custom_name: '  ค่าโฆษณา ', period_from: 1, period_to: 2 }], cats, project);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].custom_name, 'ค่าโฆษณา');
});
