-- ملخص الكشف بحسب البند (للتسويات المالية: ما يُسدَّد للجهات الخارجية وتكلفة صاحب العمل). المعامل: :P_RUN
SELECT CASE i.kind WHEN 'BASIC' THEN 'أساسي' WHEN 'EARNING' THEN 'استحقاق' WHEN 'DEDUCTION' THEN 'استقطاع'
                   WHEN 'EMPLOYER' THEN 'حصة صاحب العمل' ELSE 'قسط سلفة' END AS kind_name,
       NVL(c.name, i.description) AS item_name,
       COUNT(*) AS employees, SUM(i.amount) AS total,
       NVL(i.liability_account, i.expense_account) AS account_code
  FROM erp_payroll_items i
  JOIN erp_payroll_lines l ON l.line_id = i.line_id
  LEFT JOIN erp_pay_components c ON c.comp_id = i.comp_id
 WHERE l.run_id = :P_RUN
 GROUP BY i.kind, NVL(c.name, i.description), NVL(i.liability_account, i.expense_account)
 ORDER BY CASE i.kind WHEN 'BASIC' THEN 1 WHEN 'EARNING' THEN 2 WHEN 'DEDUCTION' THEN 3 WHEN 'EMPLOYER' THEN 4 ELSE 5 END, item_name;
-- المبالغ المستحقة لجهات خارجية (تأمينات/ضرائب) هي مجاميع الاستقطاع وحصة صاحب العمل على ح/2400 وح/2500؛
-- تُسدَّد بقيد يدوي: مدين الحساب / دائن البنك.
