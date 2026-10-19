-- مسار عروض الأسعار لفترة: عدد وقيمة كل حالة، ونسبة التحويل. المعاملان: :P_FROM · :P_TO (تاريخ العرض)
SELECT status, COUNT(*) AS quotes, NVL(SUM(total), 0) AS total_value,
       ROUND(100 * RATIO_TO_REPORT(COUNT(*)) OVER (), 1) AS pct_of_quotes
  FROM erp_quotations
 WHERE quote_date BETWEEN :P_FROM AND :P_TO
 GROUP BY status
 ORDER BY CASE status WHEN 'DRAFT' THEN 1 WHEN 'SENT' THEN 2 WHEN 'ACCEPTED' THEN 3 WHEN 'CONVERTED' THEN 4
                      WHEN 'REJECTED' THEN 5 WHEN 'EXPIRED' THEN 6 WHEN 'SUPERSEDED' THEN 7 ELSE 8 END;
-- نسبة التحويل = قيمة CONVERTED ÷ (SENT + ACCEPTED + CONVERTED + REJECTED + EXPIRED) في تقرير Reports كحقل صيغة.
