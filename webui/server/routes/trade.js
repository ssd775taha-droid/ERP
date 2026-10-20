// الأطراف (عملاء وموردون) والفواتير وسندات القبض والصرف. كل الترحيل عبر ERP_TRADE.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const KINDS = ['SALES', 'PURCHASE'];
const PARTY_KINDS = ['CUSTOMER', 'SUPPLIER'];

function qty(x, label) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) v.bad(`${label}: كمية غير صالحة`);
  if (Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6) v.bad(`${label}: أكثر من 3 منازل عشرية`);
  return n;
}
function pct(x, label) {
  if (x === undefined || x === null || x === '') return 0;
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0 || n > 100) v.bad(`${label}: نسبة غير صالحة`);
  return n;
}

module.exports = function tradeRoutes() {
  const r = express.Router();

  // ---------- مراجع للقوائم المنسدلة ----------
  r.get('/items', wrap(async (req, res) => {
    res.json({ items: await db.query(`
      SELECT item_id AS "id", code AS "code", name AS "name", unit AS "unit", sale_price AS "price", vat_rate AS "vat",
             track_stock AS "trackStock", rev_account AS "revAccount"
        FROM erp_items WHERE active = 'Y' ORDER BY code`) });
  }));
  r.get('/warehouses', wrap(async (req, res) => {
    res.json({ warehouses: await db.query(`SELECT wh_id AS "id", code AS "code", name AS "name" FROM erp_warehouses WHERE active = 'Y' ORDER BY code`) });
  }));

  // ---------- الأطراف ----------
  r.get('/parties', wrap(async (req, res) => {
    const kind = req.query.kind ? v.str(req.query.kind, 'النوع') : null;
    if (kind && !PARTY_KINDS.includes(kind)) v.bad('نوع الطرف غير صالح');
    const q = req.query.q ? `%${v.str(req.query.q, 'البحث', { max: 60 }).toLowerCase()}%` : null;
    const rows = await db.query(`
      SELECT p.party_id AS "id", p.kind AS "kind", p.name AS "name", p.phone AS "phone", p.tax_no AS "taxNo",
             erp_trade.party_balance(p.party_id) AS "balance"
        FROM erp_parties p
       WHERE (:kind IS NULL OR p.kind = :kind) AND (:q IS NULL OR LOWER(p.name) LIKE :q OR p.phone LIKE :q)
       ORDER BY p.name FETCH FIRST 500 ROWS ONLY`, { kind, q });
    res.json({ parties: rows });
  }));

  r.post('/parties', wrap(async (req, res) => {
    const b = req.body || {};
    const kind = v.str(b.kind, 'النوع');
    if (!PARTY_KINDS.includes(kind)) v.bad('نوع الطرف: CUSTOMER أو SUPPLIER');
    const name = v.str(b.name, 'الاسم', { max: 120 });
    const phone = v.str(b.phone, 'الهاتف', { max: 40, optional: true });
    const taxNo = v.str(b.taxNo, 'الرقم الضريبي', { max: 40, optional: true });
    const out = await db.run('BEGIN :id := erp_trade.add_party(:k, :n, :p, :t); END;',
      { k: kind, n: name, p: phone, t: taxNo, id: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } });
    res.status(201).json({ id: out.outBinds.id });
  }));

  // كشف حساب طرف: فواتير (غير الملغاة) وسندات برصيد جارٍ (موجب = على العميل / للمورد)
  r.get('/parties/:id/statement', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الطرف');
    const p = await db.query(`SELECT party_id AS "id", kind AS "kind", name AS "name", phone AS "phone", tax_no AS "taxNo",
                                     erp_trade.party_balance(party_id) AS "balance" FROM erp_parties WHERE party_id = :id`, { id });
    if (!p.length) throw new db.HttpError(404, 'الطرف غير موجود');
    const moves = await db.query(`
      SELECT * FROM (
        SELECT 'INVOICE' AS "type", i.invoice_id AS "id", i.invoice_no AS "no", TO_CHAR(i.invoice_date, 'YYYY-MM-DD') AS "date",
               i.total AS "amount", i.invoice_date AS sort_d, i.invoice_id AS sort_i, 0 AS sort_t
          FROM erp_invoices i WHERE i.party_id = :id AND i.status = 'OPEN'
        UNION ALL
        SELECT 'PAYMENT', y.payment_id, TO_CHAR(y.payment_id), TO_CHAR(y.pay_date, 'YYYY-MM-DD'),
               -y.amount, y.pay_date, y.payment_id, 1
          FROM erp_payments y WHERE y.party_id = :id
        UNION ALL
        SELECT 'NOTE', n.note_id, n.note_no, TO_CHAR(n.note_date, 'YYYY-MM-DD'),
               CASE n.note_type WHEN 'DEBIT' THEN n.total ELSE n.refund - n.total END, n.note_date, n.note_id, 2
          FROM erp_notes n WHERE n.party_id = :id AND n.status = 'OPEN')
       ORDER BY sort_d, sort_t, sort_i`, { id });
    let run = 0;
    const rows = moves.map((m) => { run = Math.round((run + m.amount) * 100) / 100; return { type: m.type, id: m.id, no: m.no, date: m.date, amount: m.amount, balance: run }; });
    res.json({ party: p[0], rows });
  }));

  // ---------- الفواتير ----------
  const INV_SQL = `
    SELECT i.invoice_id AS "id", i.kind AS "kind", i.invoice_no AS "no", i.ref AS "ref", i.party_id AS "partyId", p.name AS "partyName",
           TO_CHAR(i.invoice_date, 'YYYY-MM-DD') AS "date", TO_CHAR(i.due_date, 'YYYY-MM-DD') AS "due",
           i.subtotal AS "subtotal", i.vat_amount AS "vat", i.total AS "total", i.paid AS "paid", i.total + erp_note_net(i.invoice_id) - i.paid AS "remaining", i.total + (SELECT NVL(SUM(CASE n.note_type WHEN 'DEBIT' THEN n.total ELSE -n.total END), 0) FROM erp_notes n WHERE n.invoice_id = i.invoice_id AND n.status = 'OPEN') AS "effectiveTotal",
           i.status AS "status", p.tax_no AS "partyTaxNo", i.note AS "note", i.entry_id AS "entryId", i.cogs_entry_id AS "cogsEntryId", i.void_entry_id AS "voidEntryId"
      FROM erp_invoices i JOIN erp_parties p ON p.party_id = i.party_id`;

  r.get('/invoices', wrap(async (req, res) => {
    const kind = req.query.kind || null;
    if (kind && !KINDS.includes(kind)) v.bad('نوع الفاتورة غير صالح');
    const party = v.int(req.query.party, 'الطرف', { optional: true });
    const from = v.date(req.query.from, 'من تاريخ', { optional: true });
    const to = v.date(req.query.to, 'إلى تاريخ', { optional: true });
    const open = req.query.open === '1' ? 1 : 0;
    const limit = Math.min(v.int(req.query.limit, 'الحد', { optional: true }) || 100, 500);
    const rows = await db.query(`${INV_SQL}
      WHERE (:kind IS NULL OR i.kind = :kind) AND (:party IS NULL OR i.party_id = :party)
        AND (:f IS NULL OR i.invoice_date >= TO_DATE(:f, 'YYYY-MM-DD')) AND (:t IS NULL OR i.invoice_date <= TO_DATE(:t, 'YYYY-MM-DD'))
        AND (:open = 0 OR (i.status = 'OPEN' AND i.total + erp_note_net(i.invoice_id) > i.paid))
      ORDER BY i.invoice_date DESC, i.invoice_id DESC FETCH FIRST :lim ROWS ONLY`,
      { kind, party, f: from, t: to, open, lim: limit });
    res.json({ invoices: rows });
  }));

  async function loadInvoice(id) {
    const h = await db.query(`${INV_SQL} WHERE i.invoice_id = :id`, { id });
    if (!h.length) throw new db.HttpError(404, 'الفاتورة غير موجودة');
    const lines = await db.query(`
      SELECT l.line_id AS "id", l.description AS "description", l.qty AS "qty", l.price AS "price", l.vat_rate AS "vatRate", l.account_code AS "account",
             l.net AS "net", l.vat AS "vat", l.item_id AS "itemId", l.wh_id AS "whId", l.cost AS "cost",
             (SELECT NVL(SUM(nl.qty), 0) FROM erp_note_lines nl JOIN erp_notes n ON n.note_id = nl.note_id WHERE nl.orig_line_id = l.line_id AND nl.item_id IS NOT NULL AND n.status = 'OPEN') AS "creditedQty"
        FROM erp_invoice_lines l WHERE l.invoice_id = :id ORDER BY l.line_id`, { id });
    const notes = await db.query(`SELECT note_id AS "id", note_no AS "no", note_type AS "type", TO_CHAR(note_date, 'YYYY-MM-DD') AS "date", total AS "total", refund AS "refund", status AS "status", reason AS "reason"
      FROM erp_notes WHERE invoice_id = :id ORDER BY note_id`, { id });
    const pays = await db.query(`
      SELECT payment_id AS "id", kind AS "kind", TO_CHAR(pay_date, 'YYYY-MM-DD') AS "date", amount AS "amount", method AS "method", note AS "note"
        FROM erp_payments WHERE invoice_id = :id ORDER BY payment_id`, { id });
    return { ...h[0], lines, payments: pays, notes };
  }

  r.get('/invoices/:id', wrap(async (req, res) => {
    res.json({ invoice: await loadInvoice(v.int(req.params.id, 'رقم الفاتورة')) });
  }));

  r.post('/invoices', wrap(async (req, res) => {
    const b = req.body || {};
    const kind = v.str(b.kind, 'نوع الفاتورة');
    if (!KINDS.includes(kind)) v.bad('نوع الفاتورة: SALES أو PURCHASE');
    const partyId = v.int(b.partyId, 'الطرف');
    const date = v.date(b.date, 'تاريخ الفاتورة');
    const due = v.date(b.due, 'تاريخ الاستحقاق', { optional: true });
    if (due && due < date) v.bad('تاريخ الاستحقاق قبل تاريخ الفاتورة');
    const ref = v.str(b.ref, 'المرجع', { max: 60, optional: true });
    const note = v.str(b.note, 'الملاحظة', { max: 300, optional: true });
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 200) v.bad('الفاتورة تحتاج بنداً واحداً على الأقل');
    const lines = b.lines.map((l, i) => {
      const n = `البند ${i + 1}`;
      return {
        description: v.str(l.description, `وصف ${n}`, { max: 200 }),
        qty: qty(l.qty, n),
        price: v.money(l.price, `سعر ${n}`),
        vatRate: pct(l.vatRate, `ضريبة ${n}`),
        account: v.str(l.account, `حساب ${n}`, { max: 12, optional: true }),
        itemId: v.int(l.itemId, `صنف ${n}`, { optional: true }),
        whId: v.int(l.whId, `مخزن ${n}`, { optional: true }),
      };
    });
    const out = await db.run(`
      DECLARE
        v_lines erp_inv_line_tab;
        v_id    NUMBER;
      BEGIN
        SELECT erp_inv_line_t(description, qty, price, vat_rate, account_code, item_id, wh_id) BULK COLLECT INTO v_lines
          FROM JSON_TABLE(:lines, '$[*]' COLUMNS (
                 description  VARCHAR2(200) PATH '$.description',
                 qty          NUMBER        PATH '$.qty',
                 price        NUMBER        PATH '$.price',
                 vat_rate     NUMBER        PATH '$.vatRate',
                 account_code VARCHAR2(12)  PATH '$.account',
                 item_id      NUMBER        PATH '$.itemId',
                 wh_id        NUMBER        PATH '$.whId'));
        v_id := erp_trade.create_invoice(:kind, :party, TO_DATE(:d, 'YYYY-MM-DD'),
                  CASE WHEN :due IS NULL THEN NULL ELSE TO_DATE(:due, 'YYYY-MM-DD') END, :ref, :note, v_lines);
        :id := v_id;
      END;`,
      { lines: JSON.stringify(lines), kind, party: partyId, d: date, due: { val: due, type: db.oracledb.STRING }, ref, note,
        id: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } });
    res.status(201).json({ invoice: await loadInvoice(out.outBinds.id) });
  }));

  r.post('/invoices/:id/void', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الفاتورة');
    await db.run('BEGIN erp_trade.void_invoice(:id); END;', { id });
    res.json({ invoice: await loadInvoice(id) });
  }));

  // ---------- سندات القبض والصرف ----------
  r.get('/payments', wrap(async (req, res) => {
    const party = v.int(req.query.party, 'الطرف', { optional: true });
    const from = v.date(req.query.from, 'من تاريخ', { optional: true });
    const to = v.date(req.query.to, 'إلى تاريخ', { optional: true });
    const rows = await db.query(`
      SELECT y.payment_id AS "id", y.kind AS "kind", y.party_id AS "partyId", p.name AS "partyName", y.invoice_id AS "invoiceId",
             i.invoice_no AS "invoiceNo", TO_CHAR(y.pay_date, 'YYYY-MM-DD') AS "date", y.amount AS "amount", y.method AS "method",
             y.note AS "note", y.entry_id AS "entryId"
        FROM erp_payments y JOIN erp_parties p ON p.party_id = y.party_id LEFT JOIN erp_invoices i ON i.invoice_id = y.invoice_id
       WHERE (:party IS NULL OR y.party_id = :party)
         AND (:f IS NULL OR y.pay_date >= TO_DATE(:f, 'YYYY-MM-DD')) AND (:t IS NULL OR y.pay_date <= TO_DATE(:t, 'YYYY-MM-DD'))
       ORDER BY y.pay_date DESC, y.payment_id DESC FETCH FIRST 300 ROWS ONLY`, { party, f: from, t: to });
    res.json({ payments: rows });
  }));

  r.get('/payments/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم السند');
    const rows = await db.query(`
      SELECT y.payment_id AS "id", y.kind AS "kind", y.party_id AS "partyId", p.name AS "partyName", p.tax_no AS "partyTaxNo", y.invoice_id AS "invoiceId",
             i.invoice_no AS "invoiceNo", TO_CHAR(y.pay_date, 'YYYY-MM-DD') AS "date", y.amount AS "amount", y.method AS "method", y.note AS "note", y.entry_id AS "entryId"
        FROM erp_payments y JOIN erp_parties p ON p.party_id = y.party_id LEFT JOIN erp_invoices i ON i.invoice_id = y.invoice_id WHERE y.payment_id = :id`, { id });
    if (!rows.length) throw new db.HttpError(404, 'السند غير موجود');
    res.json({ payment: rows[0] });
  }));

  r.post('/payments', wrap(async (req, res) => {
    const b = req.body || {};
    const partyId = v.int(b.partyId, 'الطرف');
    const invoiceId = v.int(b.invoiceId, 'الفاتورة', { optional: true });
    const date = v.date(b.date, 'التاريخ');
    const amount = v.money(b.amount, 'المبلغ');
    if (amount <= 0) v.bad('المبلغ يجب أن يكون أكبر من صفر');
    const method = v.str(b.method, 'طريقة الدفع');
    if (!['CASH', 'BANK'].includes(method)) v.bad('طريقة الدفع: CASH أو BANK');
    const note = v.str(b.note, 'الملاحظة', { max: 300, optional: true });
    const out = await db.run("BEGIN :id := erp_trade.pay(:p, :i, TO_DATE(:d, 'YYYY-MM-DD'), :a, :m, :n); END;",
      { p: partyId, i: { val: invoiceId, type: db.oracledb.NUMBER }, d: date, a: amount, m: method, n: note,
        id: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } });
    res.status(201).json({ id: out.outBinds.id });
  }));

  // ---------- أعمار الديون: المتبقي من الفواتير المفتوحة حسب التأخر عن الاستحقاق (أو تاريخ الفاتورة) ----------
  r.get('/reports/aging', wrap(async (req, res) => {
    const kind = v.str(req.query.kind, 'النوع');
    if (!KINDS.includes(kind)) v.bad('نوع غير صالح');
    const asof = v.date(req.query.asof, 'بتاريخ');
    const rows = await db.query(`
      SELECT p.party_id AS "partyId", p.name AS "partyName",
             SUM(CASE WHEN d <= 0 THEN rem ELSE 0 END) AS "current",
             SUM(CASE WHEN d BETWEEN 1 AND 30 THEN rem ELSE 0 END) AS "d30",
             SUM(CASE WHEN d BETWEEN 31 AND 60 THEN rem ELSE 0 END) AS "d60",
             SUM(CASE WHEN d BETWEEN 61 AND 90 THEN rem ELSE 0 END) AS "d90",
             SUM(CASE WHEN d > 90 THEN rem ELSE 0 END) AS "d90plus",
             SUM(rem) AS "total"
        FROM (SELECT i.party_id, i.total + erp_note_net(i.invoice_id) - i.paid AS rem,
                     TO_DATE(:asof, 'YYYY-MM-DD') - NVL(i.due_date, i.invoice_date) AS d
                FROM erp_invoices i
               WHERE i.kind = :kind AND i.status = 'OPEN' AND i.total + erp_note_net(i.invoice_id) > i.paid
                 AND i.invoice_date <= TO_DATE(:asof, 'YYYY-MM-DD')) x
        JOIN erp_parties p ON p.party_id = x.party_id
       GROUP BY p.party_id, p.name ORDER BY SUM(rem) DESC`, { asof, kind });
    const keys = ['current', 'd30', 'd60', 'd90', 'd90plus', 'total'];
    const totals = Object.fromEntries(keys.map((k) => [k, Math.round(rows.reduce((s, x) => s + x[k], 0) * 100) / 100]));
    res.json({ rows, totals });
  }));

  return r;
};
