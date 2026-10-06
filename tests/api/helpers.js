// ตัวช่วยของ integration test: app, login, เรียก API พร้อม token, ปิด connection pool
const request = require('supertest');
const app = require('../../server');
const pool = require('../../config/db.config');

const PASSWORD = 'Passw0rd!';

// บัญชีจาก db/seed.js
const USERS = {
  owner: 'nichakan@example.com',
  other: 'araya@example.com',
  admin: 'admin@example.com',
  viewer: 'viewer@example.com',
};

async function login(email, password = PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

// api(token).get('/api/...') — ใส่ Authorization ให้อัตโนมัติ
function api(token) {
  const withAuth = (req) => (token ? req.set('Authorization', `Bearer ${token}`) : req);
  return {
    get: (url) => withAuth(request(app).get(url)),
    post: (url, body) => withAuth(request(app).post(url)).send(body ?? {}),
    put: (url, body) => withAuth(request(app).put(url)).send(body ?? {}),
    patch: (url, body) => withAuth(request(app).patch(url)).send(body ?? {}),
    delete: (url) => withAuth(request(app).delete(url)),
  };
}

// สร้างโครงการทดสอบ (ประเภทผสมผสาน 6 เดือน) แล้วคืน id
async function createProject(token, overrides = {}) {
  const res = await api(token).post('/api/projects', {
    project_name: 'Jest test project',
    project_type_id: 3,
    duration_months: 6,
    initial_budget: 100000,
    target_roi_percent: 20,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`create project failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.project_id;
}

async function closeDb() {
  await pool.end();
}

module.exports = { app, request, login, api, createProject, closeDb, USERS, PASSWORD };
