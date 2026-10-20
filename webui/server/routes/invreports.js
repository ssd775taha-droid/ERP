// تقارير المخزون (قراءة فقط) من سجل الحركات غير القابل للتعديل: تقييم بتاريخ، كارت صنف، ملخص حركة، ركود، ونواقص وتغطية.
// الكمية والقيمة في الحركات موقّعتان (وارد +، صادر −) وإلغاء الحركة يظهر حركة عكسية، فالمجاميع صحيحة دائماً.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const DAY = 86400000;

module.exports = function invReportRoutes() {
  const r = express.Router();

  // تقييم المخزون بتاريخ: لكل صنف (أو صنف/مخزن) الكمية والقيمة ومتوسط التكلفة
  r.get('/inventory/reports/valuation', wrap(async (req, res) => {
    const asof = v.date(req.query.asof, 'بتاريخ');
    const wh = v.int(req.query.wh, 'المخزن', { optional: true });
    const split = req.query.split === '1';
    const rows = await db.query(`
      SELECT i.item_id AS "itemId", i.code AS "code", i.name AS "name", i.unit AS "unit",
             ${split ? 'w.wh_id AS "whId", w.name AS "whName",' : 'NULL AS "whId", NULL AS "whName",'}
             SUM(m.qty) AS "qty", SUM(m.value) AS "value"
        FROM erp_stock_moves m JOIN erp_items i ON i.item_id = m.item_id JOIN erp_warehouses w ON w.wh_id = m.wh_id
       WHERE m.move_date <= TO_DATE(:d, 'YYYY-MM-DD') AND (:wh IS NULL OR m.wh_id = :wh)
       GROUP BY i.item_id, i.code, i.name, i.unit ${split ? ', w.wh_id, w.name' : ''}
      HAVING SUM(m.qty) <> 0 OR SUM(m.value) <> 0
       ORDER BY SUM(m.value) DESC, i.code`, { d: asof, wh });
    const out = rows.map((x) => ({ ...x, qty: r3(x.qty), value: r2(x.value), avgCost: x.qty ? r2(x.value / x.qty) : 0 }));
    const total = r2(out.reduce((s, x) => s + x.value, 0));
    res.json({ rows: out.map((x) => ({ ...x, share: total ? r2(x.value / total * 100) : 0 })), totalValue: total });
  }));

  // كارت الصنف: رصيد افتتاحي ثم الحركات برصيد جارٍ (كمية وقيمة)
  r.get('/inventory/reports/item-card', wrap(async (req, res) => {
    const item = v.int(req.query.item, 'الصنف');
    const wh = v.int(req.query.wh, 'المخزن', { optional: true });
    const from = v.date(req.query.from, 'من تاريخ'), to = v.date(req.query.to, 'إلى تاريخ');
    const it = await db.query(`SELECT item_id AS "id", code AS "code", name AS "name", unit AS "unit" FROM erp_items WHERE item_id = :i`, { i: item });
    if (!it.length) throw new db.HttpError(404, 'الصنف غير موجود');
    const [op] = await db.query(`SELECT NVL(SUM(qty), 0) AS "qty", NVL(SUM(value), 0) AS "value" FROM erp_stock_moves
       WHERE item_id = :i AND (:wh IS NULL OR wh_id = :wh) AND move_date < TO_DATE(:f, 'YYYY-MM-DD')`, { i: item, wh, f: from });
    const moves = await db.query(`
      SELECT m.move_id AS "id", TO_CHAR(m.move_date, 'YYYY-MM-DD') AS "date", w.name AS "whName", m.move_type AS "type", m.qty AS "qty", m.value AS "value",
             m.ref_type AS "refType", m.ref_id AS "refId", m.reverses AS "reverses"
        FROM erp_stock_moves m JOIN erp_warehouses w ON w.wh_id = m.wh_id
       WHERE m.item_id = :i AND (:wh IS NULL OR m.wh_id = :wh) AND m.move_date BETWEEN TO_DATE(:f, 'YYYY-MM-DD') AND TO_DATE(:t, 'YYYY-MM-DD')
       ORDER BY m.move_date, m.move_id`, { i: item, wh, f: from, t: to });
    let q = op.qty, val = op.value;
    const rows = moves.map((m) => { q = r3(q + m.qty); val = r2(val + m.value); return { ...m, balQty: q, balValue: val }; });
    res.json({ item: it[0], opening: { qty: r3(op.qty), value: r2(op.value) }, rows, closing: { qty: q, value: val } });
  }));

  // ملخص حركة المخزون للفترة لكل صنف: افتتاحي + وارد − صادر = ختامي. التحويل بين المخازن يُستبعد حين لا يُحدَّد مخزن
  r.get('/inventory/reports/movement', wrap(async (req, res) => {
    const from = v.date(req.query.from, 'من تاريخ'), to = v.date(req.query.to, 'إلى تاريخ');
    const wh = v.int(req.query.wh, 'المخزن', { optional: true });
    const rows = await db.query(`
      SELECT i.item_id AS "itemId", i.code AS "code", i.name AS "name", i.unit AS "unit",
        SUM(CASE WHEN m.move_date < TO_DATE(:f, 'YYYY-MM-DD') THEN m.qty ELSE 0 END) AS "openQty",
        SUM(CASE WHEN m.move_date < TO_DATE(:f, 'YYYY-MM-DD') THEN m.value ELSE 0 END) AS "openValue",
        SUM(CASE WHEN m.move_date >= TO_DATE(:f, 'YYYY-MM-DD') AND m.qty > 0 THEN m.qty ELSE 0 END) AS "inQty",
        SUM(CASE WHEN m.move_date >= TO_DATE(:f, 'YYYY-MM-DD') AND m.qty > 0 THEN m.value ELSE 0 END) AS "inValue",
        SUM(CASE WHEN m.move_date >= TO_DATE(:f, 'YYYY-MM-DD') AND m.qty < 0 THEN -m.qty ELSE 0 END) AS "outQty",
        SUM(CASE WHEN m.move_date >= TO_DATE(:f, 'YYYY-MM-DD') AND m.qty < 0 THEN -m.value ELSE 0 END) AS "outValue",
        SUM(m.qty) AS "closeQty", SUM(m.value) AS "closeValue"
        FROM erp_stock_moves m JOIN erp_items i ON i.item_id = m.item_id
       WHERE m.move_date <= TO_DATE(:t, 'YYYY-MM-DD') AND (:wh IS NOT NULL OR m.ref_type <> 'TRANSFER') AND (:wh IS NULL OR m.wh_id = :wh)
       GROUP BY i.item_id, i.code, i.name, i.unit
      HAVING SUM(ABS(m.qty)) <> 0
       ORDER BY i.code`, { f: from, t: to, wh });
    const out = rows.map((x) => ({ ...x, openQty: r3(x.openQty), openValue: r2(x.openValue), inQty: r3(x.inQty), inValue: r2(x.inValue), outQty: r3(x.outQty), outValue: r2(x.outValue), closeQty: r3(x.closeQty), closeValue: r2(x.closeValue) }))
      .filter((x) => x.openQty || x.inQty || x.outQty || x.closeQty);
    const sum = (k) => r2(out.reduce((s, x) => s + x[k], 0));
    res.json({ rows: out, totals: { openValue: sum('openValue'), inValue: sum('inValue'), outValue: sum('outValue'), closeValue: sum('closeValue') } });
  }));

  // ركود المخزون: أصناف لها رصيد ولم تُبَع منذ N يوماً (أو لم تُبَع قط) مع قيمة المحتجز
  r.get('/inventory/reports/slow-moving', wrap(async (req, res) => {
    const days = Math.min(v.int(req.query.days, 'عدد الأيام', { optional: true, min: 1 }) || 90, 3650);
    const asof = v.date(req.query.asof, 'بتاريخ');
    const rows = await db.query(`
      SELECT i.item_id AS "itemId", i.code AS "code", i.name AS "name", i.unit AS "unit", s.qty AS "qty", s.value AS "value",
             TO_CHAR(l.last_sale, 'YYYY-MM-DD') AS "lastSale", TO_CHAR(f.first_in, 'YYYY-MM-DD') AS "firstIn"
        FROM (SELECT item_id, SUM(qty) AS qty, SUM(value) AS value FROM erp_stock_moves WHERE move_date <= TO_DATE(:d, 'YYYY-MM-DD') GROUP BY item_id HAVING SUM(qty) > 0) s
        JOIN erp_items i ON i.item_id = s.item_id
        LEFT JOIN (SELECT item_id, MAX(move_date) AS last_sale FROM erp_stock_moves WHERE move_type = 'SALE' AND qty < 0 AND move_date <= TO_DATE(:d, 'YYYY-MM-DD') GROUP BY item_id) l ON l.item_id = s.item_id
        LEFT JOIN (SELECT item_id, MIN(move_date) AS first_in FROM erp_stock_moves WHERE qty > 0 GROUP BY item_id) f ON f.item_id = s.item_id
       ORDER BY s.value DESC`, { d: asof });
    const t = Date.parse(asof + 'T00:00:00Z');
    const out = rows.map((x) => {
      const ref = x.lastSale || x.firstIn;                      // لم يُبَع قط: العمر من أول وارد
      const idle = ref ? Math.floor((t - Date.parse(ref + 'T00:00:00Z')) / DAY) : null;
      return { ...x, qty: r3(x.qty), value: r2(x.value), idleDays: idle, neverSold: !x.lastSale };
    }).filter((x) => x.idleDays != null && x.idleDays >= days);
    res.json({ days, rows: out, totalValue: r2(out.reduce((s, x) => s + x.value, 0)) });
  }));

  // نواقص وتغطية: أصناف مخزنية نشطة رصيدها ≤ حد، مع معدل البيع اليومي آخر 90 يوماً وأيام التغطية
  r.get('/inventory/reports/shortage', wrap(async (req, res) => {
    const limit = req.query.limit === undefined || req.query.limit === '' ? 0 : Number(req.query.limit);
    if (!Number.isFinite(limit) || limit < 0) v.bad('الحد غير صالح');
    const asof = v.date(req.query.asof, 'بتاريخ');
    const rows = await db.query(`
      SELECT i.item_id AS "itemId", i.code AS "code", i.name AS "name", i.unit AS "unit", NVL(s.qty, 0) AS "qty", NVL(s.value, 0) AS "value", NVL(o.sold, 0) AS "sold90"
        FROM erp_items i
        LEFT JOIN (SELECT item_id, SUM(qty) AS qty, SUM(value) AS value FROM erp_stock_moves WHERE move_date <= TO_DATE(:d, 'YYYY-MM-DD') GROUP BY item_id) s ON s.item_id = i.item_id
        LEFT JOIN (SELECT item_id, SUM(-qty) AS sold FROM erp_stock_moves WHERE move_type = 'SALE' AND move_date > TO_DATE(:d, 'YYYY-MM-DD') - 90 AND move_date <= TO_DATE(:d, 'YYYY-MM-DD') GROUP BY item_id) o ON o.item_id = i.item_id
       WHERE i.track_stock = 'Y' AND i.active = 'Y' AND NVL(s.qty, 0) <= :lim
       ORDER BY NVL(o.sold, 0) DESC, i.code`, { d: asof, lim: limit });
    const out = rows.map((x) => { const daily = x.sold90 / 90; return { ...x, qty: r3(x.qty), value: r2(x.value), sold90: r3(x.sold90), daily: r3(daily), coverDays: daily > 0 ? Math.floor(x.qty / daily) : null }; });
    res.json({ limit, rows: out });
  }));
  return r;
};
