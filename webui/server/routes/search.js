// الاستعلام الموحَّد: بحث واحد عبر كل أنواع العمليات (قيود، فواتير، سندات، إشعارات، نقاط بيع، أوامر شراء، عروض) بنص ونوع وتاريخ ومبلغ.
// يقتصر على الأنواع التي يملك المستخدم صلاحية قراءتها.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// type: مفتاح النوع، module: الوحدة اللازمة، sql: يعيد الأعمدة الموحَّدة (type,id,no,dt,party,descr,amount,status)
const SOURCES = [
  { type: 'ENTRY', module: 'accounting', sql: `SELECT 'ENTRY' AS type, e.entry_id AS id, TO_CHAR(e.entry_id) AS no, e.entry_date AS dt, NULL AS party, e.memo AS descr,
      (SELECT NVL(SUM(l.debit), 0) FROM erp_lines l WHERE l.entry_id = e.entry_id) AS amount, CASE WHEN e.void_of IS NOT NULL THEN 'REVERSAL' ELSE 'OPEN' END AS status,
      LOWER(e.entry_id || ' ' || NVL(e.ref, '') || ' ' || NVL(e.memo, '')) AS hay FROM erp_entries e` },
  { type: 'SALES', module: 'trade', sql: `SELECT 'SALES' AS type, i.invoice_id AS id, i.invoice_no AS no, i.invoice_date AS dt, p.name AS party, i.note AS descr, i.total AS amount, i.status AS status,
      LOWER(i.invoice_no || ' ' || p.name || ' ' || NVL(i.ref, '') || ' ' || NVL(i.note, '')) AS hay FROM erp_invoices i JOIN erp_parties p ON p.party_id = i.party_id WHERE i.kind = 'SALES'` },
  { type: 'PURCHASE', module: 'trade', sql: `SELECT 'PURCHASE' AS type, i.invoice_id AS id, i.invoice_no AS no, i.invoice_date AS dt, p.name AS party, i.note AS descr, i.total AS amount, i.status AS status,
      LOWER(i.invoice_no || ' ' || p.name || ' ' || NVL(i.ref, '') || ' ' || NVL(i.note, '')) AS hay FROM erp_invoices i JOIN erp_parties p ON p.party_id = i.party_id WHERE i.kind = 'PURCHASE'` },
  { type: 'PAYMENT', module: 'trade', sql: `SELECT 'PAYMENT' AS type, y.payment_id AS id, TO_CHAR(y.payment_id) AS no, y.pay_date AS dt, p.name AS party, y.note AS descr, y.amount AS amount, y.kind AS status,
      LOWER(y.payment_id || ' ' || p.name || ' ' || NVL(y.note, '')) AS hay FROM erp_payments y JOIN erp_parties p ON p.party_id = y.party_id` },
  { type: 'NOTE', module: 'trade', sql: `SELECT 'NOTE' AS type, n.note_id AS id, n.note_no AS no, n.note_date AS dt, p.name AS party, n.reason AS descr, n.total AS amount, n.status AS status,
      LOWER(n.note_no || ' ' || p.name || ' ' || NVL(n.reason, '')) AS hay FROM erp_notes n JOIN erp_parties p ON p.party_id = n.party_id` },
  { type: 'POS', module: 'pos', sql: `SELECT 'POS' AS type, s.sale_id AS id, s.sale_no AS no, s.sale_date AS dt, NULL AS party, NULL AS descr, s.total AS amount, s.status AS status,
      LOWER(s.sale_no) AS hay FROM erp_pos_sales s` },
  { type: 'PO', module: 'orders', sql: `SELECT 'PO' AS type, o.po_id AS id, o.po_no AS no, o.po_date AS dt, p.name AS party, o.notes AS descr, o.total AS amount, o.status AS status,
      LOWER(o.po_no || ' ' || p.name || ' ' || NVL(o.notes, '')) AS hay FROM erp_purchase_orders o JOIN erp_parties p ON p.party_id = o.party_id` },
  { type: 'QUOTE', module: 'orders', sql: `SELECT 'QUOTE' AS type, q.quote_id AS id, q.quote_no AS no, q.quote_date AS dt, p.name AS party, q.notes AS descr, q.total AS amount, q.status AS status,
      LOWER(q.quote_no || ' ' || p.name || ' ' || NVL(q.notes, '')) AS hay FROM erp_quotations q JOIN erp_parties p ON p.party_id = q.party_id` },
];
const rank = { n: 0, r: 1, w: 2 };

module.exports = function searchRoutes() {
  const r = express.Router();
  r.get('/search', wrap(async (req, res) => {
    const u = req.user;
    const allowed = SOURCES.filter((s) => u.isAdmin || rank[u.perms[s.module] || 'n'] >= 1);
    const want = req.query.type ? String(req.query.type).split(',') : null;
    if (want && want.some((t) => !SOURCES.some((s) => s.type === t))) v.bad('نوع العملية غير صالح');
    const use = allowed.filter((s) => !want || want.includes(s.type));
    const text = req.query.q ? v.str(req.query.q, 'نص البحث', { max: 60 }) : null;
    const from = v.date(req.query.from, 'من تاريخ', { optional: true });
    const to = v.date(req.query.to, 'إلى تاريخ', { optional: true });
    const num = (x, label) => { if (x === undefined || x === '') return null; const n = Number(String(x).replace(/,/g, '')); if (!Number.isFinite(n) || n < 0) v.bad(label + ' غير صالح'); return n; };
    const min = num(req.query.min, 'الحد الأدنى للمبلغ'), max = num(req.query.max, 'الحد الأعلى للمبلغ');
    const limit = Math.min(v.int(req.query.limit, 'الحد', { optional: true }) || 100, 300);
    if (!use.length) return res.json({ rows: [], types: allowed.map((s) => s.type) });
    const qn = text && /^[\d,]+(\.\d+)?$/.test(text) ? Number(text.replace(/,/g, '')) : null;
    const rows = await db.query(`SELECT * FROM (SELECT x.type AS "type", x.id AS "id", x.no AS "no", TO_CHAR(x.dt, 'YYYY-MM-DD') AS "date", x.party AS "party", x.descr AS "descr", x.amount AS "amount", x.status AS "status"
        FROM (${use.map((s) => s.sql).join(' UNION ALL ')}) x
       WHERE (:q IS NULL OR x.hay LIKE :q ESCAPE '\\' OR (:qn IS NOT NULL AND ABS(x.amount - :qn) < 0.005))
         AND (:f IS NULL OR x.dt >= TO_DATE(:f, 'YYYY-MM-DD')) AND (:t IS NULL OR x.dt <= TO_DATE(:t, 'YYYY-MM-DD'))
         AND (:mn IS NULL OR x.amount >= :mn) AND (:mx IS NULL OR x.amount <= :mx)
       ORDER BY x.dt DESC, x.id DESC) WHERE ROWNUM <= :lim`,
    { q: { val: text ? '%' + text.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c) + '%' : null, type: db.oracledb.STRING }, qn: { val: qn, type: db.oracledb.NUMBER },
      f: { val: from, type: db.oracledb.STRING }, t: { val: to, type: db.oracledb.STRING }, mn: { val: min, type: db.oracledb.NUMBER }, mx: { val: max, type: db.oracledb.NUMBER }, lim: limit });
    res.json({ rows, types: allowed.map((s) => s.type) });
  }));
  return r;
};
