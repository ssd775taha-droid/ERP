-- أعمار الذمم (فواتير سارية متبقية). المعاملات: :P_KIND ('SALES' عملاء | 'PURCHASE' موردون) · :P_ASOF (DATE)
-- الشرائح بأيام التأخر عن الاستحقاق (أو عن تاريخ الفاتورة إن لم يُحدَّد استحقاق).
SELECT p.name AS party_name,
       SUM(CASE WHEN d <= 0  THEN rem ELSE 0 END) AS not_due,
       SUM(CASE WHEN d BETWEEN 1  AND 30 THEN rem ELSE 0 END) AS d1_30,
       SUM(CASE WHEN d BETWEEN 31 AND 60 THEN rem ELSE 0 END) AS d31_60,
       SUM(CASE WHEN d BETWEEN 61 AND 90 THEN rem ELSE 0 END) AS d61_90,
       SUM(CASE WHEN d > 90 THEN rem ELSE 0 END) AS over_90,
       SUM(rem) AS total_remaining
  FROM (
    SELECT i.party_id, i.total - i.paid AS rem,
           TRUNC(:P_ASOF) - NVL(i.due_date, i.invoice_date) AS d
      FROM erp_invoices i
     WHERE i.kind = :P_KIND AND i.status = 'OPEN' AND i.total > i.paid AND i.invoice_date <= :P_ASOF
  ) x
  JOIN erp_parties p ON p.party_id = x.party_id
 GROUP BY p.name
 ORDER BY total_remaining DESC;
