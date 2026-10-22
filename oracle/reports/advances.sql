-- أرصدة سلف الموظفين. المعامل اختياري: :P_STATUS ('OPEN' | 'SETTLED' | NULL = الكل)
SELECT emp_code, emp_name, grant_date, amount, repaid, remaining, installments_done, installments, status
  FROM v_erp_advance_balance
 WHERE (:P_STATUS IS NULL OR status = :P_STATUS)
 ORDER BY emp_code, grant_date;
