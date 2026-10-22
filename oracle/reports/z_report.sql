-- تقرير Z لوردية. المعامل: :P_SHIFT (إلزامي)
-- Q_SUMMARY
SELECT shift_id, reg_code, reg_name, cashier, opened_at, closed_at, status, opening_cash,
       sales_count, sales_total, sales_vat, returns_total, cash_sales, card_sales, cash_refunds, card_refunds,
       NVL(expected_cash, opening_cash + cash_sales - cash_refunds) AS expected_cash, counted_cash, variance
  FROM v_erp_pos_shift_summary WHERE shift_id = :P_SHIFT;

-- Q_ITEMS: مبيعات الأصناف في الوردية (بعد خصم المرتجعات)
SELECT l.description,
       SUM(CASE s.kind WHEN 'SALE' THEN l.qty ELSE -l.qty END) AS qty,
       SUM(CASE s.kind WHEN 'SALE' THEN l.net + l.vat ELSE -(l.net + l.vat) END) AS amount
  FROM erp_pos_sale_lines l JOIN erp_pos_sales s ON s.sale_id = l.sale_id
 WHERE s.shift_id = :P_SHIFT AND s.status = 'COMPLETED'
 GROUP BY l.description ORDER BY amount DESC;
-- يُطبع عند الإقفال: المتوقع والمعدود والفرق. الفرق مرحَّل إلى ح/5800.
