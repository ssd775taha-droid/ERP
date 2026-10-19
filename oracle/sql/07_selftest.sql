-- ============================================================================
-- 07: اختبار ذاتي لحزم PL/SQL. يتراجع عن كل شيء في النهاية (ROLLBACK) فلا يترك بيانات.
-- شغّله بعد 01-05:  SET SERVEROUTPUT ON  ثم  @07_selftest.sql
-- ============================================================================
SET SERVEROUTPUT ON
SET DEFINE OFF
DECLARE
  v_ok    PLS_INTEGER := 0;
  v_fail  PLS_INTEGER := 0;
  v_cust  NUMBER; v_sup NUMBER; v_si NUMBER; v_pi NUMBER; v_entry NUMBER; v_tmp NUMBER;
  v_inv   erp_invoices%ROWTYPE;
  v_wh NUMBER; v_wh2 NUMBER; v_i1 NUMBER; v_i2 NUMBER; v_p1 NUMBER; v_p2 NUMBER; v_s1 NUMBER; v_cogs NUMBER;

  PROCEDURE check_true (p_name VARCHAR2, p_cond BOOLEAN) IS
  BEGIN
    IF p_cond THEN v_ok := v_ok + 1; DBMS_OUTPUT.PUT_LINE('PASS  ' || p_name);
    ELSE v_fail := v_fail + 1; DBMS_OUTPUT.PUT_LINE('FAIL  ' || p_name); END IF;
  END;

  FUNCTION stk_qty (p_item NUMBER, p_wh NUMBER) RETURN NUMBER IS v NUMBER;
  BEGIN SELECT NVL(MAX(qty), 0) INTO v FROM erp_stock WHERE item_id = p_item AND wh_id = p_wh; RETURN v; END;
  FUNCTION stk_val (p_item NUMBER, p_wh NUMBER) RETURN NUMBER IS v NUMBER;
  BEGIN SELECT NVL(MAX(value), 0) INTO v FROM erp_stock WHERE item_id = p_item AND wh_id = p_wh; RETURN v; END;

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
            erp_inv_line_tab(erp_inv_line_t('خدمة', 2, 100, 15, NULL, NULL, NULL)));
  SELECT * INTO v_inv FROM erp_invoices WHERE invoice_id = v_si;
  check_true('رقم فاتورة المبيعات تسلسلي', v_inv.invoice_no = 'S-000001');
  check_true('إجمالي الفاتورة 230 = 200 + 30 ضريبة', v_inv.subtotal = 200 AND v_inv.vat_amount = 30 AND v_inv.total = 230);

  v_pi := erp_trade.create_invoice('PURCHASE', v_sup, DATE '2026-03-02', NULL, NULL, NULL,
            erp_inv_line_tab(erp_inv_line_t('بضاعة', 10, 12.5, 15, NULL, NULL, NULL)));
  SELECT * INTO v_inv FROM erp_invoices WHERE invoice_id = v_pi;
  check_true('إجمالي فاتورة المشتريات 143.75', v_inv.total = 143.75);

  BEGIN v_tmp := erp_trade.create_invoice('SALES', v_sup, DATE '2026-03-01', NULL, NULL, NULL, erp_inv_line_tab(erp_inv_line_t('x', 1, 1, 0, NULL, NULL, NULL)));
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
             erp_inv_line_tab(erp_inv_line_t('خدمة', 1, 50, 0, NULL, NULL, NULL)));
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


  -- ================= المخازن والأصناف =================
  SELECT wh_id INTO v_wh FROM erp_warehouses WHERE code = 'MAIN';
  v_wh2 := erp_stock.add_warehouse('W2', 'مخزن فرعي');
  v_i1  := erp_stock.add_item('I1', 'صنف تجريبي', 'قطعة', 30);
  v_i2  := erp_stock.add_item('I2', 'صنف ثانٍ');

  v_p1 := erp_trade.create_invoice('PURCHASE', v_sup, DATE '2026-04-01', NULL, NULL, NULL,
            erp_inv_line_tab(erp_inv_line_t('صنف', 10, 12.5, 15, NULL, v_i1, v_wh)));
  check_true('مشتريات مخزنية: الكمية 10 والقيمة 125 (دون الضريبة)', stk_qty(v_i1, v_wh) = 10 AND stk_val(v_i1, v_wh) = 125);
  check_true('ح/1400 مدين 125', bal('1400', 'D') = 125);
  v_p2 := erp_trade.create_invoice('PURCHASE', v_sup, DATE '2026-04-02', NULL, NULL, NULL,
            erp_inv_line_tab(erp_inv_line_t('صنف', 10, 20, 15, NULL, v_i1, v_wh)));
  check_true('المتوسط المرجّح: 20 بقيمة 325 (16.25)', stk_qty(v_i1, v_wh) = 20 AND stk_val(v_i1, v_wh) = 325 AND erp_stock.avg_cost(v_i1, v_wh) = 16.25);

  v_s1 := erp_trade.create_invoice('SALES', v_cust, DATE '2026-04-03', NULL, NULL, NULL,
            erp_inv_line_tab(erp_inv_line_t('صنف', 5, 30, 15, NULL, v_i1, v_wh)));
  SELECT cogs_entry_id INTO v_cogs FROM erp_invoices WHERE invoice_id = v_s1;
  check_true('البيع يُخرج بتكلفة المتوسط: 15 بقيمة 243.75', stk_qty(v_i1, v_wh) = 15 AND stk_val(v_i1, v_wh) = 243.75);
  check_true('قيد تكلفة المبيعات 81.25 (ح/5100)', v_cogs IS NOT NULL AND bal('5100', 'D') = 81.25);
  check_true('ح/1400 = 243.75 بعد البيع', bal('1400', 'D') = 243.75);

  BEGIN v_tmp := erp_trade.create_invoice('SALES', v_cust, DATE '2026-04-03', NULL, NULL, NULL,
                   erp_inv_line_tab(erp_inv_line_t('صنف', 100, 30, 15, NULL, v_i1, v_wh)));
    check_true('رفض بيع أكثر من الرصيد (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض بيع أكثر من الرصيد [' || SQLCODE || ']', SQLCODE = -20302); END;
  check_true('فشل البيع لم يترك أثراً على المخزون', stk_qty(v_i1, v_wh) = 15);
  BEGIN v_tmp := erp_trade.create_invoice('SALES', v_cust, DATE '2026-04-03', NULL, NULL, NULL,
                   erp_inv_line_tab(erp_inv_line_t('صنف', 1, 30, 15, NULL, v_i1, NULL)));
    check_true('رفض صنف مخزني بلا مخزن (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض صنف مخزني بلا مخزن [' || SQLCODE || ']', SQLCODE = -20214); END;

  erp_trade.void_invoice(v_s1);
  check_true('إلغاء البيع يعيد المخزون: 20 بقيمة 325', stk_qty(v_i1, v_wh) = 20 AND stk_val(v_i1, v_wh) = 325);
  check_true('إلغاء البيع يعكس التكلفة: ح/5100 صفر وح/1400 = 325', bal('5100', 'D') = 0 AND bal('1400', 'D') = 325);
  BEGIN erp_trade.void_invoice(v_p1);
    check_true('رفض إلغاء مشتريات بعد حركات لاحقة (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض إلغاء مشتريات بعد حركات لاحقة [' || SQLCODE || ']', SQLCODE = -20213); END;

  v_tmp := erp_trade.create_invoice('PURCHASE', v_sup, DATE '2026-04-04', NULL, NULL, NULL,
             erp_inv_line_tab(erp_inv_line_t('ثانٍ', 4, 10, 0, NULL, v_i2, v_wh)));
  erp_trade.void_invoice(v_tmp);
  check_true('إلغاء مشتريات بلا حركات لاحقة يصفّر المخزون', stk_qty(v_i2, v_wh) = 0 AND stk_val(v_i2, v_wh) = 0);

  -- التسويات
  v_tmp := erp_stock.adjust(v_i1, v_wh, DATE '2026-04-05', 3, 10);
  check_true('تسوية زيادة 3 بتكلفة 10: 23 بقيمة 355', stk_qty(v_i1, v_wh) = 23 AND stk_val(v_i1, v_wh) = 355 AND v_tmp IS NOT NULL);
  v_tmp := erp_stock.adjust(v_i1, v_wh, DATE '2026-04-05', -2);
  check_true('تسوية نقص 2 بالمتوسط: 21 بقيمة 324.13', stk_qty(v_i1, v_wh) = 21 AND stk_val(v_i1, v_wh) = 324.13);
  BEGIN v_tmp := erp_stock.adjust(v_i2, v_wh, DATE '2026-04-05', 5);
    check_true('رفض زيادة بلا تكلفة ولا متوسط (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض زيادة بلا تكلفة ولا متوسط [' || SQLCODE || ']', SQLCODE = -20303); END;

  -- التحويل بين المخازن
  v_tmp := erp_stock.transfer(v_i1, v_wh, v_wh2, DATE '2026-04-06', 6);
  check_true('تحويل 6 بتكلفة 92.61', v_tmp = 92.61);
  check_true('المصدر 15 بقيمة 231.52 والوجهة 6 بقيمة 92.61',
    stk_qty(v_i1, v_wh) = 15 AND stk_val(v_i1, v_wh) = 231.52 AND stk_qty(v_i1, v_wh2) = 6 AND stk_val(v_i1, v_wh2) = 92.61);
  BEGIN v_tmp := erp_stock.transfer(v_i1, v_wh, v_wh, DATE '2026-04-06', 1);
    check_true('رفض التحويل لنفس المخزن (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض التحويل لنفس المخزن [' || SQLCODE || ']', SQLCODE = -20304); END;
  BEGIN v_tmp := erp_stock.transfer(v_i1, v_wh, v_wh2, DATE '2026-04-06', 100);
    check_true('رفض تحويل أكثر من الرصيد (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض تحويل أكثر من الرصيد [' || SQLCODE || ']', SQLCODE = -20302); END;

  -- التطابق مع الأستاذ، وعدم تعديل الحركات
  SELECT NVL(SUM(difference), 0) INTO v_tmp FROM v_erp_stock_vs_gl;
  check_true('قيمة المخزون تطابق ح/1400 في الأستاذ', v_tmp = 0);
  BEGIN DELETE FROM erp_stock_moves;
    check_true('منع حذف حركات المخزون (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('منع حذف حركات المخزون [' || SQLCODE || ']', SQLCODE = -20901); END;

  -- التوازن الكلي
  SELECT COUNT(*) INTO v_tmp FROM v_erp_unbalanced_entries;
  check_true('لا توجد قيود غير متوازنة', v_tmp = 0);
  SELECT SUM(total_debit) - SUM(total_credit) INTO v_tmp FROM v_erp_trial_balance;
  check_true('ميزان المراجعة متوازن', v_tmp = 0);

  DBMS_OUTPUT.PUT_LINE('---- نجح ' || v_ok || ' · فشل ' || v_fail);
  ROLLBACK;
END;
/
