// تقارير محاسبية إضافية (قراءة فقط): الأرباح والخسائر الشهرية، حركة الحسابات الشهرية، دفتر النقدية والبنوك، النسب المالية، وتدقيق القيود.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const S = (val) => ({ val, type: db.oracledb.STRING });
const D = (x) => `TO_DATE(${x}, 'YYYY-MM-DD')`;
function range(req, maxMonths) {
  const f = v.date(req.query.from, 'من تاريخ'), t = v.date(req.query.to, 'إلى تاريخ');
  if (f > t) v.bad('تاريخ البداية بعد النهاية');
  if (maxMonths) {
    const n = (Number(t.slice(0, 4)) - Number(f.slice(0, 4))) * 12 + Number(t.slice(5, 7)) - Number(f.slice(5, 7)) + 1;
    if (n > maxMonths) v.bad('الفترة أطول من ' + maxMonths + ' شهراً: ضيّقها');
  }
  return { f, t };
}
const monthsOf = (f, t) => { const out = []; let y = Number(f.slice(0, 4)), m = Number(f.slice(5, 7)); const ey = Number(t.slice(0, 4)), em = Number(t.slice(5, 7)); while (y < ey || (y === ey && m <= em)) { out.push(y + '-' + String(m).padStart(2, '0')); if (++m > 12) { m = 1; y++; } } return out; };

module.exports = function accReportRoutes() {
  const r = express.Router();

  // قائمة الدخل الشهرية: كل حساب إيراد/مصروف بأعمدة الأشهر (قيود NORMAL فقط كقائمة الدخل)
  r.get('/reports/monthly-pl', wrap(async (req, res) => {
    const p = range(req, 24);
    const rows = await db.query(`
      SELECT a.acc_type AS "type", a.code AS "code", a.name AS "name", TO_CHAR(e.entry_date, 'YYYY-MM') AS "month",
             SUM(CASE WHEN a.acc_type = 'REVENUE' THEN l.credit - l.debit ELSE l.debit - l.credit END) AS "amount"
        FROM erp_accounts a JOIN erp_lines l ON l.account_code = a.code JOIN erp_entries e ON e.entry_id = l.entry_id
       WHERE a.acc_type IN ('REVENUE', 'EXPENSE') AND e.kind = 'NORMAL' AND e.entry_date BETWEEN ${D(':f')} AND ${D(':t')}
       GROUP BY a.acc_type, a.code, a.name, TO_CHAR(e.entry_date, 'YYYY-MM')`, p);
    const months = monthsOf(p.f, p.t), map = new Map();
    for (const x of rows) { const m = map.get(x.code) || { type: x.type, code: x.code, name: x.name, months: {}, total: 0 }; m.months[x.month] = r2((m.months[x.month] || 0) + x.amount); m.total = r2(m.total + x.amount); map.set(x.code, m); }
    const list = [...map.values()].filter((x) => x.total !== 0 || Object.values(x.months).some((a) => a !== 0)).sort((a, b) => (a.type === b.type ? a.code.localeCompare(b.code) : a.type === 'REVENUE' ? -1 : 1));
    const sumBy = (type, mo) => r2(list.filter((x) => x.type === type).reduce((s, x) => s + (mo ? x.months[mo] || 0 : x.total), 0));
    const net = Object.fromEntries(months.map((m) => [m, r2(sumBy('REVENUE', m) - sumBy('EXPENSE', m))]));
    res.json({ months, rows: list, revenue: Object.fromEntries(months.map((m) => [m, sumBy('REVENUE', m)])), expense: Object.fromEntries(months.map((m) => [m, sumBy('EXPENSE', m)])), net,
      totals: { revenue: sumBy('REVENUE'), expense: sumBy('EXPENSE'), net: r2(sumBy('REVENUE') - sumBy('EXPENSE')) } });
  }));

  // حركة الحسابات الشهرية: لكل حساب الرصيد الافتتاحي (مدين − دائن) وصافي حركة كل شهر والرصيد الختامي
  r.get('/reports/account-activity', wrap(async (req, res) => {
    const p = range(req, 12);
    const type = req.query.type ? String(req.query.type) : null;
    if (type && !['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(type)) v.bad('نوع الحساب غير صالح');
    const rows = await db.query(`
      SELECT a.code AS "code", a.name AS "name", a.acc_type AS "type", TO_CHAR(e.entry_date, 'YYYY-MM') AS "month",
             SUM(CASE WHEN e.entry_date < ${D(':f')} THEN l.debit - l.credit ELSE 0 END) AS "open",
             SUM(CASE WHEN e.entry_date >= ${D(':f')} THEN l.debit - l.credit ELSE 0 END) AS "net"
        FROM erp_accounts a JOIN erp_lines l ON l.account_code = a.code JOIN erp_entries e ON e.entry_id = l.entry_id
       WHERE e.entry_date <= ${D(':t')} AND (:ty IS NULL OR a.acc_type = :ty)
       GROUP BY a.code, a.name, a.acc_type, CASE WHEN e.entry_date < ${D(':f')} THEN 'OPEN' ELSE TO_CHAR(e.entry_date, 'YYYY-MM') END, TO_CHAR(e.entry_date, 'YYYY-MM')`, { ...p, ty: S(type) });
    const months = monthsOf(p.f, p.t), map = new Map();
    for (const x of rows) {
      const m = map.get(x.code) || { code: x.code, name: x.name, type: x.type, open: 0, months: {}, close: 0 };
      m.open = r2(m.open + x.open); if (x.net) m.months[x.month] = r2((m.months[x.month] || 0) + x.net);
      map.set(x.code, m);
    }
    const list = [...map.values()].map((m) => ({ ...m, close: r2(m.open + Object.values(m.months).reduce((s, a) => s + a, 0)) })).filter((m) => m.open !== 0 || m.close !== 0 || Object.keys(m.months).length).sort((a, b) => a.code.localeCompare(b.code));
    const colTotals = Object.fromEntries(months.map((mo) => [mo, r2(list.reduce((s, x) => s + (x.months[mo] || 0), 0))]));
    res.json({ months, rows: list, colTotals, totals: { open: r2(list.reduce((s, x) => s + x.open, 0)), close: r2(list.reduce((s, x) => s + x.close, 0)) } });
  }));

  // دفتر النقدية والبنوك: لكل حساب نقدي رصيد أول الفترة والمقبوضات والمدفوعات ثم الرصيد، وتفصيل يومي
  r.get('/reports/cash-book', wrap(async (req, res) => {
    const p = range(req);
    const accts = await db.query(`SELECT code AS "code", name AS "name" FROM erp_accounts WHERE cash_account = 'Y' ORDER BY code`);
    const out = [];
    for (const a of accts) {
      const [op] = await db.query(`SELECT NVL(SUM(l.debit - l.credit), 0) AS "v" FROM erp_lines l JOIN erp_entries e ON e.entry_id = l.entry_id WHERE l.account_code = :c AND e.entry_date < ${D(':f')}`, { c: a.code, f: p.f });
      const days = await db.query(`SELECT TO_CHAR(e.entry_date, 'YYYY-MM-DD') AS "date", SUM(l.debit) AS "debit", SUM(l.credit) AS "credit" FROM erp_lines l JOIN erp_entries e ON e.entry_id = l.entry_id
        WHERE l.account_code = :c AND e.entry_date BETWEEN ${D(':f')} AND ${D(':t')} GROUP BY e.entry_date ORDER BY e.entry_date`, { c: a.code, f: p.f, t: p.t });
      let bal = r2(op.v); const rows = days.map((d) => { bal = r2(bal + d.debit - d.credit); return { date: d.date, debit: r2(d.debit), credit: r2(d.credit), balance: bal }; });
      out.push({ code: a.code, name: a.name, opening: r2(op.v), debit: r2(days.reduce((s, d) => s + d.debit, 0)), credit: r2(days.reduce((s, d) => s + d.credit, 0)), closing: bal, days: rows });
    }
    const t = (k) => r2(out.reduce((s, x) => s + x[k], 0));
    res.json({ accounts: out, totals: { opening: t('opening'), debit: t('debit'), credit: t('credit'), closing: t('closing') } });
  }));

  // النسب المالية الأساسية للفترة اعتماداً على رموز حسابات النظام (العملاء 1300، المخزون 1400، الموردون 2100، تكلفة المبيعات 5100)
  r.get('/reports/ratios', wrap(async (req, res) => {
    const p = range(req);
    const days = Math.round((Date.parse(p.t) - Date.parse(p.f)) / 86400000) + 1;
    const [pl] = await db.query(`
      SELECT NVL(SUM(CASE WHEN a.acc_type = 'REVENUE' THEN l.credit - l.debit END), 0) AS "revenue",
             NVL(SUM(CASE WHEN a.acc_type = 'EXPENSE' THEN l.debit - l.credit END), 0) AS "expense",
             NVL(SUM(CASE WHEN a.code = '5100' THEN l.debit - l.credit END), 0) AS "cogs"
        FROM erp_lines l JOIN erp_accounts a ON a.code = l.account_code JOIN erp_entries e ON e.entry_id = l.entry_id
       WHERE e.kind = 'NORMAL' AND e.entry_date BETWEEN ${D(':f')} AND ${D(':t')}`, p);
    const [bs] = await db.query(`
      SELECT NVL(SUM(CASE WHEN a.code = '1300' THEN l.debit - l.credit END), 0) AS "ar", NVL(SUM(CASE WHEN a.code = '1400' THEN l.debit - l.credit END), 0) AS "inventory",
             NVL(SUM(CASE WHEN a.code = '2100' THEN l.credit - l.debit END), 0) AS "ap", NVL(SUM(CASE WHEN a.cash_account = 'Y' THEN l.debit - l.credit END), 0) AS "cash",
             NVL(SUM(CASE WHEN a.acc_type = 'LIABILITY' THEN l.credit - l.debit END), 0) AS "liabilities"
        FROM erp_lines l JOIN erp_accounts a ON a.code = l.account_code JOIN erp_entries e ON e.entry_id = l.entry_id WHERE e.entry_date <= ${D(':t')}`, { t: p.t });
    const rev = r2(pl.revenue), exp = r2(pl.expense), cogs = r2(pl.cogs), net = r2(rev - exp), gross = r2(rev - cogs);
    const pct = (a, b) => (b ? r2(a / b * 100) : null), per = (a, b) => (b ? r2(a / b * days) : null);
    res.json({ days, base: { revenue: rev, cogs, grossProfit: gross, expense: exp, net, ar: r2(bs.ar), inventory: r2(bs.inventory), ap: r2(bs.ap), cash: r2(bs.cash), liabilities: r2(bs.liabilities) },
      ratios: { grossMargin: pct(gross, rev), netMargin: pct(net, rev), expenseRatio: pct(exp, rev), dso: per(bs.ar, rev), dio: per(bs.inventory, cogs), dpo: per(bs.ap, cogs), quick: bs.liabilities ? r2((bs.cash + bs.ar) / bs.liabilities) : null } });
  }));

  // تدقيق القيود: القيود المعكوسة (الأصل والعكس) وقيود الإقفال وعدد القيود بلا مرجع (غالباً يدوية) لكل شهر
  r.get('/reports/journal-audit', wrap(async (req, res) => {
    const p = range(req);
    const reversals = await db.query(`
      SELECT o.entry_id AS "id", TO_CHAR(o.entry_date, 'YYYY-MM-DD') AS "date", o.memo AS "memo", r.entry_id AS "reversalId", TO_CHAR(r.entry_date, 'YYYY-MM-DD') AS "reversalDate",
             (SELECT NVL(SUM(l.debit), 0) FROM erp_lines l WHERE l.entry_id = o.entry_id) AS "amount"
        FROM erp_entries o JOIN erp_entries r ON r.void_of = o.entry_id WHERE o.entry_date BETWEEN ${D(':f')} AND ${D(':t')} ORDER BY o.entry_date, o.entry_id`, p);
    const closing = await db.query(`SELECT e.entry_id AS "id", TO_CHAR(e.entry_date, 'YYYY-MM-DD') AS "date", e.memo AS "memo", (SELECT NVL(SUM(l.debit), 0) FROM erp_lines l WHERE l.entry_id = e.entry_id) AS "amount"
        FROM erp_entries e WHERE e.kind = 'CLOSING' AND e.entry_date BETWEEN ${D(':f')} AND ${D(':t')} ORDER BY e.entry_date`, p);
    const monthly = await db.query(`SELECT TO_CHAR(e.entry_date, 'YYYY-MM') AS "month", COUNT(*) AS "entries", SUM(CASE WHEN e.ref IS NULL THEN 1 ELSE 0 END) AS "noRef", SUM(CASE WHEN e.void_of IS NOT NULL THEN 1 ELSE 0 END) AS "reversals"
        FROM erp_entries e WHERE e.entry_date BETWEEN ${D(':f')} AND ${D(':t')} GROUP BY TO_CHAR(e.entry_date, 'YYYY-MM') ORDER BY 1`, p);
    res.json({ reversals: reversals.map((x) => ({ ...x, amount: r2(x.amount) })), closing: closing.map((x) => ({ ...x, amount: r2(x.amount) })), monthly,
      totals: { entries: monthly.reduce((s, x) => s + x.entries, 0), noRef: monthly.reduce((s, x) => s + x.noRef, 0), reversals: reversals.length, closing: closing.length } });
  }));
  return r;
};
