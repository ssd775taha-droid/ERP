-- طباعة عرض سعر. المعامل: :P_QUOTE (إلزامي). استعلامان بربط على quote_id.
-- Q_HEAD
SELECT q.quote_id, q.quote_no, q.quote_date, q.valid_until, q.status, q.notes, q.terms,
       pa.name AS customer_name, pa.phone, pa.tax_no, q.subtotal, q.vat_amount, q.total,
       (SELECT o.quote_no FROM erp_quotations o WHERE o.quote_id = q.revision_of) AS revises_quote_no
  FROM erp_quotations q JOIN erp_parties pa ON pa.party_id = q.party_id
 WHERE q.quote_id = :P_QUOTE;

-- Q_LINES: السعر قبل الخصم ثم الخصم ثم سعر الوحدة الصافي والمجموع
SELECT l.quote_id, l.line_no, l.description, l.qty, l.price, l.discount_pct, l.unit_net_price, l.vat_rate, l.net, l.vat, l.net + l.vat AS line_total
  FROM erp_quote_lines l WHERE l.quote_id = :P_QUOTE ORDER BY l.line_no;
-- يظهر «مسودة» على العرض غير المرسل، و«منتهي الصلاحية» إن كانت حالته SENT وتجاوز تاريخ الصلاحية.
