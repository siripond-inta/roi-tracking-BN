// Integration test: บันทึกรายการ (FR03), การคำนวณ (FR04) และเปรียบเทียบแผน/จริง (FR05)
const { api, login, createProject, closeDb, USERS } = require('./helpers');

let token, id;

beforeAll(async () => {
  token = await login(USERS.owner);
  id = await createProject(token, { project_name: 'Ledger + analytics test', duration_months: 6, target_roi_percent: 20 });
});

afterAll(async () => {
  await api(token).delete(`/api/projects/${id}`);
  await closeDb();
});

const ESTIMATED = [
  { category_id: 'INV001', total_value: 60000, period_from: 1, period_to: 1, note: 'ลงทุนระบบ' },
  { category_id: 'REV001', total_value: 10000, period_from: 2, period_to: 6, note: 'ยอดขายเพิ่ม' },
  // ผลประโยชน์ทางอ้อม: 20 ชม./เดือน × ฿250 = ฿5,000/เดือน
  { category_id: 'BEN001', unit_qty: 20, unit_cost: 250, period_from: 2, period_to: 6, note: 'ลดเวลาทำงาน' },
  // หมวด "อื่นๆ" ต้องระบุชื่อรายการเอง
  { category_id: 'OPCOTH', custom_name: 'ค่าโฆษณา', total_value: 1000, period_from: 1, period_to: 6 },
];

describe('IT-LED บันทึกรายการประมาณการ/ผลจริง', () => {
  test('IT-LED-01 บันทึกประมาณการแบบช่วงเดือนได้ ระบบกระจายเป็นรายเดือน', async () => {
    const res = await api(token).put(`/api/projects/${id}/ledgers/estimated`, { ledgers: ESTIMATED });
    expect(res.status).toBe(200);
    const rows = (await api(token).get(`/api/projects/${id}/ledgers`)).body.data;
    expect(rows.filter((r) => r.category_id === 'REV001')).toHaveLength(5);
    expect(rows.filter((r) => r.category_id === 'OPCOTH')).toHaveLength(6);
  });

  test('IT-LED-02 ผลประโยชน์ทางอ้อมคำนวณ ปริมาณ × อัตรา ให้อัตโนมัติ (FR03-4)', async () => {
    const rows = (await api(token).get(`/api/projects/${id}/ledgers`)).body.data.filter((r) => r.category_id === 'BEN001');
    expect(rows).toHaveLength(5);
    rows.forEach((r) => expect(Number(r.total_value)).toBe(5000));
  });

  test('IT-LED-03 หมวด "อื่นๆ" เก็บชื่อรายการที่ผู้ใช้ระบุ', async () => {
    const row = (await api(token).get(`/api/projects/${id}/ledgers`)).body.data.find((r) => r.category_id === 'OPCOTH');
    expect(row.custom_name).toBe('ค่าโฆษณา');
  });

  test('IT-LED-04 วันที่ของรายการคำนวณจากเดือนเริ่มโครงการ (FR03-2)', async () => {
    const rows = (await api(token).get(`/api/projects/${id}/ledgers`)).body.data.filter((r) => r.category_id === 'REV001');
    const dates = rows.map((r) => r.transaction_date).sort();
    expect(new Set(dates).size).toBe(5);
    dates.forEach((d) => expect(d).toMatch(/^\d{4}-\d{2}-15$/));
  });

  test.each([
    ['ยอดติดลบ', [{ category_id: 'REV001', total_value: -5, period_from: 1, period_to: 1 }]],
    ['ผลประโยชน์ทางอ้อมกรอกแค่ปริมาณ', [{ category_id: 'BEN001', unit_qty: 5, period_from: 1, period_to: 1 }]],
    ['ช่วงเดือนเกินระยะเวลาโครงการ', [{ category_id: 'REV001', total_value: 1, period_from: 2, period_to: 9 }]],
    ['หมวด "อื่นๆ" ไม่ระบุชื่อ', [{ category_id: 'OPCOTH', total_value: 100, period_from: 1, period_to: 1 }]],
    ['หมวดหมู่ไม่มีอยู่จริง', [{ category_id: 'NOPE01', total_value: 100, period_from: 1, period_to: 1 }]],
  ])('IT-LED-05 บันทึกไม่ได้เมื่อ%s (400) และข้อมูลเดิมไม่หาย', async (_label, ledgers) => {
    const before = (await api(token).get(`/api/projects/${id}/ledgers`)).body.data.length;
    const res = await api(token).put(`/api/projects/${id}/ledgers/estimated`, { ledgers });
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
    const after = (await api(token).get(`/api/projects/${id}/ledgers`)).body.data.length;
    expect(after).toBe(before);
  });
});

describe('IT-CAL การคำนวณผลตอบแทน (/analytics)', () => {
  // ประมาณการ: ต้นทุน 60,000 + 6×1,000 = 66,000 · ผลประโยชน์ 5×10,000 + 5×5,000 = 75,000
  test('IT-CAL-01 ROI = (ผลประโยชน์ − ต้นทุน) ÷ ต้นทุน × 100', async () => {
    const s = (await api(token).get(`/api/projects/${id}/analytics`)).body.data.summary.estimated;
    expect(s.totalExpense).toBe(66000);
    expect(s.totalRevenue).toBe(75000);
    expect(s.netProfit).toBe(9000);
    expect(s.roi).toBeCloseTo((9000 / 66000) * 100, 6);
  });

  test('IT-CAL-02 ระยะคืนทุน = ต้นทุนรวม ÷ (ผลประโยชน์รวม ÷ จำนวนเดือน)', async () => {
    const s = (await api(token).get(`/api/projects/${id}/analytics`)).body.data.summary.estimated;
    expect(s.paybackMonths).toBeCloseTo(66000 / (75000 / 6), 6); // 5.28 เดือน
  });

  test('IT-CAL-03 แยกรายได้โดยตรงกับผลประโยชน์ทางอ้อม และเทียบประโยชน์ทางอ้อมเป็นรายปี', async () => {
    const s = (await api(token).get(`/api/projects/${id}/analytics`)).body.data.summary.estimated;
    expect(s.directRevenue).toBe(50000);
    expect(s.indirectBenefit).toBe(25000);
    expect(s.indirectAnnualized).toBeCloseTo((25000 / 6) * 12, 6);
  });

  test('IT-CAL-04 กระแสเงินสดรายเดือนและยอดสะสมถูกต้อง (FR04-1)', async () => {
    const monthly = (await api(token).get(`/api/projects/${id}/analytics`)).body.data.monthly;
    expect(monthly).toHaveLength(6);
    expect(monthly[0].estimated.ncf).toBe(-61000);
    expect(monthly[1].estimated.ncf).toBe(14000);
    expect(monthly[5].estimated.cumulative).toBe(9000);
  });

  test('IT-CAL-05 สถานะคุ้มค่าเทียบเป้า ROI (FR04-4)', async () => {
    const s = (await api(token).get(`/api/projects/${id}/analytics`)).body.data.summary;
    expect(s.targetRoi).toBe(20);
    expect(s.isWorthwhile).toBe(false); // ROI 13.6% < เป้า 20%
  });

  test('IT-CAL-06 ประเภทโครงการมุ่งลดต้นทุนนับเฉพาะผลประโยชน์ทางอ้อม', async () => {
    await api(token).put(`/api/projects/${id}`, { project_type_id: 2 }); // COST_SAVING
    const s = (await api(token).get(`/api/projects/${id}/analytics`)).body.data.summary;
    expect(s.countedSources).toEqual({ direct: false, indirect: true });
    expect(s.estimated.totalRevenue).toBe(25000);
    expect(s.estimated.excludedBenefit).toBe(50000);
    await api(token).put(`/api/projects/${id}`, { project_type_id: 3 });
  });

  test('IT-CAL-07 พรีวิวคำนวณจากรายการที่ยังไม่บันทึก โดยไม่เขียนลง database', async () => {
    const before = (await api(token).get(`/api/projects/${id}/ledgers`)).body.data.length;
    const res = await api(token).post(`/api/projects/${id}/analytics/preview`, {
      phase: 'Estimated',
      ledgers: [
        { category_id: 'INV001', total_value: 10000, period_from: 1, period_to: 1 },
        { category_id: 'REV001', total_value: 5000, period_from: 1, period_to: 4 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.summary.estimated.roi).toBe(100);
    expect((await api(token).get(`/api/projects/${id}/ledgers`)).body.data.length).toBe(before);
  });
});

describe('IT-CMP เปรียบเทียบแผนกับผลจริง (FR05)', () => {
  beforeAll(async () => {
    // ผลจริง 3 เดือนแรก: ลงทุน 62,000 · รายได้เดือน 2–3 เดือนละ 8,000 · ประโยชน์ทางอ้อม 18 ชม. × 250
    await api(token).put(`/api/projects/${id}/ledgers/actual`, {
      ledgers: [
        { category_id: 'INV001', total_value: 62000, period_from: 1, period_to: 1 },
        { category_id: 'REV001', total_value: 8000, period_from: 2, period_to: 3 },
        { category_id: 'BEN001', unit_qty: 18, unit_cost: 250, period_from: 2, period_to: 3 },
      ],
    });
  });

  test('IT-CMP-01 ผลจริงคำนวณเฉพาะเดือนที่บันทึกแล้ว', async () => {
    const s = (await api(token).get(`/api/projects/${id}/analytics`)).body.data.summary;
    expect(s.hasActualData).toBe(true);
    expect(s.lastActualPeriod).toBe(3);
    expect(s.actual.totalExpense).toBe(62000);
    expect(s.actual.totalRevenue).toBe(2 * 8000 + 2 * 4500);
    expect(s.actual.paybackMonths).toBeCloseTo(62000 / (25000 / 3), 6);
  });

  test('IT-CMP-02 แผนถึงเดือนเดียวกัน (เดือน 1–3) ใช้เทียบกับผลจริง', async () => {
    const s = (await api(token).get(`/api/projects/${id}/analytics`)).body.data.summary;
    expect(s.estimatedToDate.months).toBe(3);
    expect(s.estimatedToDate.totalRevenue).toBe(2 * 10000 + 2 * 5000);
    expect(s.estimatedToDate.totalExpense).toBe(60000 + 3 * 1000);
  });

  test('IT-CMP-03 รายหมวดมีส่วนต่างเทียบแผนช่วงเดียวกัน', async () => {
    const rev = (await api(token).get(`/api/projects/${id}/analytics`)).body.data.byCategory
      .find((c) => c.category_id === 'REV001');
    expect(rev.estimatedToDate).toBe(20000);
    expect(rev.actual).toBe(16000);
    expect(rev.varianceToDate).toBe(-4000);
  });
});
