// تقارير نقاط البيع (قراءة فقط): يومي، حسب الصنف، حسب الكاشير والنقطة، بالساعة، فروقات الورديات، والمرتجعات.
// العمليات المكتملة فقط؛ البيع بإشارة موجبة والمرتجع سالبة. المبالغ قبل الضريبة ما لم يُذكر.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const SG = `CASE WHEN s.kind = 'SALE' THEN 1 ELSE -1 END`;
const DONE = `s.status = 'COMPLETED'`;
function range(req) {
  const f = v.date(req.query.from, 'من تاريخ'), t = v.date(req.query.to, 'إلى تاريخ');
  if (f > t) v.bad('تاريخ البداية بعد النهاية');
  return { f, t };
}
const PER = `s.sale_date BETWEEN TO_DATE(:f, 'YYYY-MM-DD') AND TO_DATE(:t, 'YYYY-MM-DD')`;
const rnd = (rows, keys) => rows.map((x) => { const o = { ...x }; for (const k of keys) if (o[k] != null) o[k] = r2(o[k]); return o; });
const sum = (rows, k) => r2(rows.reduce((a, x) => a + (x[k] || 0), 0));

module.exports = function posReportRoutes() {
  const r = express.Router();

  // يومي: العمليات والمبيعات والمرتجعات والصافي والضريبة، وتوزيع النقد/البطاقة (النقد بعد خصم الباقي والمردود)
  r.get('/pos/reports/daily', wrap(async (req, res) => {
    const p = range(req);
    const rows = await db.query(`
      SELECT TO_CHAR(s.sale_date, 'YYYY-MM-DD') AS "date",
             SUM(CASE WHEN s.kind = 'SALE' THEN 1 ELSE 0 END) AS "sales", SUM(CASE WHEN s.kind = 'RETURN' THEN 1 ELSE 0 END) AS "returns",
             SUM(CASE WHEN s.kind = 'SALE' THEN s.subtotal ELSE 0 END) AS "gross", SUM(CASE WHEN s.kind = 'RETURN' THEN s.subtotal ELSE 0 END) AS "returned",
             SUM(${SG} * s.subtotal) AS "net", SUM(${SG} * s.vat_amount) AS "vat", SUM(${SG} * s.total) AS "total",
             SUM(NVL((SELECT SUM(${SG} * y.amount) FROM erp_pos_payments y WHERE y.sale_id = s.sale_id AND y.method = 'CASH'), 0) - CASE WHEN s.kind = 'SALE' THEN s.change_due ELSE 0 END) AS "cash",
             SUM(NVL((SELECT SUM(${SG} * y.amount) FROM erp_pos_payments y WHERE y.sale_id = s.sale_id AND y.method = 'CARD'), 0)) AS "card"
        FROM erp_pos_sales s WHERE ${DONE} AND ${PER} GROUP BY s.sale_date ORDER BY s.sale_date`, p);
    const out = rnd(rows, ['gross', 'returned', 'net', 'vat', 'total', 'cash', 'card']).map((x) => ({ ...x, avgTicket: x.sales ? r2((x.gross) / x.sales) : 0 }));
    const T = Object.fromEntries(['sales', 'returns', 'gross', 'returned', 'net', 'vat', 'total', 'cash', 'card'].map((k) => [k, sum(out, k)]));
    T.avgTicket = T.sales ? r2(T.gross / T.sales) : 0;
    res.json({ rows: out, totals: T });
  }));

  r.get('/pos/reports/items', wrap(async (req, res) => {
    const p = range(req);
    const rows = await db.query(`
      SELECT i.code AS "code", i.name AS "name", SUM(${SG} * l.qty) AS "qty", SUM(${SG} * l.net) AS "net", SUM(${SG} * l.vat) AS "vat", SUM(${SG} * NVL(l.cost, 0)) AS "cost"
        FROM erp_pos_sale_lines l JOIN erp_pos_sales s ON s.sale_id = l.sale_id JOIN erp_items i ON i.item_id = l.item_id
       WHERE ${DONE} AND ${PER} GROUP BY i.code, i.name HAVING SUM(${SG} * l.qty) <> 0 OR SUM(${SG} * l.net) <> 0 ORDER BY SUM(${SG} * l.net) DESC`, p);
    const out = rnd(rows, ['qty', 'net', 'vat', 'cost']).map((x) => ({ ...x, margin: r2(x.net - x.cost), avgPrice: x.qty ? r2(x.net / x.qty) : 0 }));
    res.json({ rows: out, totals: { qty: sum(out, 'qty'), net: sum(out, 'net'), vat: sum(out, 'vat'), cost: sum(out, 'cost'), margin: sum(out, 'margin') } });
  }));

  r.get('/pos/reports/cashiers', wrap(async (req, res) => {
    const p = range(req);
    const rows = await db.query(`
      SELECT g.cashier AS "cashier", rg.name AS "register", COUNT(DISTINCT g.shift_id) AS "shifts",
             SUM(CASE WHEN s.kind = 'SALE' THEN 1 ELSE 0 END) AS "sales", SUM(CASE WHEN s.kind = 'RETURN' THEN 1 ELSE 0 END) AS "returns",
             SUM(CASE WHEN s.kind = 'SALE' THEN s.subtotal ELSE 0 END) AS "gross", SUM(${SG} * s.subtotal) AS "net", SUM(${SG} * s.total) AS "total"
        FROM erp_pos_sales s JOIN erp_pos_shifts g ON g.shift_id = s.shift_id JOIN erp_pos_registers rg ON rg.reg_id = g.reg_id
       WHERE ${DONE} AND ${PER} GROUP BY g.cashier, rg.name ORDER BY SUM(${SG} * s.subtotal) DESC`, p);
    const out = rnd(rows, ['gross', 'net', 'total']).map((x) => ({ ...x, avgTicket: x.sales ? r2(x.gross / x.sales) : 0 }));
    res.json({ rows: out, totals: { shifts: sum(out, 'shifts'), sales: sum(out, 'sales'), returns: sum(out, 'returns'), gross: sum(out, 'gross'), net: sum(out, 'net'), total: sum(out, 'total') } });
  }));

  r.get('/pos/reports/hourly', wrap(async (req, res) => {
    const p = range(req);
    const rows = await db.query(`
      SELECT TO_NUMBER(TO_CHAR(s.created_at, 'HH24')) AS "hour", COUNT(*) AS "sales", SUM(s.subtotal) AS "net", SUM(s.total) AS "total"
        FROM erp_pos_sales s WHERE ${DONE} AND s.kind = 'SALE' AND ${PER} GROUP BY TO_NUMBER(TO_CHAR(s.created_at, 'HH24')) ORDER BY 1`, p);
    const out = rnd(rows, ['net', 'total']);
    res.json({ rows: out, totals: { sales: sum(out, 'sales'), net: sum(out, 'net'), total: sum(out, 'total') } });
  }));

  r.get('/pos/reports/shifts', wrap(async (req, res) => {
    const f = v.date(req.query.from, 'من تاريخ'), t = v.date(req.query.to, 'إلى تاريخ');
    if (f > t) v.bad('تاريخ البداية بعد النهاية');
    const rows = await db.query(`
      SELECT shift_id AS "id", reg_name AS "register", cashier AS "cashier", TO_CHAR(opened_at, 'YYYY-MM-DD HH24:MI') AS "openedAt", TO_CHAR(closed_at, 'YYYY-MM-DD HH24:MI') AS "closedAt",
             opening_cash AS "opening", sales_total AS "salesTotal", expected_cash AS "expected", counted_cash AS "counted", variance AS "variance"
        FROM v_erp_pos_shift_summary WHERE status = 'CLOSED' AND TRUNC(closed_at) BETWEEN TO_DATE(:f, 'YYYY-MM-DD') AND TO_DATE(:t, 'YYYY-MM-DD') ORDER BY closed_at`, { f, t });
    const out = rnd(rows, ['opening', 'salesTotal', 'expected', 'counted', 'variance']);
    res.json({ rows: out, totals: { shifts: out.length, expected: sum(out, 'expected'), counted: sum(out, 'counted'), over: r2(out.filter((x) => x.variance > 0).reduce((s, x) => s + x.variance, 0)), short: r2(out.filter((x) => x.variance < 0).reduce((s, x) => s + x.variance, 0)), net: sum(out, 'variance') } });
  }));

  r.get('/pos/reports/returns', wrap(async (req, res) => {
    const p = range(req);
    const rows = await db.query(`
      SELECT s.sale_id AS "id", s.sale_no AS "no", TO_CHAR(s.sale_date, 'YYYY-MM-DD') AS "date", o.sale_no AS "origNo", s.subtotal AS "net", s.vat_amount AS "vat", s.total AS "total", g.cashier AS "cashier"
        FROM erp_pos_sales s JOIN erp_pos_sales o ON o.sale_id = s.orig_sale_id JOIN erp_pos_shifts g ON g.shift_id = s.shift_id
       WHERE ${DONE} AND s.kind = 'RETURN' AND ${PER} ORDER BY s.sale_date, s.sale_id`, p);
    const [sold] = await db.query(`SELECT NVL(SUM(s.total), 0) AS "t" FROM erp_pos_sales s WHERE ${DONE} AND s.kind = 'SALE' AND ${PER}`, p);
    const out = rnd(rows, ['net', 'vat', 'total']);
    const total = sum(out, 'total');
    res.json({ rows: out, totals: { count: out.length, total, net: sum(out, 'net'), vat: sum(out, 'vat'), rate: sold.t ? r2(total / sold.t * 100) : 0 } });
  }));
  return r;
};
