// نقاط البيع: النقاط والورديات والبيع والمرتجع والإلغاء. كل الترحيل عبر ERP_POS (قيد واحد لكل عملية).
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const N = db.oracledb.NUMBER;
const OUT = (type) => ({ dir: db.oracledb.BIND_OUT, type });

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
const optMoney = (x, label) => (x === undefined || x === null || x === '' ? null : v.money(x, label));

module.exports = function posRoutes() {
  const r = express.Router();

  // ---------- النقاط ----------
  r.get('/pos/registers', wrap(async (req, res) => {
    res.json({ registers: await db.query(`
      SELECT r.reg_id AS "id", r.code AS "code", r.name AS "name", r.wh_id AS "whId", w.name AS "whName", r.cash_account AS "cashAccount",
             r.prices_include_vat AS "pricesIncludeVat", r.active AS "active",
             (SELECT s.shift_id FROM erp_pos_shifts s WHERE s.reg_id = r.reg_id AND s.status = 'OPEN') AS "openShiftId"
        FROM erp_pos_registers r JOIN erp_warehouses w ON w.wh_id = r.wh_id ORDER BY r.code`) });
  }));
  r.post('/pos/registers', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run('BEGIN :id := erp_pos.add_register(:c, :n, :w, :ca, :pv); END;', {
      c: v.str(b.code, 'رمز النقطة', { max: 12 }), n: v.str(b.name, 'اسم النقطة', { max: 120 }), w: v.int(b.whId, 'المخزن'),
      ca: b.cashAccount ? v.str(b.cashAccount, 'حساب الصندوق', { max: 12 }) : '1100', pv: b.pricesIncludeVat ? 'Y' : 'N', id: OUT(N) });
    res.status(201).json({ id: out.outBinds.id });
  }));

  // البحث بالباركود أو الرمز، مع الرصيد في مخزن النقطة
  r.get('/pos/lookup', wrap(async (req, res) => {
    const code = v.str(req.query.code, 'الباركود', { max: 60 });
    const reg = v.int(req.query.reg, 'النقطة', { optional: true });
    const rows = await db.query(`
      SELECT i.item_id AS "id", i.code AS "code", i.name AS "name", i.unit AS "unit", i.sale_price AS "price", i.vat_rate AS "vat", i.track_stock AS "trackStock",
             CASE WHEN i.track_stock = 'Y' THEN NVL((SELECT s.qty FROM erp_stock s JOIN erp_pos_registers r ON r.wh_id = s.wh_id
                  WHERE s.item_id = i.item_id AND r.reg_id = :reg), 0) END AS "onHand"
        FROM erp_items i WHERE i.item_id = erp_pos.find_item(:code) AND i.active = 'Y'`, { code, reg });
    if (!rows.length) throw new db.HttpError(404, 'لا صنف بهذا الباركود أو الرمز');
    res.json({ item: rows[0] });
  }));
  // قائمة أصناف للاختيار اليدوي
  r.get('/pos/items', wrap(async (req, res) => {
    const q = req.query.q ? `%${v.str(req.query.q, 'البحث', { max: 40 }).toLowerCase()}%` : null;
    res.json({ items: await db.query(`SELECT item_id AS "id", code AS "code", name AS "name", sale_price AS "price", vat_rate AS "vat", barcode AS "barcode"
      FROM erp_items WHERE active = 'Y' AND (:q IS NULL OR LOWER(name) LIKE :q OR LOWER(code) LIKE :q) ORDER BY code FETCH FIRST 60 ROWS ONLY`, { q }) });
  }));

  // ---------- الورديات ----------
  const SHIFT = `SELECT shift_id AS "id", reg_code AS "regCode", reg_name AS "regName", cashier AS "cashier",
      TO_CHAR(opened_at, 'YYYY-MM-DD HH24:MI') AS "openedAt", TO_CHAR(closed_at, 'YYYY-MM-DD HH24:MI') AS "closedAt", status AS "status",
      opening_cash AS "openingCash", sales_count AS "salesCount", sales_total AS "salesTotal", sales_vat AS "salesVat", returns_total AS "returnsTotal",
      cash_sales AS "cashSales", card_sales AS "cardSales", cash_refunds AS "cashRefunds", card_refunds AS "cardRefunds",
      expected_cash AS "expectedCash", counted_cash AS "countedCash", variance AS "variance" FROM v_erp_pos_shift_summary`;

  r.get('/pos/shifts', wrap(async (req, res) => {
    const status = req.query.status || null;
    if (status && !['OPEN', 'CLOSED'].includes(status)) v.bad('الحالة غير صالحة');
    res.json({ shifts: await db.query(`${SHIFT} WHERE (:s IS NULL OR status = :s) ORDER BY shift_id DESC FETCH FIRST 100 ROWS ONLY`, { s: status }) });
  }));
  r.get('/pos/shifts/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الوردية');
    const s = await db.query(`${SHIFT} WHERE shift_id = :id`, { id });
    if (!s.length) throw new db.HttpError(404, 'الوردية غير موجودة');
    const exp = s[0].status === 'OPEN' ? (await db.query('SELECT erp_pos.expected_cash(:id) AS "v" FROM dual', { id }))[0].v : s[0].expectedCash;
    res.json({ shift: { ...s[0], expectedCashNow: exp } });
  }));
  r.post('/pos/shifts/open', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run('BEGIN :id := erp_pos.open_shift(:r, :c); END;', { r: v.int(b.regId, 'النقطة'), c: v.money(b.openingCash, 'النقد الافتتاحي'), id: OUT(N) });
    res.status(201).json({ id: out.outBinds.id });
  }));
  r.post('/pos/shifts/:id/close', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الوردية');
    const out = await db.run('BEGIN :d := erp_pos.close_shift(:id, :c); END;', { id, c: v.money((req.body || {}).counted, 'النقد المعدود'), d: OUT(N) });
    res.json({ variance: out.outBinds.d });
  }));

  // ---------- المبيعات ----------
  const SALE = `SELECT s.sale_id AS "id", s.sale_no AS "no", s.kind AS "kind", s.orig_sale_id AS "origSaleId", s.shift_id AS "shiftId",
      TO_CHAR(s.sale_date, 'YYYY-MM-DD') AS "date", s.subtotal AS "subtotal", s.vat_amount AS "vat", s.total AS "total", s.tendered AS "tendered",
      s.change_due AS "changeDue", s.status AS "status", s.entry_id AS "entryId", s.cogs_entry_id AS "cogsEntryId" FROM erp_pos_sales s`;

  async function loadSale(id) {
    const h = await db.query(`${SALE} WHERE s.sale_id = :id`, { id });
    if (!h.length) throw new db.HttpError(404, 'العملية غير موجودة');
    const lines = await db.query(`SELECT line_id AS "id", item_id AS "itemId", description AS "description", qty AS "qty", price AS "price", discount_pct AS "discountPct",
      vat_rate AS "vatRate", net AS "net", vat AS "vat", orig_line_id AS "origLineId" FROM erp_pos_sale_lines WHERE sale_id = :id ORDER BY line_id`, { id });
    const pays = await db.query('SELECT method AS "method", amount AS "amount" FROM erp_pos_payments WHERE sale_id = :id ORDER BY pay_id', { id });
    // لبيع أصلي: الكمية المتاحة للإرجاع لكل بند (المباع − المرتجع غير الملغى)
    let returnable = {};
    if (h[0].kind === 'SALE') {
      const rows = await db.query(`SELECT l.line_id AS "id", l.qty - NVL((SELECT SUM(rl.qty) FROM erp_pos_sale_lines rl JOIN erp_pos_sales rs ON rs.sale_id = rl.sale_id
          WHERE rl.orig_line_id = l.line_id AND rs.status = 'COMPLETED'), 0) AS "left" FROM erp_pos_sale_lines l WHERE l.sale_id = :id`, { id });
      returnable = Object.fromEntries(rows.map((x) => [x.id, x.left]));
    }
    return { ...h[0], lines: lines.map((l) => ({ ...l, returnable: returnable[l.id] })), payments: pays };
  }

  r.get('/pos/sales', wrap(async (req, res) => {
    const shift = v.int(req.query.shift, 'الوردية', { optional: true });
    const from = v.date(req.query.from, 'من تاريخ', { optional: true });
    const to = v.date(req.query.to, 'إلى تاريخ', { optional: true });
    res.json({ sales: await db.query(`${SALE} WHERE (:sh IS NULL OR s.shift_id = :sh)
      AND (:f IS NULL OR s.sale_date >= TO_DATE(:f, 'YYYY-MM-DD')) AND (:t IS NULL OR s.sale_date <= TO_DATE(:t, 'YYYY-MM-DD'))
      ORDER BY s.sale_id DESC FETCH FIRST 200 ROWS ONLY`, { sh: shift, f: from, t: to }) });
  }));
  r.get('/pos/sales/:id', wrap(async (req, res) => { res.json({ sale: await loadSale(v.int(req.params.id, 'رقم العملية')) }); }));

  r.post('/pos/sales', wrap(async (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 200) v.bad('أضف صنفاً واحداً على الأقل');
    if (!Array.isArray(b.payments) || !b.payments.length) v.bad('أدخل الدفعة');
    const lines = b.lines.map((l, i) => ({ itemId: v.int(l.itemId, `صنف السطر ${i + 1}`), qty: qty3(l.qty, `السطر ${i + 1}`),
      price: optMoney(l.price, `سعر السطر ${i + 1}`), discountPct: pct(l.discountPct, `خصم السطر ${i + 1}`), vatRate: pct(l.vatRate, `ضريبة السطر ${i + 1}`) }));
    const pays = b.payments.map((p, i) => {
      if (!['CASH', 'CARD'].includes(p.method)) v.bad(`طريقة الدفع ${i + 1}: CASH أو CARD`);
      const a = v.money(p.amount, `مبلغ الدفعة ${i + 1}`); if (a <= 0) v.bad(`مبلغ الدفعة ${i + 1} يجب أن يكون أكبر من صفر`);
      return { method: p.method, amount: a };
    });
    const out = await db.run(`
      DECLARE
        v_lines erp_pos_line_tab; v_pays erp_pos_pay_tab; v_id NUMBER;
      BEGIN
        SELECT erp_pos_line_t(item_id, qty, price, discount_pct, vat_rate) BULK COLLECT INTO v_lines
          FROM JSON_TABLE(:lines, '$[*]' COLUMNS (item_id NUMBER PATH '$.itemId', qty NUMBER PATH '$.qty', price NUMBER PATH '$.price',
                 discount_pct NUMBER PATH '$.discountPct', vat_rate NUMBER PATH '$.vatRate'));
        SELECT erp_pos_pay_t(method, amount) BULK COLLECT INTO v_pays
          FROM JSON_TABLE(:pays, '$[*]' COLUMNS (method VARCHAR2(4) PATH '$.method', amount NUMBER PATH '$.amount'));
        v_id := erp_pos.sell(:shift, TO_DATE(:d, 'YYYY-MM-DD'), v_lines, v_pays);
        :id := v_id;
      END;`, { lines: JSON.stringify(lines), pays: JSON.stringify(pays), shift: v.int(b.shiftId, 'الوردية'), d: v.date(b.date, 'التاريخ'), id: OUT(N) });
    res.status(201).json({ sale: await loadSale(out.outBinds.id) });
  }));

  r.post('/pos/sales/:id/void', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم العملية');
    await db.run('BEGIN erp_pos.void_sale(:id); END;', { id });
    res.json({ sale: await loadSale(id) });
  }));

  r.post('/pos/sales/:id/return', wrap(async (req, res) => {
    const b = req.body || {};
    const method = v.str(b.method, 'طريقة الرد'); if (!['CASH', 'CARD'].includes(method)) v.bad('طريقة الرد: CASH أو CARD');
    if (!Array.isArray(b.lines) || !b.lines.length) v.bad('اختر بنداً للإرجاع');
    const lines = b.lines.map((l, i) => ({ lineId: v.int(l.lineId, `بند ${i + 1}`), qty: qty3(l.qty, `كمية البند ${i + 1}`) }));
    const out = await db.run(`
      DECLARE v_lines erp_pos_ret_tab; v_id NUMBER;
      BEGIN
        SELECT erp_pos_ret_t(line_id, qty) BULK COLLECT INTO v_lines FROM JSON_TABLE(:lines, '$[*]' COLUMNS (line_id NUMBER PATH '$.lineId', qty NUMBER PATH '$.qty'));
        v_id := erp_pos.return_sale(:shift, TO_DATE(:d, 'YYYY-MM-DD'), :orig, v_lines, :m);
        :id := v_id;
      END;`, { lines: JSON.stringify(lines), shift: v.int(b.shiftId, 'الوردية'), d: v.date(b.date, 'التاريخ'), orig: v.int(req.params.id, 'رقم العملية'), m: method, id: OUT(N) });
    res.status(201).json({ sale: await loadSale(out.outBinds.id) });
  }));

  return r;
};
