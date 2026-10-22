// نظام المقاهي: طاولات وخيارات أصناف (مقاسات/إضافات) وطلب يبقى مفتوحاً يُضاف إليه حتى الدفع (يستدعي ERP_CAFE
// التي تحوّله عند الإغلاق إلى عملية بيع فعلية عبر ERP_POS.SELL نفسها)، وشاشة مطبخ/بار.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const N = db.oracledb.NUMBER;
const OUT = (t) => ({ dir: db.oracledb.BIND_OUT, type: t });
const r2 = (n) => Math.round(n * 100) / 100;
function qty3(x, label, dflt) {
  if ((x === undefined || x === null || x === '') && dflt !== undefined) return dflt;
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) v.bad(`${label}: كمية غير صالحة`);
  if (Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6) v.bad(`${label}: أكثر من 3 منازل عشرية`);
  return n;
}

function ids(label) {
  return (req) => {
    const a = req.body && req.body[label];
    if (a === undefined || a === null) return [];
    if (!Array.isArray(a)) v.bad(label + ': قائمة أرقام متوقعة');
    return a.map((x, i) => v.int(x, label + ' ' + (i + 1)));
  };
}

module.exports = function cafeRoutes() {
  const r = express.Router();

  // ---------- الطاولات والأقسام ----------
  r.get('/cafe/tables', wrap(async (req, res) => {
    const reg = req.query.regId ? v.int(req.query.regId, 'النقطة') : null;
    res.json({ tables: await db.query(`SELECT table_id AS "id", reg_id AS "regId", area_id AS "areaId", area_name AS "areaName", code AS "code", name AS "name",
      seats AS "seats", active AS "active", open_order_id AS "openOrderId", open_since AS "openSince", guests AS "guests", waiter AS "waiter",
      line_count AS "lineCount", running_total AS "runningTotal" FROM v_erp_cafe_tables WHERE (:r IS NULL OR reg_id = :r) ORDER BY area_name NULLS FIRST, code`,
      { r: reg }) });
  }));
  r.post('/cafe/tables', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run(`INSERT INTO erp_cafe_tables (reg_id, area_id, code, name, seats) VALUES (:r, :a, :c, :n, :s) RETURNING table_id INTO :id`,
      { r: v.int(b.regId, 'النقطة'), a: b.areaId ? v.int(b.areaId, 'القسم') : null, c: v.str(b.code, 'الرمز', { max: 12 }),
        n: v.str(b.name, 'الاسم', { max: 80 }), s: v.int(b.seats, 'المقاعد', { optional: true }) || 4, id: OUT(N) });
    res.status(201).json({ id: out.outBinds.id[0] ?? out.outBinds.id });
  }));
  r.patch('/cafe/tables/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الطاولة'), b = req.body || {};
    const name = b.name === undefined ? null : v.str(b.name, 'الاسم', { max: 80 });
    const seats = b.seats === undefined ? null : v.int(b.seats, 'المقاعد');
    const active = b.active === undefined ? null : (b.active ? 'Y' : 'N');
    const area = b.areaId === undefined ? undefined : (b.areaId === null ? null : v.int(b.areaId, 'القسم'));
    const r1 = await db.run(`UPDATE erp_cafe_tables SET name = NVL(:n, name), seats = NVL(:s, seats), active = NVL(:a, active),
      area_id = CASE WHEN :chg = 1 THEN :ar ELSE area_id END WHERE table_id = :id`,
      { n: name, s: seats, a: active, chg: area === undefined ? 0 : 1, ar: area, id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'الطاولة غير موجودة');
    res.json({ ok: true });
  }));
  r.delete('/cafe/tables/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الطاولة');
    const [x] = await db.query('SELECT COUNT(*) AS "n" FROM erp_cafe_orders WHERE table_id = :id', { id });
    if (x.n) throw new db.HttpError(409, 'للطاولة طلبات سابقة: عطّلها بدلاً من حذفها');
    const r1 = await db.run('DELETE FROM erp_cafe_tables WHERE table_id = :id', { id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'الطاولة غير موجودة');
    res.json({ ok: true });
  }));

  r.get('/cafe/areas', wrap(async (req, res) => {
    const reg = req.query.regId ? v.int(req.query.regId, 'النقطة') : null;
    res.json({ areas: await db.query('SELECT area_id AS "id", reg_id AS "regId", name AS "name" FROM erp_cafe_areas WHERE (:r IS NULL OR reg_id = :r) ORDER BY name', { r: reg }) });
  }));
  r.post('/cafe/areas', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run('INSERT INTO erp_cafe_areas (reg_id, name) VALUES (:r, :n) RETURNING area_id INTO :id',
      { r: v.int(b.regId, 'النقطة'), n: v.str(b.name, 'الاسم', { max: 60 }), id: OUT(N) });
    res.status(201).json({ id: out.outBinds.id[0] ?? out.outBinds.id });
  }));
  r.delete('/cafe/areas/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'القسم');
    const r1 = await db.run('DELETE FROM erp_cafe_areas WHERE area_id = :id', { id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'القسم غير موجود');
    res.json({ ok: true });
  }));

  // ---------- خيارات الأصناف (المقاسات والإضافات) ----------
  r.get('/cafe/modifier-groups', wrap(async (req, res) => {
    const groups = await db.query('SELECT group_id AS "id", name AS "name", required AS "required", multi AS "multi", active AS "active" FROM erp_modifier_groups ORDER BY name');
    const options = await db.query('SELECT option_id AS "id", group_id AS "groupId", name AS "name", price_delta AS "priceDelta", active AS "active" FROM erp_modifier_options ORDER BY group_id, option_id');
    res.json({ groups: groups.map((g) => ({ ...g, options: options.filter((o) => o.groupId === g.id) })) });
  }));
  r.post('/cafe/modifier-groups', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run('INSERT INTO erp_modifier_groups (name, required, multi) VALUES (:n, :r, :m) RETURNING group_id INTO :id',
      { n: v.str(b.name, 'الاسم', { max: 80 }), r: b.required ? 'Y' : 'N', m: b.multi ? 'Y' : 'N', id: OUT(N) });
    res.status(201).json({ id: out.outBinds.id[0] ?? out.outBinds.id });
  }));
  r.patch('/cafe/modifier-groups/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'المجموعة'), b = req.body || {};
    const r1 = await db.run(`UPDATE erp_modifier_groups SET name = NVL(:n, name), required = NVL(:r, required), multi = NVL(:m, multi), active = NVL(:a, active) WHERE group_id = :id`,
      { n: b.name === undefined ? null : v.str(b.name, 'الاسم', { max: 80 }), r: b.required === undefined ? null : (b.required ? 'Y' : 'N'),
        m: b.multi === undefined ? null : (b.multi ? 'Y' : 'N'), a: b.active === undefined ? null : (b.active ? 'Y' : 'N'), id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'المجموعة غير موجودة');
    res.json({ ok: true });
  }));
  r.delete('/cafe/modifier-groups/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'المجموعة');
    await db.run('DELETE FROM erp_item_modifier_groups WHERE group_id = :id', { id });
    await db.run('DELETE FROM erp_modifier_options WHERE group_id = :id', { id });
    const r1 = await db.run('DELETE FROM erp_modifier_groups WHERE group_id = :id', { id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'المجموعة غير موجودة');
    res.json({ ok: true });
  }));
  r.post('/cafe/modifier-groups/:id/options', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'المجموعة'), b = req.body || {};
    const out = await db.run('INSERT INTO erp_modifier_options (group_id, name, price_delta) VALUES (:g, :n, :p) RETURNING option_id INTO :id',
      { g: id, n: v.str(b.name, 'الاسم', { max: 80 }), p: v.money(b.priceDelta, 'السعر الإضافي'), id: OUT(N) });
    res.status(201).json({ id: out.outBinds.id[0] ?? out.outBinds.id });
  }));
  r.patch('/cafe/modifier-options/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الخيار'), b = req.body || {};
    const r1 = await db.run('UPDATE erp_modifier_options SET name = NVL(:n, name), price_delta = NVL(:p, price_delta), active = NVL(:a, active) WHERE option_id = :id',
      { n: b.name === undefined ? null : v.str(b.name, 'الاسم', { max: 80 }), p: b.priceDelta === undefined ? null : v.money(b.priceDelta, 'السعر الإضافي'),
        a: b.active === undefined ? null : (b.active ? 'Y' : 'N'), id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'الخيار غير موجود');
    res.json({ ok: true });
  }));
  r.delete('/cafe/modifier-options/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الخيار');
    const r1 = await db.run('DELETE FROM erp_modifier_options WHERE option_id = :id', { id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'الخيار غير موجود');
    res.json({ ok: true });
  }));

  // ---------- ربط خيارات بالأصناف وقائمة المقهى ----------
  r.get('/cafe/menu', wrap(async (req, res) => {
    const items = await db.query(`SELECT i.item_id AS "id", i.code AS "code", i.name AS "name", i.sale_price AS "price", i.vat_rate AS "vat",
      i.station AS "station", i.active AS "active" FROM erp_items i WHERE i.active = 'Y' ORDER BY i.name`);
    const links = await db.query(`SELECT img.item_id AS "itemId", mg.group_id AS "id", mg.name AS "name", mg.required AS "required", mg.multi AS "multi"
      FROM erp_item_modifier_groups img JOIN erp_modifier_groups mg ON mg.group_id = img.group_id AND mg.active = 'Y' ORDER BY img.seq`);
    const options = await db.query(`SELECT option_id AS "id", group_id AS "groupId", name AS "name", price_delta AS "priceDelta" FROM erp_modifier_options WHERE active = 'Y'`);
    res.json({ items: items.map((it) => ({ ...it, modifierGroups: links.filter((l) => l.itemId === it.id).map(({ itemId, ...g }) => ({ ...g, options: options.filter((o) => o.groupId === g.id) })) })) });
  }));
  r.get('/cafe/items/:id/modifier-groups', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الصنف');
    res.json({ groupIds: (await db.query('SELECT group_id AS "id" FROM erp_item_modifier_groups WHERE item_id = :id ORDER BY seq', { id })).map((x) => x.id) });
  }));
  r.put('/cafe/items/:id/modifier-groups', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الصنف'), groupIds = ids('groupIds')(req);
    await db.withConn(async (c) => {
      try {
        await c.execute('DELETE FROM erp_item_modifier_groups WHERE item_id = :id', { id });
        if (groupIds.length) await c.executeMany('INSERT INTO erp_item_modifier_groups (item_id, group_id, seq) VALUES (:id, :g, :s)',
          groupIds.map((g, i) => ({ id, g, s: i + 1 })));
        await c.commit();
      } catch (e) { await c.rollback(); throw e; }
    });
    res.json({ ok: true });
  }));
  r.patch('/cafe/items/:id/station', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الصنف'), st = (req.body || {}).station;
    if (!['KITCHEN', 'BAR', 'NONE'].includes(st)) v.bad('المحطة: KITCHEN أو BAR أو NONE');
    const r1 = await db.run('UPDATE erp_items SET station = :s WHERE item_id = :id', { s: st, id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'الصنف غير موجود');
    res.json({ ok: true });
  }));

  // ---------- الطلبات ----------
  const ORDER = `SELECT o.order_id AS "id", o.table_id AS "tableId", t.code AS "tableCode", t.name AS "tableName", o.reg_id AS "regId",
      o.shift_id AS "shiftId", o.status AS "status", o.guests AS "guests", o.waiter AS "waiter", o.note AS "note",
      TO_CHAR(o.opened_at, 'YYYY-MM-DD HH24:MI') AS "openedAt", TO_CHAR(o.closed_at, 'YYYY-MM-DD HH24:MI') AS "closedAt", o.pos_sale_id AS "saleId"
    FROM erp_cafe_orders o LEFT JOIN erp_cafe_tables t ON t.table_id = o.table_id`;
  async function loadOrder(id) {
    const h = await db.query(`${ORDER} WHERE o.order_id = :id`, { id });
    if (!h.length) throw new db.HttpError(404, 'الطلب غير موجود');
    const [reg] = await db.query('SELECT prices_include_vat AS "incl" FROM erp_pos_registers WHERE reg_id = :r', { r: h[0].regId });
    const lines = await db.query(`SELECT l.line_id AS "id", l.item_id AS "itemId", i.name AS "itemName", i.code AS "itemCode", l.qty AS "qty",
        l.base_price AS "basePrice", l.mod_delta AS "modDelta", (l.base_price + l.mod_delta) AS "price", i.vat_rate AS "vatRate", l.mod_text AS "modText", l.note AS "note",
        l.station AS "station", l.status AS "status", TO_CHAR(l.sent_at, 'YYYY-MM-DD HH24:MI') AS "sentAt", TO_CHAR(l.served_at, 'YYYY-MM-DD HH24:MI') AS "servedAt"
      FROM erp_cafe_order_lines l JOIN erp_items i ON i.item_id = l.item_id WHERE l.order_id = :id ORDER BY l.line_id`, { id });
    const incl = reg && reg.incl === 'Y';
    let subtotal = 0, vat = 0;
    for (const x of lines) {
      if (x.status === 'CANCELLED') continue;
      const gross = r2(x.qty * x.price);
      const lineVat = incl ? r2(gross * x.vatRate / (100 + x.vatRate)) : r2(gross * x.vatRate / 100);
      subtotal += incl ? gross - lineVat : gross; vat += lineVat;
    }
    subtotal = r2(subtotal); vat = r2(vat);
    return { ...h[0], lines, subtotal, vat, total: r2(subtotal + vat) };
  }

  r.get('/cafe/orders', wrap(async (req, res) => {
    const status = req.query.status || 'OPEN';
    if (!['OPEN', 'CLOSED', 'CANCELLED'].includes(status)) v.bad('الحالة غير صالحة');
    const reg = req.query.regId ? v.int(req.query.regId, 'النقطة') : null;
    res.json({ orders: await db.query(`${ORDER} WHERE o.status = :s AND (:r IS NULL OR o.reg_id = :r) ORDER BY o.order_id DESC FETCH FIRST 100 ROWS ONLY`, { s: status, r: reg }) });
  }));
  r.get('/cafe/orders/:id', wrap(async (req, res) => { res.json({ order: await loadOrder(v.int(req.params.id, 'الطلب')) }); }));

  r.post('/cafe/orders/open', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run('BEGIN :id := erp_cafe.open_order(:r, :t, :g); END;',
      { r: v.int(b.regId, 'النقطة'), t: b.tableId ? v.int(b.tableId, 'الطاولة') : null, g: b.guests ? v.int(b.guests, 'عدد الضيوف') : null, id: OUT(N) });
    res.status(201).json({ order: await loadOrder(out.outBinds.id) });
  }));

  r.post('/cafe/orders/:id/lines', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الطلب'), b = req.body || {};
    const optionIds = Array.isArray(b.optionIds) ? b.optionIds.map((x, i) => v.int(x, `خيار ${i + 1}`)) : [];
    const out = await db.run(`
      DECLARE v_opts erp_id_tab; v_id NUMBER; BEGIN
        SELECT COLUMN_VALUE BULK COLLECT INTO v_opts FROM JSON_TABLE(:opts, '$[*]' COLUMNS (COLUMN_VALUE NUMBER PATH '$'));
        v_id := erp_cafe.add_line(:oid, :item, :qty, v_opts, :note);
        :lid := v_id;
      END;`,
      { opts: JSON.stringify(optionIds), oid: id, item: v.int(b.itemId, 'الصنف'), qty: qty3(b.qty, 'الكمية', 1),
        note: v.str(b.note, 'ملاحظة', { max: 200, optional: true }), lid: OUT(N) });
    res.status(201).json({ order: await loadOrder(id), lineId: out.outBinds.lid });
  }));
  r.delete('/cafe/orders/lines/:lineId', wrap(async (req, res) => {
    const lineId = v.int(req.params.lineId, 'البند');
    const [x] = await db.query('SELECT order_id AS "id" FROM erp_cafe_order_lines WHERE line_id = :id', { id: lineId });
    if (!x) throw new db.HttpError(404, 'البند غير موجود');
    await db.run('BEGIN erp_cafe.remove_line(:id); END;', { id: lineId });
    res.json({ order: await loadOrder(x.id) });
  }));

  r.post('/cafe/orders/:id/send', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الطلب'), lineIds = ids('lineIds')(req);
    await db.run(`DECLARE v_ids erp_id_tab; BEGIN
        SELECT COLUMN_VALUE BULK COLLECT INTO v_ids FROM JSON_TABLE(:ids, '$[*]' COLUMNS (COLUMN_VALUE NUMBER PATH '$'));
        erp_cafe.send_to_kitchen(:oid, CASE WHEN v_ids.COUNT = 0 THEN NULL ELSE v_ids END); END;`,
      { ids: JSON.stringify(lineIds), oid: id });
    res.json({ order: await loadOrder(id) });
  }));
  r.post('/cafe/lines/serve', wrap(async (req, res) => {
    const lineIds = ids('lineIds')(req);
    if (!lineIds.length) v.bad('حدّد بنوداً');
    await db.run(`DECLARE v_ids erp_id_tab; BEGIN
        SELECT COLUMN_VALUE BULK COLLECT INTO v_ids FROM JSON_TABLE(:ids, '$[*]' COLUMNS (COLUMN_VALUE NUMBER PATH '$'));
        erp_cafe.mark_served(v_ids); END;`, { ids: JSON.stringify(lineIds) });
    res.json({ ok: true });
  }));

  r.post('/cafe/orders/:id/transfer', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الطلب'), tableId = v.int((req.body || {}).tableId, 'الطاولة الجديدة');
    await db.run('BEGIN erp_cafe.transfer_table(:id, :t); END;', { id, t: tableId });
    res.json({ order: await loadOrder(id) });
  }));
  r.post('/cafe/orders/:id/split', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الطلب'), lineIds = ids('lineIds')(req);
    const out = await db.run(`DECLARE v_ids erp_id_tab; v_new NUMBER; BEGIN
        SELECT COLUMN_VALUE BULK COLLECT INTO v_ids FROM JSON_TABLE(:ids, '$[*]' COLUMNS (COLUMN_VALUE NUMBER PATH '$'));
        v_new := erp_cafe.split_order(:oid, v_ids); :nid := v_new; END;`,
      { ids: JSON.stringify(lineIds), oid: id, nid: OUT(N) });
    res.status(201).json({ order: await loadOrder(id), newOrder: await loadOrder(out.outBinds.nid) });
  }));
  r.post('/cafe/orders/:id/merge', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الطلب'), into = v.int((req.body || {}).intoOrderId, 'الطلب الهدف');
    await db.run('BEGIN erp_cafe.merge_orders(:id, :into); END;', { id, into });
    res.json({ order: await loadOrder(into) });
  }));

  r.post('/cafe/orders/:id/close', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الطلب'), b = req.body || {};
    if (!Array.isArray(b.payments) || !b.payments.length) v.bad('أدخل الدفعة');
    const pays = b.payments.map((p, i) => {
      if (!['CASH', 'CARD'].includes(p.method)) v.bad(`الدفعة ${i + 1}: CASH أو CARD`);
      const a = v.money(p.amount, `مبلغ الدفعة ${i + 1}`); if (a <= 0) v.bad(`مبلغ الدفعة ${i + 1} يجب أن يكون أكبر من صفر`);
      return { method: p.method, amount: a };
    });
    const out = await db.run(`DECLARE v_pays erp_pos_pay_tab; v_sale NUMBER; BEGIN
        SELECT erp_pos_pay_t(method, amount) BULK COLLECT INTO v_pays FROM JSON_TABLE(:pays, '$[*]' COLUMNS (method VARCHAR2(4) PATH '$.method', amount NUMBER PATH '$.amount'));
        v_sale := erp_cafe.close_order(:oid, v_pays); :sid := v_sale; END;`,
      { pays: JSON.stringify(pays), oid: id, sid: OUT(N) });
    res.json({ saleId: out.outBinds.sid, order: await loadOrder(id) });
  }));
  r.post('/cafe/orders/:id/cancel', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'الطلب');
    await db.run('BEGIN erp_cafe.cancel_order(:id); END;', { id });
    res.json({ order: await loadOrder(id) });
  }));

  // ---------- شاشة المطبخ/البار ----------
  r.get('/cafe/kitchen', wrap(async (req, res) => {
    const station = ['KITCHEN', 'BAR'].includes(req.query.station) ? req.query.station : 'KITCHEN';
    const lines = await db.query(`SELECT l.line_id AS "id", l.order_id AS "orderId", o.table_id AS "tableId", t.code AS "tableCode", t.name AS "tableName",
        i.name AS "itemName", l.qty AS "qty", l.mod_text AS "modText", l.note AS "note", l.status AS "status",
        TO_CHAR(l.sent_at, 'YYYY-MM-DD HH24:MI:SS') AS "sentAt", ROUND((SYSDATE - CAST(l.sent_at AS DATE)) * 1440) AS "minutesAgo"
      FROM erp_cafe_order_lines l JOIN erp_cafe_orders o ON o.order_id = l.order_id LEFT JOIN erp_cafe_tables t ON t.table_id = o.table_id
      JOIN erp_items i ON i.item_id = l.item_id
      WHERE l.station = :st AND l.status = 'SENT' AND o.status = 'OPEN' ORDER BY l.sent_at`, { st: station });
    res.json({ lines });
  }));

  return r;
};
