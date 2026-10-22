-- الميزانية العمومية في تاريخ. المعامل: :P_ASOF (DATE، إلزامي)
-- كل القيود حتى التاريخ (بما فيها قيود الإقفال). ما لم يُقفَل من أرباح يظهر بنداً «أرباح الفترة الحالية (غير مقفلة)»،
-- فيتحقق دائماً: إجمالي الأصول = إجمالي الخصوم وحقوق الملكية.
-- الأصول بالمدين − الدائن (مجمع الإهلاك يظهر سالباً)، والخصوم وحقوق الملكية بالدائن − المدين.
WITH bal AS (
  SELECT a.acc_type, a.code, a.name,
         SUM(CASE WHEN a.acc_type = 'ASSET' THEN l.debit - l.credit ELSE l.credit - l.debit END) AS amount
    FROM erp_accounts a
    JOIN erp_lines l   ON l.account_code = a.code
    JOIN erp_entries e ON e.entry_id = l.entry_id
   WHERE a.acc_type IN ('ASSET', 'LIABILITY', 'EQUITY') AND e.entry_date <= :P_ASOF
   GROUP BY a.acc_type, a.code, a.name
  HAVING SUM(l.debit - l.credit) <> 0
), pl AS (
  SELECT NVL(SUM(l.credit - l.debit), 0) AS amount
    FROM erp_accounts a
    JOIN erp_lines l   ON l.account_code = a.code
    JOIN erp_entries e ON e.entry_id = l.entry_id
   WHERE a.acc_type IN ('REVENUE', 'EXPENSE') AND e.entry_date <= :P_ASOF
)
SELECT ord, section, code, name, amount FROM (
  SELECT 1 AS ord, 'الأصول' AS section, code, name, amount FROM bal WHERE acc_type = 'ASSET'
  UNION ALL SELECT 2, 'إجمالي الأصول', NULL, NULL, NVL((SELECT SUM(amount) FROM bal WHERE acc_type = 'ASSET'), 0) FROM dual
  UNION ALL SELECT 3, 'الخصوم', code, name, amount FROM bal WHERE acc_type = 'LIABILITY'
  UNION ALL SELECT 4, 'إجمالي الخصوم', NULL, NULL, NVL((SELECT SUM(amount) FROM bal WHERE acc_type = 'LIABILITY'), 0) FROM dual
  UNION ALL SELECT 5, 'حقوق الملكية', code, name, amount FROM bal WHERE acc_type = 'EQUITY'
  UNION ALL SELECT 6, 'حقوق الملكية', NULL, 'أرباح الفترة الحالية (غير مقفلة)', amount FROM pl WHERE amount <> 0
  UNION ALL SELECT 7, 'إجمالي حقوق الملكية', NULL, NULL,
                      NVL((SELECT SUM(amount) FROM bal WHERE acc_type = 'EQUITY'), 0) + (SELECT amount FROM pl) FROM dual
  UNION ALL SELECT 8, 'إجمالي الخصوم وحقوق الملكية', NULL, NULL,
                      NVL((SELECT SUM(amount) FROM bal WHERE acc_type IN ('LIABILITY', 'EQUITY')), 0) + (SELECT amount FROM pl) FROM dual
)
ORDER BY ord, code;
