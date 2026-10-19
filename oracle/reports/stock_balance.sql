-- أرصدة المخزون وتقييمه. المعاملات اختيارية: :P_WH (رقم المخزن) · :P_ITEM (رقم الصنف). NULL = الكل.
SELECT item_code, item_name, unit, wh_code, wh_name, qty, avg_cost, value
  FROM v_erp_stock
 WHERE (:P_WH   IS NULL OR wh_id   = :P_WH)
   AND (:P_ITEM IS NULL OR item_id = :P_ITEM)
 ORDER BY item_code, wh_code;
-- إجمالي القيمة في التقرير: Summary Column (Sum) على value، ويُقارن بحساب المخزون عبر العرض v_erp_stock_vs_gl.
