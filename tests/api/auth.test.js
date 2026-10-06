// Integration test: สมัครสมาชิก / เข้าสู่ระบบ / แก้ไขโปรไฟล์ / เปลี่ยนรหัสผ่าน (FR01)
const { api, login, closeDb, USERS, PASSWORD } = require('./helpers');

afterAll(closeDb);

describe('IT-AUTH การยืนยันตัวตน (/api/auth)', () => {
  const email = `jest.user.${Date.now()}@example.com`;

  test('IT-AUTH-01 สมัครสมาชิกด้วยข้อมูลครบถ้วนได้ (201)', async () => {
    const res = await api().post('/api/auth/signup', { full_name: 'Jest User', email, password: 'secret123' });
    expect(res.status).toBe(201);
  });

  test('IT-AUTH-02 สมัครซ้ำด้วยอีเมลเดิมไม่ได้ (409)', async () => {
    const res = await api().post('/api/auth/signup', { full_name: 'Jest User', email, password: 'secret123' });
    expect(res.status).toBe(409);
  });

  test.each([
    ['ข้อมูลไม่ครบ', { full_name: '', email: 'a@b.com', password: 'secret123' }],
    ['อีเมลผิดรูปแบบ', { full_name: 'A', email: 'not-an-email', password: 'secret123' }],
    ['รหัสผ่านสั้นกว่า 6 ตัว', { full_name: 'A', email: 'short@example.com', password: '123' }],
  ])('IT-AUTH-03 สมัครไม่ได้เมื่อ%s (400)', async (_label, body) => {
    const res = await api().post('/api/auth/signup', body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  test('IT-AUTH-04 เข้าสู่ระบบสำเร็จได้ token และข้อมูลผู้ใช้ (ไม่มี password_hash)', async () => {
    const res = await api().post('/api/auth/login', { email: USERS.owner, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: USERS.owner, role: 'project_owner' });
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
  });

  test('IT-AUTH-05 รหัสผ่านผิดเข้าสู่ระบบไม่ได้ (401)', async () => {
    const res = await api().post('/api/auth/login', { email: USERS.owner, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  test('IT-AUTH-06 ไม่ส่ง token เรียก API ที่ต้องล็อกอินไม่ได้ (401)', async () => {
    const res = await api().get('/api/projects');
    expect(res.status).toBe(401);
  });

  test('IT-AUTH-07 token ปลอมใช้ไม่ได้ (401/403)', async () => {
    const res = await api('not.a.real.token').get('/api/projects');
    expect([401, 403]).toContain(res.status);
  });

  test('IT-AUTH-08 แก้ไขชื่อในโปรไฟล์ได้', async () => {
    const token = await login(email, 'secret123');
    const res = await api(token).put('/api/auth/profile', { full_name: 'Jest User Renamed', email });
    expect(res.status).toBe(200);
  });

  test('IT-AUTH-09 เปลี่ยนรหัสผ่าน: รหัสเดิมผิดไม่ได้ (401) รหัสเดิมถูกเปลี่ยนได้และล็อกอินด้วยรหัสใหม่ได้', async () => {
    const token = await login(email, 'secret123');
    const wrong = await api(token).put('/api/auth/password', { current_password: 'nope', new_password: 'newpass123' });
    expect(wrong.status).toBe(401);
    const ok = await api(token).put('/api/auth/password', { current_password: 'secret123', new_password: 'newpass123' });
    expect(ok.status).toBe(200);
    await expect(login(email, 'newpass123')).resolves.toEqual(expect.any(String));
  });
});
