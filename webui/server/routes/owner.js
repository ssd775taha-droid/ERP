// تطبيق المالك (PWA): ملخص يومي سريع، والعمليات المعلّقة باعتماد عبر الوحدات الموجودة (لا منطق جديد، تجميع وعرض فقط).
const express = require('express');
const db = require('../db');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const one = async (sql, binds) => (await db.query(sql, binds || {}))[0] || {};
const rank = { n: 0, r: 1, w: 2 };

module.exports = function ownerRoutes() {
  const r = express.Router();

  r.get('/owner/summary', wrap(async (req, res) => {
    const u = req.user;
    const can = (m) => u.isAdmin || rank[u.perms[m] || 'n'] >= 1;
    const out = { can: { trade: can('trade'), pos: can('pos'), reports: can('reports') } };
    if (can('trade') || can('pos')) {
      const s = await one(`SELECT
        NVL((SELECT SUM(i.total) FROM erp_invoices i WHERE i.kind = 'SALES' AND i.status != 'VOID' AND i.invoice_date = TRUNC(SYSDATE)), 0)
        + NVL((SELECT SUM(s.total) FROM erp_pos_sales s WHERE s.kind = 'SALE' AND s.status = 'COMPLETED' AND s.sale_date = TRUNC(SYSDATE)), 0)
        - NVL((SELECT SUM(s.total) FROM erp_pos_sales s WHERE s.kind = 'RETURN' AND s.status = 'COMPLETED' AND s.sale_date = TRUNC(SYSDATE)), 0) AS "today",
        NVL((SELECT SUM(i.total) FROM erp_invoices i WHERE i.kind = 'SALES' AND i.status != 'VOID' AND i.invoice_date >= TRUNC(SYSDATE, 'MM')), 0)
        + NVL((SELECT SUM(s.total) FROM erp_pos_sales s WHERE s.kind = 'SALE' AND s.status = 'COMPLETED' AND s.sale_date >= TRUNC(SYSDATE, 'MM')), 0)
        - NVL((SELECT SUM(s.total) FROM erp_pos_sales s WHERE s.kind = 'RETURN' AND s.status = 'COMPLETED' AND s.sale_date >= TRUNC(SYSDATE, 'MM')), 0) AS "mtd"
        FROM dual`);
      out.sales = { today: r2(s.today), mtd: r2(s.mtd) };
    }
    if (can('reports')) {
      const f = await one(`SELECT erp_fin.cash_balance(NULL) AS "cash", erp_fin.net_income(TRUNC(SYSDATE, 'MM'), SYSDATE) AS "mtdNet",
        NVL((SELECT SUM(i.total + erp_note_net(i.invoice_id) - i.paid) FROM erp_invoices i WHERE i.kind = 'SALES' AND i.status = 'OPEN'), 0) AS "ar",
        NVL((SELECT SUM(i.total + erp_note_net(i.invoice_id) - i.paid) FROM erp_invoices i WHERE i.kind = 'PURCHASE' AND i.status = 'OPEN'), 0) AS "ap" FROM dual`);
      out.finance = { cash: r2(f.cash), mtdNet: r2(f.mtdNet), ar: r2(f.ar), ap: r2(f.ap) };
    }
    res.json(out);
  }));

  // عمليات تحتاج اعتماد المالك (مجمّعة من الوحدات الموجودة)؛ الأزرار في الواجهة تستدعي مسارات الاعتماد نفسها القائمة أصلاً
  r.get('/owner/pending', wrap(async (req, res) => {
    const u = req.user;
    const can = (m) => u.isAdmin || rank[u.perms[m] || 'n'] >= 1;
    const items = [];
    if (can('orders')) {
      const pos = await db.query(`SELECT po.po_id AS "id", po.po_no AS "no", pa.name AS "party", po.total AS "total"
        FROM erp_purchase_orders po JOIN erp_parties pa ON pa.party_id = po.party_id WHERE po.status = 'DRAFT' ORDER BY po.po_id`);
      for (const x of pos) items.push({ kind: 'po', id: x.id, label: 'أمر شراء ' + x.no + ' — ' + x.party, amount: r2(x.total), action: { path: `/po/${x.id}/approve`, body: {} } });
    }
    if (can('payroll')) {
      const runs = await db.query(`SELECT run_id AS "id", TO_CHAR(period, 'YYYY-MM') AS "period", status AS "status", total_net AS "net" FROM v_erp_payroll_summary
        WHERE status IN ('DRAFT', 'POSTED') ORDER BY period DESC`);
      for (const x of runs) {
        if (x.status === 'DRAFT' && x.net > 0) items.push({ kind: 'payroll-post', id: x.id, label: 'ترحيل كشف رواتب ' + x.period, amount: r2(x.net), action: { path: `/payroll/runs/${x.id}/post`, body: {} } });
        else if (x.status === 'POSTED') items.push({ kind: 'payroll-pay', id: x.id, label: 'صرف كشف رواتب ' + x.period, amount: r2(x.net), action: { path: `/payroll/runs/${x.id}/pay`, body: { method: 'BANK' }, needsDate: true } });
      }
    }
    if (can('periods')) {
      const months = await db.query(`SELECT TO_CHAR(period, 'YYYY-MM-DD') AS "month", TO_CHAR(period, 'YYYY-MM') AS "label"
        FROM v_erp_period_status WHERE status <> 'CLOSED' AND period < TRUNC(SYSDATE, 'MM') ORDER BY period`);
      for (const x of months) items.push({ kind: 'period-close', id: x.month, label: 'إقفال شهر ' + x.label, amount: null, action: { path: '/periods/close', body: { month: x.month } } });
    }
    res.json({ items });
  }));

  return r;
};
