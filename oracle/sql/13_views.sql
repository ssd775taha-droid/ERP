-- 05: عروض للتقارير والتدقيق
SET DEFINE OFF

-- أرصدة الحسابات (ميزان المراجعة الكلي). للميزان حتى تاريخ معيّن استخدم reports/trial_balance.sql
CREATE OR REPLACE VIEW v_erp_trial_balance AS
SELECT a.code, a.name, a.acc_type,
       NVL(SUM(l.debit), 0)  AS total_debit,
       NVL(SUM(l.credit), 0) AS total_credit,
       GREATEST(NVL(SUM(l.debit), 0) - NVL(SUM(l.credit), 0), 0) AS balance_debit,
       GREATEST(NVL(SUM(l.credit), 0) - NVL(SUM(l.debit), 0), 0) AS balance_credit
  FROM erp_accounts a
  LEFT JOIN erp_lines l ON l.account_code = a.code
 GROUP BY a.code, a.name, a.acc_type
HAVING NVL(SUM(l.debit), 0) + NVL(SUM(l.credit), 0) > 0;

-- رصيد كل طرف: الفواتير السارية ناقص المدفوعات (موجب = مستحق)
CREATE OR REPLACE VIEW v_erp_party_balance AS
SELECT p.party_id, p.kind, p.name, p.phone,
       NVL((SELECT SUM(i.total)  FROM erp_invoices i WHERE i.party_id = p.party_id AND i.status = 'OPEN'), 0)
     - NVL((SELECT SUM(y.amount) FROM erp_payments y WHERE y.party_id = p.party_id), 0) AS balance
  FROM erp_parties p;

-- حالة الفواتير مع المتبقي والتأخر
CREATE OR REPLACE VIEW v_erp_invoice_status AS
SELECT i.invoice_id, i.party_id, i.kind, i.invoice_no, i.invoice_date, i.due_date, p.name AS party_name,
       i.total, i.paid,
       CASE WHEN i.status = 'OPEN' THEN i.total - i.paid ELSE 0 END AS remaining,
       CASE WHEN i.status = 'VOID' THEN 'VOID'
            WHEN i.total - i.paid = 0 THEN 'PAID'
            WHEN i.due_date IS NOT NULL AND i.due_date < TRUNC(SYSDATE) THEN 'OVERDUE'
            ELSE 'OPEN' END AS state
  FROM erp_invoices i
  JOIN erp_parties p ON p.party_id = i.party_id;

-- تدقيق: يجب ألا يرجع هذا العرض أي صف أبداً (قيد مدينه لا يساوي دائنه)
CREATE OR REPLACE VIEW v_erp_unbalanced_entries AS
SELECT e.entry_id, SUM(l.debit) AS total_debit, SUM(l.credit) AS total_credit
  FROM erp_entries e
  JOIN erp_lines l ON l.entry_id = e.entry_id
 GROUP BY e.entry_id
HAVING SUM(l.debit) <> SUM(l.credit);

-- أرصدة المخزون بالكمية والقيمة ومتوسط التكلفة لكل صنف ومخزن
CREATE OR REPLACE VIEW v_erp_stock AS
SELECT i.item_id, i.code AS item_code, i.name AS item_name, i.unit,
       w.wh_id, w.code AS wh_code, w.name AS wh_name,
       s.qty, s.value,
       CASE WHEN s.qty > 0 THEN ROUND(s.value / s.qty, 4) END AS avg_cost
  FROM erp_stock s
  JOIN erp_items i      ON i.item_id = s.item_id
  JOIN erp_warehouses w ON w.wh_id   = s.wh_id
 WHERE s.qty > 0;

-- مطابقة قيمة المخزون مع حساب المخزون في الأستاذ. الفرق يجب أن يكون صفراً ما لم تُرحَّل قيود يدوية على حساب المخزون.
CREATE OR REPLACE VIEW v_erp_stock_vs_gl AS
SELECT x.inv_account,
       x.stock_value,
       NVL((SELECT SUM(l.debit - l.credit) FROM erp_lines l WHERE l.account_code = x.inv_account), 0) AS gl_balance,
       x.stock_value - NVL((SELECT SUM(l.debit - l.credit) FROM erp_lines l WHERE l.account_code = x.inv_account), 0) AS difference
  FROM (SELECT i.inv_account, NVL(SUM(s.value), 0) AS stock_value
          FROM erp_items i
          LEFT JOIN erp_stock s ON s.item_id = i.item_id
         WHERE i.track_stock = 'Y'
         GROUP BY i.inv_account) x;

-- سجل الأصول: التكلفة والمجمع والقيمة الدفترية وآخر شهر مهلك
CREATE OR REPLACE VIEW v_erp_asset_register AS
SELECT a.asset_id, a.code, a.name, c.code AS cat_code, c.name AS cat_name,
       a.acq_date, a.dep_start, a.cost, a.salvage, a.life_months, a.status,
       NVL(d.accumulated, 0) AS accumulated,
       a.cost - NVL(d.accumulated, 0) AS book_value,
       d.last_period,
       CASE WHEN a.status = 'ACTIVE' AND NVL(d.accumulated, 0) >= a.cost - a.salvage THEN 'Y' ELSE 'N' END AS fully_depreciated
  FROM erp_assets a
  JOIN erp_asset_categories c ON c.cat_id = a.cat_id
  LEFT JOIN (SELECT asset_id, SUM(amount) AS accumulated, MAX(period) AS last_period
               FROM erp_depreciation WHERE status = 'OK' GROUP BY asset_id) d ON d.asset_id = a.asset_id
 WHERE a.status <> 'VOID';

-- مطابقة سجل الأصول مع الأستاذ لكل حساب أصل ومجمع. الفرق صفر ما لم تُرحَّل قيود يدوية أو فواتير غير مسجَّلة كأصول.
CREATE OR REPLACE VIEW v_erp_asset_vs_gl AS
SELECT 'COST' AS kind, x.account_code,
       x.register_value,
       NVL((SELECT SUM(l.debit - l.credit) FROM erp_lines l WHERE l.account_code = x.account_code), 0) AS gl_balance,
       x.register_value - NVL((SELECT SUM(l.debit - l.credit) FROM erp_lines l WHERE l.account_code = x.account_code), 0) AS difference
  FROM (SELECT c.asset_account AS account_code, NVL(SUM(a.cost), 0) AS register_value
          FROM erp_asset_categories c LEFT JOIN erp_assets a ON a.cat_id = c.cat_id AND a.status = 'ACTIVE'
         GROUP BY c.asset_account) x
UNION ALL
SELECT 'ACCUM', y.account_code,
       y.register_value,
       NVL((SELECT SUM(l.credit - l.debit) FROM erp_lines l WHERE l.account_code = y.account_code), 0),
       y.register_value - NVL((SELECT SUM(l.credit - l.debit) FROM erp_lines l WHERE l.account_code = y.account_code), 0)
  FROM (SELECT c.accum_account AS account_code, NVL(SUM(d.amount), 0) AS register_value
          FROM erp_asset_categories c
          LEFT JOIN erp_assets a ON a.cat_id = c.cat_id AND a.status = 'ACTIVE'
          LEFT JOIN erp_depreciation d ON d.asset_id = a.asset_id AND d.status = 'OK'
         GROUP BY c.accum_account) y;

-- الموظفون مع القسم والراتب الأساسي الساري هذا الشهر
CREATE OR REPLACE VIEW v_erp_employee AS
SELECT e.emp_id, e.code, e.name, e.job_title, d.name AS dept_name, e.hire_date, e.term_date, e.status,
       (SELECT h.basic_salary FROM erp_salary_history h
         WHERE h.emp_id = e.emp_id
           AND h.effective_from = (SELECT MAX(h2.effective_from) FROM erp_salary_history h2
                                    WHERE h2.emp_id = e.emp_id AND h2.effective_from <= TRUNC(SYSDATE, 'MM'))) AS current_basic
  FROM erp_employees e
  LEFT JOIN erp_departments d ON d.dept_id = e.dept_id;

-- رصيد السلف
CREATE OR REPLACE VIEW v_erp_advance_balance AS
SELECT a.adv_id, e.code AS emp_code, e.name AS emp_name, a.grant_date, a.amount, a.repaid,
       a.amount - a.repaid AS remaining, a.installments_done, a.installments, a.status
  FROM erp_advances a JOIN erp_employees e ON e.emp_id = a.emp_id
 WHERE a.status <> 'VOID';

-- ملخص كشوف الرواتب
CREATE OR REPLACE VIEW v_erp_payroll_summary AS
SELECT r.run_id, r.period, r.status,
       (SELECT COUNT(*) FROM erp_payroll_lines l WHERE l.run_id = r.run_id) AS employees,
       r.total_gross, r.total_deductions, r.total_net, r.total_employer, r.entry_id, r.pay_entry_id, r.pay_date
  FROM erp_payroll_runs r;

-- مطابقة: صافي الكشوف المرحَّلة غير المصروفة مقابل رصيد ح/2300 رواتب مستحقة. الفرق صفر ما لم تُرحَّل قيود يدوية عليه.
CREATE OR REPLACE VIEW v_erp_payroll_vs_gl AS
SELECT NVL((SELECT SUM(total_net) FROM erp_payroll_runs WHERE status = 'POSTED'), 0) AS unpaid_net,
       NVL((SELECT SUM(credit - debit) FROM erp_lines WHERE account_code = '2300'), 0) AS gl_balance,
       NVL((SELECT SUM(total_net) FROM erp_payroll_runs WHERE status = 'POSTED'), 0)
         - NVL((SELECT SUM(credit - debit) FROM erp_lines WHERE account_code = '2300'), 0) AS difference
  FROM dual;

-- حالة الأشهر: كل شهر فيه قيود أو له صف في الفترات، مع عدد القيود (غير المسجَّل = مفتوح)
CREATE OR REPLACE VIEW v_erp_period_status AS
SELECT m.period, NVL(p.status, 'OPEN') AS status, m.entries
  FROM (SELECT TRUNC(entry_date, 'MM') AS period, COUNT(*) AS entries FROM erp_entries GROUP BY TRUNC(entry_date, 'MM')) m
  LEFT JOIN erp_periods p ON p.period = m.period
UNION ALL
SELECT p.period, p.status, 0
  FROM erp_periods p
 WHERE NOT EXISTS (SELECT 1 FROM erp_entries e WHERE TRUNC(e.entry_date, 'MM') = p.period);

-- ملخص الوردية (تقرير Z): عدد العمليات وإجماليات المبيعات والمرتجعات وتفصيل النقد والبطاقة والنقد المتوقع
CREATE OR REPLACE VIEW v_erp_pos_shift_summary AS
SELECT sh.shift_id, r.code AS reg_code, r.name AS reg_name, sh.cashier, sh.opened_at, sh.closed_at, sh.status,
       sh.opening_cash,
       (SELECT COUNT(*) FROM erp_pos_sales s WHERE s.shift_id = sh.shift_id AND s.kind = 'SALE' AND s.status = 'COMPLETED') AS sales_count,
       (SELECT NVL(SUM(s.total), 0) FROM erp_pos_sales s WHERE s.shift_id = sh.shift_id AND s.kind = 'SALE' AND s.status = 'COMPLETED') AS sales_total,
       (SELECT NVL(SUM(s.vat_amount), 0) FROM erp_pos_sales s WHERE s.shift_id = sh.shift_id AND s.kind = 'SALE' AND s.status = 'COMPLETED') AS sales_vat,
       (SELECT NVL(SUM(s.total), 0) FROM erp_pos_sales s WHERE s.shift_id = sh.shift_id AND s.kind = 'RETURN' AND s.status = 'COMPLETED') AS returns_total,
       (SELECT NVL(SUM(p.amount), 0) FROM erp_pos_payments p JOIN erp_pos_sales s ON s.sale_id = p.sale_id
         WHERE s.shift_id = sh.shift_id AND s.kind = 'SALE' AND s.status = 'COMPLETED' AND p.method = 'CASH')
       - (SELECT NVL(SUM(s.change_due), 0) FROM erp_pos_sales s WHERE s.shift_id = sh.shift_id AND s.kind = 'SALE' AND s.status = 'COMPLETED') AS cash_sales,
       (SELECT NVL(SUM(p.amount), 0) FROM erp_pos_payments p JOIN erp_pos_sales s ON s.sale_id = p.sale_id
         WHERE s.shift_id = sh.shift_id AND s.kind = 'SALE' AND s.status = 'COMPLETED' AND p.method = 'CARD') AS card_sales,
       (SELECT NVL(SUM(p.amount), 0) FROM erp_pos_payments p JOIN erp_pos_sales s ON s.sale_id = p.sale_id
         WHERE s.shift_id = sh.shift_id AND s.kind = 'RETURN' AND s.status = 'COMPLETED' AND p.method = 'CASH') AS cash_refunds,
       (SELECT NVL(SUM(p.amount), 0) FROM erp_pos_payments p JOIN erp_pos_sales s ON s.sale_id = p.sale_id
         WHERE s.shift_id = sh.shift_id AND s.kind = 'RETURN' AND s.status = 'COMPLETED' AND p.method = 'CARD') AS card_refunds,
       sh.expected_cash, sh.counted_cash, sh.variance
  FROM erp_pos_shifts sh JOIN erp_pos_registers r ON r.reg_id = sh.reg_id;

-- حالة أوامر الشراء: الكميات المطلوبة والمستلمة والمتبقية، والتأخر عن موعد التوريد
CREATE OR REPLACE VIEW v_erp_po_status AS
SELECT po.po_id, po.po_no, pa.name AS supplier_name, po.po_date, po.expected_date, po.status,
       po.subtotal, po.vat_amount, po.total,
       NVL(l.ordered_qty, 0) AS ordered_qty, NVL(l.received_qty, 0) AS received_qty,
       NVL(l.ordered_qty, 0) - NVL(l.received_qty, 0) AS open_qty,
       CASE WHEN po.status IN ('APPROVED', 'PARTIAL') AND po.expected_date IS NOT NULL AND po.expected_date < TRUNC(SYSDATE) THEN 'Y' ELSE 'N' END AS overdue
  FROM erp_purchase_orders po
  JOIN erp_parties pa ON pa.party_id = po.party_id
  LEFT JOIN (SELECT po_id, SUM(qty) AS ordered_qty, SUM(received_qty) AS received_qty FROM erp_po_lines GROUP BY po_id) l ON l.po_id = po.po_id;

-- البنود التي ينتظر استلامها (أوامر معتمدة أو مستلمة جزئياً)
CREATE OR REPLACE VIEW v_erp_po_open_lines AS
SELECT po.po_id, po.po_no, pa.name AS supplier_name, po.expected_date,
       l.line_id, l.line_no, l.description, l.qty, l.received_qty, l.qty - l.received_qty AS open_qty, l.price, l.vat_rate
  FROM erp_purchase_orders po
  JOIN erp_parties pa ON pa.party_id = po.party_id
  JOIN erp_po_lines l ON l.po_id = po.po_id
 WHERE po.status IN ('APPROVED', 'PARTIAL') AND l.received_qty < l.qty;

-- فروق الأسعار: سعر الفاتورة الفعلي مقابل سعر الأمر في الاستلامات الفعّالة
CREATE OR REPLACE VIEW v_erp_po_variance AS
SELECT po.po_no, pa.name AS supplier_name, rc.receipt_id, rc.receipt_date, ln.description,
       rl.qty, rl.po_price, rl.price, (rl.price - rl.po_price) * rl.qty AS variance
  FROM erp_po_receipt_lines rl
  JOIN erp_po_receipts rc   ON rc.receipt_id = rl.receipt_id AND rc.status = 'ACTIVE'
  JOIN erp_purchase_orders po ON po.po_id = rc.po_id
  JOIN erp_parties pa       ON pa.party_id = po.party_id
  JOIN erp_po_lines ln      ON ln.line_id = rl.po_line_id;
