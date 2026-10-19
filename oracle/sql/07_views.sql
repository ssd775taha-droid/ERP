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
