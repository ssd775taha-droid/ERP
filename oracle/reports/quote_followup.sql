-- عروض تنتظر المتابعة: مرسلة لم تُقبل ولم تُرفض، مرتبة بأقربها انتهاءً. المعامل اختياري: :P_CUSTOMER (رقم العميل)
SELECT v.quote_no, v.customer_name, v.quote_date, v.valid_until, v.days_left, v.total,
       CASE WHEN v.expired_flag = 'Y' THEN 'منتهٍ (يلزم تحويله إلى EXPIRED)' WHEN v.days_left <= 3 THEN 'ينتهي قريباً' END AS flag
  FROM v_erp_quote_status v
  JOIN erp_quotations q ON q.quote_id = v.quote_id
 WHERE v.status = 'SENT' AND (:P_CUSTOMER IS NULL OR q.party_id = :P_CUSTOMER)
 ORDER BY v.valid_until;
