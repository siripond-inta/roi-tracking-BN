// tests/finance.test.js — รันด้วย `npm test` (node --test ไม่ต้องลง library เพิ่ม)
const assert = require('node:assert/strict');
const { analyzeProject, calcRoi, calcPaybackMonths, isCounted, summarizeForList } = require('../../services/finance');

const row = (phase, period, category_group, total_value, extra = {}) => ({
  phase,
  period_index: period,
  category_id: extra.category_id || `${category_group}001`,
  category_name: extra.category_name || category_group,
  category_group,
  is_inflow: ['REV', 'BEN'].includes(category_group) ? 1 : 0,
  total_value,
});

test('ROI = (ผลประโยชน์ - ต้นทุน) / ต้นทุน × 100 และไม่หารด้วยศูนย์', () => {
  assert.equal(calcRoi(150, 100), 50);
  assert.equal(calcRoi(50, 100), -50);
  assert.equal(calcRoi(100, 0), null); // ไม่มีต้นทุน → คำนวณ ROI ไม่ได้ (เดิมคืน 0)
});

test('ประเภทโครงการเลือกแหล่งผลประโยชน์ที่นับ', () => {
  assert.equal(isCounted('REVENUE', 'direct'), true);
  assert.equal(isCounted('REVENUE', 'indirect'), false);
  assert.equal(isCounted('COST_SAVING', 'direct'), false);
  assert.equal(isCounted('COST_SAVING', 'indirect'), true);
  assert.equal(isCounted('MIXED', 'direct'), true);
  assert.equal(isCounted('MIXED', 'indirect'), true);
  assert.equal(isCounted(null, 'indirect'), true);
  assert.equal(isCounted('REVENUE', 'cost'), true);
});

test('ROI ของโครงการเดียวกันเปลี่ยนตามประเภท', () => {
  const rows = [
    row('ESTIMATED', 1, 'INV', 100),
    row('ESTIMATED', 2, 'REV', 80),
    row('ESTIMATED', 2, 'BEN', 70),
  ];
  const base = { duration_months: 3 };
  const revenue = analyzeProject({ ...base, calculation_method: 'REVENUE' }, rows).summary.estimated;
  const saving = analyzeProject({ ...base, calculation_method: 'COST_SAVING' }, rows).summary.estimated;
  const mixed = analyzeProject({ ...base, calculation_method: 'MIXED' }, rows).summary.estimated;

  assert.equal(revenue.totalRevenue, 80);
  assert.equal(revenue.excludedBenefit, 70);
  assert.equal(revenue.roi, -20);
  assert.equal(saving.totalRevenue, 70);
  assert.equal(saving.excludedBenefit, 80);
  assert.equal(mixed.totalRevenue, 150);
  assert.equal(mixed.directRevenue, 80);
  assert.equal(mixed.indirectBenefit, 70);
  assert.equal(mixed.roi, 50);
});

test('กระแสเงินสดรายเดือนและสะสม', () => {
  const { monthly } = analyzeProject({ duration_months: 3 }, [
    row('ESTIMATED', 1, 'INV', 300),
    row('ESTIMATED', 1, 'OPC', 20),
    row('ESTIMATED', 2, 'REV', 200),
    row('ESTIMATED', 2, 'OPC', 20),
    row('ESTIMATED', 3, 'BEN', 150),
  ]);
  assert.deepEqual(monthly.map((m) => m.estimated.ncf), [-320, 180, 150]);
  assert.deepEqual(monthly.map((m) => m.estimated.cumulative), [-320, -140, 10]);
});

test('ระยะคืนทุน = ต้นทุนรวม ÷ (ผลประโยชน์รวม ÷ จำนวนเดือน)', () => {
  // ตัวอย่างโครงการ CRM: 661,000 ÷ (1,086,000 ÷ 12) = 7.30 เดือน
  assert.equal(calcPaybackMonths(661000, 1086000, 12).toFixed(1), '7.3');
  // ผลประโยชน์น้อยกว่าต้นทุนมาก → นานกว่าระยะเวลาโครงการได้
  assert.equal(calcPaybackMonths(120000, 60000, 12), 24);
  // ไม่มีผลประโยชน์ หรือไม่มีต้นทุน → คำนวณไม่ได้
  assert.equal(calcPaybackMonths(100000, 0, 12), null);
  assert.equal(calcPaybackMonths(0, 50000, 12), null);
});

test('ระยะคืนทุนใช้ต้นทุน/ผลประโยชน์ชุดเดียวกับ ROI และนับจำนวนเดือนตามช่วงข้อมูล', () => {
  const rows = [
    row('ESTIMATED', 1, 'INV', 60000),
    row('ESTIMATED', 2, 'REV', 40000),
    row('ESTIMATED', 3, 'REV', 40000),
    row('ESTIMATED', 4, 'REV', 40000),
    // ผลจริงมีแค่ 2 เดือน → ผลประโยชน์เฉลี่ยต่อเดือนคิดจาก 2 เดือน
    row('ACTUAL', 1, 'INV', 60000),
    row('ACTUAL', 2, 'REV', 30000),
  ];
  const { summary } = analyzeProject({ duration_months: 4, calculation_method: 'REVENUE' }, rows);
  assert.equal(summary.estimated.roi, 100);
  assert.equal(summary.estimated.paybackMonths, 60000 / (120000 / 4)); // 2 เดือน
  assert.equal(summary.actual.paybackMonths, 60000 / (30000 / 2));     // 4 เดือน
  const list = summarizeForList({ duration_months: 4, calculation_method: 'REVENUE' }, rows);
  assert.equal(list.estimated_payback_months, 2);
  assert.equal(list.actual_payback_months, 4);
  // แผนช่วงเดียวกัน (เดือน 1–2): 60,000 ÷ (40,000 ÷ 2) = 3 เดือน
  assert.equal(summary.estimatedToDate.paybackMonths, 3);
  assert.equal(list.estimated_to_date_payback_months, 3);
});

test('ประโยชน์ทางอ้อมเทียบเป็นรายปีจากค่าเฉลี่ยรายเดือน', () => {
  const rows = Array.from({ length: 6 }, (_, i) => row('ESTIMATED', i + 1, 'BEN', 10000));
  const { summary } = analyzeProject({ duration_months: 6, calculation_method: 'COST_SAVING' }, rows);
  assert.equal(summary.estimated.indirectBenefit, 60000);
  assert.equal(summary.estimated.indirectMonthlyAverage, 10000);
  assert.equal(summary.estimated.indirectAnnualized, 120000);
});

test('ส่วนต่างแผน-จริง และสถานะคุ้มค่าเทียบเป้าหมาย', () => {
  const { summary, monthly } = analyzeProject({ duration_months: 2, target_roi_percent: 20 }, [
    row('ESTIMATED', 1, 'INV', 100),
    row('ESTIMATED', 2, 'REV', 150),
    row('ACTUAL', 1, 'INV', 110),
    row('ACTUAL', 2, 'REV', 120),
  ]);
  assert.equal(monthly[1].variance.revenue, -30);
  assert.equal(summary.worthwhileBasis, 'actual');
  assert.ok(Math.abs(summary.actual.roi - 9.0909) < 0.001);
  assert.equal(summary.isWorthwhile, false);
});

test('สรุปย่อสำหรับหน้ารายการใช้ phase จริงเมื่อมีข้อมูลแล้ว', () => {
  const s = summarizeForList({ duration_months: 2 }, [
    row('ESTIMATED', 1, 'INV', 100),
    row('ESTIMATED', 2, 'REV', 300),
    row('ACTUAL', 1, 'INV', 100),
    row('ACTUAL', 2, 'REV', 150),
  ]);
  assert.equal(s.summary_phase, 'Actual');
  assert.equal(s.total_benefit, 150);
  assert.equal(s.roi, 50);
});

test('byCategory เทียบผลจริงกับแผนถึงเดือนที่มีผลจริงล่าสุด', () => {
  const rows = [1, 2, 3, 4].map((p) => ({ phase: 'ESTIMATED', period_index: p, category_id: 'REV001', category_group: 'REV', is_inflow: 1, total_value: 100 }));
  rows.push({ phase: 'ACTUAL', period_index: 1, category_id: 'REV001', category_group: 'REV', is_inflow: 1, total_value: 90 });
  rows.push({ phase: 'ACTUAL', period_index: 2, category_id: 'REV001', category_group: 'REV', is_inflow: 1, total_value: 120 });
  const { byCategory } = analyzeProject({ duration_months: 4, calculation_method: 'REVENUE' }, rows);
  const c = byCategory.find((x) => x.category_id === 'REV001');
  assert.equal(c.estimated, 400);
  assert.equal(c.estimatedToDate, 200);
  assert.equal(c.varianceToDate, 10);
  assert.equal(c.estimatedByPeriod, undefined);
});

test('แผนถึงเดือนเดียวกัน และหมวด "อื่นๆ" แยกตามชื่อที่ผู้ใช้ระบุ', () => {
  const row = (phase, period, cat, group, value, custom) => ({
    phase, period_index: period, category_id: cat, category_group: group, is_inflow: group === 'REV' ? 1 : 0,
    total_value: value, custom_name: custom, category_name: 'อื่นๆ',
  });
  const rows = [
    row('ESTIMATED', 1, 'OPCOTH', 'OPC', 100, 'ค่าโฆษณา'),
    row('ESTIMATED', 1, 'OPCOTH', 'OPC', 50, 'ค่าขนส่ง'),
    row('ESTIMATED', 1, 'REV001', 'REV', 300),
    row('ESTIMATED', 2, 'REV001', 'REV', 300),
    row('ACTUAL', 1, 'REV001', 'REV', 200),
    row('ACTUAL', 1, 'OPCOTH', 'OPC', 100, 'ค่าโฆษณา'),
  ];
  const { summary, byCategory } = analyzeProject({ duration_months: 2, calculation_method: 'REVENUE' }, rows);
  assert.deepEqual(byCategory.filter((c) => c.category_id === 'OPCOTH').map((c) => c.category_name).sort(), ['ค่าขนส่ง', 'ค่าโฆษณา']);
  assert.equal(summary.estimatedToDate.months, 1);
  assert.equal(summary.estimatedToDate.totalRevenue, 300);
  assert.equal(summary.estimatedToDate.totalExpense, 150);
  assert.equal(summary.estimatedToDate.roi, 100);

  const list = summarizeForList({ duration_months: 2, calculation_method: 'REVENUE' }, rows);
  assert.equal(list.has_actual, true);
  assert.equal(list.actual_roi, 100);
  assert.equal(list.estimated_roi, calcRoi(600, 150));
});
