// services/finance.js
// ตรรกะการเงินทั้งหมดของระบบอยู่ที่ไฟล์นี้ไฟล์เดียว (pure functions ไม่แตะ database)
// ทุก endpoint ที่แสดง ROI / กระแสเงินสด / ระยะคืนทุน เรียกผ่านที่นี่ ตัวเลขทุกหน้าจึงตรงกันเสมอ
//
// แหล่งของเงินแต่ละรายการ (ดูจาก category_group ของหมวดหมู่):
//   REV = รายได้โดยตรง (Direct Revenue)      — เงินสดที่ได้รับเข้ามาจริง กรอกเป็นยอดเงิน
//   BEN = ประโยชน์ทางอ้อม (Indirect Benefit) — มูลค่าที่ประหยัดได้ กรอกเป็น ปริมาณ/เดือน × อัตรา
//   INV / OPC / ADC = ต้นทุน (ลงทุน / ดำเนินงาน / บริหารจัดการ)

const SOURCES = { DIRECT: 'direct', INDIRECT: 'indirect', COST: 'cost' };

const num = (v) => Number(v) || 0;

function classifyRow(row) {
  if (row.category_group === 'REV') return SOURCES.DIRECT;
  if (row.category_group === 'BEN') return SOURCES.INDIRECT;
  if (['INV', 'OPC', 'ADC'].includes(row.category_group)) return SOURCES.COST;
  // หมวดที่ไม่รู้กลุ่ม — ตัดสินจากทิศทางเงินแทน กันข้อมูลหลุดจากการคำนวณเงียบๆ
  return Number(row.is_inflow) ? SOURCES.DIRECT : SOURCES.COST;
}

// ประเภทโครงการเลือกตรรกะการคำนวณ (Proposal ข้อ 4 และ 12):
//   REVENUE     มุ่งสร้างรายได้  → นับรายได้โดยตรง
//   COST_SAVING มุ่งลดต้นทุน    → นับประโยชน์ทางอ้อม
//   MIXED/ไม่ระบุ แบบผสมผสาน → นับทั้งสองอย่าง
// ต้นทุนนับเสมอไม่ว่าประเภทไหน
function isCounted(method, source) {
  if (source === SOURCES.COST) return true;
  if (source === SOURCES.DIRECT) return method !== 'COST_SAVING';
  if (source === SOURCES.INDIRECT) return method !== 'REVENUE';
  return false;
}

function benefitSourcesFor(method) {
  return {
    direct: isCounted(method, SOURCES.DIRECT),
    indirect: isCounted(method, SOURCES.INDIRECT),
  };
}

// ROI (%) = (ผลประโยชน์สุทธิ / ต้นทุนรวม) × 100 โดย ผลประโยชน์สุทธิ = ผลประโยชน์รวม − ต้นทุนรวม
// ต้นทุนเป็น 0 → คำนวณ ROI ไม่ได้ (หารด้วยศูนย์) คืน null ให้หน้าเว็บแสดง "—"
// (เดิมคืน 0% ทำให้โครงการที่มีแต่ผลประโยชน์ถูกตัดสินว่า "ไม่คุ้มค่า")
function calcRoi(totalBenefit, totalCost) {
  if (!(totalCost > 0)) return null;
  return ((totalBenefit - totalCost) / totalCost) * 100;
}

const diffOrNull = (a, b) => (a == null || b == null ? null : a - b);

// จุดคุ้มทุนจากกระแสเงินสดสะสม (เดือน แบบมีทศนิยม) — เดือนที่เงินสะสมกลับมาเป็น 0 ครั้งสุดท้าย
// เทียบกับ paybackMonths (สูตรเฉลี่ย) ซึ่งอาจต่างกันได้เมื่อผลประโยชน์แต่ละเดือนไม่เท่ากัน
// คืน null ถ้าไม่มีต้นทุน หรือเงินสะสม ณ เดือนสุดท้ายที่มีข้อมูลยังติดลบ (ยังไม่คืนทุน)
function calcBreakEvenMonth(list, upToPeriod) {
  const months = list.filter((m) => m.period <= upToPeriod);
  if (months.length === 0 || !months.some((m) => m.expense > 0)) return null;
  if (months[months.length - 1].cumulative < 0) return null;
  let breakEven = null;
  let prev = 0;
  for (const m of months) {
    // เดือนที่ยังไม่มีความเคลื่อนไหวเลย (ก่อนเริ่มจ่าย/รับเงิน) ข้ามไป ไม่นับเป็นจุดคุ้มทุน
    if (prev === 0 && m.revenue === 0 && m.expense === 0) continue;
    if (m.cumulative >= 0 && (prev < 0 || breakEven === null)) {
      if (prev < 0) breakEven = m.period - 1 + -prev / (m.cumulative - prev);
      else breakEven = m.revenue > 0 ? m.period - 1 + Math.min(1, m.expense / m.revenue) : m.period;
    }
    prev = m.cumulative;
  }
  return breakEven;
}

// ระยะเวลาคืนทุน (เดือน) = ต้นทุนรวม ÷ ผลประโยชน์เฉลี่ยต่อเดือน
//   ผลประโยชน์เฉลี่ยต่อเดือน = ผลประโยชน์รวม (ที่นับตามประเภทโครงการ) ÷ จำนวนเดือน
// ได้เป็นจำนวนเดือนแบบมีทศนิยม เช่น 661,000 ÷ (1,086,000 ÷ 12) = 7.3 เดือน
// ไม่มีผลประโยชน์ (หรือไม่มีต้นทุน) → คำนวณไม่ได้ คืน null
function calcPaybackMonths(totalCost, totalBenefit, months) {
  if (totalCost <= 0 || totalBenefit <= 0 || months <= 0) return null;
  return totalCost / (totalBenefit / months);
}

function emptyPhaseMonth() {
  return { direct: 0, indirect: 0, excluded: 0, expense: 0 };
}

/**
 * คำนวณผลทั้งหมดของโครงการหนึ่งโครงการ
 * @param project { duration_months, target_roi_percent, calculation_method }
 * @param rows    ledger แต่ละแถว { phase: 'ESTIMATED'|'ACTUAL', period_index, category_id,
 *                category_name, category_group, is_inflow, total_value, custom_name? }
 */
function analyzeProject(project, rows) {
  const method = project.calculation_method || 'MIXED';
  const durationMonths = Math.max(1, num(project.duration_months) || 12);
  const maxRecordedPeriod = rows.reduce((max, r) => Math.max(max, num(r.period_index)), 0);
  // ถ้ามีข้อมูลเลยระยะเวลาโครงการไป (เช่นแก้ระยะเวลาทีหลัง) ต้องแสดงให้ครบ ยอดรวมจะได้ไม่เพี้ยน
  const periodCount = Math.max(durationMonths, maxRecordedPeriod);

  const buckets = { ESTIMATED: [], ACTUAL: [] };
  for (let p = 0; p < periodCount; p++) {
    buckets.ESTIMATED.push(emptyPhaseMonth());
    buckets.ACTUAL.push(emptyPhaseMonth());
  }

  const categories = new Map();
  let lastActualPeriod = 0;

  for (const r of rows) {
    const phase = r.phase === 'ACTUAL' ? 'ACTUAL' : 'ESTIMATED';
    const period = Math.max(1, num(r.period_index));
    const value = num(r.total_value);
    const source = classifyRow(r);
    const counted = isCounted(method, source);
    const b = buckets[phase][period - 1];

    if (source === SOURCES.COST) b.expense += value;
    else if (!counted) b.excluded += value;
    else b[source] += value;

    if (phase === 'ACTUAL') lastActualPeriod = Math.max(lastActualPeriod, period);

    // หมวด "อื่นๆ" แยกตามชื่อที่ผู้ใช้พิมพ์ — ไม่งั้นรายการคนละเรื่องจะถูกรวมเป็นก้อนเดียว
    const key = r.custom_name ? `${r.category_id}|${r.custom_name}` : r.category_id;
    if (!categories.has(key)) {
      categories.set(key, {
        category_id: r.category_id,
        custom_name: r.custom_name || null,
        category_name: r.custom_name || r.category_name,
        category_group: r.category_group,
        is_inflow: !!Number(r.is_inflow),
        source,
        counted,
        estimated: 0,
        actual: 0,
        estimatedByPeriod: [],
      });
    }
    const c = categories.get(key);
    if (phase === 'ACTUAL') c.actual += value;
    else {
      c.estimated += value;
      c.estimatedByPeriod.push([period, value]);
    }
  }

  const hasActualData = rows.some((r) => r.phase === 'ACTUAL');
  const monthly = [];
  const series = { ESTIMATED: [], ACTUAL: [] };
  const cum = { ESTIMATED: 0, ACTUAL: 0 };

  for (let i = 0; i < periodCount; i++) {
    const period = i + 1;
    const out = {};
    for (const phase of ['ESTIMATED', 'ACTUAL']) {
      const b = buckets[phase][i];
      const revenue = b.direct + b.indirect;
      const ncf = revenue - b.expense;
      cum[phase] += ncf;
      const figures = {
        revenue,
        direct: b.direct,
        indirect: b.indirect,
        expense: b.expense,
        ncf,
        cumulative: cum[phase],
      };
      series[phase].push({ period, ...figures });
      out[phase] = figures;
    }
    const hasData = period <= lastActualPeriod;
    monthly.push({
      period,
      estimated: out.ESTIMATED,
      actual: { ...out.ACTUAL, hasData },
      variance: {
        revenue: out.ACTUAL.revenue - out.ESTIMATED.revenue,
        expense: out.ACTUAL.expense - out.ESTIMATED.expense,
        ncf: out.ACTUAL.ncf - out.ESTIMATED.ncf,
        cumulative: out.ACTUAL.cumulative - out.ESTIMATED.cumulative,
      },
    });
  }

  const summarize = (phase, coveredMonths) => {
    const list = series[phase];
    const excluded = buckets[phase].reduce((s, b) => s + b.excluded, 0);
    const directRevenue = list.reduce((s, m) => s + m.direct, 0);
    const indirectBenefit = list.reduce((s, m) => s + m.indirect, 0);
    const totalRevenue = directRevenue + indirectBenefit;
    const totalExpense = list.reduce((s, m) => s + m.expense, 0);
    // มูลค่าประโยชน์ทางอ้อมเทียบเป็นรายปี = ค่าเฉลี่ยต่อเดือนในช่วงที่มีข้อมูล × 12
    // (ประมาณการ = ตลอดระยะเวลาโครงการ, ผลจริง = เฉพาะเดือนที่บันทึกผลจริงแล้ว)
    const months = Math.max(1, coveredMonths);
    return {
      totalRevenue,
      totalExpense,
      netProfit: totalRevenue - totalExpense,
      roi: calcRoi(totalRevenue, totalExpense),
      paybackMonths: calcPaybackMonths(totalExpense, totalRevenue, months),
      breakEvenMonth: calcBreakEvenMonth(list, months),
      directRevenue,
      indirectBenefit,
      indirectMonthlyAverage: indirectBenefit / months,
      indirectAnnualized: (indirectBenefit / months) * 12,
      excludedBenefit: excluded,
    };
  };

  const estimated = summarize('ESTIMATED', durationMonths);
  const actual = summarize('ACTUAL', lastActualPeriod || durationMonths);

  // แผน "ถึงเดือนเดียวกับผลจริงล่าสุด" — ระหว่างโครงการยังไม่จบ ใช้ตัวนี้เทียบกับผลจริงจะยุติธรรมกว่า
  // เทียบกับแผนทั้งโครงการ
  const planToDate = series.ESTIMATED.filter((m) => m.period <= lastActualPeriod);
  const toDateRevenue = planToDate.reduce((s2, m) => s2 + m.revenue, 0);
  const toDateExpense = planToDate.reduce((s2, m) => s2 + m.expense, 0);
  const estimatedToDate = {
    months: lastActualPeriod,
    totalRevenue: toDateRevenue,
    totalExpense: toDateExpense,
    netProfit: toDateRevenue - toDateExpense,
    roi: calcRoi(toDateRevenue, toDateExpense),
    paybackMonths: calcPaybackMonths(toDateExpense, toDateRevenue, lastActualPeriod),
  };

  // คาดการณ์ทั้งโครงการ = ผลจริงถึงเดือนล่าสุด + แผนของเดือนที่เหลือ
  // ใช้ตัดสินความคุ้มค่าระหว่างโครงการยังไม่จบ — เป้า ROI ตั้งไว้สำหรับทั้งโครงการ ถ้าเอา ROI ของ
  // ผลจริงแค่บางเดือน (ที่ลงทุนไปเต็มแล้วแต่ผลประโยชน์ยังมาไม่ครบ) ไปเทียบ จะ "ไม่คุ้มค่า" แทบทุกโครงการ
  const planRemaining = series.ESTIMATED.filter((m) => m.period > lastActualPeriod);
  const projRevenue = actual.totalRevenue + planRemaining.reduce((s2, m) => s2 + m.revenue, 0);
  const projExpense = actual.totalExpense + planRemaining.reduce((s2, m) => s2 + m.expense, 0);
  const projected = {
    totalRevenue: projRevenue,
    totalExpense: projExpense,
    netProfit: projRevenue - projExpense,
    roi: calcRoi(projRevenue, projExpense),
  };

  const isFinal = project.project_status === 'completed' || project.project_status === 'archived';
  const actualIsPartial = hasActualData && !isFinal && lastActualPeriod < durationMonths;

  const targetRoi = project.target_roi_percent != null ? num(project.target_roi_percent) : null;
  // ฐานที่ใช้เทียบเป้า: ยังไม่มีผลจริง → ประมาณการ, มีผลจริงครบ/ปิดโครงการแล้ว → ผลจริง,
  // มีผลจริงบางเดือน → คาดการณ์ทั้งโครงการ (ผลจริง + แผนที่เหลือ)
  const worthwhileBasis = !hasActualData ? 'estimated' : actualIsPartial ? 'projected' : 'actual';
  const basisSummary = { estimated, actual, projected }[worthwhileBasis];
  const roiForComparison = basisSummary.roi;
  let isWorthwhile = null;
  if (targetRoi != null) {
    // ROI คำนวณไม่ได้เพราะไม่มีต้นทุน: มีผลประโยชน์ = คุ้มค่าแน่นอน, ไม่มีอะไรเลย = ยังตัดสินไม่ได้
    if (roiForComparison == null) isWorthwhile = basisSummary.totalRevenue > 0 ? true : null;
    else isWorthwhile = roiForComparison >= targetRoi;
  }

  // เทียบผลจริงกับแผน "ถึงเดือนเดียวกัน" ด้วย — ระหว่างโครงการยังไม่จบ ถ้าเทียบกับแผนทั้งโครงการ
  // ทุกหมวดจะดูต่ำกว่าเป้าหมดเพียงเพราะยังบันทึกผลไม่ครบทุกเดือน
  const byCategory = [...categories.values()]
    .map(({ estimatedByPeriod, ...c }) => {
      const estimatedToDate = estimatedByPeriod
        .filter(([period]) => period <= lastActualPeriod)
        .reduce((s, [, v]) => s + v, 0);
      return {
        ...c,
        variance: c.actual - c.estimated,
        estimatedToDate,
        varianceToDate: c.actual - estimatedToDate,
      };
    })
    .sort((a, b) => {
      const order = { direct: 0, indirect: 1, cost: 2 };
      return order[a.source] - order[b.source] || String(a.category_id).localeCompare(String(b.category_id));
    });

  return {
    monthly,
    summary: {
      hasActualData,
      lastActualPeriod,
      calculationMethod: method,
      countedSources: benefitSourcesFor(method),
      estimated,
      actual,
      estimatedToDate,
      projected,
      variance: {
        revenue: actual.totalRevenue - estimated.totalRevenue,
        expense: actual.totalExpense - estimated.totalExpense,
        netProfit: actual.netProfit - estimated.netProfit,
        roi: diffOrNull(actual.roi, estimated.roi),
      },
      targetRoi,
      roiForComparison,
      worthwhileBasis,
      isWorthwhile,
    },
    byCategory,
  };
}

// สรุปย่อของโครงการสำหรับหน้ารายการ/แดชบอร์ด — ใช้ phase จริงถ้ามีแล้ว ไม่งั้นใช้ประมาณการ
function summarizeForList(project, rows) {
  const { summary } = analyzeProject(project, rows);
  const phase = summary.hasActualData ? summary.actual : summary.estimated;
  return {
    summary_phase: summary.hasActualData ? 'Actual' : 'Estimated',
    total_benefit: phase.totalRevenue,
    direct_revenue: phase.directRevenue,
    indirect_benefit: phase.indirectBenefit,
    total_cost: phase.totalExpense,
    net_profit: phase.netProfit,
    roi: phase.roi,
    payback_months: phase.paybackMonths,
    break_even_month: phase.breakEvenMonth,
    is_worthwhile: summary.isWorthwhile,
    worthwhile_basis: summary.worthwhileBasis,
    projected_roi: summary.hasActualData ? summary.projected.roi : null,
    // แผน vs จริง สำหรับหน้า Dashboard
    has_actual: summary.hasActualData,
    last_actual_period: summary.lastActualPeriod,
    estimated_roi: summary.estimated.roi,
    estimated_net_profit: summary.estimated.netProfit,
    estimated_payback_months: summary.estimated.paybackMonths,
    actual_roi: summary.hasActualData ? summary.actual.roi : null,
    actual_net_profit: summary.hasActualData ? summary.actual.netProfit : null,
    actual_payback_months: summary.hasActualData ? summary.actual.paybackMonths : null,
    estimated_to_date_roi: summary.hasActualData ? summary.estimatedToDate.roi : null,
    estimated_to_date_payback_months: summary.hasActualData ? summary.estimatedToDate.paybackMonths : null,
  };
}

module.exports = {
  SOURCES,
  classifyRow,
  isCounted,
  benefitSourcesFor,
  calcRoi,
  calcPaybackMonths,
  calcBreakEvenMonth,
  analyzeProject,
  summarizeForList,
};
