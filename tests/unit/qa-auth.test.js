// tests/qa-auth.test.js — QA: middleware ต้องใช้ role/สถานะบัญชีล่าสุดจาก database ไม่ใช่ค่าใน token
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createAuthMiddleware } = require('../../middleware/auth.middleware');
const { isValidEmail } = require('../../controllers/auth.controller');

const SECRET = 'test-secret';
const users = new Map();
const mw = createAuthMiddleware({ loadUser: async (id) => users.get(id) || null, secret: () => SECRET });

function run(middleware, token) {
  return new Promise((resolve) => {
    const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body, req }); },
    };
    middleware(req, res, () => resolve({ status: 'next', req }));
  });
}
const tokenFor = (userId, role) => jwt.sign({ userId, email: 'x@y.z', role }, SECRET, { expiresIn: '1h' });

test('ไม่มี token → 401, token ปลอม → 403', async () => {
  assert.equal((await run(mw.verifyToken)).status, 401);
  assert.equal((await run(mw.verifyToken, 'abc.def.ghi')).status, 403);
});

test('ใช้ role ล่าสุดจาก database: ถูกลดเป็น viewer แล้ว token เดิมเขียนข้อมูลไม่ได้', async () => {
  users.set(1, { user_id: 1, email: 'a@b.c', role: 'viewer', is_active: 1 });
  const t = tokenFor(1, 'project_owner'); // token ออกตอนยังเป็น project_owner
  assert.equal((await run(mw.verifyProjectWriter, t)).status, 403);
  const r = await run(mw.verifyToken, t);
  assert.equal(r.status, 'next');
  assert.equal(r.req.user.role, 'viewer');
});

test('บัญชีที่ถูกปิดใช้งาน (soft delete) ใช้ token เดิมไม่ได้', async () => {
  users.set(2, { user_id: 2, email: 'b@b.c', role: 'project_owner', is_active: 0 });
  assert.equal((await run(mw.verifyToken, tokenFor(2, 'project_owner'))).status, 403);
});

test('บัญชีที่ถูกลบไปแล้วใช้ token เดิมไม่ได้', async () => {
  assert.equal((await run(mw.verifyToken, tokenFor(999, 'admin'))).status, 401);
});

test('admin ผ่าน verifyAdmin, project_owner ไม่ผ่าน', async () => {
  users.set(3, { user_id: 3, email: 'c@b.c', role: 'admin', is_active: 1 });
  users.set(4, { user_id: 4, email: 'd@b.c', role: 'project_owner', is_active: 1 });
  assert.equal((await run(mw.verifyAdmin, tokenFor(3, 'admin'))).status, 'next');
  assert.equal((await run(mw.verifyAdmin, tokenFor(4, 'admin'))).status, 403); // แก้ role ใน token ไม่ได้ผล
  assert.equal((await run(mw.verifyProjectWriter, tokenFor(4, 'project_owner'))).status, 'next');
});

test('ตรวจรูปแบบอีเมลตอนสมัคร/แก้โปรไฟล์', () => {
  assert.equal(isValidEmail('user@example.com'), true);
  for (const bad of ['not-an-email', 'a@b', 'a b@c.com', '', null, `${'a'.repeat(250)}@x.com`]) {
    assert.equal(isValidEmail(bad), false, String(bad));
  }
});
