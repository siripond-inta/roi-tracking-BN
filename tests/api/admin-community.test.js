// Integration test: หมวดหมู่ / ประเภทโครงการ (FR07) และการแชร์โครงการสาธารณะ (Community)
const { api, login, createProject, closeDb, USERS } = require('./helpers');

let owner, other, admin;

beforeAll(async () => {
  [owner, other, admin] = await Promise.all([login(USERS.owner), login(USERS.other), login(USERS.admin)]);
});
afterAll(closeDb);

describe('IT-CAT หมวดหมู่ผลประโยชน์/ต้นทุน (/api/categories)', () => {
  let created;

  test('IT-CAT-01 ผู้ใช้ทุกคนดูหมวดหมู่ได้ ครบทุกกลุ่มรวมหมวด "อื่นๆ"', async () => {
    const res = await api(owner).get('/api/categories');
    expect(res.status).toBe(200);
    const groups = new Set(res.body.data.map((c) => c.category_group));
    ['REV', 'BEN', 'INV', 'OPC', 'ADC'].forEach((g) => expect(groups.has(g)).toBe(true));
    expect(res.body.data.filter((c) => Number(c.allow_custom_name) === 1)).toHaveLength(5);
  });

  test('IT-CAT-02 admin เพิ่มหมวดได้ รหัสและประเภทรายรับ/รายจ่ายสร้างจากกลุ่มอัตโนมัติ', async () => {
    const res = await api(admin).post('/api/categories', { category_name: 'ค่าเดินทาง (Jest)', category_group: 'OPC' });
    expect(res.status).toBe(201);
    created = res.body.data.category_id;
    expect(created).toMatch(/^OPC\d{3}$/);
    const cat = (await api(admin).get('/api/categories')).body.data.find((c) => c.category_id === created);
    expect(Number(cat.is_inflow)).toBe(0);
  });

  test('IT-CAT-03 หมวดผลประโยชน์ทางอ้อมต้องมีชื่อหน่วยและอัตรา (400)', async () => {
    const res = await api(admin).post('/api/categories', { category_name: 'BEN ไม่มีหน่วย', category_group: 'BEN' });
    expect(res.status).toBe(400);
  });

  test('IT-CAT-04 หมวดที่มีข้อมูลใช้งานอยู่ เปลี่ยนกลุ่มไม่ได้ (400)', async () => {
    expect((await api(admin).put('/api/categories/REV001', { category_group: 'OPC' })).status).toBe(400);
  });

  test('IT-CAT-05 ลบหมวดที่ยังไม่ถูกใช้ได้', async () => {
    expect((await api(admin).delete(`/api/categories/${created}`)).status).toBe(200);
  });
});

describe('IT-PTY ประเภทโครงการ (/api/project-types)', () => {
  let typeId;

  test('IT-PTY-01 ดูประเภทโครงการได้ 3 แบบพร้อมวิธีคำนวณ', async () => {
    const types = (await api(owner).get('/api/project-types')).body.data;
    expect(types.map((t) => t.calculation_method).sort()).toEqual(['COST_SAVING', 'MIXED', 'REVENUE']);
  });

  test('IT-PTY-02 admin เพิ่ม/แก้/ลบประเภทโครงการได้', async () => {
    const res = await api(admin).post('/api/project-types', { type_name: 'Jest type', calculation_method: 'MIXED' });
    expect(res.status).toBe(201);
    typeId = res.body.data.type_id;
    expect((await api(admin).put(`/api/project-types/${typeId}`, { type_name: 'Jest type 2', calculation_method: 'REVENUE' })).status).toBe(200);
    expect((await api(admin).delete(`/api/project-types/${typeId}`)).status).toBe(200);
  });

  test('IT-PTY-03 วิธีคำนวณที่ไม่รองรับถูกปฏิเสธ (400)', async () => {
    expect((await api(admin).post('/api/project-types', { type_name: 'x', calculation_method: 'MAGIC' })).status).toBe(400);
  });
});

describe('IT-COM การแชร์โครงการ (Community)', () => {
  let id;
  beforeAll(async () => {
    id = await createProject(owner, { project_name: 'Community test' });
  });
  afterAll(() => api(owner).delete(`/api/projects/${id}`));

  test('IT-COM-01 ยังไม่มีผลจริง เปิดเป็นสาธารณะไม่ได้ (400)', async () => {
    expect((await api(owner).patch(`/api/projects/${id}/visibility`, { is_public: true })).status).toBe(400);
  });

  test('IT-COM-02 มีผลจริงแล้วเปิดสาธารณะได้ คนอื่นเห็นในหน้า Community และเปิดรายงานได้', async () => {
    await api(owner).put(`/api/projects/${id}/ledgers/actual`, {
      ledgers: [{ category_id: 'REV001', total_value: 1000, period_from: 1, period_to: 1 }],
    });
    expect((await api(owner).patch(`/api/projects/${id}/visibility`, { is_public: true })).status).toBe(200);
    const community = (await api(other).get('/api/projects/community')).body.data;
    const shared = community.find((p) => p.project_id === id);
    expect(shared).toBeTruthy();
    expect(shared.owner_name).toBeTruthy();
    expect(shared).toHaveProperty('roi');
    expect((await api(other).get(`/api/projects/${id}/analytics`)).status).toBe(200);
  });

  test('IT-COM-03 ผู้ชมแก้ไขโครงการสาธารณะของคนอื่นไม่ได้', async () => {
    expect((await api(other).put(`/api/projects/${id}`, { project_name: 'x' })).status).toBe(404);
  });

  test('IT-COM-04 เปลี่ยนกลับเป็นส่วนตัว คนอื่นมองไม่เห็นอีก', async () => {
    expect((await api(owner).patch(`/api/projects/${id}/visibility`, { is_public: false })).status).toBe(200);
    const community = (await api(other).get('/api/projects/community')).body.data;
    expect(community.some((p) => p.project_id === id)).toBe(false);
  });
});
