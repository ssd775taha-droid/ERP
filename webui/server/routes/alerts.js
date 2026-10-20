// التنبيهات التشغيلية للوحة المعلومات: ما يحتاج متابعة، مقتصرة على الوحدات التي يملك المستخدم صلاحية قراءتها.
const express = require('express');
const db = require('../db');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const rank = { n: 0, r: 1, w: 2 };

module.exports = function alertRoutes() {
  const r = express.Router();
  r.get('/alerts', wrap(async (req, res) => {
    const u = req.user;
    const can = (m) => u.isAdmin || rank[u.perms[m] || 'n'] >= 1;
    const out = [];
    const one = async (sql, binds = {}) => (await db.query(sql, binds))[0];
    const add = (level, text, href, count, amount) => { if (count > 0) out.push({ level, text, href, count, amount: amount == null ? null : r2(amount) }); };

    if (can('trade')) {
      for (const [kind, label, href] of [['SALES', 'فاتورة مبيعات متأخرة السداد', '#/reports/open-invoices'], ['PURCHASE', 'فاتورة مشتريات متأخرة السداد', '#/reports/open-invoices']]) {
        const x = await one(`SELECT COUNT(*) AS "n", NVL(SUM(i.total + erp_note_net(i.invoice_id) - i.paid), 0) AS "a" FROM erp_invoices i
          WHERE i.kind = :k AND i.status = 'OPEN' AND i.total + erp_note_net(i.invoice_id) - i.paid > 0 AND NVL(i.due_date, i.invoice_date) < TRUNC(SYSDATE)`, { k: kind });
        add('bad', label, href, x.n, x.a);
      }
    }
    if (can('payroll')) { const x = await one(`SELECT COUNT(*) AS "n" FROM erp_payroll_runs WHERE status = 'DRAFT'`); add('warn', 'كشف رواتب مسودة لم يُرحَّل', '#/payroll', x.n); }
    if (can('periods')) {
      const x = await one(`SELECT COUNT(*) AS "n" FROM v_erp_period_status WHERE status <> 'CLOSED' AND period < TRUNC(SYSDATE, 'MM')`);
      add('info', 'شهر سابق لم يُقفل بعد', '#/periods', x.n);
    }
    if (can('inventory')) {
      const x = await one(`SELECT COUNT(*) AS "n" FROM erp_items i WHERE i.track_stock = 'Y' AND i.active = 'Y'
        AND NVL((SELECT SUM(m.qty) FROM erp_stock_moves m WHERE m.item_id = i.item_id), 0) <= 0
        AND EXISTS (SELECT 1 FROM erp_stock_moves m WHERE m.item_id = i.item_id AND m.move_type = 'SALE' AND m.move_date > TRUNC(SYSDATE) - 90)`);
      add('bad', 'صنف نافد وله مبيعات آخر 90 يوماً', '#/inventory/shortage', x.n);
    }
    if (can('orders')) {
      const q = await one(`SELECT SUM(CASE WHEN valid_until < TRUNC(SYSDATE) THEN 1 ELSE 0 END) AS "expired", SUM(CASE WHEN valid_until >= TRUNC(SYSDATE) AND valid_until <= TRUNC(SYSDATE) + 7 THEN 1 ELSE 0 END) AS "soon"
        FROM erp_quotations WHERE status = 'SENT'`);
      add('warn', 'عرض سعر مرسل انتهت صلاحيته', '#/quotes', q.expired || 0);
      add('info', 'عرض سعر مرسل تنتهي صلاحيته خلال 7 أيام', '#/quotes', q.soon || 0);
      const p = await one(`SELECT COUNT(*) AS "n" FROM erp_purchase_orders WHERE status IN ('APPROVED', 'PARTIAL') AND expected_date < TRUNC(SYSDATE)`);
      add('warn', 'أمر شراء تجاوز تاريخ التسليم المتوقع', '#/po', p.n);
    }
    if (can('pos')) { const x = await one(`SELECT COUNT(*) AS "n" FROM erp_pos_shifts WHERE status = 'OPEN' AND opened_at < SYSTIMESTAMP - INTERVAL '1' DAY`); add('warn', 'وردية مفتوحة منذ أكثر من 24 ساعة', '#/pos/shifts', x.n); }
    if (can('assets')) { const x = await one(`SELECT COUNT(*) AS "n" FROM v_erp_asset_register WHERE fully_depreciated = 'Y' AND status = 'ACTIVE'`); add('info', 'أصل مهلك بالكامل ما زال فعّالاً', '#/assets/rep-life', x.n); }
    if (can('hr')) { const x = await one(`SELECT COUNT(*) AS "n" FROM erp_employees WHERE status = 'ACTIVE' AND (national_id IS NULL OR bank_account IS NULL)`); add('info', 'موظف ينقصه رقم هوية أو حساب بنكي', '#/hr/data-gaps', x.n); }
    res.json({ alerts: out });
  }));
  return r;
};
