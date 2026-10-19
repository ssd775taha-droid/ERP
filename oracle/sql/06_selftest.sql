-- ============================================================================
-- 06: اختبار ذاتي لحزم PL/SQL. يتراجع عن كل شيء في النهاية (ROLLBACK) فلا يترك بيانات.
-- شغّله بعد 01-05:  SET SERVEROUTPUT ON  ثم  @06_selftest.sql
-- ============================================================================
SET SERVEROUTPUT ON
SET DEFINE OFF
DECLARE
  v_ok    PLS_INTEGER := 0;
  v_fail  PLS_INTEGER := 0;
  v_cust  NUMBER; v_sup NUMBER; v_si NUMBER; v_pi NUMBER; v_entry NUMBER; v_tmp NUMBER;
  v_inv   erp_invoices%ROWTYPE;

  PROCEDURE check_true (p_name VARCHAR2, p_cond BOOLEAN) IS
  BEGIN
    IF p_cond THEN v_ok := v_ok + 1; DBMS_OUTPUT.PUT_LINE('PASS  ' || p_name);
    ELSE v_fail := v_fail + 1; DBMS_OUTPUT.PUT_LINE('FAIL  ' || p_name); END IF;
  END;

  FUNCTION bal (p_code VARCHAR2, p_side VARCHAR2) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    SELECT NVL(MAX(CASE p_side WHEN 'D' THEN balance_debit ELSE balance_credit END), 0) INTO v
      FROM v_erp_trial_balance WHERE code = p_code;
    RETURN v;
  END;
BEGIN
  -- قيد متوازن
  v_entry := erp_gl.post_entry(DATE '2026-01-10', 'رأس مال', 'T1',
    erp_line_tab(erp_line_t('1200', 1000, 0, NULL), erp_line_t('3100', 0, 1000, NULL)));
  check_true('قيد متوازن يُرحَّل', v_entry IS NOT NULL);

  -- رفض القيود الخاطئة (كل محاولة تتراجع إلى نقطة حفظها)
  BEGIN v_tmp := erp_gl.post_entry(DATE '2026-01-10', 'x', NULL, erp_line_tab(erp_line_t('1100', 100, 0, NULL), erp_line_t('3100', 0, 90, NULL)));
    check_true('رفض قيد غير متوازن (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض قيد غير متوازن [' || SQLCODE || ']', SQLCODE = -20107); END;
  BEGIN v_tmp := erp_gl.post_entry(DATE '2026-01-10', 'x', NULL, erp_line_tab(erp_line_t('1000', 100, 0, NULL), erp_line_t('3100', 0, 100, NULL)));
    check_true('رفض حساب تجميعي (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض حساب تجميعي [' || SQLCODE || ']', SQLCODE = -20106); END;
  BEGIN v_tmp := erp_gl.post_entry(DATE '2026-01-10', 'x', NULL, erp_line_tab(erp_line_t('1100', 100, 5, NULL), erp_line_t('3100', 0, 95, NULL)));
    check_true('رفض سطر مدين ودائن معاً (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض سطر مدين ودائن معاً [' || SQLCODE || ']', SQLCODE = -20103); END;
  BEGIN v_tmp := erp_gl.post_entry(DATE '2026-01-10', 'x', NULL, erp_line_tab(erp_line_t('1100', 0.001, 0, NULL), erp_line_t('3100', 0, 0.001, NULL)));
    check_true('رفض أكثر من منزلتين (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض أكثر من منزلتين [' || SQLCODE || ']', SQLCODE = -20104); END;

  -- المشتقات الكسرية دقيقة: 0.1 + 0.2 = 0.3
  v_tmp := erp_gl.post_entry(DATE '2026-01-11', 'كسور', NULL,
    erp_line_tab(erp_line_t('1100', 0.1, 0, NULL), erp_line_t('1200', 0.2, 0, NULL), erp_line_t('3100', 0, 0.3, NULL)));
  check_true('قيد بكسور عشرية متوازن', v_tmp IS NOT NULL);

  -- الفواتير
  v_cust := erp_trade.add_party('CUSTOMER', 'شركة النور', '0500000000', '300000000000003');
  v_sup  := erp_trade.add_party('SUPPLIER', 'مورد البضاعة');
  v_si := erp_trade.create_invoice('SALES', v_cust, DATE '2026-03-01', NULL, NULL, NULL,
            erp_inv_line_tab(erp_inv_line_t('خدمة', 2, 100, 15, NULL)));
  SELECT * INTO v_inv FROM erp_invoices WHERE invoice_id = v_si;
  check_true('رقم فاتورة المبيعات تسلسلي', v_inv.invoice_no = 'S-000001');
  check_true('إجمالي الفاتورة 230 = 200 + 30 ضريبة', v_inv.subtotal = 200 AND v_inv.vat_amount = 30 AND v_inv.total = 230);

  v_pi := erp_trade.create_invoice('PURCHASE', v_sup, DATE '2026-03-02', NULL, NULL, NULL,
            erp_inv_line_tab(erp_inv_line_t('بضاعة', 10, 12.5, 15, NULL)));
  SELECT * INTO v_inv FROM erp_invoices WHERE invoice_id = v_pi;
  check_true('إجمالي فاتورة المشتريات 143.75', v_inv.total = 143.75);

  BEGIN v_tmp := erp_trade.create_invoice('SALES', v_sup, DATE '2026-03-01', NULL, NULL, NULL, erp_inv_line_tab(erp_inv_line_t('x', 1, 1, 0, NULL)));
    check_true('رفض مبيعات لمورد (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض مبيعات لمورد [' || SQLCODE || ']', SQLCODE = -20202); END;

  -- أثر القيود
  check_true('ح/1300 مدين 230', bal('1300', 'D') = 230);
  check_true('ح/4100 دائن 200', bal('4100', 'C') = 200);
  check_true('ح/2100 دائن 143.75', bal('2100', 'C') = 143.75);
  check_true('ح/2200 صافي 30 - 18.75 = 11.25 دائن', bal('2200', 'C') = 11.25);

  -- المدفوعات
  BEGIN v_tmp := erp_trade.pay(v_cust, v_si, DATE '2026-03-05', 300, 'BANK');
    check_true('رفض دفعة أكبر من المتبقي (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض دفعة أكبر من المتبقي [' || SQLCODE || ']', SQLCODE = -20207); END;
  v_tmp := erp_trade.pay(v_cust, v_si, DATE '2026-03-05', 100, 'BANK');
  check_true('رصيد العميل بعد الدفعة 130', erp_trade.party_balance(v_cust) = 130);
  BEGIN erp_trade.void_invoice(v_si);
    check_true('رفض إلغاء فاتورة عليها مدفوعات (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض إلغاء فاتورة عليها مدفوعات [' || SQLCODE || ']', SQLCODE = -20209); END;
  v_tmp := erp_trade.pay(v_sup, v_pi, DATE '2026-03-06', 43.75, 'CASH');
  check_true('رصيد المورد بعد الدفعة 100', erp_trade.party_balance(v_sup) = 100);

  -- إلغاء بقيد عكسي
  v_tmp := erp_trade.create_invoice('SALES', v_cust, DATE '2026-03-07', NULL, NULL, NULL,
             erp_inv_line_tab(erp_inv_line_t('خدمة', 1, 50, 0, NULL)));
  erp_trade.void_invoice(v_tmp);
  SELECT status INTO v_inv.status FROM erp_invoices WHERE invoice_id = v_tmp;
  check_true('الفاتورة الملغاة VOID', v_inv.status = 'VOID');
  check_true('رصيد العميل لا يتأثر بالملغاة', erp_trade.party_balance(v_cust) = 130);

  -- العكس المزدوج وعكس العكسي
  v_tmp := erp_gl.reverse_entry(v_entry);
  BEGIN v_tmp := erp_gl.reverse_entry(v_entry);
    check_true('رفض العكس المزدوج (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض العكس المزدوج [' || SQLCODE || ']', SQLCODE = -20112); END;
  BEGIN v_tmp := erp_gl.reverse_entry(v_tmp);
    check_true('رفض عكس القيد العكسي (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض عكس القيد العكسي [' || SQLCODE || ']', SQLCODE = -20111); END;

  -- عدم التعديل والحذف
  BEGIN DELETE FROM erp_lines WHERE entry_id = v_entry;
    check_true('منع حذف سطور القيود (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('منع حذف سطور القيود [' || SQLCODE || ']', SQLCODE = -20900); END;

  -- التوازن الكلي
  SELECT COUNT(*) INTO v_tmp FROM v_erp_unbalanced_entries;
  check_true('لا توجد قيود غير متوازنة', v_tmp = 0);
  SELECT SUM(total_debit) - SUM(total_credit) INTO v_tmp FROM v_erp_trial_balance;
  check_true('ميزان المراجعة متوازن', v_tmp = 0);

  DBMS_OUTPUT.PUT_LINE('---- نجح ' || v_ok || ' · فشل ' || v_fail);
  ROLLBACK;
END;
/
