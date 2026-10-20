// إشعارات الدائن والمدين (مبيعات ومشتريات). الترحيل والمخزون وقواعد الصلاحية المحاسبية كلها في ERP_CDNOTE.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const N = db.oracledb.NUMBER;

function qty3(x, label) {
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

module.exports = function noteRoutes() {
  const r = express.Router();

  const NOTE = `SELECT n.note_id AS "id", n.note_no AS "no", n.doc_kind AS "docKind", n.note_type AS "type", n.invoice_id AS "invoiceId", i.invoice_no AS "invoiceNo",
      TO_CHAR(i.invoice_date, 'YYYY-MM-DD') AS "invoiceDate", n.party_id AS "partyId", p.name AS "partyName", p.tax_no AS "partyTaxNo",
      TO_CHAR(n.note_date, 'YYYY-MM-DD') AS "date", n.reason AS "reason", n.subtotal AS "subtotal", n.vat_amount AS "vat", n.total AS "total",
      n.refund AS "refund", n.refund_method AS "refundMethod", n.status AS "status", n.entry_id AS "entryId", n.stock_entry_id AS "stockEntryId", n.void_entry_id AS "voidEntryId"
      FROM erp_notes n JOIN erp_invoices i ON i.invoice_id = n.invoice_id JOIN erp_parties p ON p.party_id = n.party_id`;

  async function loadNote(id) {
    const h = await db.query(`${NOTE} WHERE n.note_id = :id`, { id });
    if (!h.length) throw new db.HttpError(404, 'الإشعار غير موجود');
    const lines = await db.query(`SELECT description AS "description", qty AS "qty", price AS "price", vat_rate AS "vatRate", account_code AS "account", net AS "net", vat AS "vat",
      orig_line_id AS "origLineId", item_id AS "itemId", cost AS "cost" FROM erp_note_lines WHERE note_id = :id ORDER BY line_id`, { id });
    return { ...h[0], lines };
  }

  r.get('/notes', wrap(async (req, res) => {
    const kind = req.query.kind || null, type = req.query.type || null;
    if (kind && !['SALES', 'PURCHASE'].includes(kind)) v.bad('النوع غير صالح');
    if (type && !['CREDIT', 'DEBIT'].includes(type)) v.bad('نوع الإشعار غير صالح');
    const from = v.date(req.query.from, 'من تاريخ', { optional: true });
    const to = v.date(req.query.to, 'إلى تاريخ', { optional: true });
    const invoice = v.int(req.query.invoice, 'الفاتورة', { optional: true });
    res.json({ notes: await db.query(`${NOTE} WHERE (:k IS NULL OR n.doc_kind = :k) AND (:t IS NULL OR n.note_type = :t) AND (:inv IS NULL OR n.invoice_id = :inv)
      AND (:f IS NULL OR n.note_date >= TO_DATE(:f, 'YYYY-MM-DD')) AND (:tt IS NULL OR n.note_date <= TO_DATE(:tt, 'YYYY-MM-DD'))
      ORDER BY n.note_id DESC FETCH FIRST 300 ROWS ONLY`, { k: kind, t: type, inv: invoice, f: from, tt: to }) });
  }));

  r.get('/notes/:id', wrap(async (req, res) => { res.json({ note: await loadNote(v.int(req.params.id, 'رقم الإشعار')) }); }));

  r.post('/notes', wrap(async (req, res) => {
    const b = req.body || {};
    const type = v.str(b.type, 'نوع الإشعار');
    if (!['CREDIT', 'DEBIT'].includes(type)) v.bad('نوع الإشعار: CREDIT أو DEBIT');
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 200) v.bad('أضف بنداً واحداً على الأقل');
    const lines = b.lines.map((l, i) => ({
      description: v.str(l.description, `وصف البند ${i + 1}`, { max: 200, optional: true }), qty: qty3(l.qty, `البند ${i + 1}`),
      price: v.money(l.price, `سعر البند ${i + 1}`), vatRate: pct(l.vatRate, `ضريبة البند ${i + 1}`),
      account: l.account ? v.str(l.account, `حساب البند ${i + 1}`, { max: 12 }) : null,
      origLineId: v.int(l.origLineId, `بند أصلي ${i + 1}`, { optional: true }), restock: l.restock === false || l.restock === 'N' ? 'N' : 'Y' }));
    const refund = v.money(b.refund, 'المبلغ المردود');
    const method = refund > 0 ? v.str(b.refundMethod, 'طريقة الرد') : null;
    if (method && !['CASH', 'BANK'].includes(method)) v.bad('طريقة الرد: CASH أو BANK');
    const out = await db.run(`
      DECLARE v_lines erp_note_line_tab; v_id NUMBER;
      BEGIN
        SELECT erp_note_line_t(description, qty, price, vat_rate, account_code, orig_line_id, restock) BULK COLLECT INTO v_lines
          FROM JSON_TABLE(:lines, '$[*]' COLUMNS (description VARCHAR2(200) PATH '$.description', qty NUMBER PATH '$.qty', price NUMBER PATH '$.price',
                 vat_rate NUMBER PATH '$.vatRate', account_code VARCHAR2(12) PATH '$.account', orig_line_id NUMBER PATH '$.origLineId', restock VARCHAR2(1) PATH '$.restock'));
        v_id := erp_cdnote.create_note(:inv, :t, TO_DATE(:d, 'YYYY-MM-DD'), :reason, v_lines, :refund, :method);
        :id := v_id;
      END;`,
    { lines: JSON.stringify(lines), inv: v.int(b.invoiceId, 'الفاتورة'), t: type, d: v.date(b.date, 'تاريخ الإشعار'), reason: v.str(b.reason, 'سبب الإشعار', { max: 300 }),
      refund, method, id: { dir: db.oracledb.BIND_OUT, type: N } });
    res.status(201).json({ note: await loadNote(out.outBinds.id) });
  }));

  r.post('/notes/:id/void', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الإشعار');
    await db.run('BEGIN erp_cdnote.void_note(:id); END;', { id });
    res.json({ note: await loadNote(id) });
  }));

  return r;
};
