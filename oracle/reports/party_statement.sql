-- كشف حساب عميل/مورد برصيد جارٍ (موجب = مستحق). المعامل: :P_PARTY (إلزامي)
SELECT doc_date, doc_no, doc_type, amount,
       SUM(amount) OVER (ORDER BY doc_date, sort_key, doc_id) AS balance
  FROM (
    SELECT i.invoice_date AS doc_date, i.invoice_no AS doc_no, 'فاتورة' AS doc_type, i.total AS amount, 1 AS sort_key, i.invoice_id AS doc_id
      FROM erp_invoices i WHERE i.party_id = :P_PARTY AND i.status = 'OPEN'
    UNION ALL
    SELECT y.pay_date, 'سند ' || y.payment_id, CASE y.kind WHEN 'RECEIPT' THEN 'قبض' ELSE 'صرف' END, -y.amount, 2, y.payment_id
      FROM erp_payments y WHERE y.party_id = :P_PARTY
  )
 ORDER BY doc_date, sort_key, doc_id;
