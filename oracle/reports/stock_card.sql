-- بطاقة الصنف (حركات صنف في مخزن برصيد جارٍ بالكمية والقيمة). المعاملات: :P_ITEM · :P_WH (إلزاميان) · :P_FROM · :P_TO (اختياريان)
-- الصف الأول رصيد أول الفترة إن حُدِّد :P_FROM.
WITH opening AS (
  SELECT NVL(SUM(qty), 0) AS q, NVL(SUM(value), 0) AS v
    FROM erp_stock_moves
   WHERE item_id = :P_ITEM AND wh_id = :P_WH AND :P_FROM IS NOT NULL AND move_date < :P_FROM
)
SELECT TO_DATE(NULL) AS move_date, TO_NUMBER(NULL) AS move_id, 'رصيد أول الفترة' AS move_type, TO_CHAR(NULL) AS doc,
       TO_NUMBER(NULL) AS qty, TO_NUMBER(NULL) AS value,
       (SELECT q FROM opening) AS qty_balance, (SELECT v FROM opening) AS value_balance, 0 AS ord
  FROM dual WHERE :P_FROM IS NOT NULL
UNION ALL
SELECT m.move_date, m.move_id,
       CASE m.move_type WHEN 'PURCHASE' THEN 'مشتريات' WHEN 'SALE' THEN 'مبيعات' WHEN 'ADJUST' THEN 'تسوية'
                        WHEN 'TRANSFER' THEN 'تحويل' ELSE 'عكس' END,
       m.ref_type || ' ' || m.ref_id, m.qty, m.value,
       (SELECT q FROM opening) + SUM(m.qty)   OVER (ORDER BY m.move_date, m.move_id),
       (SELECT v FROM opening) + SUM(m.value) OVER (ORDER BY m.move_date, m.move_id),
       1
  FROM erp_stock_moves m
 WHERE m.item_id = :P_ITEM AND m.wh_id = :P_WH
   AND (:P_FROM IS NULL OR m.move_date >= :P_FROM)
   AND (:P_TO   IS NULL OR m.move_date <= :P_TO)
 ORDER BY ord, move_date, move_id;
