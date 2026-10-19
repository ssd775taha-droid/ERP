-- ============================================================================
-- 10: اختبار ذاتي لحزم PL/SQL. يتراجع عن كل شيء في النهاية (ROLLBACK) فلا يترك بيانات.
-- شغّله بعد 01-05:  SET SERVEROUTPUT ON  ثم  @10_selftest.sql
-- ============================================================================
SET SERVEROUTPUT ON
SET DEFINE OFF
DECLARE
  v_ok    PLS_INTEGER := 0;
  v_fail  PLS_INTEGER := 0;
  v_cust  NUMBER; v_sup NUMBER; v_si NUMBER; v_pi NUMBER; v_entry NUMBER; v_tmp NUMBER;
  v_inv   erp_invoices%ROWTYPE;
  v_st VARCHAR2(20);
  v_hd NUMBER; v_e1 NUMBER; v_e2 NUMBER; v_e3 NUMBER; v_e4 NUMBER; v_cal NUMBER; v_ctr NUMBER; v_csi NUMBER; v_cse NUMBER;
  v_hadv NUMBER; v_ra NUMBER; v_rb NUMBER; v_rc NUMBER; v_rd NUMBER; v_re NUMBER; v_n1 NUMBER; v_n2 NUMBER; v_n3 NUMBER;
  v_cat NUMBER; v_fa NUMBER; v_fb NUMBER; v_fc NUMBER; v_fd NUMBER; v_fe NUMBER; v_ff NUMBER; v_finv NUMBER;
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

  FUNCTION line_val (p_run NUMBER, p_emp NUMBER, p_col VARCHAR2) RETURN NUMBER IS v NUMBER;
  BEGIN
    SELECT CASE p_col WHEN 'NET' THEN net WHEN 'GROSS' THEN gross WHEN 'ADV' THEN advance_deduction WHEN 'DED' THEN deductions
                      WHEN 'EMP' THEN employer_cost ELSE basic END INTO v
      FROM erp_payroll_lines WHERE run_id = p_run AND emp_id = p_emp;
    RETURN v;
  END;
  FUNCTION run_val (p_run NUMBER, p_col VARCHAR2) RETURN NUMBER IS v NUMBER;
  BEGIN
    SELECT CASE p_col WHEN 'NET' THEN total_net WHEN 'GROSS' THEN total_gross WHEN 'DED' THEN total_deductions ELSE total_employer END INTO v
      FROM erp_payroll_runs WHERE run_id = p_run;
    RETURN v;
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


  -- ================= الأصول الثابتة والإهلاك =================
  v_cat := erp_asset.add_category('T1', 'فئة اختبار', 12);
  v_fa  := erp_asset.acquire('A1', 'آلة أ', v_cat, DATE '2026-01-15', 1200, 0, 12, NULL, '1200');
  check_true('اقتناء أصل: ح/1500 مدين 1200', bal('1500', 'D') = 1200);

  v_tmp := erp_asset.run_depreciation(DATE '2026-03-31');
  check_true('إهلاك يناير-مارس 300 (100 شهرياً)', v_tmp = 300 AND erp_asset.accumulated(v_fa) = 300 AND erp_asset.book_value(v_fa) = 900);
  check_true('ح/5600 مدين 300 وح/1510 دائن 300', bal('5600', 'D') = 300 AND bal('1510', 'C') = 300);
  check_true('إعادة التشغيل لا تهلك مرتين', erp_asset.run_depreciation(DATE '2026-03-31') = 0);

  BEGIN erp_asset.reverse_depreciation(DATE '2026-02-01');
    check_true('رفض عكس شهر وبعده إهلاك (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض عكس شهر وبعده إهلاك [' || SQLCODE || ']', SQLCODE = -20409); END;
  erp_asset.reverse_depreciation(DATE '2026-03-15');
  check_true('عكس إهلاك مارس: المتراكم 200', erp_asset.accumulated(v_fa) = 200);
  check_true('إعادة إهلاك مارس بعد العكس: 100', erp_asset.run_depreciation(DATE '2026-03-31') = 100 AND erp_asset.accumulated(v_fa) = 300);

  -- أصل بعمر 3 أشهر يبدأ فبراير: التعويض بالترتيب، والشهر الأخير يأخذ فرق التقريب
  v_fb := erp_asset.acquire('B1', 'آلة ب', v_cat, DATE '2026-02-10', 1000, 0, 3, NULL, '1200');
  v_tmp := erp_asset.run_depreciation(DATE '2026-04-30');
  check_true('تعويض الأشهر الفائتة: 100 لـ أ في أبريل + 1000 لـ ب', v_tmp = 1100);
  check_true('أصل ب مهلك بالكامل بلا فرق تقريب (333.33 + 333.33 + 333.34)', erp_asset.accumulated(v_fb) = 1000 AND erp_asset.book_value(v_fb) = 0);
  check_true('ح/1510 دائن 1400', bal('1510', 'C') = 1400);
  check_true('لا يهلك أصل مهلك بالكامل: مايو 100 فقط', erp_asset.run_depreciation(DATE '2026-05-31') = 100);

  -- إهلاك معلّق يمنع البيع
  v_fc := erp_asset.acquire('C1', 'آلة ج', v_cat, DATE '2026-01-05', 600, 0, 6, NULL, '1200');
  BEGIN v_tmp := erp_asset.dispose(v_fc, DATE '2026-06-10', 100, '1100');
    check_true('رفض بيع أصل عليه إهلاك معلّق (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض بيع أصل عليه إهلاك معلّق [' || SQLCODE || ']', SQLCODE = -20404); END;

  -- بيع بربح: التكلفة 1200، المتراكم 500، الدفترية 700، الثمن 800 → ربح 100
  v_tmp := erp_asset.dispose(v_fa, DATE '2026-06-10', 800, '1100');
  check_true('بيع أ بربح 100 (ح/4300)', v_tmp IS NOT NULL AND bal('4300', 'C') = 100);
  check_true('بعد البيع: ح/1510 دائن 1000 وح/1500 مدين 1600', bal('1510', 'C') = 1000 AND bal('1500', 'D') = 1600);
  BEGIN v_tmp := erp_asset.dispose(v_fa, DATE '2026-06-11', 0);
    check_true('رفض بيع أصل مباع (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض بيع أصل مباع [' || SQLCODE || ']', SQLCODE = -20406); END;

  -- بيع بخسارة
  v_fd := erp_asset.acquire('D1', 'آلة د', v_cat, DATE '2026-06-01', 1000, 0, 10, NULL, '1200');
  v_tmp := erp_asset.dispose(v_fd, DATE '2026-06-20', 0);
  check_true('بيع د بلا ثمن: خسارة 1000 (ح/5700)', bal('5700', 'D') = 1000);

  -- عكس الإهلاك بعد بيع أصل اعتمد عليه
  BEGIN erp_asset.reverse_depreciation(DATE '2026-05-01');
    check_true('رفض عكس إهلاك بعد بيع اعتمد عليه (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض عكس إهلاك بعد بيع اعتمد عليه [' || SQLCODE || ']', SQLCODE = -20409); END;

  -- إلغاء تسجيل الأصل
  v_fe := erp_asset.acquire('E1', 'آلة هـ', v_cat, DATE '2026-06-02', 500, 0, 12, NULL, '1200');
  erp_asset.void_asset(v_fe);
  SELECT status INTO v_inv.status FROM erp_assets WHERE asset_id = v_fe;
  check_true('إلغاء أصل بلا إهلاك: الحالة VOID', v_inv.status = 'VOID');
  BEGIN erp_asset.void_asset(v_fb);
    check_true('رفض إلغاء أصل عليه إهلاك (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض إلغاء أصل عليه إهلاك [' || SQLCODE || ']', SQLCODE = -20406); END;

  -- اقتناء عبر فاتورة مشتريات: لا قيد ثانٍ، والفاتورة محمية
  v_finv := erp_trade.create_invoice('PURCHASE', v_sup, DATE '2026-06-03', NULL, NULL, NULL,
              erp_inv_line_tab(erp_inv_line_t('جهاز', 1, 2000, 0, '1500', NULL, NULL)));
  v_ff := erp_asset.acquire('F1', 'جهاز', v_cat, DATE '2026-06-03', 2000, 0, 12, NULL, NULL, v_finv);
  SELECT COUNT(*) INTO v_tmp FROM erp_assets WHERE asset_id = v_ff AND entry_id IS NULL AND invoice_id = v_finv;
  check_true('أصل من فاتورة: بلا قيد اقتناء ثانٍ ومربوط بالفاتورة', v_tmp = 1);
  BEGIN erp_trade.void_invoice(v_finv);
    check_true('رفض إلغاء فاتورة مربوطة بأصل (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض إلغاء فاتورة مربوطة بأصل [' || SQLCODE || ']', SQLCODE = -20215); END;
  erp_asset.void_asset(v_ff);
  erp_trade.void_invoice(v_finv);
  SELECT status INTO v_inv.status FROM erp_invoices WHERE invoice_id = v_finv;
  check_true('بعد إلغاء تسجيل الأصل تُلغى الفاتورة', v_inv.status = 'VOID');

  SELECT NVL(SUM(difference), 0) INTO v_tmp FROM v_erp_asset_vs_gl;
  check_true('سجل الأصول يطابق الأستاذ (التكلفة والمجمع)', v_tmp = 0);


  -- ================= الموارد البشرية والرواتب =================
  v_hd := erp_hr.add_department('D1', 'الإدارة');
  v_e1 := erp_hr.add_employee('E1', 'موظف أ', DATE '2025-01-10', 3000, v_hd);
  v_e2 := erp_hr.add_employee('E2', 'موظف ب', DATE '2026-03-16', 3100);
  v_e3 := erp_hr.add_employee('E3', 'موظف ج', DATE '2025-01-01', 2000);
  v_cal := erp_hr.add_component('ALLW', 'بدل سكن',            'EARNING',   'FIXED');
  v_ctr := erp_hr.add_component('TRN',  'بدل نقل',            'EARNING',   'PCT', 10);
  v_csi := erp_hr.add_component('SIN',  'تأمينات الموظف',     'DEDUCTION', 'PCT', 9,  'GROSS', 4000);
  v_cse := erp_hr.add_component('SIE',  'تأمينات صاحب العمل', 'EMPLOYER',  'PCT', 12, 'GROSS', 4000);
  FOR emp IN (SELECT v_e1 AS id FROM dual UNION ALL SELECT v_e2 FROM dual) LOOP
    erp_hr.assign_component(emp.id, v_cal, 500);
    erp_hr.assign_component(emp.id, v_ctr);
    erp_hr.assign_component(emp.id, v_csi);
    erp_hr.assign_component(emp.id, v_cse);
  END LOOP;
  erp_hr.terminate(v_e3, DATE '2026-03-10');

  BEGIN erp_hr.assign_component(v_e3, v_cal);
    check_true('رفض مكوّن ثابت بلا مبلغ (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض مكوّن ثابت بلا مبلغ [' || SQLCODE || ']', SQLCODE = -20503); END;
  BEGIN erp_hr.terminate(v_e3, DATE '2026-03-11');
    check_true('رفض إنهاء خدمة موظف منتهٍ (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض إنهاء خدمة موظف منتهٍ [' || SQLCODE || ']', SQLCODE = -20505); END;

  v_hadv := erp_hr.grant_advance(v_e1, DATE '2026-02-20', 1000, 3, DATE '2026-03-01', 'CASH');
  check_true('سلفة 1000: ح/1350 مدين 1000', bal('1350', 'D') = 1000);
  v_tmp := erp_hr.add_adjustment(v_e1, DATE '2026-03-01', 'EARNING', 'مكافأة', 200);
  v_tmp := erp_hr.add_adjustment(v_e2, DATE '2026-03-01', 'DEDUCTION', 'جزاء', 50, '5200');

  -- كشف مارس
  v_ra := erp_payroll.create_run(DATE '2026-03-01');
  v_n1 := line_val(v_ra, v_e1, 'NET'); v_n2 := line_val(v_ra, v_e2, 'NET'); v_n3 := line_val(v_ra, v_e3, 'NET');
  check_true('صافي أ = 3000 + 800 + 200 − 342 − 333.33 = 3324.67', v_n1 = 3324.67);
  check_true('صافي ب (16 يوماً من 31) = 1600 + 418.06 − 181.63 − 50 = 1786.43', v_n2 = 1786.43 AND line_val(v_ra, v_e2, 'BASIC') = 1600);
  check_true('صافي ج (10 أيام قبل إنهاء الخدمة) = 645.16', v_n3 = 645.16);
  check_true('إجماليات الكشف: إجمالي 6663.22 · استقطاعات 906.96 · صافي 5756.26 · صاحب العمل 698.17',
    run_val(v_ra, 'GROSS') = 6663.22 AND run_val(v_ra, 'DED') = 906.96 AND run_val(v_ra, 'NET') = 5756.26 AND run_val(v_ra, 'EMP') = 698.17);
  check_true('سقف الوعاء: أ تأمين الموظف 342 وحصة صاحب العمل 456', line_val(v_ra, v_e1, 'EMP') = 456);
  BEGIN v_tmp := erp_payroll.create_run(DATE '2026-03-15');
    check_true('رفض كشف ثانٍ لنفس الشهر (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض كشف ثانٍ لنفس الشهر [' || SQLCODE || ']', SQLCODE = -20601); END;
  erp_payroll.calculate_run(v_ra);
  check_true('إعادة حساب المسودة تعطي النتيجة نفسها', run_val(v_ra, 'NET') = 5756.26);

  v_tmp := erp_payroll.post_run(v_ra);
  check_true('قيد الكشف: ح/5200 مدين 6613.22 وح/5210 مدين 698.17', bal('5200', 'D') = 6613.22 AND bal('5210', 'D') = 698.17);
  check_true('ح/2400 دائن 1221.80 (تأمينات 523.63 + حصة 698.17)', bal('2400', 'C') = 1221.80);
  check_true('ح/2300 دائن 5756.26 وح/1350 مدين 666.67', bal('2300', 'C') = 5756.26 AND bal('1350', 'D') = 666.67);
  SELECT repaid, installments_done, status INTO v_n1, v_n2, v_st FROM erp_advances WHERE adv_id = v_hadv;
  check_true('بعد الترحيل: سُدّد 333.33 من السلفة (قسط 1) وهي مفتوحة', v_n1 = 333.33 AND v_n2 = 1 AND v_st = 'OPEN');
  BEGIN erp_payroll.calculate_run(v_ra);
    check_true('رفض إعادة حساب كشف مرحَّل (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض إعادة حساب كشف مرحَّل [' || SQLCODE || ']', SQLCODE = -20603); END;
  BEGIN DELETE FROM erp_payroll_items;
    check_true('منع حذف بنود كشف مرحَّل (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('منع حذف بنود كشف مرحَّل [' || SQLCODE || ']', SQLCODE = -20910); END;

  -- الصرف والتراجع عنه
  v_tmp := erp_payroll.pay_run(v_ra, DATE '2026-03-31', 'BANK');
  check_true('بعد الصرف ح/2300 صفر', bal('2300', 'C') = 0);
  BEGIN erp_payroll.void_run(v_ra);
    check_true('رفض إلغاء كشف مصروف (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض إلغاء كشف مصروف [' || SQLCODE || ']', SQLCODE = -20603); END;
  erp_payroll.unpay_run(v_ra);
  check_true('إلغاء الصرف يعيد ح/2300 دائناً 5756.26', bal('2300', 'C') = 5756.26);
  v_tmp := erp_payroll.pay_run(v_ra, DATE '2026-03-31', 'BANK');

  -- الراتب بأثر رجعي مرفوض، وبأثر مستقبلي يسري من الشهر
  BEGIN erp_hr.set_salary(v_e1, 3500, DATE '2026-03-01');
    check_true('رفض تعديل راتب بأثر رجعي على شهر مرحَّل (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض تعديل راتب بأثر رجعي على شهر مرحَّل [' || SQLCODE || ']', SQLCODE = -20505); END;
  erp_hr.set_salary(v_e2, 3500, DATE '2026-04-01');

  -- كشف أبريل: أ قسط سلفة 2، ب راتب جديد وسقف الوعاء
  v_rb := erp_payroll.create_run(DATE '2026-04-01');
  check_true('أبريل: صافي أ = 3800 − 342 − 333.33 = 3124.67', line_val(v_rb, v_e1, 'NET') = 3124.67);
  check_true('أبريل: ب = 3500 + 850 − 360 (سقف 4000 على وعاء 4350) = 3990.00 وحصة صاحب العمل 480',
    line_val(v_rb, v_e2, 'NET') = 3990 AND line_val(v_rb, v_e2, 'EMP') = 480);
  SELECT COUNT(*) INTO v_tmp FROM erp_payroll_lines WHERE run_id = v_rb;
  check_true('ج منتهي الخدمة لا يظهر في أبريل (موظفان فقط)', v_tmp = 2);
  v_tmp := erp_payroll.post_run(v_rb);

  -- إلغاء كشف مرحَّل يعيد السلفة، ثم يُنشأ من جديد
  erp_payroll.void_run(v_rb);
  SELECT repaid, installments_done INTO v_n1, v_n2 FROM erp_advances WHERE adv_id = v_hadv;
  check_true('إلغاء أبريل يعيد قسط السلفة: المسدد 333.33 (قسط 1)', v_n1 = 333.33 AND v_n2 = 1);
  v_rc := erp_payroll.create_run(DATE '2026-04-01');
  check_true('إعادة إنشاء أبريل بعد الإلغاء', line_val(v_rc, v_e1, 'NET') = 3124.67);
  v_tmp := erp_payroll.post_run(v_rc);

  -- القسط الأخير يأخذ المتبقي بالضبط (333.34)
  v_rd := erp_payroll.create_run(DATE '2026-05-01');
  check_true('مايو: القسط الأخير 333.34 (1000 − 666.66)', line_val(v_rd, v_e1, 'ADV') = 333.34);
  v_tmp := erp_payroll.post_run(v_rd);
  SELECT repaid, status INTO v_n1, v_st FROM erp_advances WHERE adv_id = v_hadv;
  check_true('السلفة سُوّيت بالكامل: 1000 وحالة SETTLED', v_n1 = 1000 AND v_st = 'SETTLED');
  erp_payroll.void_run(v_rd);
  SELECT repaid, status INTO v_n1, v_st FROM erp_advances WHERE adv_id = v_hadv;
  check_true('إلغاء مايو يعيد السلفة مفتوحة: 666.66', v_n1 = 666.66 AND v_st = 'OPEN');
  BEGIN erp_hr.void_advance(v_hadv);
    check_true('رفض إلغاء سلفة اقتُطع منها (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض إلغاء سلفة اقتُطع منها [' || SQLCODE || ']', SQLCODE = -20505); END;

  -- إلغاء مسودة
  v_re := erp_payroll.create_run(DATE '2026-05-01');
  erp_payroll.cancel_run(v_re);
  SELECT status INTO v_st FROM erp_payroll_runs WHERE run_id = v_re;
  check_true('إلغاء مسودة: CANCELLED', v_st = 'CANCELLED');

  -- صافٍ سالب يوقف الكشف ولا يترك أثراً
  v_e4 := erp_hr.add_employee('E4', 'موظف د', DATE '2026-06-01', 1000);
  v_tmp := erp_hr.grant_advance(v_e4, DATE '2026-06-01', 1500, 1, DATE '2026-06-01', 'CASH');
  SELECT COUNT(*) INTO v_n1 FROM erp_payroll_runs;
  BEGIN v_tmp := erp_payroll.create_run(DATE '2026-06-01');
    check_true('رفض كشف بصافي سالب (لم يُرفع خطأ)', FALSE);
  EXCEPTION WHEN OTHERS THEN check_true('رفض كشف بصافي سالب [' || SQLCODE || ']', SQLCODE = -20605); END;
  SELECT COUNT(*) INTO v_n2 FROM erp_payroll_runs;
  check_true('فشل الكشف لم يترك كشفاً يتيماً', v_n1 = v_n2);

  -- تعديل تسوية معلّقة
  v_tmp := erp_hr.add_adjustment(v_e1, DATE '2026-07-01', 'EARNING', 'عمل إضافي', 100);
  erp_hr.void_adjustment(v_tmp);
  SELECT status INTO v_st FROM erp_pay_adjustments WHERE adj_id = v_tmp;
  check_true('إلغاء تسوية معلّقة: VOID', v_st = 'VOID');

  SELECT difference INTO v_tmp FROM v_erp_payroll_vs_gl;
  check_true('صافي الكشوف المرحَّلة غير المصروفة يطابق ح/2300', v_tmp = 0);

  -- التوازن الكلي
  SELECT COUNT(*) INTO v_tmp FROM v_erp_unbalanced_entries;
  check_true('لا توجد قيود غير متوازنة', v_tmp = 0);
  SELECT SUM(total_debit) - SUM(total_credit) INTO v_tmp FROM v_erp_trial_balance;
  check_true('ميزان المراجعة متوازن', v_tmp = 0);

  DBMS_OUTPUT.PUT_LINE('---- نجح ' || v_ok || ' · فشل ' || v_fail);
  ROLLBACK;
END;
/
