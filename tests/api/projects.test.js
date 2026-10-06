// Integration test: สร้าง/แก้ไข/ลบโครงการ (FR02) และสถานะโครงการ
const { api, login, createProject, closeDb, USERS } = require('./helpers');

let token;
beforeAll(async () => { token = await login(USERS.owner); });
afterAll(closeDb);

describe('IT-PRJ การจัดการโครงการ (/api/projects)', () => {
  let id;

  test('IT-PRJ-01 สร้างโครงการได้ สถานะเริ่มต้น planning (Estimated)', async () => {
    id = await createProject(token, { project_name: 'โครงการทดสอบ Jest' });
    const res = await api(token).get(`/api/projects/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      project_name: 'โครงการทดสอบ Jest',
      project_status: 'planning',
      calculation_method: 'MIXED',
      duration_months: 6,
    });
  });

  test.each([
    ['ไม่มีชื่อ', { project_name: '' }],
    ['ระยะเวลา 0 เดือน', { duration_months: 0 }],
    ['ระยะเวลาเกิน 120 เดือน', { duration_months: 121 }],
    ['งบติดลบ', { initial_budget: -1 }],
    ['เป้า ROI เกิน 999.99', { target_roi_percent: 5000 }],
    ['ประเภทโครงการไม่มีอยู่จริง', { project_type_id: 99999 }],
  ])('IT-PRJ-02 สร้างไม่ได้เมื่อ%s (400)', async (_label, override) => {
    const res = await api(token).post('/api/projects', {
      project_name: 'x', project_type_id: 3, duration_months: 6, initial_budget: 1000, ...override,
    });
    expect(res.status).toBe(400);
  });

  test('IT-PRJ-03 แก้ไขข้อมูลพื้นฐานได้ (FR02-2)', async () => {
    const res = await api(token).put(`/api/projects/${id}`, { project_name: 'แก้ชื่อแล้ว', duration_months: 8, target_roi_percent: 35 });
    expect(res.status).toBe(200);
    const p = (await api(token).get(`/api/projects/${id}`)).body.data;
    expect(p.project_name).toBe('แก้ชื่อแล้ว');
    expect(p.duration_months).toBe(8);
    expect(Number(p.target_roi_percent)).toBe(35);
  });

  test('IT-PRJ-04 เปลี่ยนแค่สถานะ เป้าหมาย ROI เดิมไม่หาย', async () => {
    await api(token).put(`/api/projects/${id}/ledgers/actual`, {
      ledgers: [
        { category_id: 'INV001', total_value: 800, period_from: 1, period_to: 1 },
        { category_id: 'REV001', total_value: 1000, period_from: 1, period_to: 1 },
      ],
    });
    await api(token).put(`/api/projects/${id}`, { status: 'completed' });
    const p = (await api(token).get(`/api/projects/${id}`)).body.data;
    expect(p.project_status).toBe('completed');
    expect(Number(p.target_roi_percent)).toBe(35);
  });

  test('IT-PRJ-05 รายการโครงการมีตัวชี้วัดสรุปจาก backend (ROI, ระยะคืนทุน, แผน vs จริง)', async () => {
    const list = (await api(token).get('/api/projects')).body.data;
    const p = list.find((x) => x.project_id === id);
    expect(p).toEqual(expect.objectContaining({
      roi: expect.any(Number),
      total_benefit: expect.any(Number),
      total_cost: expect.any(Number),
      has_actual: true,
    }));
    expect(p).toHaveProperty('payback_months');
    expect(p).toHaveProperty('estimated_roi');
    expect(p).toHaveProperty('actual_roi');
  });

  test('IT-PRJ-06 ลบโครงการได้ และหลังลบเปิดดูไม่ได้ (404)', async () => {
    expect((await api(token).delete(`/api/projects/${id}`)).status).toBe(200);
    expect((await api(token).get(`/api/projects/${id}`)).status).toBe(404);
  });
});

describe('IT-STS สถานะโครงการ (Estimated → Actual → Completed)', () => {
  let id;
  beforeAll(async () => {
    id = await createProject(token, { project_name: 'Status test' });
    await api(token).put(`/api/projects/${id}/ledgers/estimated`, {
      ledgers: [{ category_id: 'INV001', total_value: 50000, period_from: 1, period_to: 1 }],
    });
  });
  afterAll(() => api(token).delete(`/api/projects/${id}`));

  test('IT-STS-01 ยังไม่มีผลจริง เปลี่ยนเป็น completed ไม่ได้ (400)', async () => {
    expect((await api(token).put(`/api/projects/${id}`, { status: 'completed' })).status).toBe(400);
  });

  test('IT-STS-02 บันทึกผลจริงครั้งแรก สถานะเปลี่ยนเป็น in_progress อัตโนมัติ', async () => {
    const res = await api(token).put(`/api/projects/${id}/ledgers/actual`, {
      ledgers: [{ category_id: 'INV001', total_value: 52000, period_from: 1, period_to: 1 }],
    });
    expect(res.status).toBe(200);
    expect((await api(token).get(`/api/projects/${id}`)).body.data.project_status).toBe('in_progress');
  });

  test('IT-STS-03 มีผลจริงแล้วกลับไป planning ไม่ได้ และแก้ประมาณการไม่ได้ (400)', async () => {
    expect((await api(token).put(`/api/projects/${id}`, { status: 'planning' })).status).toBe(400);
    expect((await api(token).put(`/api/projects/${id}/ledgers/estimated`, { ledgers: [] })).status).toBe(400);
  });

  test('IT-STS-04 โครงการ completed ถูกล็อกไม่ให้แก้ข้อมูล และเปิดกลับมาแก้ได้', async () => {
    expect((await api(token).put(`/api/projects/${id}`, { status: 'completed' })).status).toBe(200);
    expect((await api(token).put(`/api/projects/${id}/ledgers/actual`, { ledgers: [] })).status).toBe(400);
    expect((await api(token).put(`/api/projects/${id}`, { status: 'in_progress' })).status).toBe(200);
  });

  test('IT-STS-05 ลบผลจริงออกทั้งหมด สถานะกลับเป็น planning', async () => {
    await api(token).put(`/api/projects/${id}/ledgers/actual`, { ledgers: [] });
    expect((await api(token).get(`/api/projects/${id}`)).body.data.project_status).toBe('planning');
  });
});
