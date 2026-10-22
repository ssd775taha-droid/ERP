// تقارير الرواتب (قراءة فقط): حسب القسم، لكل موظف بالأشهر، حسب المكوّن، واتجاه التكلفة الشهري.
// تُحتسب الكشوف المرحَّلة والمصروفة فقط (المسودات والملغاة مستبعدة).
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const OK = `r.status IN ('POSTED', 'PAID')`;

function range(req) {
  const f = v.date(req.query.from, 'من شهر'), t = v.date(req.query.to, 'إلى شهر');
  if (f > t) v.bad('تاريخ البداية بعد النهاية');
  return { f: f.slice(0, 7) + '-01', t: t.slice(0, 7) + '-01' };
}
const PER = `r.period BETWEEN TO_DATE(:f, 'YYYY-MM-DD') AND TO_DATE(:t, 'YYYY-MM-DD')`;

module.exports = function payReportRoutes() {
  const r = express.Router();

  r.get('/payroll/reports/by-department', wrap(async (req, res) => {
    const p = range(req);
    const rows = await db.query(`
      SELECT NVL(d.name, 'بدون قسم') AS "dept", COUNT(DISTINCT l.emp_id) AS "employees", SUM(l.basic) AS "basic", SUM(l.earnings) AS "earnings", SUM(l.gross) AS "gross",
             SUM(l.deductions) AS "deductions", SUM(l.advance_deduction) AS "advance", SUM(l.net) AS "net", SUM(l.employer_cost) AS "employer"
        FROM erp_payroll_lines l JOIN erp_payroll_runs r ON r.run_id = l.run_id JOIN erp_employees e ON e.emp_id = l.emp_id LEFT JOIN erp_departments d ON d.dept_id = e.dept_id
       WHERE ${OK} AND ${PER} GROUP BY NVL(d.name, 'بدون قسم') ORDER BY SUM(l.gross) DESC`, p);
    const keys = ['basic', 'earnings', 'gross', 'deductions', 'advance', 'net', 'employer'];
    const totals = Object.fromEntries(keys.map((k) => [k, r2(rows.reduce((s, x) => s + x[k], 0))]));
    totals.employees = rows.reduce((s, x) => s + x.employees, 0);
    res.json({ rows: rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, val]) => [k, typeof val === 'number' && k !== 'employees' ? r2(val) : val]))), totals });
  }));

  r.get('/payroll/reports/by-employee', wrap(async (req, res) => {
    const p = range(req);
    const rows = await db.query(`
      SELECT e.code AS "code", e.name AS "name", NVL(d.name, 'بدون قسم') AS "dept", TO_CHAR(r.period, 'YYYY-MM') AS "month", l.gross AS "gross", l.deductions + l.advance_deduction AS "deductions", l.net AS "net"
        FROM erp_payroll_lines l JOIN erp_payroll_runs r ON r.run_id = l.run_id JOIN erp_employees e ON e.emp_id = l.emp_id LEFT JOIN erp_departments d ON d.dept_id = e.dept_id
       WHERE ${OK} AND ${PER} ORDER BY e.code, r.period`, p);
    const months = [...new Set(rows.map((x) => x.month))].sort();
    const map = new Map();
    for (const x of rows) {
      const m = map.get(x.code) || { code: x.code, name: x.name, dept: x.dept, months: {}, gross: 0, deductions: 0, net: 0 };
      m.months[x.month] = r2((m.months[x.month] || 0) + x.net); m.gross = r2(m.gross + x.gross); m.deductions = r2(m.deductions + x.deductions); m.net = r2(m.net + x.net);
      map.set(x.code, m);
    }
    const list = [...map.values()];
    const monthTotals = Object.fromEntries(months.map((mo) => [mo, r2(list.reduce((s, e) => s + (e.months[mo] || 0), 0))]));
    res.json({ months, rows: list, monthTotals, totals: { gross: r2(list.reduce((s, e) => s + e.gross, 0)), deductions: r2(list.reduce((s, e) => s + e.deductions, 0)), net: r2(list.reduce((s, e) => s + e.net, 0)) } });
  }));

  // حسب المكوّن: كل بند استحقاق/استقطاع/حصة صاحب عمل/سلفة بإجماليه وعدد موظفيه (يفيد في مطابقة التأمينات وغيرها)
  r.get('/payroll/reports/components', wrap(async (req, res) => {
    const p = range(req);
    const rows = await db.query(`
      SELECT i.kind AS "kind", NVL(c.name, i.description) AS "name", COUNT(DISTINCT l.emp_id) AS "employees", SUM(i.amount) AS "amount"
        FROM erp_payroll_items i JOIN erp_payroll_lines l ON l.line_id = i.line_id JOIN erp_payroll_runs r ON r.run_id = l.run_id LEFT JOIN erp_pay_components c ON c.comp_id = i.comp_id
       WHERE ${OK} AND ${PER} GROUP BY i.kind, NVL(c.name, i.description)
       ORDER BY DECODE(i.kind, 'BASIC', 1, 'EARNING', 2, 'DEDUCTION', 3, 'ADVANCE', 4, 5), SUM(i.amount) DESC`, p);
    const by = (k) => r2(rows.filter((x) => x.kind === k).reduce((s, x) => s + x.amount, 0));
    res.json({ rows: rows.map((x) => ({ ...x, amount: r2(x.amount) })), totals: { basic: by('BASIC'), earning: by('EARNING'), deduction: by('DEDUCTION'), advance: by('ADVANCE'), employer: by('EMPLOYER') } });
  }));

  r.get('/payroll/reports/trend', wrap(async (req, res) => {
    const p = range(req);
    const rows = await db.query(`
      SELECT TO_CHAR(r.period, 'YYYY-MM') AS "month", r.status AS "status", COUNT(*) AS "employees", SUM(l.gross) AS "gross", SUM(l.deductions + l.advance_deduction) AS "deductions",
             SUM(l.net) AS "net", SUM(l.employer_cost) AS "employer"
        FROM erp_payroll_lines l JOIN erp_payroll_runs r ON r.run_id = l.run_id WHERE ${OK} AND ${PER} GROUP BY r.period, r.status ORDER BY r.period`, p);
    const out = rows.map((x) => ({ ...x, gross: r2(x.gross), deductions: r2(x.deductions), net: r2(x.net), employer: r2(x.employer), totalCost: r2(x.gross + x.employer) }));
    const sum = (k) => r2(out.reduce((s, x) => s + x[k], 0));
    res.json({ rows: out, totals: { gross: sum('gross'), deductions: sum('deductions'), net: sum('net'), employer: sum('employer'), totalCost: sum('totalCost') } });
  }));
  return r;
};
