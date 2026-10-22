// تقارير الموارد البشرية (قراءة فقط): القوى العاملة حسب القسم، مدة الخدمة، حركة التعيين والإنهاء، تغيّرات الرواتب، أرصدة السلف، ونواقص بيانات الموظفين.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const D = (x) => `TO_DATE(${x}, 'YYYY-MM-DD')`;
// الراتب الأساسي الساري في تاريخ :d (آخر تعديل فعّال حتى ذلك التاريخ)
const BASIC_AT = (d) => `(SELECT MAX(h.basic_salary) KEEP (DENSE_RANK LAST ORDER BY h.effective_from) FROM erp_salary_history h WHERE h.emp_id = e.emp_id AND h.effective_from <= ${D(d)})`;
// على رأس العمل في التاريخ: عُيّن قبله أو فيه ولم تنتهِ خدمته بعده
const ACTIVE_AT = (d) => `(e.hire_date <= ${D(d)} AND (e.term_date IS NULL OR e.term_date > ${D(d)}))`;

module.exports = function hrReportRoutes() {
  const r = express.Router();

  r.get('/hr/reports/headcount', wrap(async (req, res) => {
    const asof = v.date(req.query.asof, 'بتاريخ');
    const rows = await db.query(`
      SELECT NVL(d.name, 'بدون قسم') AS "dept", COUNT(*) AS "active", SUM(${BASIC_AT(':a')}) AS "basic", ROUND(AVG(${BASIC_AT(':a')}), 2) AS "avg",
             MIN(${BASIC_AT(':a')}) AS "min", MAX(${BASIC_AT(':a')}) AS "max"
        FROM erp_employees e LEFT JOIN erp_departments d ON d.dept_id = e.dept_id WHERE ${ACTIVE_AT(':a')}
       GROUP BY NVL(d.name, 'بدون قسم') ORDER BY COUNT(*) DESC, 1`, { a: asof });
    const [x] = await db.query(`SELECT COUNT(*) AS "left" FROM erp_employees e WHERE e.term_date IS NOT NULL AND e.term_date <= ${D(':a')}`, { a: asof });
    const active = rows.reduce((s, y) => s + y.active, 0), basic = r2(rows.reduce((s, y) => s + (y.basic || 0), 0));
    res.json({ rows: rows.map((y) => ({ ...y, basic: r2(y.basic || 0), avg: y.avg || 0, min: y.min || 0, max: y.max || 0 })), totals: { active, basic, avg: active ? r2(basic / active) : 0, left: x.left } });
  }));

  r.get('/hr/reports/tenure', wrap(async (req, res) => {
    const asof = v.date(req.query.asof, 'بتاريخ');
    const rows = await db.query(`
      SELECT e.code AS "code", e.name AS "name", NVL(d.name, 'بدون قسم') AS "dept", e.job_title AS "job", TO_CHAR(e.hire_date, 'YYYY-MM-DD') AS "hireDate",
             MONTHS_BETWEEN(${D(':a')}, e.hire_date) AS "months", ${BASIC_AT(':a')} AS "basic"
        FROM erp_employees e LEFT JOIN erp_departments d ON d.dept_id = e.dept_id WHERE ${ACTIVE_AT(':a')} ORDER BY e.hire_date, e.code`, { a: asof });
    const B = [['أقل من سنة', 0, 12], ['1 – 3 سنوات', 12, 36], ['3 – 5 سنوات', 36, 60], ['5 – 10 سنوات', 60, 120], ['10 سنوات فأكثر', 120, 1e9]];
    const out = rows.map((x) => { const m = Math.floor(x.months); return { ...x, years: Math.floor(m / 12), restMonths: m % 12, totalMonths: m, basic: x.basic || 0 }; });
    res.json({ rows: out, buckets: B.map(([label, lo, hi]) => ({ label, count: out.filter((x) => x.totalMonths >= lo && x.totalMonths < hi).length })),
      avgYears: out.length ? r2(out.reduce((s, x) => s + x.totalMonths, 0) / out.length / 12) : 0 });
  }));

  r.get('/hr/reports/movements', wrap(async (req, res) => {
    const f = v.date(req.query.from, 'من تاريخ'), t = v.date(req.query.to, 'إلى تاريخ');
    if (f > t) v.bad('تاريخ البداية بعد النهاية');
    const rows = await db.query(`
      SELECT * FROM (
        SELECT 'HIRE' AS "type", TO_CHAR(e.hire_date, 'YYYY-MM-DD') AS "date", e.code AS "code", e.name AS "name", NVL(d.name, 'بدون قسم') AS "dept", e.job_title AS "job"
          FROM erp_employees e LEFT JOIN erp_departments d ON d.dept_id = e.dept_id WHERE e.hire_date BETWEEN ${D(':f')} AND ${D(':t')}
        UNION ALL
        SELECT 'TERM', TO_CHAR(e.term_date, 'YYYY-MM-DD'), e.code, e.name, NVL(d.name, 'بدون قسم'), e.job_title
          FROM erp_employees e LEFT JOIN erp_departments d ON d.dept_id = e.dept_id WHERE e.term_date BETWEEN ${D(':f')} AND ${D(':t')}) ORDER BY "date", "code"`, { f, t });
    const [open] = await db.query(`SELECT COUNT(*) AS "n" FROM erp_employees e WHERE e.hire_date < ${D(':f')} AND (e.term_date IS NULL OR e.term_date >= ${D(':f')})`, { f });
    const hires = rows.filter((x) => x.type === 'HIRE').length, terms = rows.filter((x) => x.type === 'TERM').length;
    res.json({ rows, totals: { opening: open.n, hires, terms, closing: open.n + hires - terms } });
  }));

  r.get('/hr/reports/salary-changes', wrap(async (req, res) => {
    const f = v.date(req.query.from, 'من تاريخ'), t = v.date(req.query.to, 'إلى تاريخ');
    if (f > t) v.bad('تاريخ البداية بعد النهاية');
    const rows = await db.query(`
      SELECT e.code AS "code", e.name AS "name", NVL(d.name, 'بدون قسم') AS "dept", TO_CHAR(h.effective_from, 'YYYY-MM') AS "month", h.basic_salary AS "newBasic",
             (SELECT p.basic_salary FROM erp_salary_history p WHERE p.emp_id = h.emp_id AND p.effective_from = (SELECT MAX(q.effective_from) FROM erp_salary_history q WHERE q.emp_id = h.emp_id AND q.effective_from < h.effective_from)) AS "oldBasic"
        FROM erp_salary_history h JOIN erp_employees e ON e.emp_id = h.emp_id LEFT JOIN erp_departments d ON d.dept_id = e.dept_id
       WHERE h.effective_from BETWEEN ${D(':f')} AND ${D(':t')} AND h.effective_from > TRUNC(e.hire_date, 'MM') ORDER BY h.effective_from, e.code`, { f, t });
    const out = rows.filter((x) => x.oldBasic != null).map((x) => ({ ...x, diff: r2(x.newBasic - x.oldBasic), pct: r2((x.newBasic - x.oldBasic) / x.oldBasic * 100) }));
    res.json({ rows: out, totals: { count: out.length, raises: out.filter((x) => x.diff > 0).length, cuts: out.filter((x) => x.diff < 0).length, net: r2(out.reduce((s, x) => s + x.diff, 0)) } });
  }));

  r.get('/hr/reports/advances', wrap(async (req, res) => {
    const rows = await db.query(`
      SELECT a.emp_code AS "code", a.emp_name AS "name", COUNT(*) AS "count", SUM(a.amount) AS "amount", SUM(a.repaid) AS "repaid", SUM(a.remaining) AS "remaining"
        FROM v_erp_advance_balance a GROUP BY a.emp_code, a.emp_name HAVING SUM(a.remaining) > 0 ORDER BY SUM(a.remaining) DESC`);
    const out = rows.map((x) => ({ ...x, amount: r2(x.amount), repaid: r2(x.repaid), remaining: r2(x.remaining) }));
    res.json({ rows: out, totals: { amount: r2(out.reduce((s, x) => s + x.amount, 0)), repaid: r2(out.reduce((s, x) => s + x.repaid, 0)), remaining: r2(out.reduce((s, x) => s + x.remaining, 0)) } });
  }));

  r.get('/hr/reports/data-gaps', wrap(async (req, res) => {
    const rows = await db.query(`
      SELECT e.code AS "code", e.name AS "name", NVL(d.name, '—') AS "dept",
             CASE WHEN e.national_id IS NULL THEN 1 ELSE 0 END AS "noId", CASE WHEN e.bank_account IS NULL THEN 1 ELSE 0 END AS "noBank",
             CASE WHEN e.dept_id IS NULL THEN 1 ELSE 0 END AS "noDept", CASE WHEN e.job_title IS NULL THEN 1 ELSE 0 END AS "noJob"
        FROM erp_employees e LEFT JOIN erp_departments d ON d.dept_id = e.dept_id
       WHERE e.status = 'ACTIVE' AND (e.national_id IS NULL OR e.bank_account IS NULL OR e.dept_id IS NULL OR e.job_title IS NULL) ORDER BY e.code`);
    const [n] = await db.query(`SELECT COUNT(*) AS "n" FROM erp_employees WHERE status = 'ACTIVE'`);
    res.json({ rows, active: n.n, totals: { noId: rows.reduce((s, x) => s + x.noId, 0), noBank: rows.reduce((s, x) => s + x.noBank, 0), noDept: rows.reduce((s, x) => s + x.noDept, 0), noJob: rows.reduce((s, x) => s + x.noJob, 0) } });
  }));
  return r;
};
