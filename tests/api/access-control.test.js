// Integration test: สิทธิ์การเข้าถึงตามบทบาท (FR01-2) และการเข้าถึงข้อมูลของคนอื่น
const { api, login, createProject, closeDb, USERS } = require('./helpers');

let owner, other, admin, viewer, projectId;

beforeAll(async () => {
  [owner, other, admin, viewer] = await Promise.all([
    login(USERS.owner), login(USERS.other), login(USERS.admin), login(USERS.viewer),
  ]);
  projectId = await createProject(owner, { project_name: 'Access control test' });
});

afterAll(async () => {
  await api(owner).delete(`/api/projects/${projectId}`);
  await closeDb();
});

describe('IT-ACL สิทธิ์ตามบทบาทผู้ใช้', () => {
  test('IT-ACL-01 viewer สร้างโครงการไม่ได้ (403)', async () => {
    const res = await api(viewer).post('/api/projects', { project_name: 'x', project_type_id: 1, duration_months: 6, initial_budget: 1000 });
    expect(res.status).toBe(403);
  });

  test('IT-ACL-02 ผู้ใช้ทั่วไปเรียก API ของ admin ไม่ได้ (403)', async () => {
    expect((await api(owner).get('/api/admin/users')).status).toBe(403);
    expect((await api(owner).get('/api/admin/projects')).status).toBe(403);
  });

  test('IT-ACL-03 ผู้ใช้ทั่วไปเพิ่ม/แก้หมวดหมู่และประเภทโครงการไม่ได้ (403)', async () => {
    expect((await api(owner).post('/api/categories', { category_name: 'x', category_group: 'REV' })).status).toBe(403);
    expect((await api(owner).post('/api/project-types', { type_name: 'x', calculation_method: 'MIXED' })).status).toBe(403);
  });

  test('IT-ACL-04 admin เรียกดูผู้ใช้และโครงการทั้งระบบได้', async () => {
    const users = await api(admin).get('/api/admin/users');
    expect(users.status).toBe(200);
    expect(users.body.data.length).toBeGreaterThanOrEqual(5);
    const projects = await api(admin).get('/api/admin/projects');
    expect(projects.status).toBe(200);
    expect(projects.body.data.some((p) => p.project_id === projectId)).toBe(true);
  });

  test('IT-ACL-05 โครงการส่วนตัวของคนอื่นเปิดดูไม่ได้ (404)', async () => {
    expect((await api(other).get(`/api/projects/${projectId}`)).status).toBe(404);
    expect((await api(other).get(`/api/projects/${projectId}/analytics`)).status).toBe(404);
  });

  test('IT-ACL-06 แก้ไข/ลบ/บันทึกข้อมูลโครงการของคนอื่นไม่ได้ (404)', async () => {
    expect((await api(other).put(`/api/projects/${projectId}`, { project_name: 'hacked' })).status).toBe(404);
    expect((await api(other).put(`/api/projects/${projectId}/ledgers/estimated`, { ledgers: [] })).status).toBe(404);
    expect((await api(other).delete(`/api/projects/${projectId}`)).status).toBe(404);
  });

  test('IT-ACL-07 รายการโครงการของฉันแสดงเฉพาะของตัวเอง', async () => {
    const mine = (await api(other).get('/api/projects')).body.data;
    expect(mine.every((p) => p.project_id !== projectId)).toBe(true);
  });
});
