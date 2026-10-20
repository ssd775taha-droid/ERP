// تقارير الأصول الثابتة (قراءة فقط): السجل بتاريخ، حركة الأصول والإهلاك للفترة، الإهلاك المتوقع، الاستبعادات، والعمر المتبقي.
// الإهلاك الشهري: (التكلفة − الخردة) ÷ العمر مقرَّباً لمنزلتين، والشهر الأخير يستوفي المتبقي (كما في ERP_ASSET).
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const D = (x) => `TO_DATE(${x}, 'YYYY-MM-DD')`;
const ACC = (d) => `(SELECT NVL(SUM(x.amount), 0) FROM erp_depreciation x WHERE x.asset_id = a.asset_id AND x.status = 'OK' AND x.period <= ${D(d)})`;
const EXISTS_AT = (d) => `(a.acq_date <= ${D(d)} AND (a.disposal_date IS NULL OR a.disposal_date > ${D(d)}))`;
const BASE = `FROM erp_assets a JOIN erp_asset_categories c ON c.cat_id = a.cat_id WHERE a.status <> 'VOID'`;
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

module.exports = function assetReportRoutes() {
  const r = express.Router();

  r.get('/assets/reports/register', wrap(async (req, res) => {
    const asof = v.date(req.query.asof, 'بتاريخ');
    const rows = await db.query(`SELECT a.code AS "code", a.name AS "name", c.name AS "cat", TO_CHAR(a.acq_date, 'YYYY-MM-DD') AS "acqDate", a.cost AS "cost", a.salvage AS "salvage", a.life_months AS "life",
        ${ACC(':d')} AS "accumulated" ${BASE} AND ${EXISTS_AT(':d')} ORDER BY c.name, a.code`, { d: asof });
    const out = rows.map((x) => ({ ...x, accumulated: r2(x.accumulated), bookValue: r2(x.cost - x.accumulated) }));
    const cats = [...new Set(out.map((x) => x.cat))].map((cat) => { const g = out.filter((x) => x.cat === cat); return { cat, count: g.length, cost: r2(g.reduce((s, x) => s + x.cost, 0)), accumulated: r2(g.reduce((s, x) => s + x.accumulated, 0)), bookValue: r2(g.reduce((s, x) => s + x.bookValue, 0)) }; });
    res.json({ rows: out, cats, totals: { count: out.length, cost: r2(out.reduce((s, x) => s + x.cost, 0)), accumulated: r2(out.reduce((s, x) => s + x.accumulated, 0)), bookValue: r2(out.reduce((s, x) => s + x.bookValue, 0)) } });
  }));

  // حركة الأصول: تكلفة أول الفترة + إضافات − استبعادات = آخرها؛ ومجمع الإهلاك أول + إهلاك الفترة − ما يُستبعد = آخر
  r.get('/assets/reports/rollforward', wrap(async (req, res) => {
    const f = v.date(req.query.from, 'من تاريخ'), t = v.date(req.query.to, 'إلى تاريخ');
    if (f > t) v.bad('تاريخ البداية بعد النهاية');
    const prev = addDays(f, -1);
    const rows = await db.query(`SELECT c.name AS "cat", a.cost AS "cost",
        CASE WHEN ${EXISTS_AT(':p')} THEN 1 ELSE 0 END AS "openEx", CASE WHEN ${EXISTS_AT(':t')} THEN 1 ELSE 0 END AS "closeEx",
        CASE WHEN a.acq_date BETWEEN ${D(':f')} AND ${D(':t')} THEN 1 ELSE 0 END AS "added", CASE WHEN a.disposal_date BETWEEN ${D(':f')} AND ${D(':t')} THEN 1 ELSE 0 END AS "disposed",
        ${ACC(':p')} AS "accOpen", ${ACC(':t')} AS "accClose",
        (SELECT NVL(SUM(x.amount), 0) FROM erp_depreciation x WHERE x.asset_id = a.asset_id AND x.status = 'OK' AND x.period BETWEEN ${D(':f')} AND ${D(':t')}) AS "dep",
        CASE WHEN a.disposal_date BETWEEN ${D(':f')} AND ${D(':t')} THEN (SELECT NVL(SUM(x.amount), 0) FROM erp_depreciation x WHERE x.asset_id = a.asset_id AND x.status = 'OK' AND x.period <= a.disposal_date) ELSE 0 END AS "accRemoved"
        ${BASE}`, { p: prev, f, t });
    const map = new Map();
    for (const x of rows) {
      const m = map.get(x.cat) || { cat: x.cat, openCost: 0, additions: 0, disposals: 0, closeCost: 0, openAcc: 0, dep: 0, removedAcc: 0, closeAcc: 0 };
      if (x.openEx) { m.openCost += x.cost; m.openAcc += x.accOpen; }
      if (x.added) m.additions += x.cost;
      if (x.disposed) { m.disposals += x.cost; m.removedAcc += x.accRemoved; }
      if (x.closeEx) { m.closeCost += x.cost; m.closeAcc += x.accClose; }
      m.dep += x.dep;
      map.set(x.cat, m);
    }
    const list = [...map.values()].map((m) => Object.fromEntries(Object.entries(m).map(([k, val]) => [k, typeof val === 'number' ? r2(val) : val]))).filter((m) => m.openCost || m.additions || m.disposals || m.closeCost || m.dep);
    const keys = ['openCost', 'additions', 'disposals', 'closeCost', 'openAcc', 'dep', 'removedAcc', 'closeAcc'];
    const totals = Object.fromEntries(keys.map((k) => [k, r2(list.reduce((s, m) => s + m[k], 0))]));
    res.json({ rows: list.map((m) => ({ ...m, openBook: r2(m.openCost - m.openAcc), closeBook: r2(m.closeCost - m.closeAcc) })), totals: { ...totals, openBook: r2(totals.openCost - totals.openAcc), closeBook: r2(totals.closeCost - totals.closeAcc) } });
  }));

  // الإهلاك المتوقع للأشهر القادمة لكل أصل فعّال (محاكاة نفس معادلة التشغيل)
  r.get('/assets/reports/forecast', wrap(async (req, res) => {
    const months = Math.min(v.int(req.query.months, 'عدد الأشهر', { optional: true }) || 12, 36);
    const rows = await db.query(`SELECT a.code AS "code", a.name AS "name", c.name AS "cat", a.cost AS "cost", a.salvage AS "salvage", a.life_months AS "life",
        TO_CHAR(a.dep_start, 'YYYY-MM-DD') AS "depStart",
        (SELECT COUNT(*) FROM erp_depreciation x WHERE x.asset_id = a.asset_id AND x.status = 'OK') AS "done",
        (SELECT NVL(SUM(x.amount), 0) FROM erp_depreciation x WHERE x.asset_id = a.asset_id AND x.status = 'OK') AS "acc",
        TO_CHAR((SELECT MAX(x.period) FROM erp_depreciation x WHERE x.asset_id = a.asset_id AND x.status = 'OK'), 'YYYY-MM-DD') AS "last"
        FROM erp_assets a JOIN erp_asset_categories c ON c.cat_id = a.cat_id WHERE a.status = 'ACTIVE' ORDER BY a.code`);
    const cols = [];
    const first = rows.reduce((m, x) => { const n = x.last ? addMonth(x.last) : x.depStart; return !m || n < m ? n : m; }, null) || new Date().toISOString().slice(0, 7) + '-01';
    let cur = first; for (let i = 0; i < months; i++) { cols.push(cur.slice(0, 7)); cur = addMonth(cur); }
    const out = rows.map((a) => {
      let done = a.done, rem = r2(a.cost - a.salvage - a.acc), next = a.last ? addMonth(a.last) : a.depStart; const per = {};
      const base = a.cost - a.salvage;
      for (let i = 0; i < 200 && rem > 0 && done < a.life; i++) {
        const amt = done + 1 >= a.life ? rem : Math.min(r2(base / a.life), rem);
        per[next.slice(0, 7)] = r2(amt); rem = r2(rem - amt); done++; next = addMonth(next);
      }
      return { code: a.code, name: a.name, cat: a.cat, months: Object.fromEntries(cols.map((c) => [c, per[c] || 0])), total: r2(cols.reduce((s, c) => s + (per[c] || 0), 0)), remaining: r2(a.cost - a.salvage - a.acc) };
    });
    const colTotals = Object.fromEntries(cols.map((c) => [c, r2(out.reduce((s, x) => s + x.months[c], 0))]));
    res.json({ cols, rows: out, colTotals, totals: { total: r2(out.reduce((s, x) => s + x.total, 0)), remaining: r2(out.reduce((s, x) => s + x.remaining, 0)) } });
  }));

  r.get('/assets/reports/disposals', wrap(async (req, res) => {
    const f = v.date(req.query.from, 'من تاريخ'), t = v.date(req.query.to, 'إلى تاريخ');
    if (f > t) v.bad('تاريخ البداية بعد النهاية');
    const rows = await db.query(`SELECT a.code AS "code", a.name AS "name", c.name AS "cat", TO_CHAR(a.disposal_date, 'YYYY-MM-DD') AS "date", a.cost AS "cost", a.proceeds AS "proceeds",
        (SELECT NVL(SUM(x.amount), 0) FROM erp_depreciation x WHERE x.asset_id = a.asset_id AND x.status = 'OK' AND x.period <= a.disposal_date) AS "accumulated", a.disposal_entry_id AS "entryId"
        FROM erp_assets a JOIN erp_asset_categories c ON c.cat_id = a.cat_id WHERE a.status = 'DISPOSED' AND a.disposal_date BETWEEN ${D(':f')} AND ${D(':t')} ORDER BY a.disposal_date, a.code`, { f, t });
    const out = rows.map((x) => { const book = r2(x.cost - x.accumulated); return { ...x, accumulated: r2(x.accumulated), bookValue: book, proceeds: x.proceeds || 0, gain: r2((x.proceeds || 0) - book) }; });
    res.json({ rows: out, totals: { count: out.length, cost: r2(out.reduce((s, x) => s + x.cost, 0)), accumulated: r2(out.reduce((s, x) => s + x.accumulated, 0)), bookValue: r2(out.reduce((s, x) => s + x.bookValue, 0)), proceeds: r2(out.reduce((s, x) => s + x.proceeds, 0)), gain: r2(out.reduce((s, x) => s + x.gain, 0)) } });
  }));

  // العمر المتبقي: أصول فعّالة مهلكة بالكامل أو يتبقى من عمرها ≤ N شهراً
  r.get('/assets/reports/life', wrap(async (req, res) => {
    const within = Math.min(v.int(req.query.within, 'خلال (شهر)', { optional: true }) || 12, 600);
    const rows = await db.query(`SELECT a.code AS "code", a.name AS "name", c.name AS "cat", a.cost AS "cost", a.life_months AS "life",
        (SELECT COUNT(*) FROM erp_depreciation x WHERE x.asset_id = a.asset_id AND x.status = 'OK') AS "done",
        (SELECT NVL(SUM(x.amount), 0) FROM erp_depreciation x WHERE x.asset_id = a.asset_id AND x.status = 'OK') AS "acc", a.salvage AS "salvage"
        FROM erp_assets a JOIN erp_asset_categories c ON c.cat_id = a.cat_id WHERE a.status = 'ACTIVE' ORDER BY a.code`);
    const out = rows.map((x) => ({ ...x, remainingMonths: Math.max(x.life - x.done, 0), bookValue: r2(x.cost - x.acc), full: r2(x.acc) >= r2(x.cost - x.salvage) })).filter((x) => x.full || x.remainingMonths <= within);
    res.json({ within, rows: out });
  }));
  return r;
};
function addMonth(d) { const x = new Date(d.slice(0, 7) + '-01T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 10); }
