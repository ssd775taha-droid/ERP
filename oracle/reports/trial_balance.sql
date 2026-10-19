-- ميزان المراجعة حتى تاريخ. المعاملات: :P_TO (DATE، اختياري: NULL = الكل)
SELECT a.code, a.name, a.acc_type,
       NVL(SUM(l.debit), 0)  AS total_debit,
       NVL(SUM(l.credit), 0) AS total_credit,
       GREATEST(NVL(SUM(l.debit), 0) - NVL(SUM(l.credit), 0), 0) AS balance_debit,
       GREATEST(NVL(SUM(l.credit), 0) - NVL(SUM(l.debit), 0), 0) AS balance_credit
  FROM erp_accounts a
  JOIN erp_lines   l ON l.account_code = a.code
  JOIN erp_entries e ON e.entry_id = l.entry_id AND (:P_TO IS NULL OR e.entry_date <= :P_TO)
 GROUP BY a.code, a.name, a.acc_type
 ORDER BY a.code;
