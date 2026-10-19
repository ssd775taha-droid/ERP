-- قائمة الدخل لفترة. المعاملان: :P_FROM · :P_TO (DATE، إلزاميان)
-- تستبعد قيود إقفال السنة (kind = 'CLOSING') فتظهر السنة المقفلة بأرقامها كاملة.
SELECT ord, section, code, name, amount FROM (
  SELECT 1 AS ord, 'الإيرادات' AS section, a.code, a.name, SUM(l.credit - l.debit) AS amount
    FROM erp_accounts a
    JOIN erp_lines l   ON l.account_code = a.code
    JOIN erp_entries e ON e.entry_id = l.entry_id
   WHERE a.acc_type = 'REVENUE' AND e.kind = 'NORMAL' AND e.entry_date BETWEEN :P_FROM AND :P_TO
   GROUP BY a.code, a.name HAVING SUM(l.credit - l.debit) <> 0
  UNION ALL
  SELECT 2, 'المصروفات', a.code, a.name, SUM(l.debit - l.credit)
    FROM erp_accounts a
    JOIN erp_lines l   ON l.account_code = a.code
    JOIN erp_entries e ON e.entry_id = l.entry_id
   WHERE a.acc_type = 'EXPENSE' AND e.kind = 'NORMAL' AND e.entry_date BETWEEN :P_FROM AND :P_TO
   GROUP BY a.code, a.name HAVING SUM(l.debit - l.credit) <> 0
  UNION ALL
  SELECT 3, 'صافي الربح (الخسارة)', NULL, NULL, NVL(SUM(l.credit - l.debit), 0)
    FROM erp_accounts a
    JOIN erp_lines l   ON l.account_code = a.code
    JOIN erp_entries e ON e.entry_id = l.entry_id
   WHERE a.acc_type IN ('REVENUE', 'EXPENSE') AND e.kind = 'NORMAL' AND e.entry_date BETWEEN :P_FROM AND :P_TO
)
ORDER BY ord, code;
-- في Reports Builder: تجميع بـ section، وSummary Column بمجموع amount لكل قسم. إجمالي الإيرادات − إجمالي المصروفات = سطر الصافي.
