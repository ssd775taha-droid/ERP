-- طباعة أمر شراء. المعامل: :P_PO (إلزامي). استعلامان بربط على po_id.
-- Q_HEAD
SELECT po.po_id, po.po_no, po.po_date, po.expected_date, po.status, po.notes,
       pa.name AS supplier_name, pa.phone, pa.tax_no, po.subtotal, po.vat_amount, po.total,
       po.created_by, po.approved_by, po.approved_at
  FROM erp_purchase_orders po JOIN erp_parties pa ON pa.party_id = po.party_id
 WHERE po.po_id = :P_PO;

-- Q_LINES
SELECT l.po_id, l.line_no, l.description, l.qty, l.price, l.vat_rate, l.net, l.vat, l.net + l.vat AS line_total,
       l.received_qty, l.qty - l.received_qty AS open_qty
  FROM erp_po_lines l WHERE l.po_id = :P_PO ORDER BY l.line_no;
-- يُطبع على الأمر «مسودة» ما لم تكن حالته APPROVED أو أبعد (علامة مائية أو نص شرطي).
