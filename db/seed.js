// db/seed.js
// Resets and fills every table with mock data for local/dev use.
//
// WARNING: this DELETES all existing rows in these tables before inserting fresh mock data.
// Safe to re-run any time you want a clean, predictable dataset — but don't run it against a
// database that has real data you want to keep.
//
// Usage:
//   npm run db:seed                          (local, uses .env)
//   docker compose run --rm seed             (against the dockerized mysql)

const bcrypt = require('bcryptjs');
const { db, pool } = require('./index');
const {
  users,
  projectTypes,
  entryTypes,
  categories,
  projects,
  projectAccess,
  projectLedger,
  systemSettings,
} = require('./schema');

const DEMO_PASSWORD = 'Passw0rd!';

async function resetTables() {
  await db.delete(projectLedger);
  await db.delete(projectAccess);
  await db.delete(projects);
  await db.delete(categories);
  await db.delete(users);
  await db.delete(projectTypes);
  await db.delete(entryTypes);
  await db.delete(systemSettings);
}

// หมายเหตุ: 1 = รายจ่าย, 2 = รายรับ — ต้องตรงกับที่ frontend hardcode ไว้ (เช่น
// estimated-form2.ts, actual-form2.ts: "type_id: 1 = Expense, 2 = Revenue") ห้ามสลับ
async function seedEntryTypes() {
  await db.insert(entryTypes).values([
    { typeId: 1, typeName: 'รายจ่าย', isInflow: false, description: 'รายการที่เป็นต้นทุน/ค่าใช้จ่ายของโครงการ' },
    { typeId: 2, typeName: 'รายรับ', isInflow: true, description: 'รายการที่เป็นรายรับ/ผลประโยชน์ของโครงการ' },
  ]);
}

async function seedProjectTypes() {
  await db.insert(projectTypes).values([
    { typeId: 1, typeName: 'โครงการเพิ่มรายได้', description: 'โครงการที่มุ่งสร้างหรือเพิ่มรายได้', calculationMethod: 'REVENUE' },
    { typeId: 2, typeName: 'โครงการลดต้นทุน', description: 'โครงการที่มุ่งลดค่าใช้จ่ายหรือเพิ่มประสิทธิภาพ', calculationMethod: 'COST_SAVING' },
    { typeId: 3, typeName: 'โครงการผสม', description: 'โครงการที่ทั้งเพิ่มรายได้และลดต้นทุน', calculationMethod: 'MIXED' },
    { typeId: 4, typeName: 'อื่นๆ', description: 'โครงการประเภทอื่นๆ ที่ระบุเพิ่มเติม', calculationMethod: null },
  ]);
}

// ใช้ category_id ชุดเดียวกับที่ frontend hardcode ไว้ในฟอร์ม (REV001/CAT001/CAT002 ใน
// estimated-form2.html, actual-form2.html) — ถ้าเปลี่ยน id จะ insert ledger ไม่ได้ (FK ไม่พบ)
async function seedCategories() {
  await db.insert(categories).values([
    { categoryId: 'REV001', categoryName: 'การสร้างรายรับ', typeId: 2, categoryGroup: 'BEN' },
    { categoryId: 'REV002', categoryName: 'การประหยัดต้นทุน', typeId: 2, categoryGroup: 'BEN' },
    { categoryId: 'CAT001', categoryName: 'ต้นทุนดำเนินการ', typeId: 1, categoryGroup: 'OPC' },
    { categoryId: 'CAT002', categoryName: 'ต้นทุนพัฒนา', typeId: 1, categoryGroup: 'INV' },
    { categoryId: 'CAT003', categoryName: 'ต้นทุนทั่วไป', typeId: 1, categoryGroup: 'ADC' },
  ]);
}

async function seedSystemSettings() {
  await db.insert(systemSettings).values([
    { settingKey: 'default_discount_rate', settingValue: '10', description: 'อัตราคิดลดเริ่มต้นสำหรับคำนวณ NPV (%)' },
    { settingKey: 'default_currency', settingValue: 'THB', description: 'สกุลเงินเริ่มต้นของระบบ' },
    { settingKey: 'fiscal_year_start_month', settingValue: '1', description: 'เดือนเริ่มต้นปีงบประมาณ (1-12)' },
    { settingKey: 'app_version', settingValue: '1.2.0', description: 'เวอร์ชันสคีมาปัจจุบัน (อ้างอิง DBML v1.2)' },
  ]);
}

function yearsAgo(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d;
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const demoUsers = [
    // Somchai's last login is 4 years ago on purpose, to demo the admin "soft delete
    // accounts inactive > 3 years" feature against a real dormant candidate.
    { email: 'nichakan@example.com', fullName: 'Nichakan Boonmee', role: 'project_owner', lastLoginAt: new Date() },
    { email: 'somchai@example.com', fullName: 'Somchai Suksan', role: 'project_owner', lastLoginAt: yearsAgo(4) },
    { email: 'araya@example.com', fullName: 'Araya Chaiyaporn', role: 'project_owner', lastLoginAt: new Date() },
    { email: 'admin@example.com', fullName: 'Admin User', role: 'admin', lastLoginAt: new Date() },
  ];

  const created = [];
  for (const u of demoUsers) {
    const [result] = await db.insert(users).values({
      email: u.email,
      passwordHash,
      fullName: u.fullName,
      role: u.role,
      isActive: true,
      lastLoginAt: u.lastLoginAt,
    });
    created.push({ userId: result.insertId, ...u });
  }
  return created;
}

// 3 projects per user: [public+completed, public+in_progress, private+planning]
// กติกา: โปรเจกต์ status 'planning' ยังไม่มีข้อมูล Actual (status='Estimated') จึงเปิดสาธารณะไม่ได้
// เลยตั้งเป็น private เท่านั้น — public มีได้แค่ completed/in_progress ที่มี Actual แล้ว
const PROJECT_TEMPLATES = [
  [
    { name: 'ระบบขายสินค้าออนไลน์', typeId: 1, status: 'completed', isPublic: true },
    { name: 'โครงการลดต้นทุนคลังสินค้า', typeId: 2, status: 'in_progress', isPublic: true },
    { name: 'ระบบ CRM บริหารลูกค้าสัมพันธ์', typeId: 3, status: 'planning', isPublic: false },
  ],
  [
    { name: 'แอปพลิเคชันสั่งอาหารเดลิเวอรี่', typeId: 1, status: 'completed', isPublic: true },
    { name: 'โครงการลดต้นทุนพลังงานโรงงาน', typeId: 2, status: 'in_progress', isPublic: true },
    { name: 'ระบบบริหารจัดการพนักงาน (HRIS)', typeId: 3, status: 'planning', isPublic: false },
  ],
  [
    { name: 'แพลตฟอร์มขายคอร์สออนไลน์', typeId: 1, status: 'completed', isPublic: true },
    { name: 'โครงการลดของเสียในสายการผลิต', typeId: 2, status: 'in_progress', isPublic: true },
    { name: 'ระบบวิเคราะห์ข้อมูลลูกค้า (Data Analytics)', typeId: 3, status: 'planning', isPublic: false },
  ],
];

async function seedProjects(createdUsers) {
  const createdProjects = [];

  for (let u = 0; u < createdUsers.length; u++) {
    const owner = createdUsers[u];
    for (const tpl of PROJECT_TEMPLATES[u]) {
      const [result] = await db.insert(projects).values({
        userId: owner.userId,
        projectName: tpl.name,
        projectTypeId: tpl.typeId,
        durationMonths: 12,
        initialBudget: '500000.00',
        targetRoiPercent: '20.00',
        discountRate: '10.00',
        status: tpl.status,
      });
      createdProjects.push({ projectId: result.insertId, owner, ...tpl });
    }
  }
  return createdProjects;
}

async function seedProjectAccess(createdProjects, createdUsers) {
  const rows = [];

  for (const project of createdProjects) {
    // The owner always has an explicit 'owner' entry in the access list.
    rows.push({
      projectId: project.projectId,
      userId: project.owner.userId,
      permissionLevel: 'owner',
      sharedBy: null,
    });

    // Public projects are shared as read-only to every other user; private projects are not shared.
    if (project.isPublic) {
      for (const other of createdUsers) {
        if (other.userId === project.owner.userId) continue;
        rows.push({
          projectId: project.projectId,
          userId: other.userId,
          permissionLevel: 'viewer',
          sharedBy: project.owner.userId,
        });
      }
    }
  }

  await db.insert(projectAccess).values(rows);
}

async function seedProjectLedger(createdProjects) {
  const rows = [];

  for (const project of createdProjects) {
    const hasActual = project.status === 'in_progress' || project.status === 'completed';

    const estimated = [
      { categoryId: 'REV001', typeId: 2, amount: '650000.00' },
      { categoryId: 'CAT002', typeId: 1, amount: '200000.00' },
      { categoryId: 'CAT001', typeId: 1, amount: '150000.00' },
    ];
    for (const line of estimated) {
      rows.push({
        projectId: project.projectId,
        phase: 'ESTIMATED',
        periodIndex: 1,
        typeId: line.typeId,
        categoryId: line.categoryId,
        amountBase: line.amount,
        totalValue: line.amount,
        transactionDate: '2026-01-15',
        note: 'ประมาณการเริ่มต้นของโครงการ',
        createdBy: project.owner.userId,
      });
    }

    if (hasActual) {
      const actual = [
        { categoryId: 'REV001', typeId: 2, amount: '612000.00' },
        { categoryId: 'CAT002', typeId: 1, amount: '215000.00' },
        { categoryId: 'CAT003', typeId: 1, amount: '48000.00' },
      ];
      for (const line of actual) {
        rows.push({
          projectId: project.projectId,
          phase: 'ACTUAL',
          periodIndex: 1,
          typeId: line.typeId,
          categoryId: line.categoryId,
          amountBase: line.amount,
          totalValue: line.amount,
          transactionDate: '2026-04-30',
          note: 'ผลดำเนินงานจริงงวดที่ 1',
          createdBy: project.owner.userId,
        });
      }
    }
  }

  await db.insert(projectLedger).values(rows);
}

async function main() {
  console.log('Resetting tables...');
  await resetTables();

  console.log('Seeding master data (entry_types, project_types, categories, system_settings)...');
  await seedEntryTypes();
  await seedProjectTypes();
  await seedCategories();
  await seedSystemSettings();

  console.log('Seeding users...');
  const createdUsers = await seedUsers();
  // PROJECT_TEMPLATES only has entries for the 3 project_owner demo users — the admin user
  // doesn't own projects or need project_access rows.
  const projectOwners = createdUsers.filter(u => u.role === 'project_owner');

  console.log('Seeding projects...');
  const createdProjects = await seedProjects(projectOwners);

  console.log('Seeding project_access...');
  await seedProjectAccess(createdProjects, projectOwners);

  console.log('Seeding project_ledger...');
  await seedProjectLedger(createdProjects);

  console.log(`\nDone. ${createdUsers.length} users (${projectOwners.length} project owners + 1 admin), ${createdProjects.length} projects.`);
  console.log(`Demo login password for every seeded user: ${DEMO_PASSWORD}`);
  createdUsers.forEach((u) => console.log(`  - ${u.email}`));
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
