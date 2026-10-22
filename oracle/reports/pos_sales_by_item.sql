-- مبيعات نقاط البيع بالصنف لفترة. المعاملات: :P_FROM · :P_TO (DATE، إلزاميان) و:P_REG اختياري (رقم نقطة البيع)
SELECT i.code AS item_code, i.name AS item_name,
       SUM(CASE s.kind WHEN 'SALE' THEN l.qty ELSE -l.qty END) AS qty,
       SUM(CASE s.kind WHEN 'SALE' THEN l.net ELSE -l.net END) AS net_sales,
       SUM(CASE s.kind WHEN 'SALE' THEN l.vat ELSE -l.vat END) AS vat,
       SUM(CASE s.kind WHEN 'SALE' THEN NVL(l.cost, 0) ELSE -NVL(l.cost, 0) END) AS cost,
       SUM(CASE s.kind WHEN 'SALE' THEN l.net - NVL(l.cost, 0) ELSE -(l.net - NVL(l.cost, 0)) END) AS gross_profit
  FROM erp_pos_sale_lines l
  JOIN erp_pos_sales s   ON s.sale_id = l.sale_id
  JOIN erp_pos_shifts sh ON sh.shift_id = s.shift_id
  JOIN erp_items i       ON i.item_id = l.item_id
 WHERE s.status = 'COMPLETED' AND s.sale_date BETWEEN :P_FROM AND :P_TO AND (:P_REG IS NULL OR sh.reg_id = :P_REG)
 GROUP BY i.code, i.name
 ORDER BY net_sales DESC;
