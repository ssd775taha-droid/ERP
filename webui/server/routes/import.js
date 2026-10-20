// استيراد بيانات أساسية من CSV (يُحلَّل في المتصفح): العملاء/الموردون والأصناف. «تجربة» تتحقق دون حفظ، والاستيراد الفعلي يحفظ الصفوف الصحيحة ويُبلغ عن الخاطئة بأسبابها.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const MAX_ROWS = 2000;
const OUT = { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER };
const txt = (x, label, max) => v.str(x, label, { max, optional: true });
const num = (x, label, { min = 0, max = 1e12 } = {}) => {
  if (x === undefined || x === null || String(x).trim() === '') return 0;
  const n = Number(String(x).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < min || n > max) v.bad(label + ' غير صالح');
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) v.bad(label + ': أكثر من منزلتين');
  return n;
};

// ينفّذ كل صف بنقطة حفظ مستقلة، فالخطأ في صف لا يُبطل غيره؛ وفي التجربة يُتراجع عن الكل
async function run(rows, dryRun, one) {
  if (!Array.isArray(rows) || !rows.length) v.bad('لا صفوف للاستيراد');
  if (rows.length > MAX_ROWS) v.bad('الحد الأقصى ' + MAX_ROWS + ' صف في المرة الواحدة');
  const results = [];
  await db.withConn(async (c) => {
    try {
      for (let i = 0; i < rows.length; i++) {
        await c.execute('SAVEPOINT imp_row');
        try { await one(c, rows[i] || {}); results.push({ row: i + 1, ok: true }); }
        catch (e) {
          await c.execute('ROLLBACK TO SAVEPOINT imp_row');
          results.push({ row: i + 1, ok: false, error: db.toHttpError(e).message });
        }
      }
      if (dryRun) await c.rollback(); else await c.commit();
    } catch (e) { await c.rollback(); throw e; }
  });
  return { dryRun: !!dryRun, total: rows.length, ok: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results };
}

module.exports = function importRoutes() {
  const r = express.Router();

  r.post('/import/parties', wrap(async (req, res) => {
    const b = req.body || {};
    const kind = b.kind === 'SUPPLIER' ? 'SUPPLIER' : b.kind === 'CUSTOMER' ? 'CUSTOMER' : v.bad('النوع: CUSTOMER أو SUPPLIER');
    const seen = new Set();
    res.json(await run(b.rows, b.dryRun, async (c, row) => {
      const name = v.str(row.name, 'الاسم', { max: 120 });
      const phone = txt(row.phone, 'الهاتف', 40), tax = txt(row.taxNo, 'الرقم الضريبي', 40);
      if (tax && !/^\d{15}$/.test(tax)) v.bad('الرقم الضريبي 15 رقماً');
      const key = name.toLowerCase();
      if (seen.has(key)) v.bad('الاسم مكرر داخل الملف');
      seen.add(key);
      const dup = (await c.execute('SELECT COUNT(*) AS n FROM erp_parties WHERE kind = :k AND LOWER(name) = :n', { k: kind, n: key }, { outFormat: db.oracledb.OUT_FORMAT_OBJECT })).rows[0].N;
      if (dup) v.bad('موجود مسبقاً بالاسم نفسه');
      await c.execute('BEGIN :id := erp_trade.add_party(:k, :n, :p, :t); END;', { k: kind, n: name, p: phone, t: tax, id: OUT });
    }));
  }));

  r.post('/import/items', wrap(async (req, res) => {
    const b = req.body || {};
    const seen = new Set();
    res.json(await run(b.rows, b.dryRun, async (c, row) => {
      const code = v.str(row.code, 'الرمز', { max: 30 }), name = v.str(row.name, 'الاسم', { max: 120 });
      const unit = txt(row.unit, 'الوحدة', 20) || 'قطعة', barcode = txt(row.barcode, 'الباركود', 40);
      const price = num(row.price, 'سعر البيع'), vat = num(row.vat, 'الضريبة', { max: 100 });
      const t = String(row.trackStock == null ? '' : row.trackStock).trim().toLowerCase();
      const track = ['n', 'no', 'لا', 'خدمة', 'false', '0'].includes(t) ? 'N' : 'Y';
      if (seen.has(code.toLowerCase())) v.bad('الرمز مكرر داخل الملف');
      seen.add(code.toLowerCase());
      await c.execute('BEGIN :id := erp_inventory.add_item(:c, :n, :u, :p, :t, \'1400\', \'5100\', \'4100\', :v, :b); END;', { c: code, n: name, u: unit, p: price, t: track, v: vat, b: barcode, id: OUT });
    }));
  }));
  return r;
};
