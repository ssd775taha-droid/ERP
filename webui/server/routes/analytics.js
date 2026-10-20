// تقارير متقدمة (قراءة فقط): تحليل المبيعات/المشتريات، ربحية الأصناف، قائمة الدخل المقارنة.
// المبالغ قبل الضريبة. إشعارات الدائن تُنقص والمدين تزيد؛ ونقاط البيع (بيع − مرتجع) تدخل في المبيعات.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const D = (col, a, b) => `${col} BETWEEN TO_DATE(:${a}, 'YYYY-MM-DD') AND TO_DATE(:${b}, 'YYYY-MM-DD')`;

module.exports = function analyticsRoutes() {
  const r = express.Router();

  // يعيد تجميع المبيعات/المشتريات الصافية (قبل الضريبة) حسب الطرف أو الصنف أو الشهر
  async function analysis(kind, by, from, to) {
    const grp = {
      party: { inv: 'TO_CHAR(i.party_id)', invL: 'p.name', note: 'TO_CHAR(n.party_id)', noteL: 'p.name', pos: `'0'`, posL: `'نقاط البيع'`,
               invJ: 'JOIN erp_parties p ON p.party_id = i.party_id', noteJ: 'JOIN erp_parties p ON p.party_id = n.party_id' },
      item: { inv: `TO_CHAR(NVL(l.item_id, 0))`, invL: `NVL(it.name, 'بند حر / خدمة')`, note: `TO_CHAR(NVL(l.item_id, 0))`, noteL: `NVL(it.name, 'بند حر / خدمة')`, pos: 'TO_CHAR(l.item_id)', posL: 'it.name',
             invJ: 'LEFT JOIN erp_items it ON it.item_id = l.item_id', noteJ: 'LEFT JOIN erp_items it ON it.item_id = l.item_id', posJ: 'JOIN erp_items it ON it.item_id = l.item_id' },
      month: { inv: `TO_CHAR(i.invoice_date, 'YYYY-MM')`, invL: `TO_CHAR(i.invoice_date, 'YYYY-MM')`, note: `TO_CHAR(n.note_date, 'YYYY-MM')`, noteL: `TO_CHAR(n.note_date, 'YYYY-MM')`,
               pos: `TO_CHAR(s.sale_date, 'YYYY-MM')`, posL: `TO_CHAR(s.sale_date, 'YYYY-MM')`, invJ: '', noteJ: '' },
    }[by];
    const parts = [
      `SELECT ${grp.inv} AS k, ${grp.invL} AS lbl, 'I' || i.invoice_id AS doc, l.net AS net
         FROM erp_invoice_lines l JOIN erp_invoices i ON i.invoice_id = l.invoice_id ${grp.invJ}
        WHERE i.kind = '${kind}' AND i.status = 'OPEN' AND ${D('i.invoice_date', 'f', 't')}`,
      `SELECT ${grp.note} AS k, ${grp.noteL} AS lbl, 'N' || n.note_id AS doc, CASE n.note_type WHEN 'DEBIT' THEN l.net ELSE -l.net END AS net
         FROM erp_note_lines l JOIN erp_notes n ON n.note_id = l.note_id ${grp.noteJ}
        WHERE n.doc_kind = '${kind}' AND n.status = 'OPEN' AND ${D('n.note_date', 'f', 't')}`,
    ];
    if (kind === 'SALES') {
      parts.push(`SELECT ${grp.pos} AS k, ${grp.posL} AS lbl, 'S' || s.sale_id AS doc, CASE WHEN s.kind = 'SALE' THEN l.net ELSE -l.net END AS net
         FROM erp_pos_sale_lines l JOIN erp_pos_sales s ON s.sale_id = l.sale_id ${grp.posJ || ''}
        WHERE s.status = 'COMPLETED' AND ${D('s.sale_date', 'f', 't')}`);
    }
    const rows = await db.query(`SELECT k AS "key", MIN(lbl) AS "label", COUNT(DISTINCT doc) AS "docs", SUM(net) AS "net" FROM (${parts.join(' UNION ALL ')}) GROUP BY k
      ORDER BY ${by === 'month' ? 'k' : 'SUM(net) DESC'}`, { f: from, t: to });
    return rows.map((x) => ({ ...x, net: r2(x.net) }));
  }

  // تحليل المبيعات أو المشتريات حسب الطرف أو الصنف أو الشهر
  r.get('/reports/sales-analysis', wrap(async (req, res) => {
    const from = v.date(req.query.from, 'من تاريخ'), to = v.date(req.query.to, 'إلى تاريخ');
    const kind = req.query.kind === 'PURCHASE' ? 'PURCHASE' : 'SALES';
    const by = ['party', 'item', 'month'].includes(req.query.by) ? req.query.by : 'party';
    const rows = await analysis(kind, by, from, to);
    res.json({ kind, by, rows, total: r2(rows.reduce((s, x) => s + x.net, 0)) });
  }));

  // مقارنة مبيعات/مشتريات فترتين حسب الطرف أو الصنف: الفرق ونسبة التغير
  r.get('/reports/sales-comparison', wrap(async (req, res) => {
    const f1 = v.date(req.query.f1, 'بداية الفترة الحالية'), t1 = v.date(req.query.t1, 'نهاية الفترة الحالية');
    const f2 = v.date(req.query.f2, 'بداية فترة المقارنة'), t2 = v.date(req.query.t2, 'نهاية فترة المقارنة');
    const kind = req.query.kind === 'PURCHASE' ? 'PURCHASE' : 'SALES';
    const by = req.query.by === 'item' ? 'item' : 'party';
    const [cur, prev] = await Promise.all([analysis(kind, by, f1, t1), analysis(kind, by, f2, t2)]);
    const map = new Map();
    for (const x of cur) map.set(x.key, { key: x.key, label: x.label, current: x.net, previous: 0 });
    for (const x of prev) { const m = map.get(x.key) || { key: x.key, label: x.label, current: 0, previous: 0 }; m.previous = x.net; map.set(x.key, m); }
    const rows = [...map.values()].map((m) => { const diff = r2(m.current - m.previous); return { ...m, diff, pct: m.previous ? r2(diff / Math.abs(m.previous) * 100) : null }; }).sort((a, b) => b.current - a.current || b.previous - a.previous);
    const cur$ = r2(rows.reduce((s, x) => s + x.current, 0)), prev$ = r2(rows.reduce((s, x) => s + x.previous, 0));
    res.json({ kind, by, rows, totals: { current: cur$, previous: prev$, diff: r2(cur$ - prev$), pct: prev$ ? r2((cur$ - prev$) / Math.abs(prev$) * 100) : null } });
  }));

  // ربحية الأصناف: كمية وإيراد وتكلفة وهامش (بيع − مرتجع، فواتير − إشعارات دائنة، ونقاط البيع)
  r.get('/reports/item-profit', wrap(async (req, res) => {
    const from = v.date(req.query.from, 'من تاريخ'), to = v.date(req.query.to, 'إلى تاريخ');
    const rows = await db.query(`
      SELECT it.item_id AS "id", it.code AS "code", it.name AS "name", SUM(x.qty) AS "qty", SUM(x.net) AS "revenue", SUM(x.cost) AS "cost"
        FROM (
          SELECT l.item_id, l.qty AS qty, l.net AS net, NVL(l.cost, 0) AS cost
            FROM erp_invoice_lines l JOIN erp_invoices i ON i.invoice_id = l.invoice_id
           WHERE i.kind = 'SALES' AND i.status = 'OPEN' AND l.item_id IS NOT NULL AND ${D('i.invoice_date', 'f', 't')}
          UNION ALL
          SELECT l.item_id, CASE n.note_type WHEN 'DEBIT' THEN l.qty ELSE -l.qty END, CASE n.note_type WHEN 'DEBIT' THEN l.net ELSE -l.net END, CASE n.note_type WHEN 'DEBIT' THEN NVL(l.cost, 0) ELSE -NVL(l.cost, 0) END
            FROM erp_note_lines l JOIN erp_notes n ON n.note_id = l.note_id
           WHERE n.doc_kind = 'SALES' AND n.status = 'OPEN' AND l.item_id IS NOT NULL AND ${D('n.note_date', 'f', 't')}
          UNION ALL
          SELECT l.item_id, CASE WHEN s.kind = 'SALE' THEN l.qty ELSE -l.qty END, CASE WHEN s.kind = 'SALE' THEN l.net ELSE -l.net END, CASE WHEN s.kind = 'SALE' THEN NVL(l.cost, 0) ELSE -NVL(l.cost, 0) END
            FROM erp_pos_sale_lines l JOIN erp_pos_sales s ON s.sale_id = l.sale_id
           WHERE s.status = 'COMPLETED' AND ${D('s.sale_date', 'f', 't')}
        ) x JOIN erp_items it ON it.item_id = x.item_id
       GROUP BY it.item_id, it.code, it.name HAVING SUM(x.qty) <> 0 OR SUM(x.net) <> 0
       ORDER BY SUM(x.net) - SUM(x.cost) DESC`, { f: from, t: to });
    const out = rows.map((x) => { const margin = r2(x.revenue - x.cost); return { ...x, qty: Math.round(x.qty * 1000) / 1000, revenue: r2(x.revenue), cost: r2(x.cost), margin, marginPct: x.revenue ? r2(margin / x.revenue * 100) : null }; });
    const revenue = r2(out.reduce((s, x) => s + x.revenue, 0)), cost = r2(out.reduce((s, x) => s + x.cost, 0));
    res.json({ rows: out, totals: { revenue, cost, margin: r2(revenue - cost), marginPct: revenue ? r2((revenue - cost) / revenue * 100) : null } });
  }));

  // قائمة الدخل المقارنة: فترتان جنباً إلى جنب بالفرق والنسبة
  r.get('/reports/comparative', wrap(async (req, res) => {
    const f1 = v.date(req.query.f1, 'بداية الفترة الحالية'), t1 = v.date(req.query.t1, 'نهاية الفترة الحالية');
    const f2 = v.date(req.query.f2, 'بداية فترة المقارنة'), t2 = v.date(req.query.t2, 'نهاية فترة المقارنة');
    const period = (f, t) => db.query(`
      SELECT a.acc_type AS "type", a.code AS "code", a.name AS "name",
             SUM(CASE WHEN a.acc_type = 'REVENUE' THEN l.credit - l.debit ELSE l.debit - l.credit END) AS "amount"
        FROM erp_accounts a JOIN erp_lines l ON l.account_code = a.code JOIN erp_entries e ON e.entry_id = l.entry_id
       WHERE a.acc_type IN ('REVENUE', 'EXPENSE') AND e.kind = 'NORMAL' AND ${D('e.entry_date', 'f', 't')}
       GROUP BY a.acc_type, a.code, a.name`, { f, t });
    const [cur, prev] = await Promise.all([period(f1, t1), period(f2, t2)]);
    const map = new Map();
    for (const x of cur) map.set(x.code, { type: x.type, code: x.code, name: x.name, current: x.amount, previous: 0 });
    for (const x of prev) { const m = map.get(x.code) || { type: x.type, code: x.code, name: x.name, current: 0, previous: 0 }; m.previous = x.amount; map.set(x.code, m); }
    const rows = [...map.values()].filter((x) => r2(x.current) !== 0 || r2(x.previous) !== 0).map((x) => {
      const current = r2(x.current), previous = r2(x.previous), diff = r2(current - previous);
      return { ...x, current, previous, diff, pct: previous ? r2(diff / Math.abs(previous) * 100) : null };
    }).sort((a, b) => (a.type === b.type ? a.code.localeCompare(b.code) : a.type === 'REVENUE' ? -1 : 1));
    const sum = (type, k) => r2(rows.filter((x) => x.type === type).reduce((s, x) => s + x[k], 0));
    const net = (k) => r2(sum('REVENUE', k) - sum('EXPENSE', k));
    res.json({ rows, totals: { revenue: { current: sum('REVENUE', 'current'), previous: sum('REVENUE', 'previous') }, expense: { current: sum('EXPENSE', 'current'), previous: sum('EXPENSE', 'previous') },
      net: { current: net('current'), previous: net('previous') } } });
  }));
  return r;
};
