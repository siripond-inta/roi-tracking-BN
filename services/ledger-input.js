// services/ledger-input.js
// ตรวจความถูกต้องของรายการรายรับ/รายจ่ายที่ส่งมาจากฟอร์ม แล้วกระจายเป็นแถวรายเดือน
//
// ฟอร์มส่งมาได้สองแบบ:
//   { period_from: 2, period_to: 12, ... } — ค่าเดียวกันทุกเดือนในช่วง เช่น "ประหยัด 80 ชม./เดือน
//                                             ตั้งแต่เดือน 2 ถึง 12" (ประโยชน์ทางอ้อมส่วนใหญ่เป็นแบบนี้)
//   { period_index: 3, ... }                — เดือนเดียว (รูปแบบเดิม)
// ทั้งสองแบบถูกเก็บเป็นหนึ่งแถวต่อหนึ่งเดือน รายงานรายเดือน/กราฟ/ระยะคืนทุนจึงคำนวณได้ตรงเดือน

const MAX_ITEMS = 500;

const isNonNegativeNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  return Number(v);
}

// วันที่ของงวด = วันที่ 15 ของเดือน (เดือนเริ่มโครงการ + งวด − 1) — ผู้ใช้เลือกแค่เดือน
function periodDate(projectCreatedAt, period) {
  const start = projectCreatedAt ? new Date(projectCreatedAt) : new Date();
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 15));
  d.setUTCMonth(d.getUTCMonth() + (period - 1));
  return d.toISOString().split('T')[0];
}

/**
 * @param items       รายการจากฟอร์ม
 * @param categories  Map<category_id, { type_id, unit_label, rate_label, category_name }>
 * @param project     { duration_months, created_at }
 * @returns { rows } หรือ { error }
 */
function expandLedgerItems(items, categories, project) {
  if (!Array.isArray(items)) return { error: 'รูปแบบข้อมูลรายการไม่ถูกต้อง' };
  if (items.length > MAX_ITEMS) return { error: `ส่งรายการได้ครั้งละไม่เกิน ${MAX_ITEMS} รายการ` };

  const duration = Math.max(1, Number(project.duration_months) || 12);
  const rows = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const label = `รายการที่ ${i + 1}`;
    const category = categories.get(item.category_id);
    if (!category) return { error: `${label}: ไม่พบหมวดหมู่ ${item.category_id ?? '(ว่าง)'}` };

    const qty = toNumberOrNull(item.unit_qty);
    const cost = toNumberOrNull(item.unit_cost);
    const amount = toNumberOrNull(item.total_value);

    for (const [name, v] of [['ปริมาณ', qty], ['อัตราต่อหน่วย', cost], ['จำนวนเงิน', amount]]) {
      if (v !== null && !isNonNegativeNumber(v)) {
        return { error: `${label} (${category.category_name}): ${name}ต้องเป็นตัวเลขที่ไม่ติดลบ` };
      }
    }

    const qtyBased = !!(category.unit_label && category.rate_label);
    let value;
    if (qtyBased && (qty !== null || cost !== null)) {
      if (qty === null || cost === null) {
        return { error: `${label} (${category.category_name}): ต้องกรอกทั้ง "${category.unit_label}" และ "${category.rate_label}"` };
      }
      value = qty * cost;
    } else {
      value = amount ?? 0;
    }

    const from = Number(item.period_from ?? item.period_index ?? 1);
    const to = Number(item.period_to ?? from);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > duration) {
      return { error: `${label} (${category.category_name}): ช่วงเดือนต้องอยู่ระหว่าง 1–${duration} และเดือนเริ่มต้องไม่เกินเดือนสิ้นสุด` };
    }

    for (let period = from; period <= to; period++) {
      rows.push({
        period_index: period,
        // ประเภทรายรับ/รายจ่ายยึดตามหมวดหมู่เสมอ ไม่เชื่อค่าที่ส่งมา — กันกรณีส่ง type_id
        // ไม่ตรงกับหมวด ซึ่งจะทำให้รายรับถูกนับเป็นรายจ่าย (หรือกลับกัน)
        type_id: category.type_id,
        category_id: item.category_id,
        unit_qty: qtyBased && qty !== null ? qty : null,
        unit_cost: qtyBased && cost !== null ? cost : null,
        total_value: value,
        transaction_date: periodDate(project.created_at, period),
        note: typeof item.note === 'string' ? item.note.slice(0, 1000) : '',
      });
    }
  }

  return { rows };
}

module.exports = { expandLedgerItems, periodDate, MAX_ITEMS };
