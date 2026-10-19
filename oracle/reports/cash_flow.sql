-- قائمة التدفقات النقدية (الطريقة المباشرة) لفترة. المعاملان: :P_FROM · :P_TO (DATE، إلزاميان)
-- النقد = حسابات cash_account = 'Y' (الصندوق والبنوك افتراضياً). كل قيد يمس النقد يُصنَّف مرة واحدة بحسب حسابات الطرف
-- المقابل: استثماري إن مس حساباً cf_category = 'INVESTING'، وإلا تمويلي إن مس 'FINANCING'، وإلا تشغيلي.
-- هذا تقريب عملي: قيد مختلط (أصل وتمويل في قيد واحد) يُنسب كله إلى الاستثماري.
WITH ce AS (
  SELECT e.entry_id, SUM(l.debit - l.credit) AS cash_change
    FROM erp_entries e
    JOIN erp_lines l    ON l.entry_id = e.entry_id
    JOIN erp_accounts a ON a.code = l.account_code AND a.cash_account = 'Y'
   WHERE e.entry_date BETWEEN :P_FROM AND :P_TO
   GROUP BY e.entry_id HAVING SUM(l.debit - l.credit) <> 0
), cls AS (
  SELECT ce.cash_change,
         CASE WHEN EXISTS (SELECT 1 FROM erp_lines l2 JOIN erp_accounts a2 ON a2.code = l2.account_code
                            WHERE l2.entry_id = ce.entry_id AND a2.cash_account = 'N' AND a2.cf_category = 'INVESTING') THEN 'INVESTING'
              WHEN EXISTS (SELECT 1 FROM erp_lines l2 JOIN erp_accounts a2 ON a2.code = l2.account_code
                            WHERE l2.entry_id = ce.entry_id AND a2.cash_account = 'N' AND a2.cf_category = 'FINANCING') THEN 'FINANCING'
              ELSE 'OPERATING' END AS category
    FROM ce
), opening AS (
  SELECT NVL(SUM(l.debit - l.credit), 0) AS amount
    FROM erp_lines l JOIN erp_entries e ON e.entry_id = l.entry_id JOIN erp_accounts a ON a.code = l.account_code
   WHERE a.cash_account = 'Y' AND e.entry_date < :P_FROM
)
SELECT ord, label, amount FROM (
  SELECT 1 AS ord, 'الرصيد النقدي أول الفترة' AS label, amount FROM opening
  UNION ALL SELECT 2, 'صافي التدفق من الأنشطة التشغيلية',  NVL((SELECT SUM(cash_change) FROM cls WHERE category = 'OPERATING'), 0) FROM dual
  UNION ALL SELECT 3, 'صافي التدفق من الأنشطة الاستثمارية', NVL((SELECT SUM(cash_change) FROM cls WHERE category = 'INVESTING'), 0) FROM dual
  UNION ALL SELECT 4, 'صافي التدفق من الأنشطة التمويلية',  NVL((SELECT SUM(cash_change) FROM cls WHERE category = 'FINANCING'), 0) FROM dual
  UNION ALL SELECT 5, 'الرصيد النقدي آخر الفترة', (SELECT amount FROM opening) + NVL((SELECT SUM(cash_change) FROM cls), 0) FROM dual
)
ORDER BY ord;
-- تحقق: الرصيد الأخير = رصيد حسابات النقد في الأستاذ حتى :P_TO (الدالة ERP_FIN.CASH_BALANCE).
