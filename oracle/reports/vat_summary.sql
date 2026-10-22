-- ملخص ضريبة القيمة المضافة لفترة. المعاملات: :P_FROM · :P_TO (DATE)
SELECT CASE i.kind WHEN 'SALES' THEN 'مخرجات (مبيعات)' ELSE 'مدخلات (مشتريات)' END AS side,
       COUNT(*) AS invoices, SUM(i.subtotal) AS taxable, SUM(i.vat_amount) AS vat
  FROM erp_invoices i
 WHERE i.status = 'OPEN' AND i.invoice_date BETWEEN :P_FROM AND :P_TO
 GROUP BY i.kind
UNION ALL
SELECT 'صافي الضريبة المستحقة', NULL, NULL,
       NVL(SUM(CASE i.kind WHEN 'SALES' THEN i.vat_amount ELSE -i.vat_amount END), 0)
  FROM erp_invoices i
 WHERE i.status = 'OPEN' AND i.invoice_date BETWEEN :P_FROM AND :P_TO;
