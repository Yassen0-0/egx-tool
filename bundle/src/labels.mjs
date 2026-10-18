// Arabic names and one-line beginner explanations for the keys stored in a valuation record
// (methods, assumptions, sanity checks, risk criteria). Every abbreviation is spelled out on
// first sight. Pure data + small formatters: inlined into client.js and tested in bundle/test.
import { fmtNumber, fmtPct } from './format.mjs'

export const METHOD_LABEL = {
  dcf_fcff: ['خصم التدفقات النقدية الحرة (DCF)', 'قيمة النقد الذي تولّده الشركة في السنوات القادمة بعد خصمه لليوم'],
  ddm: ['نموذج خصم التوزيعات', 'القيمة الحالية للتوزيعات النقدية المتوقعة'],
  multiples: ['مضاعفات السوق', 'مقارنة السعر بالأرباح أو القيمة الدفترية مع تاريخ الشركة وأمثالها'],
  nav: ['صافي قيمة الأصول (NAV)', 'قيمة الأصول والحصص ناقص الديون، لكل سهم'],
  bank_justified_pb: ['مضاعف القيمة الدفترية المبرَّر', 'كم يستحق جنيه حقوق الملكية حسب العائد عليه مقابل تكلفته'],
  residual_income: ['نموذج العائد الزائد على حقوق الملكية', 'القيمة الدفترية زائد ما يكسبه البنك فوق تكلفة رأس ماله'],
}

// [label, how to show the value]: 'pct' for rates and ratios, 'num' for plain numbers, 'egp' for pounds.
export const ASSUMPTION_LABEL = {
  wacc: ['متوسط تكلفة التمويل المرجّح (WACC)', 'pct'],
  cost_of_equity: ['تكلفة حقوق الملكية', 'pct'],
  capm_cost_of_equity: ['تكلفة حقوق الملكية', 'pct'],
  risk_free_rate_egp: ['عائد أذون الخزانة بالجنيه (الخالي من المخاطر)', 'pct'],
  equity_risk_premium: ['علاوة مخاطر الأسهم', 'pct'],
  country_risk_premium: ['علاوة مخاطر الدولة', 'pct'],
  beta: ['بيتا السهم (حساسيته لحركة السوق)', 'num'],
  sustainable_roe: ['العائد المستدام على حقوق الملكية', 'pct'],
  roe: ['العائد على حقوق الملكية', 'pct'],
  long_run_growth: ['النمو طويل الأجل', 'pct'],
  long_run_nominal_growth: ['النمو الاسمي طويل الأجل', 'pct'],
  terminal_growth: ['النمو بعد سنوات التوقع', 'pct'],
  payout_ratio: ['نسبة التوزيع النقدي', 'pct'],
  tax_rate: ['معدل الضريبة', 'pct'],
  inflation: ['التضخم', 'pct'],
  usd_egp: ['سعر الدولار بالجنيه', 'num'],
  volume_growth: ['نمو حجم المبيعات', 'pct'],
  revenue_growth: ['نمو الإيرادات', 'pct'],
  ebit_margin: ['هامش الربح التشغيلي', 'pct'],
  land_bank_value_per_share: ['قيمة محفظة الأراضي للسهم', 'egp'],
  net_debt_per_share: ['صافي الدين للسهم', 'egp'],
  shares_outstanding: ['عدد الأسهم', 'num'],
  forecast_years: ['سنوات التوقع', 'num'],
  note: ['ملاحظة', 'text'],
}

export const CHECK_LABEL = {
  terminal_growth: ['النمو بعد سنوات التوقع أقل من نمو الاقتصاد',
    'لو لم ينجح: التقييم يفترض أن الشركة ستنمو أسرع من الاقتصاد للأبد، وده يرفع العادل أكثر من اللازم.'],
  terminal_share: ['وزن السنوات البعيدة في القيمة',
    'ليس بالضرورة خطأ: معناه أن جزءًا كبيرًا من القيمة يأتي من السنوات البعيدة، فأي تغيير صغير في النمو أو الخصم يحرّك العادل أكثر.'],
  currency_consistency: ['اتساق عملة التدفقات وسعر الخصم',
    'لو لم ينجح: خصم تدفقات بالدولار بسعر خصم بالجنيه (أو العكس) يعطي رقمًا غير صحيح.'],
  price_gap: ['المسافة بين العادل وسعر السوق',
    'الفجوة الكبيرة جدًا تعني أن السوق يرى شيئًا فات التقييم أو أن الافتراضات مبالغ فيها، والتقرير لازم يشرح السبب.'],
  implied_pe: ['مكرر الربحية الضمني (السعر إلى ربح السهم) مقارنة بتاريخه',
    'لو خرج عن نطاقه التاريخي، فالعادل يفترض أن السوق سيقيّم الشركة بطريقة لم يفعلها من قبل.'],
  implied_ev_ebitda: ['مضاعف قيمة المنشأة إلى الربح قبل الفوائد والضرائب والإهلاك (EV/EBITDA) مقارنة بتاريخه',
    'لو خرج عن نطاقه التاريخي، فالعادل يفترض مضاعفًا لم تسجله الشركة من قبل.'],
}

// [name, explanation, reference, value format]
export const RISK_LABEL = {
  car: ['كفاية رأس المال (CAR)', 'نسبة رأس مال البنك إلى أصوله المرجّحة بالمخاطر: كلما زادت زاد أمان المودعين.', 'الحد الأدنى 12.5%', 'pct'],
  cet1: ['الشريحة الأولى من رأس المال (CET1)', 'الجزء الأقوى من رأس المال (أسهم وأرباح محتجزة) ويمتص الخسائر أولًا.', 'أعلى من 10% قوي', 'pct'],
  npl_ratio: ['نسبة القروض المتعثرة (NPL)', 'حصة القروض التي تأخر سدادها طويلًا من إجمالي القروض.', 'أقل من 3% منخفضة · فوق 6% مرتفعة', 'pct'],
  coverage_ratio: ['تغطية المخصصات', 'كم جنيه مخصصات مقابل كل جنيه من القروض المتعثرة.', 'أعلى من 100% يغطيها كاملة', 'pct'],
  lcr: ['السيولة (نسبة تغطية السيولة LCR)', 'قدرة البنك على تلبية سحب الودائع في أزمة قصيرة من أصول سائلة.', 'الحد الأدنى 100%', 'pct'],
  loans_to_deposits: ['القروض إلى الودائع', 'كم من الودائع أقرضه البنك.', 'أقل من 70% متحفظ · فوق 90% مرتفع', 'pct'],
  fx_open_position_to_capital: ['مركز العملة المفتوح إلى رأس المال', 'تعرّض البنك لتغيّر سعر الصرف.', 'أقل من 5% منخفض · فوق 10% مرتفع', 'pct'],
  auditor_qualified_opinion: ['رأي مراقب الحسابات', 'هل للمراجع تحفّظ على القوائم المالية؟', 'التحفّظ إشارة تحذير', 'auditor'],
  // valuations saved before 19/10 list the missing auditor input under this older key
  auditor_opinion: ['رأي مراقب الحسابات', 'هل للمراجع تحفّظ على القوائم المالية؟', 'التحفّظ إشارة تحذير', 'auditor'],
  debt_to_equity: ['الدين إلى حقوق الملكية', 'كم تقترض الشركة مقابل كل جنيه من أموال المساهمين.', 'أقل من 0.5 منخفض · فوق 1.5 مرتفع', 'num'],
  interest_coverage: ['تغطية الفوائد', 'كم مرة يغطي الربح التشغيلي مصروف الفوائد.', 'أعلى من 5 مريح · أقل من 2 ضعيف', 'times'],
  earnings_cv: ['تذبذب الأرباح', 'مدى تقلّب صافي الربح من سنة لأخرى.', 'أقل من 0.25 مستقر · فوق 0.6 متقلب', 'num'],
  avg_daily_traded_value_egp: ['متوسط قيمة التداول اليومي', 'سيولة السهم في السوق: كلما زادت سهل التداول دون تحريك السعر.', 'أكثر من 20 مليون جنيه جيد · أقل من 5 ملايين ضعيف', 'egp'],
  annual_volatility: ['التذبذب السنوي للسعر', 'مدى تقلّب سعر السهم خلال السنة.', 'أقل من 30% هادئ · فوق 50% متقلب', 'pct'],
  dividend_years_paid_of_5: ['سنوات التوزيع من آخر 5', 'كم سنة وزّعت الشركة أرباحًا نقدية في آخر 5 سنوات.', '5 منتظم · 3 أو أقل متقطع', 'num0'],
  valuation_range_width: ['عرض نطاق التقييم', 'الفرق بين المتشائم والمتفائل نسبةً إلى العادل: كلما اتسع زاد عدم اليقين.', 'أقل من 40% ضيق · فوق 80% واسع', 'pct'],
  top_customer_share: ['حصة أكبر عميل', 'اعتماد الإيرادات على عميل واحد.', 'أقل من 15% · فوق 30% تركّز', 'pct'],
  capital_increases_3y: ['زيادات رأس المال في 3 سنوات', 'كم مرة طلبت الشركة أموالًا جديدة من المساهمين.', 'مرة أو أقل · مرتين فأكثر', 'num0'],
  altman_z2: ['Altman Z-Score (مؤشر خطر التعثر)', 'يقيس من الميزانية قرب الشركة من التعثر المالي.', 'آمن · منطقة رمادية · خطر', 'zone'],
  piotroski_f: ['Piotroski F-Score (جودة الأداء المالي)', '9 اختبارات بسيطة للربحية والسيولة والكفاءة.', '7 فأكثر قوي · 3 أو أقل ضعيف', 'num0'],
  beneish_m: ['Beneish M-Score (مؤشر التلاعب المحاسبي)', 'يرصد علامات تجميل الأرقام في القوائم.', 'لا علامات · متابعة · علامة حمراء', 'flag'],
  government_pricing_exposure: ['التعرّض للتسعير الحكومي', 'هل تحدد الحكومة أسعار منتجات الشركة أو مدخلاتها؟', 'التعرّض يرفع المخاطر', 'bool'],
  loss_year_in_5y: ['سنة خسارة في آخر 5 سنوات', 'هل سجلت الشركة خسارة في أي سنة مؤخرًا؟', 'الخسارة ترفع المخاطر', 'bool'],
}

export const BANK_RISK_ORDER = ['car', 'cet1', 'npl_ratio', 'coverage_ratio', 'lcr', 'loans_to_deposits', 'fx_open_position_to_capital', 'auditor_qualified_opinion']
export const QUALITY_SCORES = ['altman_z2', 'piotroski_f', 'beneish_m']

export const RED_FLAG_LABEL = {
  car_below_regulatory_floor: 'كفاية رأس المال تحت الحد الأدنى الرقابي',
  altman_distress_zone: 'مؤشر Altman في منطقة الخطر',
  beneish_possible_manipulation: 'مؤشر Beneish يرصد علامة تلاعب محتملة',
  auditor_qualified_opinion: 'مراقب الحسابات متحفّظ على القوائم',
}

const ZONE = { safe: 'آمن', grey: 'منطقة رمادية', distress: 'خطر' }
const FLAG = { clear: 'لا علامات', watch: 'يحتاج متابعة', red: 'علامة حمراء' }
export const LEVEL_LABEL = ['منخفض', 'متوسط', 'مرتفع']

/** Display text for a risk value, by the format in RISK_LABEL (pass the format string). */
export function riskValue(value, format) {
  if (value == null) return '—'
  switch (format) {
    case 'pct': return fmtPct(value)
    case 'times': return `${fmtNumber(value, 1)}x`
    case 'num0': return fmtNumber(value, 0)
    case 'egp': return value >= 1e6 ? `${fmtNumber(value / 1e6, 0)} مليون جنيه` : `${fmtNumber(value, 0)} جنيه`
    case 'zone': return ZONE[value] || String(value)
    case 'flag': return FLAG[value] || String(value)
    case 'auditor': return value ? 'متحفّظ' : 'غير متحفّظ'
    case 'bool': return value ? 'نعم' : 'لا'
    default: return typeof value === 'number' ? fmtNumber(value, 2) : String(value)
  }
}

/** Display text for an assumption value. Rates are stored as fractions (0.245 → 24.5%). */
export function assumptionValue(value, format) {
  if (value == null) return '—'
  if (typeof value !== 'number') return String(value)
  if (format === 'pct') return fmtPct(value)
  if (format === 'egp') return `${fmtNumber(value, 2)} جنيه`
  return fmtNumber(value, Number.isInteger(value) ? 0 : 2)
}

/** Flattens a stored assumptions object into rows of { key, label, value, source, asOf }. */
export function assumptionRows(assumptions) {
  if (!assumptions || typeof assumptions !== 'object') return []
  return Object.entries(assumptions).map(([key, raw]) => {
    const [label, format] = ASSUMPTION_LABEL[key] || [key.replace(/_/g, ' '), 'num']
    const known = Boolean(ASSUMPTION_LABEL[key])
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { key, label, known, value: assumptionValue(raw.value, format), source: raw.source || null, asOf: raw.as_of || null }
    }
    return { key, label, known, value: Array.isArray(raw) ? raw.join('، ') : assumptionValue(raw, format), source: null, asOf: null }
  })
}

export function methodLabel(key) {
  return METHOD_LABEL[key] || [key.replace(/_/g, ' '), null]
}
