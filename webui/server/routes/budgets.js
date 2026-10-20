// مراكز التكلفة والموازنات: إدارة المراكز، إدخال الموازنة الشهرية، وتقارير الموازنة مقابل الفعلي وربحية المراكز (التقارير قراءة فقط).
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const S = (val) => ({ val, type: db.oracledb.STRING });
const D = (x) => `TO_DATE(${x}, 'YYYY-MM-DD')`;
const year = (x) => v.int(x, 'السنة', { min: 2000 }) <= 2200 ? Number(x) : v.bad('السنة غير صالحة');
const cc = (x) => (x === undefined || x === null || x === '' ? 0 : v.int(x, 'مركز التكلفة', { min: 0 }));

module.exports = function budgetRoutes() {
  const r = express.Router();

  // ---------- مراكز التكلفة ----------
  r.get('/cost-centers', wrap(async (req, res) => {
    res.json({ centers: await db.query(`SELECT c.cc_id AS "id", c.code AS "code", c.name AS "name", c.active AS "active",
      (SELECT COUNT(*) FROM erp_line_cc t WHERE t.cc_id = c.cc_id) AS "lines" FROM erp_cost_centers c ORDER BY c.code`) });
  }));
  r.post('/cost-centers', wrap(async (req, res) => {
    const b = req.body || {};
    const code = v.str(b.code, 'الرمز', { max: 20 }), name = v.str(b.name, 'الاسم', { max: 120 });
    const out = await db.run('INSERT INTO erp_cost_centers (code, name) VALUES (:c, :n) RETURNING cc_id INTO :id', { c: code, n: name, id: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } });
    res.status(201).json({ id: out.outBinds.id[0] ?? out.outBinds.id });
  }));
  r.patch('/cost-centers/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'المركز'), b = req.body || {};
    const name = b.name === undefined ? null : v.str(b.name, 'الاسم', { max: 120 }), active = b.active === undefined ? null : (b.active ? 'Y' : 'N');
    if (name === null && active === null) v.bad('لا تغيير مطلوب');
    const r1 = await db.run('UPDATE erp_cost_centers SET name = NVL(:n, name), active = NVL(:a, active) WHERE cc_id = :id', { n: name, a: active, id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'المركز غير موجود');
    res.json({ ok: true });
  }));
  r.delete('/cost-centers/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'المركز');
    const [u] = await db.query('SELECT COUNT(*) AS "n" FROM erp_line_cc WHERE cc_id = :id', { id });
    if (u.n) throw new db.HttpError(409, 'المركز مستخدم في قيود: عطّله بدلاً من حذفه');
    await db.run('DELETE FROM erp_budgets WHERE cc_id = :id', { id });
    const r1 = await db.run('DELETE FROM erp_cost_centers WHERE cc_id = :id', { id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'المركز غير موجود');
    res.json({ ok: true });
  }));

  // ---------- إدخال الموازنة ----------
  // حسابات الإيراد والمصروف الطرفية (بلا أبناء) بمبالغها الشهرية لسنة ومركز (0 = المنشأة كلها)
  r.get('/budgets/:year', wrap(async (req, res) => {
    const y = year(req.params.year), c = cc(req.query.cc);
    const accts = await db.query(`SELECT a.code AS "code", a.name AS "name", a.acc_type AS "type" FROM erp_accounts a
      WHERE a.acc_type IN ('REVENUE', 'EXPENSE') AND a.active = 'Y' AND NOT EXISTS (SELECT 1 FROM erp_accounts k WHERE k.parent_code = a.code) ORDER BY a.acc_type DESC, a.code`);
    const rows = await db.query('SELECT account_code AS "code", month_no AS "m", amount AS "amount" FROM erp_budgets WHERE year_no = :y AND cc_id = :c', { y, c });
    const by = new Map();
    for (const x of rows) { if (!by.has(x.code)) by.set(x.code, Array(12).fill(0)); by.get(x.code)[x.m - 1] = x.amount; }
    res.json({ year: y, cc: c, rows: accts.map((a) => ({ ...a, months: by.get(a.code) || Array(12).fill(0) })) });
  }));
  // استبدال موازنة سنة ومركز كاملة بما يُرسَل (القيم الصفرية لا تُخزَّن)
  r.put('/budgets/:year', wrap(async (req, res) => {
    const y = year(req.params.year), b = req.body || {}, c = cc(b.cc);
    if (c) { const [x] = await db.query('SELECT COUNT(*) AS "n" FROM erp_cost_centers WHERE cc_id = :c', { c }); if (!x.n) v.bad('مركز التكلفة غير موجود'); }
    if (!Array.isArray(b.rows) || b.rows.length > 500) v.bad('بيانات الموازنة غير صالحة');
    const ok = new Set((await db.query("SELECT code AS \"code\" FROM erp_accounts WHERE acc_type IN ('REVENUE', 'EXPENSE')")).map((x) => x.code));
    const binds = [];
    b.rows.forEach((row, i) => {
      const code = v.str(row.account, `حساب الصف ${i + 1}`, { max: 12 });
      if (!ok.has(code)) v.bad(`الحساب ${code} ليس إيراداً ولا مصروفاً`);
      if (!Array.isArray(row.months) || row.months.length !== 12) v.bad(`أشهر الحساب ${code} يجب أن تكون 12`);
      row.months.forEach((a, m) => { const amt = v.money(a, `${code} شهر ${m + 1}`); if (amt > 0) binds.push({ y, code, c, m: m + 1, amt }); });
    });
    await db.withConn(async (conn) => {
      try {
        await conn.execute('DELETE FROM erp_budgets WHERE year_no = :y AND cc_id = :c', { y, c });
        if (binds.length) await conn.executeMany('INSERT INTO erp_budgets (year_no, account_code, cc_id, month_no, amount) VALUES (:y, :code, :c, :m, :amt)', binds);
        await conn.commit();
      } catch (e) { await conn.rollback(); throw e; }
    });
    res.json({ ok: true, cells: binds.length });
  }));

  // ---------- الموازنة مقابل الفعلي ----------
  // الفعلي من قيود NORMAL (كقائمة الدخل) من بداية السنة حتى نهاية الشهر المحدد؛ مع مركز محدد يُحسب الفعلي لأسطره فقط
  r.get('/reports/budget-vs-actual', wrap(async (req, res) => {
    const y = year(req.query.year), c = cc(req.query.cc), to = v.int(req.query.month, 'الشهر');
    if (to > 12) v.bad('الشهر غير صالح');
    const from = v.int(req.query.fromMonth || 1, 'من شهر');
    if (from > to) v.bad('شهر البداية بعد النهاية');
    const f = `${y}-${String(from).padStart(2, '0')}-01`, t = `${y}-${String(to).padStart(2, '0')}-31`;
    const bud = await db.query(`SELECT b.account_code AS "code", a.name AS "name", a.acc_type AS "type", b.month_no AS "m", b.amount AS "amount"
      FROM erp_budgets b JOIN erp_accounts a ON a.code = b.account_code WHERE b.year_no = :y AND b.cc_id = :c AND b.month_no BETWEEN :f AND :t`, { y, c, f: from, t: to });
    const act = await db.query(`
      SELECT a.code AS "code", a.name AS "name", a.acc_type AS "type", EXTRACT(MONTH FROM l.entry_date) AS "m",
             SUM(CASE WHEN a.acc_type = 'REVENUE' THEN l.credit - l.debit ELSE l.debit - l.credit END) AS "amount"
        FROM v_erp_line_cc l JOIN erp_accounts a ON a.code = l.account_code
       WHERE a.acc_type IN ('REVENUE', 'EXPENSE') AND l.kind = 'NORMAL' AND l.entry_date BETWEEN ${D(':f')} AND LAST_DAY(${D(':t2')})
         AND (:c = 0 OR l.cc_id = :c)
       GROUP BY a.code, a.name, a.acc_type, EXTRACT(MONTH FROM l.entry_date)`, { f, t2: `${y}-${String(to).padStart(2, '0')}-01`, c });
    const map = new Map();
    const row = (x) => { if (!map.has(x.code)) map.set(x.code, { code: x.code, name: x.name, type: x.type, budget: 0, actual: 0, months: {} }); return map.get(x.code); };
    for (const x of bud) { const a = row(x); a.budget = r2(a.budget + x.amount); (a.months[x.m] = a.months[x.m] || { budget: 0, actual: 0 }).budget = x.amount; }
    for (const x of act) { const a = row(x); a.actual = r2(a.actual + x.amount); (a.months[x.m] = a.months[x.m] || { budget: 0, actual: 0 }).actual = r2(x.amount); }
    const rows = [...map.values()].filter((x) => x.budget !== 0 || x.actual !== 0).sort((a, b) => (a.type === b.type ? a.code.localeCompare(b.code) : a.type === 'REVENUE' ? -1 : 1))
      .map((x) => { const diff = r2(x.actual - x.budget); return { ...x, diff, pct: x.budget ? r2(x.actual / x.budget * 100) : null, favorable: x.type === 'REVENUE' ? diff >= 0 : diff <= 0 }; });
    const sum = (type, k) => r2(rows.filter((x) => x.type === type).reduce((s, x) => s + x[k], 0));
    const monthly = [];
    for (let m = from; m <= to; m++) {
      const g = (type, k) => r2(rows.filter((x) => x.type === type).reduce((s, x) => s + ((x.months[m] || {})[k] || 0), 0));
      monthly.push({ month: m, revBudget: g('REVENUE', 'budget'), revActual: g('REVENUE', 'actual'), expBudget: g('EXPENSE', 'budget'), expActual: g('EXPENSE', 'actual') });
    }
    const T = { revBudget: sum('REVENUE', 'budget'), revActual: sum('REVENUE', 'actual'), expBudget: sum('EXPENSE', 'budget'), expActual: sum('EXPENSE', 'actual') };
    T.netBudget = r2(T.revBudget - T.expBudget); T.netActual = r2(T.revActual - T.expActual);
    res.json({ year: y, cc: c, rows: rows.map(({ months, ...x }) => x), monthly, totals: T });
  }));

  // ---------- ربحية مراكز التكلفة ----------
  // ملخص كل المركز (إيراد/مصروف/صافي) مع «غير موزّع» لأسطر بلا مركز؛ ومع مركز محدد تفصيل حساباته
  r.get('/reports/cost-center-pl', wrap(async (req, res) => {
    const f = v.date(req.query.from, 'من تاريخ'), t = v.date(req.query.to, 'إلى تاريخ'), c = req.query.cc === undefined || req.query.cc === '' ? null : cc(req.query.cc);
    if (f > t) v.bad('تاريخ البداية بعد النهاية');
    const rows = await db.query(`
      SELECT NVL(l.cc_id, 0) AS "cc", a.code AS "code", a.name AS "name", a.acc_type AS "type",
             SUM(CASE WHEN a.acc_type = 'REVENUE' THEN l.credit - l.debit ELSE l.debit - l.credit END) AS "amount"
        FROM v_erp_line_cc l JOIN erp_accounts a ON a.code = l.account_code
       WHERE a.acc_type IN ('REVENUE', 'EXPENSE') AND l.kind = 'NORMAL' AND l.entry_date BETWEEN ${D(':f')} AND ${D(':t')}
       GROUP BY NVL(l.cc_id, 0), a.code, a.name, a.acc_type`, { f, t });
    const centers = await db.query('SELECT cc_id AS "id", code AS "code", name AS "name" FROM erp_cost_centers ORDER BY code');
    const names = new Map(centers.map((x) => [x.id, x])); names.set(0, { id: 0, code: '—', name: 'غير موزّع' });
    const sums = new Map();
    for (const x of rows) { const s = sums.get(x.cc) || { id: x.cc, revenue: 0, expense: 0 }; if (x.type === 'REVENUE') s.revenue = r2(s.revenue + x.amount); else s.expense = r2(s.expense + x.amount); sums.set(x.cc, s); }
    const summary = [...sums.values()].map((s) => ({ ...s, code: (names.get(s.id) || {}).code, name: (names.get(s.id) || {}).name || '؟', net: r2(s.revenue - s.expense), margin: s.revenue ? r2((s.revenue - s.expense) / s.revenue * 100) : null }))
      .filter((s) => s.revenue !== 0 || s.expense !== 0).sort((a, b) => (a.id === 0) - (b.id === 0) || String(a.code).localeCompare(String(b.code)));
    const tot = (k) => r2(summary.reduce((s, x) => s + x[k], 0));
    const out = { summary, totals: { revenue: tot('revenue'), expense: tot('expense'), net: tot('net') } };
    if (c !== null) out.detail = rows.filter((x) => x.cc === c && x.amount !== 0).map(({ cc: _c, ...x }) => x).sort((a, b) => (a.type === b.type ? a.code.localeCompare(b.code) : a.type === 'REVENUE' ? -1 : 1));
    res.json(out);
  }));

  return r;
};
