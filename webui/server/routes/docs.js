// أوامر الشراء وعروض الأسعار. كل المنطق عبر ERP_PO وERP_QUOTE؛ الاستلام والتحويل ينشئان فاتورة فعلية في المعاملة نفسها.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const N = db.oracledb.NUMBER;
const OUT = (type) => ({ dir: db.oracledb.BIND_OUT, type });
const optDate = (x, l) => ({ val: v.date(x, l, { optional: true }), type: db.oracledb.STRING });

function qty3(x, label) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) v.bad(`${label}: كمية غير صالحة`);
  if (Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6) v.bad(`${label}: أكثر من 3 منازل عشرية`);
  return n;
}
function pct(x, label) {
  if (x === undefined || x === null || x === '') return null;
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0 || n > 100) v.bad(`${label}: نسبة غير صالحة`);
  return n;
}
const optMoney = (x, l) => (x === undefined || x === null || x === '' ? null : v.money(x, l));
const optInt = (x, l) => v.int(x, l, { optional: true });

function cleanLines(raw, withDiscount) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 200) v.bad('أضف بنداً واحداً على الأقل');
  return raw.map((l, i) => {
    const n = `البند ${i + 1}`;
    const o = { itemId: optInt(l.itemId, `صنف ${n}`), whId: optInt(l.whId, `مخزن ${n}`), description: v.str(l.description, `وصف ${n}`, { max: 200, optional: true }),
      qty: qty3(l.qty, n), price: optMoney(l.price, `سعر ${n}`), vatRate: pct(l.vatRate, `ضريبة ${n}`), account: l.account ? v.str(l.account, `حساب ${n}`, { max: 12 }) : null };
    if (withDiscount) o.discountPct = pct(l.discountPct, `خصم ${n}`);
    return o;
  });
}

module.exports = function docRoutes() {
  const r = express.Router();

  // ---------- الإعدادات ----------
  r.get('/settings', wrap(async (req, res) => {
    const x = (await db.query(`SELECT erp_po.get_setting('PO_APPROVAL_LIMIT') AS "poLimit", erp_quote.get_setting('QUOTE_MAX_DISCOUNT_PCT') AS "quoteMaxDiscount" FROM dual`))[0];
    res.json(x);
  }));
  r.post('/settings', wrap(async (req, res) => {
    const b = req.body || {};
    const name = v.str(b.name, 'الإعداد');
    const val = b.value === null || b.value === '' || b.value === undefined ? null : v.str(b.value, 'القيمة', { max: 40 });
    if (name === 'PO_APPROVAL_LIMIT') await db.run('BEGIN erp_po.set_setting(:n, :v); END;', { n: name, v: val });
    else if (name === 'QUOTE_MAX_DISCOUNT_PCT') await db.run('BEGIN erp_quote.set_setting(:n, :v); END;', { n: name, v: val });
    else v.bad('إعداد غير معروف');
    res.json({ ok: true });
  }));

  // ======================= أوامر الشراء =======================
  const PO = `SELECT po.po_id AS "id", po.po_no AS "no", po.party_id AS "partyId", pa.name AS "partyName", TO_CHAR(po.po_date, 'YYYY-MM-DD') AS "date",
      TO_CHAR(po.expected_date, 'YYYY-MM-DD') AS "expected", po.status AS "status", po.subtotal AS "subtotal", po.vat_amount AS "vat", po.total AS "total",
      po.notes AS "notes", po.created_by AS "createdBy", po.approved_by AS "approvedBy",
      CASE WHEN po.status IN ('APPROVED','PARTIAL') AND po.expected_date < TRUNC(SYSDATE) THEN 'Y' ELSE 'N' END AS "overdue"
      FROM erp_purchase_orders po JOIN erp_parties pa ON pa.party_id = po.party_id`;

  async function loadPo(id) {
    const h = await db.query(`${PO} WHERE po.po_id = :id`, { id });
    if (!h.length) throw new db.HttpError(404, 'أمر الشراء غير موجود');
    const lines = await db.query(`SELECT line_id AS "id", line_no AS "no", item_id AS "itemId", wh_id AS "whId", description AS "description", qty AS "qty", price AS "price",
      vat_rate AS "vatRate", account_code AS "account", net AS "net", vat AS "vat", received_qty AS "received" FROM erp_po_lines WHERE po_id = :id ORDER BY line_no`, { id });
    const rcpts = await db.query(`SELECT receipt_id AS "id", invoice_id AS "invoiceId", TO_CHAR(receipt_date, 'YYYY-MM-DD') AS "date", status AS "status", note AS "note"
      FROM erp_po_receipts WHERE po_id = :id ORDER BY receipt_id`, { id });
    return { ...h[0], lines, receipts: rcpts };
  }

  r.get('/po', wrap(async (req, res) => {
    const status = req.query.status || null;
    if (status && !['DRAFT', 'APPROVED', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED'].includes(status)) v.bad('الحالة غير صالحة');
    res.json({ orders: await db.query(`${PO} WHERE (:s IS NULL OR po.status = :s) ORDER BY po.po_id DESC FETCH FIRST 200 ROWS ONLY`, { s: status }) });
  }));
  r.get('/po/:id', wrap(async (req, res) => { res.json({ order: await loadPo(v.int(req.params.id, 'رقم الأمر')) }); }));

  const poLinesSql = `SELECT erp_po_line_t(item_id, wh_id, description, qty, price, vat_rate, account_code) BULK COLLECT INTO v_lines
      FROM JSON_TABLE(:lines, '$[*]' COLUMNS (item_id NUMBER PATH '$.itemId', wh_id NUMBER PATH '$.whId', description VARCHAR2(200) PATH '$.description',
        qty NUMBER PATH '$.qty', price NUMBER PATH '$.price', vat_rate NUMBER PATH '$.vatRate', account_code VARCHAR2(12) PATH '$.account'));`;

  r.post('/po', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run(`DECLARE v_lines erp_po_line_tab; v_id NUMBER; BEGIN ${poLinesSql}
        v_id := erp_po.create_po(:p, TO_DATE(:d, 'YYYY-MM-DD'), CASE WHEN :e IS NULL THEN NULL ELSE TO_DATE(:e, 'YYYY-MM-DD') END, :n, v_lines); :id := v_id; END;`,
      { lines: JSON.stringify(cleanLines(b.lines, false)), p: v.int(b.partyId, 'المورد'), d: v.date(b.date, 'التاريخ'), e: optDate(b.expected, 'موعد التوريد'),
        n: v.str(b.notes, 'الملاحظات', { max: 300, optional: true }), id: OUT(N) });
    res.status(201).json({ order: await loadPo(out.outBinds.id) });
  }));

  r.put('/po/:id/lines', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الأمر');
    await db.run(`DECLARE v_lines erp_po_line_tab; BEGIN ${poLinesSql} erp_po.replace_lines(:id, v_lines); END;`, { lines: JSON.stringify(cleanLines((req.body || {}).lines, false)), id });
    res.json({ order: await loadPo(id) });
  }));

  for (const [path, proc] of [['approve', 'approve_po'], ['cancel', 'cancel_po'], ['close', 'close_po']]) {
    r.post(`/po/:id/${path}`, wrap(async (req, res) => {
      const id = v.int(req.params.id, 'رقم الأمر');
      await db.run(`BEGIN erp_po.${proc}(:id); END;`, { id });
      res.json({ order: await loadPo(id) });
    }));
  }

  r.post('/po/:id/receive', wrap(async (req, res) => {
    const b = req.body || {};
    const id = v.int(req.params.id, 'رقم الأمر');
    if (!Array.isArray(b.lines) || !b.lines.length) v.bad('حدّد الكميات المستلمة');
    const lines = b.lines.map((l, i) => ({ lineId: v.int(l.lineId, `بند ${i + 1}`), qty: qty3(l.qty, `كمية البند ${i + 1}`), price: optMoney(l.price, `سعر البند ${i + 1}`) }));
    const out = await db.run(`DECLARE v_lines erp_po_rcv_tab; v_id NUMBER; BEGIN
        SELECT erp_po_rcv_t(line_id, qty, price) BULK COLLECT INTO v_lines FROM JSON_TABLE(:lines, '$[*]' COLUMNS (line_id NUMBER PATH '$.lineId', qty NUMBER PATH '$.qty', price NUMBER PATH '$.price'));
        v_id := erp_po.receive(:id, TO_DATE(:d, 'YYYY-MM-DD'), :ref, v_lines, :n); :rid := v_id; END;`,
      { lines: JSON.stringify(lines), id, d: v.date(b.date, 'تاريخ الاستلام'), ref: v.str(b.ref, 'رقم فاتورة المورد', { max: 60, optional: true }),
        n: v.str(b.note, 'الملاحظة', { max: 300, optional: true }), rid: OUT(N) });
    res.status(201).json({ receiptId: out.outBinds.rid, order: await loadPo(id) });
  }));

  r.post('/po/receipts/:rid/void', wrap(async (req, res) => {
    const rid = v.int(req.params.rid, 'رقم الاستلام');
    const po = (await db.query('SELECT po_id AS "id" FROM erp_po_receipts WHERE receipt_id = :r', { r: rid }))[0];
    if (!po) throw new db.HttpError(404, 'الاستلام غير موجود');
    await db.run('BEGIN erp_po.void_receipt(:r); END;', { r: rid });
    res.json({ order: await loadPo(po.id) });
  }));

  // ======================= عروض الأسعار =======================
  const Q = `SELECT q.quote_id AS "id", q.quote_no AS "no", q.party_id AS "partyId", pa.name AS "partyName", TO_CHAR(q.quote_date, 'YYYY-MM-DD') AS "date",
      TO_CHAR(q.valid_until, 'YYYY-MM-DD') AS "validUntil", q.status AS "status", q.subtotal AS "subtotal", q.vat_amount AS "vat", q.total AS "total",
      q.notes AS "notes", q.terms AS "terms", q.revision_of AS "revisionOf", q.invoice_id AS "invoiceId",
      CASE WHEN q.status = 'SENT' AND q.valid_until < TRUNC(SYSDATE) THEN 'Y' ELSE 'N' END AS "expiredFlag",
      (SELECT n.quote_id FROM erp_quotations n WHERE n.revision_of = q.quote_id AND ROWNUM = 1) AS "revisedBy"
      FROM erp_quotations q JOIN erp_parties pa ON pa.party_id = q.party_id`;

  async function loadQuote(id) {
    const h = await db.query(`${Q} WHERE q.quote_id = :id`, { id });
    if (!h.length) throw new db.HttpError(404, 'عرض السعر غير موجود');
    const lines = await db.query(`SELECT line_no AS "no", item_id AS "itemId", wh_id AS "whId", description AS "description", qty AS "qty", discount_pct AS "discountPct",
      unit_net_price AS "unitNetPrice", vat_rate AS "vatRate", account_code AS "account", net AS "net", vat AS "vat" FROM erp_quote_lines WHERE quote_id = :id ORDER BY line_no`, { id });
    return { ...h[0], lines };
  }

  r.get('/quotes/pipeline', wrap(async (req, res) => {
    res.json({ rows: await db.query('SELECT status AS "status", quotes AS "quotes", total_value AS "totalValue" FROM v_erp_quote_pipeline ORDER BY status') });
  }));
  r.get('/quotes', wrap(async (req, res) => {
    const status = req.query.status || null;
    res.json({ quotes: await db.query(`${Q} WHERE (:s IS NULL OR q.status = :s) ORDER BY q.quote_id DESC FETCH FIRST 200 ROWS ONLY`, { s: status ? v.str(status, 'الحالة', { max: 10 }) : null }) });
  }));
  r.get('/quotes/:id', wrap(async (req, res) => { res.json({ quote: await loadQuote(v.int(req.params.id, 'رقم العرض')) }); }));

  const qLinesSql = `SELECT erp_quote_line_t(item_id, wh_id, description, qty, price, discount_pct, vat_rate, account_code) BULK COLLECT INTO v_lines
      FROM JSON_TABLE(:lines, '$[*]' COLUMNS (item_id NUMBER PATH '$.itemId', wh_id NUMBER PATH '$.whId', description VARCHAR2(200) PATH '$.description', qty NUMBER PATH '$.qty',
        price NUMBER PATH '$.price', discount_pct NUMBER PATH '$.discountPct', vat_rate NUMBER PATH '$.vatRate', account_code VARCHAR2(12) PATH '$.account'));`;

  r.post('/quotes', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run(`DECLARE v_lines erp_quote_line_tab; v_id NUMBER; BEGIN ${qLinesSql}
        v_id := erp_quote.create_quote(:p, TO_DATE(:d, 'YYYY-MM-DD'), TO_DATE(:vu, 'YYYY-MM-DD'), :n, :t, v_lines); :id := v_id; END;`,
      { lines: JSON.stringify(cleanLines(b.lines, true)), p: v.int(b.partyId, 'العميل'), d: v.date(b.date, 'التاريخ'), vu: v.date(b.validUntil, 'صالح حتى'),
        n: v.str(b.notes, 'الملاحظات', { max: 300, optional: true }), t: v.str(b.terms, 'الشروط', { max: 500, optional: true }), id: OUT(N) });
    res.status(201).json({ quote: await loadQuote(out.outBinds.id) });
  }));

  r.put('/quotes/:id/lines', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم العرض');
    await db.run(`DECLARE v_lines erp_quote_line_tab; BEGIN ${qLinesSql} erp_quote.replace_lines(:id, v_lines); END;`, { lines: JSON.stringify(cleanLines((req.body || {}).lines, true)), id });
    res.json({ quote: await loadQuote(id) });
  }));

  for (const [path, proc] of [['send', 'send_quote'], ['accept', 'accept_quote'], ['reject', 'reject_quote'], ['cancel', 'cancel_quote'], ['unconvert', 'unconvert']]) {
    r.post(`/quotes/:id/${path}`, wrap(async (req, res) => {
      const id = v.int(req.params.id, 'رقم العرض');
      await db.run(`BEGIN erp_quote.${proc}(:id${proc === 'accept_quote' ? ', NULL' : ''}); END;`, { id });
      res.json({ quote: await loadQuote(id) });
    }));
  }

  r.post('/quotes/:id/revise', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run("BEGIN :n := erp_quote.revise_quote(:id, CASE WHEN :d IS NULL THEN NULL ELSE TO_DATE(:d, 'YYYY-MM-DD') END, CASE WHEN :vu IS NULL THEN NULL ELSE TO_DATE(:vu, 'YYYY-MM-DD') END); END;",
      { id: v.int(req.params.id, 'رقم العرض'), d: optDate(b.date, 'التاريخ'), vu: optDate(b.validUntil, 'صالح حتى'), n: OUT(N) });
    res.status(201).json({ quote: await loadQuote(out.outBinds.n) });
  }));

  r.post('/quotes/:id/convert', wrap(async (req, res) => {
    const b = req.body || {};
    const id = v.int(req.params.id, 'رقم العرض');
    const out = await db.run("BEGIN :n := erp_quote.convert_to_invoice(:id, TO_DATE(:d, 'YYYY-MM-DD'), CASE WHEN :du IS NULL THEN NULL ELSE TO_DATE(:du, 'YYYY-MM-DD') END); END;",
      { id, d: v.date(b.date, 'تاريخ الفاتورة'), du: optDate(b.due, 'الاستحقاق'), n: OUT(N) });
    res.json({ invoiceId: out.outBinds.n, quote: await loadQuote(id) });
  }));

  r.post('/quotes/expire', wrap(async (req, res) => {
    const out = await db.run("BEGIN :n := erp_quote.expire_old(CASE WHEN :d IS NULL THEN NULL ELSE TO_DATE(:d, 'YYYY-MM-DD') END); END;", { d: optDate((req.body || {}).asof, 'بتاريخ'), n: OUT(N) });
    res.json({ expired: out.outBinds.n });
  }));

  return r;
};
