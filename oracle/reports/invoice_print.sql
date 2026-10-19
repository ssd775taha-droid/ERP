-- طباعة فاتورة: رأس (استعلام 1) وبنود (استعلام 2). المعامل: :P_INVOICE
-- في Reports Builder: استعلام Q_HEAD ثم Q_LINES مع رابط بين الاستعلامين على invoice_id.
-- Q_HEAD
SELECT i.invoice_id, i.invoice_no, i.invoice_date, i.due_date, i.ref, i.note, i.kind, i.status,
       p.name AS party_name, p.phone, p.tax_no,
       i.subtotal, i.vat_amount, i.total, i.paid, i.total - i.paid AS remaining
  FROM erp_invoices i JOIN erp_parties p ON p.party_id = i.party_id
 WHERE i.invoice_id = :P_INVOICE;

-- Q_LINES
SELECT l.invoice_id, l.description, l.qty, l.price, l.vat_rate, l.net, l.vat, l.net + l.vat AS line_total
  FROM erp_invoice_lines l
 WHERE l.invoice_id = :P_INVOICE
 ORDER BY l.line_id;
