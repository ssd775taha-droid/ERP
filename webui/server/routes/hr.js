// الموارد البشرية (أقسام، موظفون، رواتب أساسية، مكوّنات، تسويات، سلف) وكشوف الرواتب. كل الترحيل عبر ERP_HR وERP_PAYROLL.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const OUT = (type) => ({ dir: db.oracledb.BIND_OUT, type });
const N = db.oracledb.NUMBER;
const monthStart = (s, label) => { const d = v.date(s, label); if (!d.endsWith('-01')) v.bad(`${label} يجب أن يكون أول الشهر`); return d; };
const pos = (x, label) => { const n = v.money(x, label); if (n <= 0) v.bad(`${label} يجب أن يكون أكبر من صفر`); return n; };
function pct(x, label) {
  if (x === undefined || x === null || x === '') return null;
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0 || n > 100) v.bad(`${label}: نسبة غير صالحة`);
  return n;
}

module.exports = function hrRoutes() {
  const r = express.Router();

  // ---------- الأقسام ----------
  r.get('/hr/departments', wrap(async (req, res) => {
    res.json({ departments: await db.query(`SELECT d.dept_id AS "id", d.code AS "code", d.name AS "name", d.active AS "active",
      (SELECT COUNT(*) FROM erp_employees e WHERE e.dept_id = d.dept_id AND e.status = 'ACTIVE') AS "employees" FROM erp_departments d ORDER BY d.code`) });
  }));
  r.post('/hr/departments', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run('BEGIN :id := erp_hr.add_department(:c, :n); END;', { c: v.str(b.code, 'رمز القسم', { max: 12 }), n: v.str(b.name, 'اسم القسم', { max: 120 }), id: OUT(N) });
    res.status(201).json({ id: out.outBinds.id });
  }));

  // ---------- الموظفون ----------
  r.get('/hr/employees', wrap(async (req, res) => {
    res.json({ employees: await db.query(`
      SELECT emp_id AS "id", code AS "code", name AS "name", job_title AS "jobTitle", dept_name AS "deptName",
             TO_CHAR(hire_date, 'YYYY-MM-DD') AS "hireDate", TO_CHAR(term_date, 'YYYY-MM-DD') AS "termDate", status AS "status", current_basic AS "basic"
        FROM v_erp_employee ORDER BY code`) });
  }));

  r.post('/hr/employees', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run("BEGIN :id := erp_hr.add_employee(:c, :n, TO_DATE(:h, 'YYYY-MM-DD'), :s, :d, :j, :nid, :ba); END;", {
      c: v.str(b.code, 'رمز الموظف', { max: 20 }), n: v.str(b.name, 'الاسم', { max: 120 }), h: v.date(b.hireDate, 'تاريخ التعيين'), s: pos(b.basic, 'الراتب الأساسي'),
      d: { val: v.int(b.deptId, 'القسم', { optional: true }), type: N }, j: v.str(b.jobTitle, 'الوظيفة', { max: 80, optional: true }),
      nid: v.str(b.nationalId, 'رقم الهوية', { max: 30, optional: true }), ba: v.str(b.bankAccount, 'الحساب البنكي', { max: 60, optional: true }), id: OUT(N) });
    res.status(201).json({ id: out.outBinds.id });
  }));

  r.get('/hr/employees/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الموظف');
    const e = await db.query(`SELECT e.emp_id AS "id", e.code AS "code", e.name AS "name", e.job_title AS "jobTitle", d.name AS "deptName", e.national_id AS "nationalId",
        e.bank_account AS "bankAccount", TO_CHAR(e.hire_date, 'YYYY-MM-DD') AS "hireDate", TO_CHAR(e.term_date, 'YYYY-MM-DD') AS "termDate", e.status AS "status"
      FROM erp_employees e LEFT JOIN erp_departments d ON d.dept_id = e.dept_id WHERE e.emp_id = :id`, { id });
    if (!e.length) throw new db.HttpError(404, 'الموظف غير موجود');
    const salary = await db.query(`SELECT TO_CHAR(effective_from, 'YYYY-MM') AS "from", basic_salary AS "basic" FROM erp_salary_history WHERE emp_id = :id ORDER BY effective_from DESC`, { id });
    const comps = await db.query(`SELECT c.comp_id AS "compId", c.code AS "code", c.name AS "name", c.kind AS "kind", c.calc_type AS "calcType", ec.amount AS "amount", NVL(ec.pct, c.pct) AS "pct"
      FROM erp_emp_components ec JOIN erp_pay_components c ON c.comp_id = ec.comp_id WHERE ec.emp_id = :id ORDER BY c.code`, { id });
    res.json({ employee: { ...e[0], salary, components: comps } });
  }));

  r.post('/hr/employees/:id/salary', wrap(async (req, res) => {
    const b = req.body || {};
    await db.run("BEGIN erp_hr.set_salary(:id, :s, TO_DATE(:f, 'YYYY-MM-DD')); END;", { id: v.int(req.params.id, 'رقم الموظف'), s: pos(b.basic, 'الراتب'), f: monthStart(b.from, 'تاريخ السريان') });
    res.json({ ok: true });
  }));
  r.post('/hr/employees/:id/terminate', wrap(async (req, res) => {
    await db.run("BEGIN erp_hr.terminate(:id, TO_DATE(:d, 'YYYY-MM-DD')); END;", { id: v.int(req.params.id, 'رقم الموظف'), d: v.date((req.body || {}).date, 'تاريخ إنهاء الخدمة') });
    res.json({ ok: true });
  }));
  r.post('/hr/employees/:id/components', wrap(async (req, res) => {
    const b = req.body || {};
    const amount = b.amount === undefined || b.amount === null || b.amount === '' ? null : v.money(b.amount, 'المبلغ');
    await db.run('BEGIN erp_hr.assign_component(:e, :c, :a, :p); END;', {
      e: v.int(req.params.id, 'رقم الموظف'), c: v.int(b.compId, 'المكوّن'), a: { val: amount, type: N }, p: { val: pct(b.pct, 'النسبة'), type: N } });
    res.json({ ok: true });
  }));
  r.post('/hr/employees/:id/components/:comp/remove', wrap(async (req, res) => {
    await db.run('BEGIN erp_hr.unassign_component(:e, :c); END;', { e: v.int(req.params.id, 'رقم الموظف'), c: v.int(req.params.comp, 'المكوّن') });
    res.json({ ok: true });
  }));

  // ---------- مكوّنات الراتب ----------
  r.get('/hr/components', wrap(async (req, res) => {
    res.json({ components: await db.query(`SELECT comp_id AS "id", code AS "code", name AS "name", kind AS "kind", calc_type AS "calcType", pct AS "pct", base_type AS "baseType",
      base_cap AS "baseCap", expense_account AS "expenseAccount", liability_account AS "liabilityAccount", active AS "active" FROM erp_pay_components ORDER BY code`) });
  }));
  r.post('/hr/components', wrap(async (req, res) => {
    const b = req.body || {};
    const kind = v.str(b.kind, 'النوع'); if (!['EARNING', 'DEDUCTION', 'EMPLOYER'].includes(kind)) v.bad('نوع المكوّن غير صالح');
    const calc = v.str(b.calcType, 'طريقة الحساب'); if (!['FIXED', 'PCT'].includes(calc)) v.bad('طريقة الحساب غير صالحة');
    const base = b.baseType || 'BASIC'; if (!['BASIC', 'GROSS'].includes(base)) v.bad('الوعاء غير صالح');
    const cap = b.baseCap === undefined || b.baseCap === null || b.baseCap === '' ? null : pos(b.baseCap, 'السقف');
    const acct = (x, l) => (x ? v.str(x, l, { max: 12 }) : null);
    const out = await db.run('BEGIN :id := erp_hr.add_component(:c, :n, :k, :t, :p, :b, :cap, :ea, :la); END;', {
      c: v.str(b.code, 'رمز المكوّن', { max: 20 }), n: v.str(b.name, 'اسم المكوّن', { max: 120 }), k: kind, t: calc, p: pct(b.pct, 'النسبة') || 0, b: base,
      cap: { val: cap, type: N }, ea: acct(b.expenseAccount, 'حساب المصروف'), la: acct(b.liabilityAccount, 'حساب الالتزام'), id: OUT(N) });
    res.status(201).json({ id: out.outBinds.id });
  }));

  // ---------- التسويات الشهرية ----------
  r.get('/hr/adjustments', wrap(async (req, res) => {
    res.json({ adjustments: await db.query(`SELECT a.adj_id AS "id", e.code AS "empCode", e.name AS "empName", TO_CHAR(a.period, 'YYYY-MM') AS "period", a.kind AS "kind",
      a.description AS "description", a.amount AS "amount", a.account_code AS "account", a.status AS "status", a.run_id AS "runId"
      FROM erp_pay_adjustments a JOIN erp_employees e ON e.emp_id = a.emp_id ORDER BY a.period DESC, a.adj_id DESC FETCH FIRST 300 ROWS ONLY`) });
  }));
  r.post('/hr/adjustments', wrap(async (req, res) => {
    const b = req.body || {};
    const kind = v.str(b.kind, 'النوع'); if (!['EARNING', 'DEDUCTION'].includes(kind)) v.bad('نوع التسوية: EARNING أو DEDUCTION');
    const out = await db.run("BEGIN :id := erp_hr.add_adjustment(:e, TO_DATE(:p, 'YYYY-MM-DD'), :k, :d, :a, :ac); END;", {
      e: v.int(b.empId, 'الموظف'), p: monthStart(b.period, 'الشهر'), k: kind, d: v.str(b.description, 'الوصف', { max: 200 }), a: pos(b.amount, 'المبلغ'),
      ac: b.account ? v.str(b.account, 'الحساب', { max: 12 }) : '5200', id: OUT(N) });
    res.status(201).json({ id: out.outBinds.id });
  }));
  r.post('/hr/adjustments/:id/void', wrap(async (req, res) => {
    await db.run('BEGIN erp_hr.void_adjustment(:id); END;', { id: v.int(req.params.id, 'رقم التسوية') });
    res.json({ ok: true });
  }));

  // ---------- السلف ----------
  r.get('/hr/advances', wrap(async (req, res) => {
    res.json({ advances: await db.query(`SELECT adv_id AS "id", emp_code AS "empCode", emp_name AS "empName", TO_CHAR(grant_date, 'YYYY-MM-DD') AS "date", amount AS "amount",
      repaid AS "repaid", remaining AS "remaining", installments_done AS "done", installments AS "installments", status AS "status" FROM v_erp_advance_balance ORDER BY adv_id DESC`) });
  }));
  r.post('/hr/advances', wrap(async (req, res) => {
    const b = req.body || {};
    const method = v.str(b.method, 'طريقة الصرف'); if (!['CASH', 'BANK'].includes(method)) v.bad('طريقة الصرف: CASH أو BANK');
    const out = await db.run("BEGIN :id := erp_hr.grant_advance(:e, TO_DATE(:d, 'YYYY-MM-DD'), :a, :i, TO_DATE(:f, 'YYYY-MM-DD'), :m, :n); END;", {
      e: v.int(b.empId, 'الموظف'), d: v.date(b.date, 'التاريخ'), a: pos(b.amount, 'المبلغ'), i: v.int(b.installments, 'عدد الأقساط'),
      f: monthStart(b.firstPeriod, 'أول شهر اقتطاع'), m: method, n: v.str(b.note, 'الملاحظة', { max: 300, optional: true }), id: OUT(N) });
    res.status(201).json({ id: out.outBinds.id });
  }));
  r.post('/hr/advances/:id/void', wrap(async (req, res) => {
    await db.run('BEGIN erp_hr.void_advance(:id); END;', { id: v.int(req.params.id, 'رقم السلفة') });
    res.json({ ok: true });
  }));

  // ---------- كشوف الرواتب ----------
  const RUN = `SELECT run_id AS "id", TO_CHAR(period, 'YYYY-MM') AS "period", status AS "status", employees AS "employees", total_gross AS "gross",
      total_deductions AS "deductions", total_net AS "net", total_employer AS "employer", entry_id AS "entryId", pay_entry_id AS "payEntryId",
      TO_CHAR(pay_date, 'YYYY-MM-DD') AS "payDate" FROM v_erp_payroll_summary`;

  r.get('/payroll/runs', wrap(async (req, res) => {
    res.json({ runs: await db.query(`${RUN} ORDER BY period DESC, run_id DESC`) });
  }));
  r.get('/payroll/check', wrap(async (req, res) => {
    const x = (await db.query('SELECT unpaid_net AS "unpaidNet", gl_balance AS "glBalance", difference AS "difference" FROM v_erp_payroll_vs_gl'))[0];
    res.json({ ...x, ok: x.difference === 0 });
  }));

  async function loadRun(id) {
    const h = await db.query(`${RUN} WHERE run_id = :id`, { id });
    if (!h.length) throw new db.HttpError(404, 'الكشف غير موجود');
    const lines = await db.query(`SELECT l.line_id AS "id", e.code AS "empCode", e.name AS "empName", l.days_worked AS "days", l.days_in_period AS "daysInPeriod", l.basic AS "basic",
      l.earnings AS "earnings", l.gross AS "gross", l.deductions AS "deductions", l.advance_deduction AS "advance", l.net AS "net", l.employer_cost AS "employer"
      FROM erp_payroll_lines l JOIN erp_employees e ON e.emp_id = l.emp_id WHERE l.run_id = :id ORDER BY e.code`, { id });
    const items = await db.query(`SELECT i.line_id AS "lineId", i.kind AS "kind", i.description AS "description", i.amount AS "amount"
      FROM erp_payroll_items i JOIN erp_payroll_lines l ON l.line_id = i.line_id WHERE l.run_id = :id ORDER BY i.item_id`, { id });
    return { ...h[0], lines: lines.map((l) => ({ ...l, items: items.filter((i) => i.lineId === l.id) })) };
  }
  r.get('/payroll/runs/:id', wrap(async (req, res) => { res.json({ run: await loadRun(v.int(req.params.id, 'رقم الكشف')) }); }));

  r.post('/payroll/runs', wrap(async (req, res) => {
    const out = await db.run("BEGIN :id := erp_payroll.create_run(TO_DATE(:p, 'YYYY-MM-DD')); END;", { p: monthStart((req.body || {}).period, 'الشهر'), id: OUT(N) });
    res.status(201).json({ run: await loadRun(out.outBinds.id) });
  }));
  const act = (path, sql, bindsFn) => r.post(`/payroll/runs/:id/${path}`, wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الكشف');
    const out = await db.run(sql, { id, ...bindsFn(req.body || {}) });
    res.json({ run: await loadRun(id), entryId: out.outBinds && out.outBinds.e });
  }));
  act('calculate', 'BEGIN erp_payroll.calculate_run(:id); END;', () => ({}));
  act('cancel', 'BEGIN erp_payroll.cancel_run(:id); END;', () => ({}));
  act('post', 'BEGIN :e := erp_payroll.post_run(:id); END;', () => ({ e: OUT(N) }));
  act('unpay', 'BEGIN erp_payroll.unpay_run(:id); END;', () => ({}));
  act('void', 'BEGIN erp_payroll.void_run(:id); END;', () => ({}));
  act('pay', "BEGIN :e := erp_payroll.pay_run(:id, TO_DATE(:d, 'YYYY-MM-DD'), :m); END;", (b) => {
    const m = v.str(b.method, 'طريقة الصرف'); if (!['CASH', 'BANK'].includes(m)) v.bad('طريقة الصرف: CASH أو BANK');
    return { d: v.date(b.date, 'تاريخ الصرف'), m, e: OUT(N) };
  });

  return r;
};
