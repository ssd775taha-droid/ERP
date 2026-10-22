-- أوامر الشراء المنتظرة للاستلام وبنودها. المعامل اختياري: :P_SUPPLIER (رقم المورد، NULL = الكل)
SELECT o.po_no, o.supplier_name, o.expected_date, o.line_no, o.description, o.qty, o.received_qty, o.open_qty, o.price,
       o.open_qty * o.price AS open_value,
       CASE WHEN o.expected_date IS NOT NULL AND o.expected_date < TRUNC(SYSDATE) THEN 'متأخر' END AS late_flag
  FROM v_erp_po_open_lines o
  JOIN erp_purchase_orders po ON po.po_id = o.po_id
 WHERE (:P_SUPPLIER IS NULL OR po.party_id = :P_SUPPLIER)
 ORDER BY o.expected_date NULLS LAST, o.po_no, o.line_no;
-- تجميع بالمورد ثم بالأمر، وملخص Sum لقيمة المتبقي (open_value).
