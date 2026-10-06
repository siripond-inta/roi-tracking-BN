// db/schema.js
// Drizzle ORM schema — implements the roi_tracking_db DBML spec (v1.2 - Gap Analysis Update).
// This replaces manual table creation in phpMyAdmin: run `npm run db:generate` + `npm run db:migrate`
// (or `npm run db:push` for dev) to create/update these tables instead.
//
// NOTE: this schema intentionally matches the DBML spec as given, which differs from the
// tables the current controllers/routes query (e.g. users.company_name, projects.is_public /
// custom_project_type, and lowercase 'Estimated'/'Actual' phase values are not present here).
// Updating the application code to match this schema is a separate follow-up task.

const {
  mysqlTable,
  int,
  varchar,
  text,
  boolean,
  timestamp,
  date,
  decimal,
  mysqlEnum,
  uniqueIndex,
  index,
} = require('drizzle-orm/mysql-core');
const { relations } = require('drizzle-orm');

// ── users ──────────────────────────────────────────────────
const users = mysqlTable('users', {
  userId: int('user_id').autoincrement().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  fullName: varchar('full_name', { length: 255 }),
  role: mysqlEnum('role', ['admin', 'project_owner', 'viewer']).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  // เพิ่มนอกเหนือจาก DBML เดิม (v1.2) — จำเป็นสำหรับ feature "soft delete บัญชีที่ไม่ active เกิน 3 ปี"
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

// ── project_types ─────────────────────────────────────────
const projectTypes = mysqlTable('project_types', {
  typeId: int('type_id').primaryKey(),
  typeName: varchar('type_name', { length: 255 }).notNull(),
  description: text('description'),
  calculationMethod: mysqlEnum('calculation_method', ['REVENUE', 'COST_SAVING', 'MIXED']),
});

// ── entry_types ───────────────────────────────────────────
const entryTypes = mysqlTable('entry_types', {
  typeId: int('type_id').primaryKey(),
  typeName: varchar('type_name', { length: 255 }).notNull(),
  isInflow: boolean('is_inflow').notNull(),
  description: text('description'),
});

// ── categories ────────────────────────────────────────────
const categories = mysqlTable('categories', {
  categoryId: varchar('category_id', { length: 50 }).primaryKey(),
  categoryName: varchar('category_name', { length: 255 }).notNull(),
  typeId: int('type_id').references(() => entryTypes.typeId),
  // REV เพิ่มนอกเหนือจาก DBML เดิม — แยก "รายได้โดยตรง" (REV) ออกจาก "ประโยชน์ทางอ้อม" (BEN)
  // เพราะประเภทโครงการใช้สองกลุ่มนี้เลือกตรรกะการคำนวณ (ดู services/finance.js)
  categoryGroup: mysqlEnum('category_group', ['INV', 'OPC', 'ADC', 'REV', 'BEN']).notNull(),
  // เพิ่มนอกเหนือจาก DBML เดิม (v1.2) — รองรับการตีมูลค่าประโยชน์ทางอ้อม (FR03-4) ที่คิดจาก
  // "ปริมาณที่ลดได้ × อัตราต่อหน่วย" โดยแต่ละหมวดใช้หน่วยคนละแบบ (ชั่วโมง/ชุด/ครั้ง)
  // เก็บชื่อหน่วยไว้ใน database ให้ฟอร์มดึงไปแสดงเอง ไม่ต้อง hardcode ใน frontend
  // null = หมวดหมู่ปกติที่กรอกยอดเงินตรงๆ ไม่ใช่แบบ qty × rate
  unitLabel: varchar('unit_label', { length: 100 }),
  rateLabel: varchar('rate_label', { length: 100 }),
  // หมวด "อื่นๆ" — ผู้ใช้ต้องพิมพ์ชื่อรายการเอง (เก็บใน project_ledger.custom_name)
  allowCustomName: boolean('allow_custom_name').notNull().default(false),
});

// ── projects ──────────────────────────────────────────────
const projects = mysqlTable('projects', {
  projectId: int('project_id').autoincrement().primaryKey(),
  userId: int('user_id').references(() => users.userId),
  projectName: varchar('project_name', { length: 255 }).notNull(),
  projectTypeId: int('project_type_id').references(() => projectTypes.typeId),
  durationMonths: int('duration_months'),
  initialBudget: decimal('initial_budget', { precision: 15, scale: 2 }),
  targetRoiPercent: decimal('target_roi_percent', { precision: 5, scale: 2 }),
  discountRate: decimal('discount_rate', { precision: 5, scale: 2 }),
  status: mysqlEnum('status', ['planning', 'in_progress', 'completed', 'archived'])
    .notNull()
    .default('planning'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

// ── project_access ────────────────────────────────────────
const projectAccess = mysqlTable(
  'project_access',
  {
    accessId: int('access_id').autoincrement().primaryKey(),
    projectId: int('project_id')
      .notNull()
      .references(() => projects.projectId),
    userId: int('user_id')
      .notNull()
      .references(() => users.userId),
    permissionLevel: mysqlEnum('permission_level', ['owner', 'editor', 'viewer']).notNull(),
    sharedBy: int('shared_by').references(() => users.userId),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [uniqueIndex('project_access_project_user_unique').on(table.projectId, table.userId)],
);

// ── project_ledger ────────────────────────────────────────
const projectLedger = mysqlTable(
  'project_ledger',
  {
    ledgerId: int('ledger_id').autoincrement().primaryKey(),
    projectId: int('project_id').references(() => projects.projectId),
    phase: mysqlEnum('phase', ['ESTIMATED', 'ACTUAL']).notNull(),
    periodIndex: int('period_index').notNull(),
    typeId: int('type_id').references(() => entryTypes.typeId),
    categoryId: varchar('category_id', { length: 50 }).references(() => categories.categoryId),
    amountBase: decimal('amount_base', { precision: 15, scale: 2 }),
    unitQty: decimal('unit_qty', { precision: 10, scale: 2 }),
    unitCost: decimal('unit_cost', { precision: 15, scale: 2 }),
    totalValue: decimal('total_value', { precision: 15, scale: 2 }),
    transactionDate: date('transaction_date').notNull(),
    // ชื่อรายการที่ผู้ใช้พิมพ์เองเมื่อเลือกหมวด "อื่นๆ" (categories.allow_custom_name)
    customName: varchar('custom_name', { length: 255 }),
    note: text('note'),
    createdBy: int('created_by').references(() => users.userId),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [index('project_ledger_project_phase_period_idx').on(table.projectId, table.phase, table.periodIndex)],
);

// ── system_settings ───────────────────────────────────────
const systemSettings = mysqlTable('system_settings', {
  settingKey: varchar('setting_key', { length: 100 }).primaryKey(),
  settingValue: varchar('setting_value', { length: 255 }),
  description: text('description'),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

// ── relations (mirrors the Ref: lines in the DBML) ───────────
const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  projectAccess: many(projectAccess),
  ledgerEntries: many(projectLedger),
}));

const projectTypesRelations = relations(projectTypes, ({ many }) => ({
  projects: many(projects),
}));

const entryTypesRelations = relations(entryTypes, ({ many }) => ({
  categories: many(categories),
  ledgerEntries: many(projectLedger),
}));

const categoriesRelations = relations(categories, ({ one, many }) => ({
  entryType: one(entryTypes, { fields: [categories.typeId], references: [entryTypes.typeId] }),
  ledgerEntries: many(projectLedger),
}));

const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.userId], references: [users.userId] }),
  projectType: one(projectTypes, { fields: [projects.projectTypeId], references: [projectTypes.typeId] }),
  access: many(projectAccess),
  ledgerEntries: many(projectLedger),
}));

const projectAccessRelations = relations(projectAccess, ({ one }) => ({
  project: one(projects, { fields: [projectAccess.projectId], references: [projects.projectId] }),
  user: one(users, { fields: [projectAccess.userId], references: [users.userId] }),
  sharedByUser: one(users, { fields: [projectAccess.sharedBy], references: [users.userId] }),
}));

const projectLedgerRelations = relations(projectLedger, ({ one }) => ({
  project: one(projects, { fields: [projectLedger.projectId], references: [projects.projectId] }),
  entryType: one(entryTypes, { fields: [projectLedger.typeId], references: [entryTypes.typeId] }),
  category: one(categories, { fields: [projectLedger.categoryId], references: [categories.categoryId] }),
  createdByUser: one(users, { fields: [projectLedger.createdBy], references: [users.userId] }),
}));

module.exports = {
  users,
  projectTypes,
  entryTypes,
  categories,
  projects,
  projectAccess,
  projectLedger,
  systemSettings,
  usersRelations,
  projectTypesRelations,
  entryTypesRelations,
  categoriesRelations,
  projectsRelations,
  projectAccessRelations,
  projectLedgerRelations,
};
