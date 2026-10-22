// الأصناف والمخازن والأرصدة وحركات المخزون والتسويات والتحويلات. الحركات عبر ERP_INVENTORY.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

function qty3(x, label, { signed = false } = {}) {
  const n = Number(x);
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1e9 || (!signed && n < 0)) v.bad(`${label}: كمية غير صالحة`);
  if (Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6) v.bad(`${label}: أكثر من 3 منازل عشرية`);
  return n;
}
function pct(x, label) {
  if (x === undefined || x === null || x === '') return 0;
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0 || n > 100) v.bad(`${label}: نسبة غير صالحة`);
  return n;
}
const OUT = (type) => ({ dir: db.oracledb.BIND_OUT, type });

module.exports = function inventoryRoutes() {
  const r = express.Router();

  // ---------- الأصناف ----------
  r.get('/inventory/items', wrap(async (req, res) => {
    res.json({ items: await db.query(`
      SELECT i.item_id AS "id", i.code AS "code", i.name AS "name", i.unit AS "unit", i.sale_price AS "price", i.vat_rate AS "vat",
             i.barcode AS "barcode", i.track_stock AS "trackStock", i.inv_account AS "invAccount", i.cogs_account AS "cogsAccount",
             i.rev_account AS "revAccount", i.active AS "active",
             NVL((SELECT SUM(s.qty) FROM erp_stock s WHERE s.item_id = i.item_id), 0) AS "qty",
             NVL((SELECT SUM(s.value) FROM erp_stock s WHERE s.item_id = i.item_id), 0) AS "value"
        FROM erp_items i ORDER BY i.code`) });
  }));

  r.post('/inventory/items', wrap(async (req, res) => {
    const b = req.body || {};
    const code = v.str(b.code, 'رمز الصنف', { max: 30 });
    const name = v.str(b.name, 'اسم الصنف', { max: 120 });
    const unit = v.str(b.unit, 'الوحدة', { max: 20, optional: true }) || 'قطعة';
    const price = v.money(b.price, 'سعر البيع');
    const vat = pct(b.vat, 'الضريبة');
    const track = b.trackStock === false || b.trackStock === 'N' ? 'N' : 'Y';
    const barcode = v.str(b.barcode, 'الباركود', { max: 40, optional: true });
    const acc = (x, d, l) => (x ? v.str(x, l, { max: 12 }) : d);
    const out = await db.run('BEGIN :id := erp_inventory.add_item(:c, :n, :u, :p, :t, :ia, :ca, :ra, :v, :b); END;', {
      c: code, n: name, u: unit, p: price, t: track, ia: acc(b.invAccount, '1400', 'حساب المخزون'),
      ca: acc(b.cogsAccount, '5100', 'حساب التكلفة'), ra: acc(b.revAccount, '4100', 'حساب الإيراد'), v: vat, b: barcode, id: OUT(db.oracledb.NUMBER) });
    res.status(201).json({ id: out.outBinds.id });
  }));

  // تعديل بيانات وصفية فقط (الاسم والسعر والضريبة والإيقاف)؛ الحسابات لا تتغير بعد وجود حركة
  r.patch('/inventory/items/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الصنف');
    const b = req.body || {};
    const name = b.name === undefined ? null : v.str(b.name, 'الاسم', { max: 120 });
    const price = b.price === undefined ? null : v.money(b.price, 'السعر');
    const vat = b.vat === undefined ? null : pct(b.vat, 'الضريبة');
    const active = b.active === undefined ? null : (b.active ? 'Y' : 'N');
    if (name === null && price === null && vat === null && active === null) v.bad('لا تغيير مطلوب');
    const r1 = await db.run(`UPDATE erp_items SET name = NVL(:n, name), sale_price = NVL(:p, sale_price), vat_rate = NVL(:v, vat_rate), active = NVL(:a, active) WHERE item_id = :id`,
      { n: name, p: price, v: vat, a: active, id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'الصنف غير موجود');
    res.json({ ok: true });
  }));

  // ---------- المخازن ----------
  r.get('/inventory/warehouses', wrap(async (req, res) => {
    res.json({ warehouses: await db.query(`
      SELECT w.wh_id AS "id", w.code AS "code", w.name AS "name", w.active AS "active",
             NVL((SELECT SUM(s.value) FROM erp_stock s WHERE s.wh_id = w.wh_id), 0) AS "value"
        FROM erp_warehouses w ORDER BY w.code`) });
  }));
  r.post('/inventory/warehouses', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run('BEGIN :id := erp_inventory.add_warehouse(:c, :n); END;',
      { c: v.str(b.code, 'رمز المخزن', { max: 12 }), n: v.str(b.name, 'اسم المخزن', { max: 120 }), id: OUT(db.oracledb.NUMBER) });
    res.status(201).json({ id: out.outBinds.id });
  }));
  r.patch('/inventory/warehouses/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم المخزن');
    const b = req.body || {};
    if (b.active === undefined) v.bad('لا تغيير مطلوب');
    const r1 = await db.run('UPDATE erp_warehouses SET active = :a WHERE wh_id = :id', { a: b.active ? 'Y' : 'N', id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'المخزن غير موجود');
    res.json({ ok: true });
  }));

  // ---------- الأرصدة والحركات ----------
  r.get('/inventory/stock', wrap(async (req, res) => {
    const wh = v.int(req.query.wh, 'المخزن', { optional: true });
    const item = v.int(req.query.item, 'الصنف', { optional: true });
    const rows = await db.query(`
      SELECT item_id AS "itemId", item_code AS "itemCode", item_name AS "itemName", unit AS "unit", wh_id AS "whId", wh_name AS "whName",
             qty AS "qty", value AS "value", avg_cost AS "avgCost"
        FROM v_erp_stock WHERE (:wh IS NULL OR wh_id = :wh) AND (:item IS NULL OR item_id = :item) ORDER BY item_code, wh_code`, { wh, item });
    res.json({ rows, totalValue: Math.round(rows.reduce((s, x) => s + x.value, 0) * 100) / 100 });
  }));

  r.get('/inventory/moves', wrap(async (req, res) => {
    const item = v.int(req.query.item, 'الصنف', { optional: true });
    const wh = v.int(req.query.wh, 'المخزن', { optional: true });
    const from = v.date(req.query.from, 'من تاريخ', { optional: true });
    const to = v.date(req.query.to, 'إلى تاريخ', { optional: true });
    const rows = await db.query(`
      SELECT m.move_id AS "id", TO_CHAR(m.move_date, 'YYYY-MM-DD') AS "date", i.code AS "itemCode", i.name AS "itemName", w.name AS "whName",
             m.move_type AS "type", m.qty AS "qty", m.value AS "value", m.ref_type AS "refType", m.ref_id AS "refId", m.reverses AS "reverses"
        FROM erp_stock_moves m JOIN erp_items i ON i.item_id = m.item_id JOIN erp_warehouses w ON w.wh_id = m.wh_id
       WHERE (:item IS NULL OR m.item_id = :item) AND (:wh IS NULL OR m.wh_id = :wh)
         AND (:f IS NULL OR m.move_date >= TO_DATE(:f, 'YYYY-MM-DD')) AND (:t IS NULL OR m.move_date <= TO_DATE(:t, 'YYYY-MM-DD'))
       ORDER BY m.move_id DESC FETCH FIRST 300 ROWS ONLY`, { item, wh, f: from, t: to });
    res.json({ moves: rows });
  }));

  // مطابقة قيمة المخزون مع الأستاذ
  r.get('/inventory/check', wrap(async (req, res) => {
    const rows = await db.query(`SELECT inv_account AS "account", stock_value AS "stockValue", gl_balance AS "glBalance", difference AS "difference" FROM v_erp_stock_vs_gl ORDER BY inv_account`);
    res.json({ rows, ok: rows.every((x) => x.difference === 0) });
  }));

  // ---------- التسوية والتحويل ----------
  r.post('/inventory/adjust', wrap(async (req, res) => {
    const b = req.body || {};
    const itemId = v.int(b.itemId, 'الصنف');
    const whId = v.int(b.whId, 'المخزن');
    const date = v.date(b.date, 'التاريخ');
    const delta = qty3(b.qtyDelta, 'الكمية', { signed: true });
    const cost = b.unitCost === undefined || b.unitCost === null || b.unitCost === '' ? null : v.money(b.unitCost, 'تكلفة الوحدة');
    const offset = b.offsetAccount ? v.str(b.offsetAccount, 'الحساب المقابل', { max: 12 }) : '5500';
    const note = v.str(b.note, 'الملاحظة', { max: 300, optional: true });
    const out = await db.run("BEGIN :e := erp_inventory.adjust(:i, :w, TO_DATE(:d, 'YYYY-MM-DD'), :q, :c, :o, :n); END;",
      { i: itemId, w: whId, d: date, q: delta, c: { val: cost, type: db.oracledb.NUMBER }, o: offset, n: note, e: OUT(db.oracledb.NUMBER) });
    res.status(201).json({ entryId: out.outBinds.e });
  }));

  r.post('/inventory/transfer', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run("BEGIN :val := erp_inventory.transfer(:i, :f, :t, TO_DATE(:d, 'YYYY-MM-DD'), :q); END;", {
      i: v.int(b.itemId, 'الصنف'), f: v.int(b.fromWh, 'من مخزن'), t: v.int(b.toWh, 'إلى مخزن'),
      d: v.date(b.date, 'التاريخ'), q: qty3(b.qty, 'الكمية'), val: OUT(db.oracledb.NUMBER) });
    res.status(201).json({ value: out.outBinds.val });
  }));

  return r;
};
