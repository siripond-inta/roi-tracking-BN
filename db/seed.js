// db/seed.js
// ล้างแล้วเติมข้อมูลตัวอย่างทุกตาราง สำหรับ dev/เดโม
//
// คำเตือน: สคริปต์นี้ลบข้อมูลเดิมทั้งหมดก่อน — อย่ารันกับฐานข้อมูลที่มีข้อมูลจริงที่ต้องเก็บไว้
//
// Usage:
//   npm run db:seed                          (local, ใช้ .env)
//   docker compose run --rm seed             (กับ mysql ใน docker)
//
// ข้อมูลตัวอย่างออกแบบให้เดโมได้ครบทุกกรณี: 3 ประเภทโครงการ (มุ่งรายได้ / มุ่งลดต้นทุน / ผสม)
// × 3 สถานะ (วางแผน / กำลังดำเนินการ / สิ้นสุดแล้ว) และมีทั้งโครงการที่คุ้มค่าและไม่คุ้มค่า

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
const { periodDate } = require('../services/ledger-input');

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

// 1 = รายจ่าย, 2 = รายรับ
async function seedEntryTypes() {
  await db.insert(entryTypes).values([
    { typeId: 1, typeName: 'รายจ่าย', isInflow: false, description: 'ต้นทุน/ค่าใช้จ่ายของโครงการ' },
    { typeId: 2, typeName: 'รายรับ', isInflow: true, description: 'รายได้หรือผลประโยชน์ของโครงการ' },
  ]);
}

// ประเภทโครงการกำหนดตรรกะการคำนวณ (services/finance.js):
//   REVENUE นับรายได้โดยตรง · COST_SAVING นับประโยชน์ทางอ้อม · MIXED นับทั้งสองอย่าง
const TYPE = { REVENUE: 1, COST_SAVING: 2, MIXED: 3 };

async function seedProjectTypes() {
  await db.insert(projectTypes).values([
    {
      typeId: TYPE.REVENUE,
      typeName: 'โครงการมุ่งสร้างรายได้',
      description: 'คิดผลตอบแทนจากรายได้โดยตรง เช่น ยอดขายหรือค่าบริการที่เพิ่มขึ้น',
      calculationMethod: 'REVENUE',
    },
    {
      typeId: TYPE.COST_SAVING,
      typeName: 'โครงการมุ่งลดต้นทุน',
      description: 'คิดผลตอบแทนจากประโยชน์ทางอ้อม เช่น เวลาทำงานหรือค่าเอกสารที่ลดลง',
      calculationMethod: 'COST_SAVING',
    },
    {
      typeId: TYPE.MIXED,
      typeName: 'โครงการแบบผสมผสาน',
      description: 'คิดผลตอบแทนทั้งจากรายได้โดยตรงและประโยชน์ทางอ้อม',
      calculationMethod: 'MIXED',
    },
  ]);
}

// รหัสหมวดหมู่ใช้กลุ่มเป็น prefix (ตรงกับที่ category.controller.js สร้างรหัสใหม่ให้อัตโนมัติ)
// BEN001–BEN004 คือประโยชน์ทางอ้อม 4 หมวดหลักตาม Proposal ข้อ 6.5 / 7.1 — ตีมูลค่าจาก
// "ปริมาณที่ลดได้ต่อเดือน × อัตราต่อหน่วย" โดยแต่ละองค์กรใส่อัตราของตัวเองได้
async function seedCategories() {
  await db.insert(categories).values([
    { categoryId: 'REV001', categoryName: 'รายได้จากการขายสินค้า/บริการ', typeId: 2, categoryGroup: 'REV' },
    { categoryId: 'REV002', categoryName: 'รายได้ค่าสมาชิก/ค่าบริการรายเดือน', typeId: 2, categoryGroup: 'REV' },
    {
      categoryId: 'BEN001', categoryName: 'การลดเวลาทำงานของบุคลากร', typeId: 2, categoryGroup: 'BEN',
      unitLabel: 'ชั่วโมงที่ลดได้ต่อเดือน (ชม.)', rateLabel: 'อัตราค่าจ้างต่อชั่วโมง (บาท)',
    },
    {
      categoryId: 'BEN002', categoryName: 'การลดค่าใช้จ่ายด้านเอกสาร', typeId: 2, categoryGroup: 'BEN',
      unitLabel: 'จำนวนชุด/แผ่นที่ลดได้ต่อเดือน', rateLabel: 'ต้นทุนเฉลี่ยต่อหน่วย (บาท)',
    },
    {
      categoryId: 'BEN003', categoryName: 'การลดค่าใช้จ่ายในการวิเคราะห์โครงการ', typeId: 2, categoryGroup: 'BEN',
      unitLabel: 'ชั่วโมงวิเคราะห์ที่ลดได้ต่อเดือน (ชม.)', rateLabel: 'อัตราค่าตอบแทนต่อชั่วโมง (บาท)',
    },
    {
      categoryId: 'BEN004', categoryName: 'การลดต้นทุนจากความผิดพลาด', typeId: 2, categoryGroup: 'BEN',
      unitLabel: 'จำนวนครั้งที่ลดความผิดพลาดได้ต่อเดือน', rateLabel: 'ต้นทุนการแก้ไขต่อครั้ง (บาท)',
    },
    { categoryId: 'INV001', categoryName: 'ค่าพัฒนาระบบ/ซอฟต์แวร์', typeId: 1, categoryGroup: 'INV' },
    { categoryId: 'INV002', categoryName: 'ค่าฮาร์ดแวร์และอุปกรณ์', typeId: 1, categoryGroup: 'INV' },
    { categoryId: 'OPC001', categoryName: 'ค่าบำรุงรักษาระบบ', typeId: 1, categoryGroup: 'OPC' },
    { categoryId: 'OPC002', categoryName: 'ค่าบุคลากรดำเนินงาน', typeId: 1, categoryGroup: 'OPC' },
    { categoryId: 'ADC001', categoryName: 'ค่าบริหารจัดการโครงการ', typeId: 1, categoryGroup: 'ADC' },
    { categoryId: 'ADC002', categoryName: 'ค่าฝึกอบรมผู้ใช้งาน', typeId: 1, categoryGroup: 'ADC' },
    // หมวด "อื่นๆ" ของแต่ละกลุ่ม — ผู้ใช้พิมพ์ชื่อรายการเอง (เหมือน migration 0004)
    { categoryId: 'REVOTH', categoryName: 'รายได้อื่นๆ (ระบุเอง)', typeId: 2, categoryGroup: 'REV', allowCustomName: true },
    {
      categoryId: 'BENOTH', categoryName: 'ผลประโยชน์ทางอ้อมอื่นๆ (ระบุเอง)', typeId: 2, categoryGroup: 'BEN',
      unitLabel: 'ปริมาณที่ลดได้ต่อเดือน', rateLabel: 'มูลค่าต่อหน่วย (บาท)', allowCustomName: true,
    },
    { categoryId: 'INVOTH', categoryName: 'เงินลงทุนอื่นๆ (ระบุเอง)', typeId: 1, categoryGroup: 'INV', allowCustomName: true },
    { categoryId: 'OPCOTH', categoryName: 'ต้นทุนดำเนินงานอื่นๆ (ระบุเอง)', typeId: 1, categoryGroup: 'OPC', allowCustomName: true },
    { categoryId: 'ADCOTH', categoryName: 'ค่าใช้จ่ายบริหารอื่นๆ (ระบุเอง)', typeId: 1, categoryGroup: 'ADC', allowCustomName: true },
  ]);
}

async function seedSystemSettings() {
  await db.insert(systemSettings).values([
    { settingKey: 'default_currency', settingValue: 'THB', description: 'สกุลเงินเริ่มต้นของระบบ' },
    { settingKey: 'fiscal_year_start_month', settingValue: '1', description: 'เดือนเริ่มต้นปีงบประมาณ (1-12)' },
    { settingKey: 'app_version', settingValue: '1.3.0', description: 'เวอร์ชันสคีมาปัจจุบัน' },
  ]);
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const demoUsers = [
    { email: 'nichakan@example.com', fullName: 'Nichakan Boonmee', role: 'project_owner', lastLoginAt: new Date() },
    // login ล่าสุด 4 ปีก่อน — ใช้เดโมฟีเจอร์ admin ปิดบัญชีที่ไม่ใช้งานเกิน 3 ปี
    { email: 'somchai@example.com', fullName: 'Somchai Suksan', role: 'project_owner', lastLoginAt: monthsAgo(48) },
    { email: 'araya@example.com', fullName: 'Araya Chaiyaporn', role: 'project_owner', lastLoginAt: new Date() },
    { email: 'admin@example.com', fullName: 'Admin User', role: 'admin', lastLoginAt: new Date() },
    // บัญชีระดับ viewer — ดูโครงการสาธารณะได้ แต่สร้าง/แก้ไข/ลบไม่ได้
    { email: 'viewer@example.com', fullName: 'Viewer Demo', role: 'viewer', lastLoginAt: new Date() },
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

// ── แผนงาน (ESTIMATED) ของโครงการแต่ละประเภท — ระยะเวลา 12 เดือน ─────────────
// แต่ละรายการ: { cat, from, to, amount } หรือ { cat, from, to, qty, rate } สำหรับประโยชน์ทางอ้อม
const PLANS = {
  [TYPE.REVENUE]: {
    budget: 450000,
    target: 40,
    items: [
      { cat: 'INV001', from: 1, to: 1, amount: 280000, note: 'พัฒนาระบบหน้าร้านออนไลน์' },
      { cat: 'INV002', from: 1, to: 1, amount: 120000, note: 'เซิร์ฟเวอร์และอุปกรณ์' },
      { cat: 'OPC001', from: 1, to: 12, amount: 12000, note: 'ค่าบำรุงรักษารายเดือน' },
      { cat: 'OPC002', from: 1, to: 12, amount: 25000, note: 'เจ้าหน้าที่ดูแลระบบ' },
      { cat: 'ADC001', from: 1, to: 12, amount: 6000, note: 'ค่าบริหารโครงการ' },
      { cat: 'REV001', from: 2, to: 12, amount: 115000, note: 'ยอดขายออนไลน์ที่เพิ่มขึ้น' },
      { cat: 'REV002', from: 4, to: 12, amount: 18000, note: 'ค่าสมาชิกรายเดือน' },
      { cat: 'OPCOTH', customName: 'ค่าโฆษณาออนไลน์', from: 2, to: 12, amount: 8000, note: 'Facebook / Google Ads' },
    ],
  },
  [TYPE.COST_SAVING]: {
    budget: 300000,
    target: 60,
    items: [
      { cat: 'INV001', from: 1, to: 1, amount: 200000, note: 'พัฒนาระบบอัตโนมัติ' },
      { cat: 'INV002', from: 1, to: 1, amount: 45000, note: 'เครื่องสแกนและอุปกรณ์' },
      { cat: 'ADC002', from: 1, to: 1, amount: 20000, note: 'อบรมพนักงาน' },
      { cat: 'OPC001', from: 1, to: 12, amount: 9000, note: 'ค่าบำรุงรักษารายเดือน' },
      { cat: 'BEN001', from: 2, to: 12, qty: 100, rate: 320, note: 'ลดงานคีย์ข้อมูลซ้ำซ้อน' },
      { cat: 'BEN002', from: 2, to: 12, qty: 900, rate: 15, note: 'เลิกพิมพ์ใบงานกระดาษ' },
      { cat: 'BEN003', from: 3, to: 12, qty: 20, rate: 650, note: 'รายงานสรุปอัตโนมัติ' },
      { cat: 'BEN004', from: 3, to: 12, qty: 8, rate: 2000, note: 'ลดการส่งสินค้าผิด' },
    ],
  },
  [TYPE.MIXED]: {
    budget: 380000,
    target: 30,
    items: [
      { cat: 'INV001', from: 1, to: 1, amount: 250000, note: 'พัฒนาแพลตฟอร์ม' },
      { cat: 'INV002', from: 1, to: 1, amount: 60000, note: 'อุปกรณ์และลิขสิทธิ์' },
      { cat: 'ADC002', from: 1, to: 1, amount: 15000, note: 'อบรมผู้ใช้งาน' },
      { cat: 'OPC001', from: 1, to: 12, amount: 10000, note: 'ค่าบำรุงรักษารายเดือน' },
      { cat: 'OPC002', from: 1, to: 12, amount: 18000, note: 'ทีมดูแลลูกค้า' },
      { cat: 'REV001', from: 2, to: 12, amount: 60000, note: 'รายได้จากช่องทางใหม่' },
      { cat: 'REV002', from: 3, to: 12, amount: 12000, note: 'ค่าบริการรายเดือน' },
      { cat: 'BEN001', from: 2, to: 12, qty: 60, rate: 300, note: 'ลดเวลาตอบคำถามลูกค้า' },
      { cat: 'BEN004', from: 3, to: 12, qty: 6, rate: 1800, note: 'ลดการสั่งซื้อผิดพลาด' },
      { cat: 'BENOTH', customName: 'ลดค่าโทรศัพท์ติดต่อลูกค้า', from: 2, to: 12, qty: 40, rate: 25, note: 'ใช้แชตแทนโทร' },
    ],
  },
};

// สามโครงการต่อเจ้าของ — จัดให้ทุกประเภทเจอครบทุกสถานะ
// actualFactor = ผลจริงเทียบกับแผน (ใช้สร้างทั้งโครงการที่คุ้มค่าและไม่คุ้มค่า)
const PROJECT_TEMPLATES = [
  [
    { name: 'ระบบขายสินค้าออนไลน์', typeId: TYPE.REVENUE, status: 'completed', actualFactor: 1.05 },
    { name: 'ระบบจัดการคลังสินค้าอัตโนมัติ', typeId: TYPE.COST_SAVING, status: 'in_progress', actualFactor: 0.9 },
    { name: 'ระบบ CRM บริหารลูกค้าสัมพันธ์', typeId: TYPE.MIXED, status: 'planning' },
  ],
  [
    { name: 'ระบบเอกสารอิเล็กทรอนิกส์ (e-Document)', typeId: TYPE.COST_SAVING, status: 'completed', actualFactor: 0.55 },
    { name: 'แอปพลิเคชันสั่งอาหารเดลิเวอรี่', typeId: TYPE.MIXED, status: 'in_progress', actualFactor: 1.1 },
    { name: 'แพลตฟอร์มจองคิวออนไลน์', typeId: TYPE.REVENUE, status: 'planning' },
  ],
  [
    { name: 'แพลตฟอร์มขายคอร์สออนไลน์', typeId: TYPE.MIXED, status: 'completed', actualFactor: 0.95 },
    { name: 'ระบบสมาชิกและแต้มสะสม', typeId: TYPE.REVENUE, status: 'in_progress', actualFactor: 0.85 },
    { name: 'ระบบวิเคราะห์ข้อมูลลูกค้า (Data Analytics)', typeId: TYPE.COST_SAVING, status: 'planning' },
  ],
];

const ACTUAL_MONTHS = { completed: 12, in_progress: 6, planning: 0 };
// โครงการที่ปิดแล้วเริ่มเมื่อ 14 เดือนก่อน กำลังดำเนินการเริ่ม 7 เดือนก่อน ส่วนวางแผนเริ่มเดือนนี้
const STARTED_MONTHS_AGO = { completed: 14, in_progress: 7, planning: 0 };

async function seedProjects(owners) {
  const createdProjects = [];
  for (let u = 0; u < owners.length; u++) {
    const owner = owners[u];
    for (const tpl of PROJECT_TEMPLATES[u]) {
      const plan = PLANS[tpl.typeId];
      const createdAt = monthsAgo(STARTED_MONTHS_AGO[tpl.status]);
      const [result] = await db.insert(projects).values({
        userId: owner.userId,
        projectName: tpl.name,
        projectTypeId: tpl.typeId,
        durationMonths: 12,
        initialBudget: String(plan.budget),
        targetRoiPercent: String(plan.target),
        status: tpl.status,
        createdAt,
      });
      createdProjects.push({ projectId: result.insertId, owner, createdAt, ...tpl });
    }
  }
  return createdProjects;
}

async function seedProjectAccess(createdProjects, audience) {
  const rows = [];
  for (const project of createdProjects) {
    rows.push({ projectId: project.projectId, userId: project.owner.userId, permissionLevel: 'owner', sharedBy: null });
    // โครงการที่มีผลจริงแล้วเปิดสาธารณะ (แชร์ viewer ให้ทุกคน) ส่วนที่ยังวางแผนอยู่เป็นส่วนตัว
    if (ACTUAL_MONTHS[project.status] === 0) continue;
    for (const other of audience) {
      if (other.userId === project.owner.userId) continue;
      rows.push({ projectId: project.projectId, userId: other.userId, permissionLevel: 'viewer', sharedBy: project.owner.userId });
    }
  }
  await db.insert(projectAccess).values(rows);
}

// ความผันผวนรายเดือนแบบคงที่ (ไม่สุ่ม) ให้กราฟดูสมจริงแต่ seed ซ้ำได้ผลเท่าเดิมทุกครั้ง
const wiggle = (period, salt) => 0.92 + (((period * 7 + salt * 3) % 5) * 0.04);

function ledgerRow(project, phase, period, catId, value, extra = {}) {
  const isInflow = catId.startsWith('REV') || catId.startsWith('BEN');
  return {
    projectId: project.projectId,
    phase,
    periodIndex: period,
    typeId: isInflow ? 2 : 1,
    categoryId: catId,
    unitQty: extra.qty != null ? String(extra.qty) : null,
    unitCost: extra.rate != null ? String(extra.rate) : null,
    amountBase: String(value),
    totalValue: String(value),
    transactionDate: periodDate(project.createdAt, period),
    customName: extra.customName || null,
    note: extra.note || '',
    createdBy: project.owner.userId,
  };
}

function buildLedger(project, salt) {
  const plan = PLANS[project.typeId];
  const rows = [];
  const actualMonths = ACTUAL_MONTHS[project.status];

  for (const item of plan.items) {
    for (let period = item.from; period <= item.to; period++) {
      // แผน: ค่าเท่ากันทุกเดือนในช่วง
      if (item.qty != null) {
        rows.push(ledgerRow(project, 'ESTIMATED', period, item.cat, item.qty * item.rate,
          { qty: item.qty, rate: item.rate, note: item.note, customName: item.customName }));
      } else {
        rows.push(ledgerRow(project, 'ESTIMATED', period, item.cat, item.amount, { note: item.note, customName: item.customName }));
      }

      // ผลจริง: เฉพาะเดือนที่ผ่านมาแล้ว — ผลประโยชน์ปรับตาม actualFactor, ต้นทุนเกินแผนเล็กน้อย
      if (period > actualMonths) continue;
      const isBenefit = item.cat.startsWith('REV') || item.cat.startsWith('BEN');
      const factor = isBenefit ? project.actualFactor * wiggle(period, salt) : 1.04;
      if (item.qty != null) {
        const qty = Math.max(0, Math.round(item.qty * factor));
        rows.push(ledgerRow(project, 'ACTUAL', period, item.cat, qty * item.rate,
          { qty, rate: item.rate, note: item.note, customName: item.customName }));
      } else {
        const amount = Math.round((item.amount * factor) / 100) * 100;
        rows.push(ledgerRow(project, 'ACTUAL', period, item.cat, amount, { note: item.note, customName: item.customName }));
      }
    }
  }
  return rows;
}

async function seedProjectLedger(createdProjects) {
  const rows = createdProjects.flatMap((p, i) => buildLedger(p, i));
  // แบ่งส่งเป็นชุด กัน statement ใหญ่เกิน max_allowed_packet
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(projectLedger).values(rows.slice(i, i + 200));
  }
  return rows.length;
}

async function main() {
  console.log('Resetting tables...');
  await resetTables();

  console.log('Seeding master data...');
  await seedEntryTypes();
  await seedProjectTypes();
  await seedCategories();
  await seedSystemSettings();

  console.log('Seeding users...');
  const createdUsers = await seedUsers();
  const owners = createdUsers.filter((u) => u.role === 'project_owner');
  const audience = createdUsers.filter((u) => u.role === 'project_owner' || u.role === 'viewer');

  console.log('Seeding projects...');
  const createdProjects = await seedProjects(owners);
  await seedProjectAccess(createdProjects, audience);
  const ledgerCount = await seedProjectLedger(createdProjects);

  console.log(`\nDone. ${createdUsers.length} users, ${createdProjects.length} projects, ${ledgerCount} ledger rows.`);
  console.log(`Demo login password for every seeded user: ${DEMO_PASSWORD}`);
  createdUsers.forEach((u) => console.log(`  - ${u.email} (${u.role})`));
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
