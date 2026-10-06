// tests/qa-finance-edge.test.js — QA: กรณีขอบ/regression ของ services/finance.js
// เทสต์ที่ติด { todo } คือพฤติกรรมที่ QA เห็นว่าควรแก้ (ไม่ทำให้ npm test ล้ม แต่จะแสดงเป็น TODO)
const assert = require('node:assert/strict');
const { analyzeProject, summarizeForList, calcRoi, calcPaybackMonths } = require('../../services/finance');

const row = (phase, period, group, value, extra = {}) => ({
  phase,
  period_index: period,
  category_id: extra.category_id || `${group}001`,
  category_name: extra.category_name || group,
  category_group: group,
  is_inflow: ['REV', 'BEN'].includes(group) ? 1 : 0,
  total_value: value,
  custom_name: extra.custom_name,
});
const range = (phase, from, to, group, value, extra) => {
  const out = [];
  for (let p = from; p <= to; p++) out.push(row(phase, p, group, value, extra));
  return out;
};
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// แผน MIXED ของ seed (ตรงกับตัวอย่างใน README): ต้นทุน 661,000 ผลประโยชน์ 1,086,000
function mixedSeedPlan() {
  return [
    row('ESTIMATED', 1, 'INV', 250000, { category_id: 'INV001' }),
    row('ESTIMATED', 1, 'INV', 60000, { category_id: 'INV002' }),
    row('ESTIMATED', 1, 'ADC', 15000, { category_id: 'ADC002' }),
    ...range('ESTIMATED', 1, 12, 'OPC', 10000, { category_id: 'OPC001' }),
    ...range('ESTIMATED', 1, 12, 'OPC', 18000, { category_id: 'OPC002' }),
    ...range('ESTIMATED', 2, 12, 'REV', 60000, { category_id: 'REV001' }),
    ...range('ESTIMATED', 3, 12, 'REV', 12000, { category_id: 'REV002' }),
    ...range('ESTIMATED', 2, 12, 'BEN', 18000, { category_id: 'BEN001' }),
    ...range('ESTIMATED', 3, 12, 'BEN', 10800, { category_id: 'BEN004' }),
  ];
}

test('regression: ตัวอย่างใน README — MIXED 661,000 / 1,086,000 → ROI 64.3%, คืนทุน 7.3 เดือน', () => {
  const s = analyzeProject({ duration_months: 12, calculation_method: 'MIXED', target_roi_percent: 30 }, mixedSeedPlan()).summary;
  assert.equal(s.estimated.totalExpense, 661000);
  assert.equal(s.estimated.totalRevenue, 1086000);
  close(s.estimated.roi, ((1086000 - 661000) / 661000) * 100);
  assert.equal(s.estimated.paybackMonths.toFixed(1), '7.3');
  assert.equal(s.isWorthwhile, true);
  assert.equal(s.worthwhileBasis, 'estimated');
});

test('ข้อมูลเดียวกันแต่ประเภท REVENUE: ประโยชน์ทางอ้อมย้ายไป excludedBenefit ไม่ถูกทิ้ง', () => {
  const s = analyzeProject({ duration_months: 12, calculation_method: 'REVENUE' }, mixedSeedPlan()).summary.estimated;
  assert.equal(s.indirectBenefit, 0);
  assert.equal(s.excludedBenefit, 11 * 18000 + 10 * 10800);
  assert.equal(s.totalRevenue + s.excludedBenefit, 1086000);
});

test('ยอดเงินเป็น string (DECIMAL จาก MySQL) คำนวณได้เหมือน number', () => {
  const rows = [row('ESTIMATED', 1, 'INV', '1000.50'), row('ESTIMATED', 2, 'REV', '2001.00')];
  const s = analyzeProject({ duration_months: 2, calculation_method: 'MIXED' }, rows).summary.estimated;
  close(s.totalExpense, 1000.5);
  close(s.totalRevenue, 2001);
});

test('ผลจริงบางเดือน: ระยะคืนทุนจริงใช้จำนวนเดือนที่บันทึก, แผน-ถึงวันนี้ใช้เดือนเดียวกัน', () => {
  const rows = [
    ...mixedSeedPlan(),
    row('ACTUAL', 1, 'INV', 330000),
    ...range('ACTUAL', 1, 3, 'OPC', 28000),
    ...range('ACTUAL', 2, 3, 'REV', 70000),
  ];
  const s = analyzeProject({ duration_months: 12, calculation_method: 'MIXED', target_roi_percent: 30 }, rows).summary;
  assert.equal(s.lastActualPeriod, 3);
  assert.equal(s.actual.totalExpense, 330000 + 84000);
  assert.equal(s.actual.totalRevenue, 140000);
  close(s.actual.paybackMonths, 414000 / (140000 / 3));
  assert.equal(s.estimatedToDate.months, 3);
  assert.equal(s.estimatedToDate.totalExpense, 325000 + 3 * 28000);
  // ผลจริงยังไม่ครบ → ตัดสินความคุ้มค่าจาก "คาดการณ์ทั้งโครงการ" = ผลจริง 1–3 + แผนเดือน 4–12
  assert.equal(s.worthwhileBasis, 'projected');
  const planRest = { rev: 9 * 60000 + 9 * 12000 + 9 * 18000 + 9 * 10800, exp: 9 * 28000 };
  assert.equal(s.projected.totalRevenue, 140000 + planRest.rev);
  assert.equal(s.projected.totalExpense, 414000 + planRest.exp);
  close(s.roiForComparison, s.projected.roi);
  assert.equal(s.isWorthwhile, s.projected.roi >= 30);
});

test('ปิดโครงการ (completed) แล้วตัดสินจากผลจริง แม้บันทึกไม่ครบทุกเดือน', () => {
  const rows = [...mixedSeedPlan(), row('ACTUAL', 1, 'INV', 330000), row('ACTUAL', 2, 'REV', 70000)];
  const s = analyzeProject({ duration_months: 12, calculation_method: 'MIXED', target_roi_percent: 30, project_status: 'completed' }, rows).summary;
  assert.equal(s.worthwhileBasis, 'actual');
  assert.equal(s.isWorthwhile, false);
});

test('ผลจริงครบทุกเดือนตัดสินจากผลจริง', () => {
  const rows = [row('ESTIMATED', 1, 'INV', 100), row('ACTUAL', 1, 'INV', 100), row('ACTUAL', 2, 'REV', 300)];
  const s = analyzeProject({ duration_months: 2, target_roi_percent: 50 }, rows).summary;
  assert.equal(s.worthwhileBasis, 'actual');
  assert.equal(s.isWorthwhile, true);
});

test('จุดคุ้มทุนจากเงินสะสม (breakEvenMonth) ตรงกับกราฟ ไม่ใช่สูตรเฉลี่ย', () => {
  const a = analyzeProject({ duration_months: 12, calculation_method: 'MIXED' }, mixedSeedPlan()).summary.estimated;
  // เงินสะสม: เดือน 6 = -11,800 → เดือน 7 = +61,000 → คุ้มทุนที่ 6 + 11,800/72,800 เดือน
  close(a.breakEvenMonth, 6 + 11800 / 72800);
  assert.equal(a.paybackMonths.toFixed(1), '7.3'); // สูตรเฉลี่ยยังคงไว้ตาม spec
});

test('ผลจริงที่เงินสะสมยังติดลบ: breakEvenMonth = null (ยังไม่คืนทุน)', () => {
  const rows = [...mixedSeedPlan(), row('ACTUAL', 1, 'INV', 330000), row('ACTUAL', 2, 'REV', 70000)];
  assert.equal(analyzeProject({ duration_months: 12 }, rows).summary.actual.breakEvenMonth, null);
});

test('ROI เท่ากับเป้าพอดี = คุ้มค่า (>=), ไม่ตั้งเป้า = null', () => {
  const rows = [row('ESTIMATED', 1, 'INV', 100), row('ESTIMATED', 1, 'REV', 150)];
  assert.equal(analyzeProject({ duration_months: 1, target_roi_percent: 50 }, rows).summary.isWorthwhile, true);
  assert.equal(analyzeProject({ duration_months: 1, target_roi_percent: 50.01 }, rows).summary.isWorthwhile, false);
  assert.equal(analyzeProject({ duration_months: 1, target_roi_percent: null }, rows).summary.isWorthwhile, null);
});

test('มีแถวเกินระยะเวลาโครงการ: ตารางรายเดือนขยายให้ครบ ยอดรวมไม่หาย', () => {
  const rows = [row('ESTIMATED', 1, 'INV', 100), row('ESTIMATED', 5, 'REV', 300)];
  const a = analyzeProject({ duration_months: 3 }, rows);
  assert.equal(a.monthly.length, 5);
  assert.equal(a.summary.estimated.totalRevenue, 300);
  assert.equal(a.monthly.at(-1).estimated.cumulative, 200);
});

test('duration_months ว่าง/0 ใช้ค่า default 12 เดือน', () => {
  assert.equal(analyzeProject({ duration_months: null }, []).monthly.length, 12);
  assert.equal(analyzeProject({ duration_months: 0 }, []).monthly.length, 12);
});

test('summarizeForList ตรงกับ analyzeProject (หน้า Dashboard/Projects ใช้ตัวเลขชุดเดียวกับรายงาน)', () => {
  const rows = [...mixedSeedPlan(), row('ACTUAL', 1, 'INV', 300000), row('ACTUAL', 2, 'REV', 90000)];
  const project = { duration_months: 12, calculation_method: 'MIXED', target_roi_percent: 30 };
  const list = summarizeForList(project, rows);
  const { summary } = analyzeProject(project, rows);
  assert.equal(list.summary_phase, 'Actual');
  assert.equal(list.roi, summary.actual.roi);
  assert.equal(list.total_cost, summary.actual.totalExpense);
  assert.equal(list.estimated_roi, summary.estimated.roi);
  assert.equal(list.estimated_to_date_roi, summary.estimatedToDate.roi);
});

test('ไม่มีต้นทุน: ROI = null และระยะคืนทุน = null (ไม่หารด้วยศูนย์)', () => {
  assert.equal(calcRoi(500, 0), null);
  assert.equal(calcPaybackMonths(0, 500, 12), null);
  assert.equal(calcPaybackMonths(100, 0, 12), null);
});

test('มีผลประโยชน์แต่ต้นทุน 0: ROI = null และถือว่าคุ้มค่า, ไม่มีข้อมูลเลย = ยังตัดสินไม่ได้', () => {
  const s = analyzeProject({ duration_months: 1, target_roi_percent: 10 }, [row('ESTIMATED', 1, 'REV', 1000)]).summary;
  assert.equal(s.estimated.roi, null);
  assert.equal(s.isWorthwhile, true);
  assert.equal(s.variance.roi, null);
  assert.equal(analyzeProject({ duration_months: 1, target_roi_percent: 10 }, []).summary.isWorthwhile, null);
});
