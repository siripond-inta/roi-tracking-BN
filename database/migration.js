const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '12345',
      database: process.env.DB_NAME || 'roi_tracking_db'
    });

    console.log('Connecting to database...');

    // 1. users: Add company_name
    const [userCols] = await conn.query("SHOW COLUMNS FROM users LIKE 'company_name'");
    if (userCols.length === 0) {
      await conn.query("ALTER TABLE users ADD COLUMN company_name VARCHAR(255) NULL AFTER full_name");
      console.log('✅ Added company_name to users table');
    } else {
      console.log('ℹ️ company_name already exists in users');
    }

    // 2. projects: Add is_public and custom_project_type
    const [projCols1] = await conn.query("SHOW COLUMNS FROM projects LIKE 'is_public'");
    if (projCols1.length === 0) {
      await conn.query("ALTER TABLE projects ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0 AFTER initial_budget");
      console.log('✅ Added is_public to projects table');
    } else {
      console.log('ℹ️ is_public already exists in projects');
    }

    const [projCols2] = await conn.query("SHOW COLUMNS FROM projects LIKE 'custom_project_type'");
    if (projCols2.length === 0) {
      await conn.query("ALTER TABLE projects ADD COLUMN custom_project_type VARCHAR(255) NULL AFTER is_public");
      console.log('✅ Added custom_project_type to projects table');
    } else {
      console.log('ℹ️ custom_project_type already exists in projects');
    }

    // 3. project_types: Seed 1, 2, 3, 4
    await conn.query(`
      INSERT INTO project_types (type_id, type_name, description)
      VALUES 
        (1, 'โปรเจกต์รายได้', 'โครงการเพื่อการสร้างหรือเพิ่มรายได้'),
        (2, 'โปรเจกต์ลดต้นทุน', 'โครงการเพื่อการลดค่าใช้จ่ายหรือเพิ่มประสิทธิภาพ'),
        (3, 'โปรเจกต์ตามข้อบังคับ', 'โครงการตามกฎหมายหรือข้อบังคับขององค์กร'),
        (4, 'อื่นๆ', 'โครงการประเภทอื่นๆ ที่ระบุเพิ่มเติม')
      ON DUPLICATE KEY UPDATE 
        type_name = VALUES(type_name),
        description = VALUES(description)
    `);
    console.log('✅ Seeded project_types (1, 2, 3, 4)');

    // 4. categories: Update or seed Thai categories
    await conn.query(`
      INSERT INTO categories (category_id, category_name, type_id)
      VALUES 
        ('REV001', 'การสร้างรายรับ', 2),
        ('REV002', 'การประหยัดต้นทุน', 2),
        ('CAT001', 'ต้นทุนดำเนินการ', 1),
        ('CAT002', 'ต้นทุนพัฒนา', 1),
        ('CAT003', 'ต้นทุนทั่วไป', 1)
      ON DUPLICATE KEY UPDATE 
        category_name = VALUES(category_name),
        type_id = VALUES(type_id)
    `);
    console.log('✅ Seeded categories with Thai names');

    console.log('\n--- VERIFICATION OF SCHEMA ---');
    const [uCols] = await conn.query('DESCRIBE users');
    console.log('Users columns:', uCols.map(c => c.Field));

    const [pCols] = await conn.query('DESCRIBE projects');
    console.log('Projects columns:', pCols.map(c => c.Field));

    const [pTypes] = await conn.query('SELECT * FROM project_types');
    console.log('Project types in DB:', pTypes);

    const [cats] = await conn.query('SELECT * FROM categories');
    console.log('Categories in DB:', cats);

    console.log('\n🎉 ALL DATABASE UPDATES COMPLETED SUCCESSFULLY!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    if (conn) await conn.end();
  }
}

migrate();
