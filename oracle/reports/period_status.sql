-- حالة الفترات المحاسبية وإقفال السنوات (بلا معاملات)
SELECT 'شهر' AS kind, TO_CHAR(period, 'YYYY-MM') AS period_label, status, entries AS detail
  FROM v_erp_period_status
UNION ALL
SELECT 'سنة', TO_CHAR(year_end, 'YYYY-MM-DD'), status, TO_NUMBER(net_income)
  FROM erp_year_closings
ORDER BY 1, 2;
