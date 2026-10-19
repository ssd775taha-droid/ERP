-- فروق أسعار الاستلام مقابل أوامر الشراء لفترة. المعاملان: :P_FROM · :P_TO (DATE)
SELECT supplier_name, po_no, receipt_date, description, qty, po_price, price, variance
  FROM v_erp_po_variance
 WHERE receipt_date BETWEEN :P_FROM AND :P_TO AND variance <> 0
 ORDER BY supplier_name, receipt_date, po_no;
-- تجميع بالمورد وملخص Sum للفرق. موجب = اشترينا بأكثر من سعر الأمر.
