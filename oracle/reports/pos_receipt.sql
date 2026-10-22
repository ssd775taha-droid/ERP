-- إيصال بيع أو مرتجع. المعامل: :P_SALE (إلزامي). ثلاثة استعلامات بربط على sale_id.
-- Q_HEAD
SELECT s.sale_id, s.sale_no, s.kind, s.sale_date, s.status, r.name AS reg_name, sh.cashier,
       s.subtotal, s.vat_amount, s.total, s.tendered, s.change_due,
       (SELECT o.sale_no FROM erp_pos_sales o WHERE o.sale_id = s.orig_sale_id) AS orig_sale_no
  FROM erp_pos_sales s
  JOIN erp_pos_shifts sh   ON sh.shift_id = s.shift_id
  JOIN erp_pos_registers r ON r.reg_id = sh.reg_id
 WHERE s.sale_id = :P_SALE;

-- Q_LINES
SELECT l.sale_id, l.description, l.qty, l.price, l.discount_pct, l.vat_rate, l.net, l.vat, l.net + l.vat AS line_total
  FROM erp_pos_sale_lines l WHERE l.sale_id = :P_SALE ORDER BY l.line_id;

-- Q_PAYMENTS
SELECT p.sale_id, CASE p.method WHEN 'CASH' THEN 'نقداً' ELSE 'بطاقة' END AS method_name, p.amount
  FROM erp_pos_payments p WHERE p.sale_id = :P_SALE ORDER BY p.pay_id;
-- الإيصال الحراري: عرض 80 مم، خط 9، وQR/باركود لرقم الإيصال اختياري (للفاتورة الإلكترونية يلزم تكامل منفصل بحسب بلدك).
