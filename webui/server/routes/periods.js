// إقفال الفترات والسنة عبر ERP_PERIOD (الدفتر نفسه يرفض أي قيد في فترة مقفلة).
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

module.exports = function periodRoutes() {
  const r = express.Router();

  r.get('/periods', wrap(async (req, res) => {
    const months = await db.query(`
      SELECT TO_CHAR(period, 'YYYY-MM-DD') AS "month", status AS "status", entries AS "entries"
        FROM v_erp_period_status ORDER BY period DESC`);
    const years = await db.query(`
      SELECT TO_CHAR(year_end, 'YYYY-MM-DD') AS "yearEnd", net_income AS "netIncome", status AS "status", entry_id AS "entryId", reopen_entry_id AS "reopenEntryId",
             changed_by AS "changedBy", TO_CHAR(changed_at, 'YYYY-MM-DD HH24:MI') AS "changedAt"
        FROM erp_year_closings ORDER BY year_end DESC`);
    res.json({ months, years });
  }));

  r.get('/periods/issues', wrap(async (req, res) => {
    const month = v.date(req.query.month, 'الشهر');
    const rows = await db.query(
      "SELECT column_value AS \"msg\" FROM TABLE(erp_period.close_issues(TO_DATE(:m, 'YYYY-MM-DD')))", { m: month });
    res.json({ issues: rows.map((x) => x.msg) });
  }));

  const call = (proc, key, label) => wrap(async (req, res) => {
    const d = v.date((req.body || {})[key], label);
    await db.run(`BEGIN erp_period.${proc}(TO_DATE(:d, 'YYYY-MM-DD')); END;`, { d });
    res.json({ ok: true });
  });
  r.post('/periods/close', call('close_period', 'month', 'الشهر'));
  r.post('/periods/reopen', call('reopen_period', 'month', 'الشهر'));
  r.post('/years/reopen', call('reopen_year', 'yearEnd', 'نهاية السنة'));

  r.post('/years/close', wrap(async (req, res) => {
    const d = v.date((req.body || {}).yearEnd, 'نهاية السنة');
    const out = await db.run(
      "BEGIN :n := erp_period.close_year(TO_DATE(:d, 'YYYY-MM-DD')); END;",
      { d, n: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } });
    res.json({ ok: true, entryId: out.outBinds.n });
  }));

  return r;
};
