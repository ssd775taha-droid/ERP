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
