// القوائم والتقارير المالية: استعلامات قراءة فقط بنفس منطق oracle/reports/*.sql، وأرقام الملخص من ERP_FIN.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const S = (val) => ({ val, type: db.oracledb.STRING });

module.exports = function reportRoutes() {
  const r = express.Router();

  // ميزان المراجعة حتى تاريخ (اختياري)
  r.get('/reports/trial-balance', wrap(async (req, res) => {
    const to = v.date(req.query.to, 'حتى تاريخ', { optional: true });
    const rows = await db.query(`
      SELECT a.code AS "code", a.name AS "name", a.acc_type AS "type",
             SUM(l.debit) AS "debit", SUM(l.credit) AS "credit",
             GREATEST(SUM(l.debit) - SUM(l.credit), 0) AS "balanceDebit",
             GREATEST(SUM(l.credit) - SUM(l.debit), 0) AS "balanceCredit"
        FROM erp_accounts a
        JOIN erp_lines l   ON l.account_code = a.code
        JOIN erp_entries e ON e.entry_id = l.entry_id AND (:to_d IS NULL OR e.entry_date <= TO_DATE(:to_d, 'YYYY-MM-DD'))
       GROUP BY a.code, a.name, a.acc_type ORDER BY a.code`, { to_d: S(to) });
    const t = rows.reduce((s, x) => ({
      debit: s.debit + x.debit, credit: s.credit + x.credit,
      balanceDebit: s.balanceDebit + x.balanceDebit, balanceCredit: s.balanceCredit + x.balanceCredit,
    }), { debit: 0, credit: 0, balanceDebit: 0, balanceCredit: 0 });
    const round = (n) => Math.round(n * 100) / 100;
    for (const k of Object.keys(t)) t[k] = round(t[k]);
    res.json({ rows, totals: t, balanced: t.debit === t.credit });
  }));

  // دفتر الأستاذ لحساب برصيد جارٍ بالجانب الطبيعي
  r.get('/reports/ledger/:code', wrap(async (req, res) => {
    const code = v.str(req.params.code, 'الحساب', { max: 12 });
    const from = v.date(req.query.from, 'من تاريخ', { optional: true });
    const to = v.date(req.query.to, 'إلى تاريخ', { optional: true });
    const acc = await db.query('SELECT code AS "code", name AS "name", acc_type AS "type" FROM erp_accounts WHERE code = :c', { c: code });
    if (!acc.length) throw new db.HttpError(404, 'الحساب غير موجود');
    const sign = ['ASSET', 'EXPENSE'].includes(acc[0].type) ? 1 : -1;
    const opening = from
      ? (await db.query(`SELECT NVL(SUM(l.debit - l.credit), 0) AS "v" FROM erp_lines l JOIN erp_entries e ON e.entry_id = l.entry_id
                          WHERE l.account_code = :c AND e.entry_date < TO_DATE(:f, 'YYYY-MM-DD')`, { c: code, f: from }))[0].v * sign
      : 0;
    const moves = await db.query(`
      SELECT e.entry_id AS "entryId", TO_CHAR(e.entry_date, 'YYYY-MM-DD') AS "date", e.memo AS "memo", e.ref AS "ref",
             l.debit AS "debit", l.credit AS "credit"
        FROM erp_lines l JOIN erp_entries e ON e.entry_id = l.entry_id
       WHERE l.account_code = :c
         AND (:f IS NULL OR e.entry_date >= TO_DATE(:f, 'YYYY-MM-DD'))
         AND (:t IS NULL OR e.entry_date <= TO_DATE(:t, 'YYYY-MM-DD'))
       ORDER BY e.entry_date, e.entry_id, l.line_id`, { c: code, f: S(from), t: S(to) });
    let run = Math.round(opening * 100) / 100;
    const rows = moves.map((m) => {
      run = Math.round((run + (m.debit - m.credit) * sign) * 100) / 100;
      return { ...m, balance: run };
    });
    res.json({ account: acc[0], opening: Math.round(opening * 100) / 100, rows, closing: run });
  }));

  // قائمة الدخل: قيود NORMAL فقط (تُستبعد قيود إقفال السنة)
  r.get('/reports/income-statement', wrap(async (req, res) => {
    const from = v.date(req.query.from, 'من تاريخ');
    const to = v.date(req.query.to, 'إلى تاريخ');
    const rows = await db.query(`
      SELECT a.acc_type AS "type", a.code AS "code", a.name AS "name",
             SUM(CASE WHEN a.acc_type = 'REVENUE' THEN l.credit - l.debit ELSE l.debit - l.credit END) AS "amount"
        FROM erp_accounts a
        JOIN erp_lines l   ON l.account_code = a.code
        JOIN erp_entries e ON e.entry_id = l.entry_id
       WHERE a.acc_type IN ('REVENUE', 'EXPENSE') AND e.kind = 'NORMAL'
         AND e.entry_date BETWEEN TO_DATE(:f, 'YYYY-MM-DD') AND TO_DATE(:t, 'YYYY-MM-DD')
       GROUP BY a.acc_type, a.code, a.name
      HAVING SUM(l.credit - l.debit) <> 0
       ORDER BY a.acc_type DESC, a.code`, { f: from, t: to });
    const revenue = rows.filter((x) => x.type === 'REVENUE');
    const expense = rows.filter((x) => x.type === 'EXPENSE');
    const sum = (a) => Math.round(a.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    res.json({ revenue, expense, totalRevenue: sum(revenue), totalExpense: sum(expense),
               netIncome: Math.round((sum(revenue) - sum(expense)) * 100) / 100 });
  }));

  // الميزانية: كل القيود حتى التاريخ، وما لم يُقفَل من أرباح بنداً مستقلاً فتتوازن دائماً
  r.get('/reports/balance-sheet', wrap(async (req, res) => {
    const asof = v.date(req.query.asof, 'بتاريخ');
    const rows = await db.query(`
      SELECT a.acc_type AS "type", a.code AS "code", a.name AS "name",
             SUM(CASE WHEN a.acc_type = 'ASSET' THEN l.debit - l.credit ELSE l.credit - l.debit END) AS "amount"
        FROM erp_accounts a
        JOIN erp_lines l   ON l.account_code = a.code
        JOIN erp_entries e ON e.entry_id = l.entry_id
       WHERE a.acc_type IN ('ASSET', 'LIABILITY', 'EQUITY') AND e.entry_date <= TO_DATE(:d, 'YYYY-MM-DD')
       GROUP BY a.acc_type, a.code, a.name
      HAVING SUM(l.debit - l.credit) <> 0
       ORDER BY a.code`, { d: asof });
    const unclosed = (await db.query('SELECT erp_fin.unclosed_earnings(TO_DATE(:d, \'YYYY-MM-DD\')) AS "v" FROM dual', { d: asof }))[0].v;
    const part = (t) => rows.filter((x) => x.type === t);
    const sum = (a) => Math.round(a.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    const assets = part('ASSET'), liabilities = part('LIABILITY'), equity = part('EQUITY');
    const totalAssets = sum(assets);
    const totalLiab = sum(liabilities);
    const totalEquity = Math.round((sum(equity) + unclosed) * 100) / 100;
    res.json({ assets, liabilities, equity, unclosedEarnings: unclosed, totalAssets, totalLiabilities: totalLiab,
               totalEquity, balanced: Math.round((totalAssets - totalLiab - totalEquity) * 100) === 0 });
  }));

  // التدفقات النقدية بالطريقة المباشرة (ERP_FIN)
  r.get('/reports/cash-flow', wrap(async (req, res) => {
    const from = v.date(req.query.from, 'من تاريخ');
    const to = v.date(req.query.to, 'إلى تاريخ');
    const row = (await db.query(`
      SELECT erp_fin.cash_balance(TO_DATE(:f, 'YYYY-MM-DD') - 1) AS "opening",
             erp_fin.cash_flow(TO_DATE(:f, 'YYYY-MM-DD'), TO_DATE(:t, 'YYYY-MM-DD'), 'OPERATING') AS "operating",
             erp_fin.cash_flow(TO_DATE(:f, 'YYYY-MM-DD'), TO_DATE(:t, 'YYYY-MM-DD'), 'INVESTING') AS "investing",
             erp_fin.cash_flow(TO_DATE(:f, 'YYYY-MM-DD'), TO_DATE(:t, 'YYYY-MM-DD'), 'FINANCING') AS "financing",
             erp_fin.cash_balance(TO_DATE(:t, 'YYYY-MM-DD')) AS "closing"
        FROM dual`, { f: from, t: to }))[0];
    res.json({ ...row, reconciled: Math.round((row.opening + row.operating + row.investing + row.financing - row.closing) * 100) === 0 });
  }));

  // ملخص اللوحة الرئيسية
  r.get('/summary', wrap(async (req, res) => {
    const row = (await db.query(`
      SELECT (SELECT COUNT(*) FROM erp_accounts) AS "accounts",
             (SELECT COUNT(*) FROM erp_entries) AS "entries",
             (SELECT COUNT(*) FROM v_erp_unbalanced_entries) AS "unbalanced",
             erp_fin.cash_balance(NULL) AS "cash",
             erp_fin.unclosed_earnings(NULL) AS "unclosedEarnings",
             (SELECT COUNT(*) FROM erp_periods WHERE status = 'CLOSED') AS "closedMonths"
        FROM dual`))[0];
    res.json(row);
  }));

  return r;
};
