// الأصول الثابتة والإهلاك. كل الترحيل عبر ERP_ASSET (قسط ثابت شهري، بيع/استبعاد، عكس).
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const OUT = (type) => ({ dir: db.oracledb.BIND_OUT, type });
const acc = (x, d, l) => (x ? v.str(x, l, { max: 12 }) : d);

module.exports = function assetRoutes() {
  const r = express.Router();

  // ---------- الفئات ----------
  r.get('/assets/categories', wrap(async (req, res) => {
    res.json({ categories: await db.query(`
      SELECT cat_id AS "id", code AS "code", name AS "name", asset_account AS "assetAccount", accum_account AS "accumAccount",
             expense_account AS "expenseAccount", life_months AS "lifeMonths", active AS "active" FROM erp_asset_categories ORDER BY code`) });
  }));
  r.post('/assets/categories', wrap(async (req, res) => {
    const b = req.body || {};
    const life = v.int(b.lifeMonths, 'العمر بالأشهر');
    if (life > 1200) v.bad('العمر بالأشهر بين 1 و1200');
    const out = await db.run('BEGIN :id := erp_asset.add_category(:c, :n, :l, :a, :m, :e); END;', {
      c: v.str(b.code, 'رمز الفئة', { max: 12 }), n: v.str(b.name, 'اسم الفئة', { max: 120 }), l: life,
      a: acc(b.assetAccount, '1500', 'حساب الأصل'), m: acc(b.accumAccount, '1510', 'حساب المجمع'), e: acc(b.expenseAccount, '5600', 'حساب المصروف'),
      id: OUT(db.oracledb.NUMBER) });
    res.status(201).json({ id: out.outBinds.id });
  }));

  // ---------- سجل الأصول ----------
  const REG = `SELECT asset_id AS "id", code AS "code", name AS "name", cat_code AS "catCode", cat_name AS "catName",
      TO_CHAR(acq_date, 'YYYY-MM-DD') AS "acqDate", TO_CHAR(dep_start, 'YYYY-MM') AS "depStart", cost AS "cost", salvage AS "salvage",
      life_months AS "lifeMonths", status AS "status", accumulated AS "accumulated", book_value AS "bookValue",
      TO_CHAR(last_period, 'YYYY-MM') AS "lastPeriod", fully_depreciated AS "fullyDepreciated" FROM v_erp_asset_register`;

  r.get('/assets', wrap(async (req, res) => {
    const status = req.query.status || null;
    if (status && !['ACTIVE', 'DISPOSED'].includes(status)) v.bad('الحالة غير صالحة');
    const rows = await db.query(`${REG} WHERE (:s IS NULL OR status = :s) ORDER BY code`, { s: status });
    const live = rows.filter((x) => x.status === 'ACTIVE');
    const sum = (k) => Math.round(live.reduce((s, x) => s + x[k], 0) * 100) / 100;
    res.json({ assets: rows, totals: { cost: sum('cost'), accumulated: sum('accumulated'), bookValue: sum('bookValue') } });
  }));

  r.get('/assets/check', wrap(async (req, res) => {
    const rows = await db.query(`SELECT kind AS "kind", account_code AS "account", register_value AS "registerValue", gl_balance AS "glBalance", difference AS "difference" FROM v_erp_asset_vs_gl ORDER BY kind, account_code`);
    res.json({ rows, ok: rows.every((x) => x.difference === 0) });
  }));

  r.get('/assets/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الأصل');
    const a = await db.query(`${REG} WHERE asset_id = :id`, { id });
    if (!a.length) throw new db.HttpError(404, 'الأصل غير موجود');
    const x = (await db.query(`SELECT invoice_id AS "invoiceId", entry_id AS "entryId", TO_CHAR(disposal_date, 'YYYY-MM-DD') AS "disposalDate",
                                      proceeds AS "proceeds", disposal_entry_id AS "disposalEntryId", note AS "note" FROM erp_assets WHERE asset_id = :id`, { id }))[0];
    const dep = await db.query(`SELECT TO_CHAR(period, 'YYYY-MM') AS "period", amount AS "amount", status AS "status" FROM erp_depreciation WHERE asset_id = :id ORDER BY period, dep_id`, { id });
    res.json({ asset: { ...a[0], ...x, depreciation: dep } });
  }));

  r.post('/assets', wrap(async (req, res) => {
    const b = req.body || {};
    const startMonth = v.date(b.depStart, 'بدء الإهلاك', { optional: true });
    if (startMonth && !startMonth.endsWith('-01')) v.bad('بدء الإهلاك يجب أن يكون أول الشهر');
    const cost = v.money(b.cost, 'التكلفة');
    const salvage = v.money(b.salvage, 'قيمة الخردة');
    if (cost <= 0) v.bad('التكلفة يجب أن تكون أكبر من صفر');
    if (salvage >= cost) v.bad('الخردة يجب أن تكون أقل من التكلفة');
    const life = b.lifeMonths === undefined || b.lifeMonths === '' || b.lifeMonths === null ? null : v.int(b.lifeMonths, 'العمر بالأشهر');
    const out = await db.run(`BEGIN :id := erp_asset.acquire(:c, :n, :cat, TO_DATE(:d, 'YYYY-MM-DD'), :cost, :salv, :life,
        CASE WHEN :ds IS NULL THEN NULL ELSE TO_DATE(:ds, 'YYYY-MM-DD') END, :off, :inv, :note); END;`, {
      c: v.str(b.code, 'رمز الأصل', { max: 30 }), n: v.str(b.name, 'اسم الأصل', { max: 120 }), cat: v.int(b.catId, 'الفئة'),
      d: v.date(b.acqDate, 'تاريخ الاقتناء'), cost, salv: salvage, life: { val: life, type: db.oracledb.NUMBER },
      ds: { val: startMonth, type: db.oracledb.STRING }, off: acc(b.offsetAccount, '1200', 'الحساب المقابل'),
      inv: { val: v.int(b.invoiceId, 'فاتورة الاقتناء', { optional: true }), type: db.oracledb.NUMBER },
      note: v.str(b.note, 'الملاحظة', { max: 300, optional: true }), id: OUT(db.oracledb.NUMBER) });
    res.status(201).json({ id: out.outBinds.id });
  }));

  r.post('/assets/:id/dispose', wrap(async (req, res) => {
    const b = req.body || {};
    const out = await db.run("BEGIN :e := erp_asset.dispose(:id, TO_DATE(:d, 'YYYY-MM-DD'), :p, :a); END;", {
      id: v.int(req.params.id, 'رقم الأصل'), d: v.date(b.date, 'تاريخ البيع'), p: v.money(b.proceeds, 'المتحصلات'),
      a: acc(b.proceedsAccount, '1200', 'حساب المتحصلات'), e: OUT(db.oracledb.NUMBER) });
    res.status(201).json({ entryId: out.outBinds.e });
  }));

  r.post('/assets/:id/void', wrap(async (req, res) => {
    await db.run('BEGIN erp_asset.void_asset(:id); END;', { id: v.int(req.params.id, 'رقم الأصل') });
    res.json({ ok: true });
  }));

  // ---------- الإهلاك ----------
  r.post('/depreciation/run', wrap(async (req, res) => {
    const upto = v.date((req.body || {}).upto, 'حتى شهر');
    const out = await db.run("BEGIN :t := erp_asset.run_depreciation(TO_DATE(:d, 'YYYY-MM-DD')); END;", { d: upto, t: OUT(db.oracledb.NUMBER) });
    res.json({ total: out.outBinds.t });
  }));
  r.post('/depreciation/reverse', wrap(async (req, res) => {
    await db.run("BEGIN erp_asset.reverse_depreciation(TO_DATE(:d, 'YYYY-MM-DD')); END;", { d: v.date((req.body || {}).period, 'الشهر') });
    res.json({ ok: true });
  }));
  // إجمالي الإهلاك المسجّل لكل شهر (للعرض وللعكس)
  r.get('/depreciation/months', wrap(async (req, res) => {
    res.json({ months: await db.query(`SELECT TO_CHAR(period, 'YYYY-MM-DD') AS "period", COUNT(*) AS "assets", SUM(amount) AS "amount"
                                         FROM erp_depreciation WHERE status = 'OK' GROUP BY period ORDER BY period DESC FETCH FIRST 60 ROWS ONLY`) });
  }));

  return r;
};
