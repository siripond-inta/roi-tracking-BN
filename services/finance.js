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
// ต้นทุนเป็น 0 (ยังไม่มีข้อมูลต้นทุน) คืน 0 แทนการหารด้วยศูนย์
function calcRoi(totalBenefit, totalCost) {
  if (totalCost <= 0) return 0;
  return ((totalBenefit - totalCost) / totalCost) * 100;
}

// ระยะเวลาคืนทุน = เดือนแรกที่กระแสเงินสดสะสมกลับมาไม่ติดลบ หลังจากมีต้นทุนเกิดขึ้นแล้ว
// กระแสเงินสดสะสมหักเงินลงทุน (INV) ไว้แล้ว การที่มันกลับมา ≥ 0 จึงหมายถึงผลประโยชน์สะสม
// หักต้นทุนดำเนินงาน ได้ครอบคลุมเงินลงทุนทั้งหมดแล้ว — ใช้ต้นทุนชุดเดียวกับ ROI
// (เดิมเทียบกับงบประมาณเริ่มต้นแยกต่างหาก ทำให้ขัดกันเอง เช่น ROI 100% แต่ยังขึ้นว่าไม่คืนทุน)
function findPaybackMonth(monthly) {
  let cumulativeCost = 0;
  for (const m of monthly) {
    cumulativeCost += m.expense;
    if (cumulativeCost > 0 && m.cumulative >= 0) return m.period;
  }
  return null;
}

function emptyPhaseMonth() {
  return { direct: 0, indirect: 0, excluded: 0, expense: 0 };
}

/**
 * คำนวณผลทั้งหมดของโครงการหนึ่งโครงการ
 * @param project { duration_months, target_roi_percent, calculation_method }
 * @param rows    ledger แต่ละแถว { phase: 'ESTIMATED'|'ACTUAL', period_index, category_id,
 *                category_name, category_group, is_inflow, total_value }
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

    const key = r.category_id;
    if (!categories.has(key)) {
      categories.set(key, {
        category_id: r.category_id,
        category_name: r.category_name,
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
    const months = Math.max(1, coveredMonths);
    return {
      totalRevenue,
      totalExpense,
      netProfit: totalRevenue - totalExpense,
      roi: calcRoi(totalRevenue, totalExpense),
      paybackMonth: findPaybackMonth(list),
      directRevenue,
      indirectBenefit,
      indirectMonthlyAverage: indirectBenefit / months,
      indirectAnnualized: (indirectBenefit / months) * 12,
      excludedBenefit: excluded,
    };
  };

  const estimated = summarize('ESTIMATED', durationMonths);
  const actual = summarize('ACTUAL', lastActualPeriod || durationMonths);

  const targetRoi = project.target_roi_percent != null ? num(project.target_roi_percent) : null;
  // เทียบกับ ROI จริงถ้ามีข้อมูล Actual แล้ว ถ้ายังไม่มีก็เทียบกับที่คาดการณ์ไว้ (และบอกด้วยว่าใช้ฐานไหน)
  const worthwhileBasis = hasActualData ? 'actual' : 'estimated';
  const roiForComparison = hasActualData ? actual.roi : estimated.roi;

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
      variance: {
        revenue: actual.totalRevenue - estimated.totalRevenue,
        expense: actual.totalExpense - estimated.totalExpense,
        netProfit: actual.netProfit - estimated.netProfit,
        roi: actual.roi - estimated.roi,
      },
      targetRoi,
      roiForComparison,
      worthwhileBasis,
      isWorthwhile: targetRoi == null ? null : roiForComparison >= targetRoi,
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
    payback_month: phase.paybackMonth,
    is_worthwhile: summary.isWorthwhile,
  };
}

module.exports = {
  SOURCES,
  classifyRow,
  isCounted,
  benefitSourcesFor,
  calcRoi,
  findPaybackMonth,
  analyzeProject,
  summarizeForList,
};
