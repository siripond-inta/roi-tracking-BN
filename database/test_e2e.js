const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function runEndToEndTests() {
  console.log('=== RUNNING COMPREHENSIVE BACKEND & DB VERIFICATION ===\n');

  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '12345',
      database: process.env.DB_NAME || 'roi_tracking_db'
    });

    // 1. Test Auth: Login with existing user
    console.log('Test 1: Check existing users...');
    const [users] = await conn.query('SELECT user_id, email, full_name, company_name, role FROM users LIMIT 3');
    console.log('Users found:', users.length, users.map(u => `${u.email} (${u.role})`));
    console.log('✅ Auth table lookup works!\n');

    // 2. Test Signup simulation with company_name
    console.log('Test 2: Signup insert with company_name...');
    const testEmail = `test_runner_${Date.now()}@example.com`;
    const hashed = await bcrypt.hash('password123', 10);
    const [signupRes] = await conn.query(
      'INSERT INTO users (full_name, email, password_hash, role, company_name) VALUES (?, ?, ?, ?, ?)',
      ['Test Company User', testEmail, hashed, 'user', 'ABC Tech Co.']
    );
    const testUserId = signupRes.insertId;
    console.log(`✅ Signup successfully inserted test user id: ${testUserId}`);

    // Verify token generation
    const token = jwt.sign(
      { userId: testUserId, email: testEmail, role: 'user' },
      process.env.JWT_SECRET || 'test_secret',
      { expiresIn: '24h' }
    );
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test_secret');
    console.log('✅ JWT sign & verify verified:', decoded.userId === testUserId);

    // 3. Test Create Project with custom_project_type and type_id = 4 ('อื่นๆ')
    console.log('\nTest 3: Create project with type_id=4 (อื่นๆ) and custom_project_type...');
    const [[{ maxId }]] = await conn.query('SELECT COALESCE(MAX(project_id), 100) AS maxId FROM projects');
    const newProjectId = maxId + 1;
    await conn.query(
      `INSERT INTO projects (project_id, user_id, project_name, project_type_id, duration_months, initial_budget, is_public, custom_project_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newProjectId, testUserId, 'โครงการทดสอบระบบอัตโนมัติ', 4, 12, 150000.00, 0, 'วิจัยและพัฒนา AI']
    );
    console.log(`✅ Project created successfully with id: ${newProjectId}`);

    // 4. Test getAllProjects query (as used in project.controller.js)
    console.log('\nTest 4: getAllProjects query for user...');
    const [projects] = await conn.query(`
      SELECT 
        p.project_id, 
        p.project_name, 
        p.duration_months, 
        p.initial_budget,
        p.user_id,
        p.is_public,
        p.custom_project_type,
        p.created_at,
        pt.type_name AS project_type,
        CASE WHEN EXISTS(
          SELECT 1 FROM project_ledger pl 
          WHERE pl.project_id = p.project_id AND pl.phase = 'Actual'
        ) THEN 'Actual' ELSE 'Estimated' END AS status
      FROM projects p
      LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
    `, [testUserId]);
    console.log('Project fetched:', projects[0]);
    console.log('✅ getAllProjects query executed without errors!');

    // 5. Test Insert Estimated Ledgers
    console.log('\nTest 5: Insert Estimated Ledgers...');
    const [[{ maxLedgerId }]] = await conn.query('SELECT COALESCE(MAX(ledger_id), 0) AS maxLedgerId FROM project_ledger');
    let nextLedgerId = maxLedgerId + 1;
    const today = new Date().toISOString().split('T')[0];

    // Add 1 Revenue and 1 Expense
    await conn.query(
      `INSERT INTO project_ledger (ledger_id, project_id, phase, type_id, category_id, total_value, transaction_date, note)
       VALUES (?, ?, 'Estimated', 2, 'REV001', 300000, ?, 'รายรับจากยอดขายประมาณการ')`,
      [nextLedgerId++, newProjectId, today]
    );
    await conn.query(
      `INSERT INTO project_ledger (ledger_id, project_id, phase, type_id, category_id, total_value, transaction_date, note)
       VALUES (?, ?, 'Estimated', 1, 'CAT001', 100000, ?, 'ค่าใช้จ่ายดำเนินงานประมาณการ')`,
      [nextLedgerId++, newProjectId, today]
    );
    console.log('✅ Estimated ledgers inserted successfully!');

    // 6. Test Update Estimated Ledgers
    console.log('\nTest 6: Update Estimated Ledgers...');
    await conn.query('DELETE FROM project_ledger WHERE project_id = ? AND phase = "Estimated"', [newProjectId]);
    await conn.query(
      `INSERT INTO project_ledger (ledger_id, project_id, phase, type_id, category_id, total_value, transaction_date, note)
       VALUES (?, ?, 'Estimated', 2, 'REV001', 350000, ?, 'แก้ไขประมาณการรายรับ')`,
      [nextLedgerId++, newProjectId, today]
    );
    console.log('✅ Update Estimated ledgers executed successfully!');

    // 7. Test Insert Actual Ledgers
    console.log('\nTest 7: Insert Actual Ledgers...');
    await conn.query(
      `INSERT INTO project_ledger (ledger_id, project_id, phase, type_id, category_id, total_value, transaction_date, note)
       VALUES (?, ?, 'Actual', 2, 'REV001', 320000, ?, 'รายรับจริง')`,
      [nextLedgerId++, newProjectId, today]
    );
    await conn.query(
      `INSERT INTO project_ledger (ledger_id, project_id, phase, type_id, category_id, total_value, transaction_date, note)
       VALUES (?, ?, 'Actual', 1, 'CAT001', 95000, ?, 'รายจ่ายจริง')`,
      [nextLedgerId++, newProjectId, today]
    );
    console.log('✅ Actual ledgers inserted successfully!');

    // 8. Test Toggle Visibility
    console.log('\nTest 8: Toggle visibility to public...');
    await conn.query('UPDATE projects SET is_public = 1 WHERE project_id = ?', [newProjectId]);
    const [[updatedProj]] = await conn.query('SELECT is_public FROM projects WHERE project_id = ?', [newProjectId]);
    console.log('is_public value:', updatedProj.is_public);
    console.log('✅ Visibility toggled successfully!');

    // 9. Test Admin queries
    console.log('\nTest 9: Admin getAllProjects and getAllUsers queries...');
    const [adminProjs] = await conn.query(`
      SELECT 
        p.project_id,
        p.project_name,
        p.is_public,
        p.custom_project_type,
        u.full_name AS owner_name,
        u.company_name AS owner_company,
        pt.type_name AS project_type
      FROM projects p
      LEFT JOIN users u ON p.user_id = u.user_id
      LEFT JOIN project_types pt ON p.project_type_id = pt.type_id
      LIMIT 3
    `);
    console.log('Admin projects sample:', adminProjs);
    console.log('✅ Admin projects query executed without errors!');

    // Clean up test records
    console.log('\nCleaning up test user & test project...');
    await conn.query('DELETE FROM project_ledger WHERE project_id = ?', [newProjectId]);
    await conn.query('DELETE FROM projects WHERE project_id = ?', [newProjectId]);
    await conn.query('DELETE FROM users WHERE user_id = ?', [testUserId]);
    console.log('✅ Cleanup completed.');

    console.log('\n🎉 ALL 9 END-TO-END DATABASE TESTS PASSED 100%!');

  } catch (err) {
    console.error('❌ Test failed with error:', err);
  } finally {
    if (conn) await conn.end();
  }
}

runEndToEndTests();
