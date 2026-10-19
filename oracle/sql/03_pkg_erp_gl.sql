-- ============================================================================
-- 03: حزمة المحاسبة العامة ERP_GL
-- القاعدة: لا COMMIT ولا ROLLBACK كاملاً داخل الحزم؛ المتصل (Forms أو SQL*Plus) يتحكم بالمعاملة.
-- عند الخطأ تتراجع الحزمة إلى نقطة حفظ خاصة بها ثم تعيد رفع الخطأ، فلا يبقى شيء ناقص.
--
-- رموز الأخطاء:
--   -20101 تاريخ القيد مطلوب          -20105 حساب غير موجود أو موقوف
--   -20102 القيد يحتاج سطرين فأكثر    -20106 حساب تجميعي لا يقبل الترحيل
--   -20103 سطر غير صالح (مدين/دائن)   -20107 القيد غير متوازن
--   -20104 أكثر من منزلتين عشريتين    -20110 قيد غير موجود
--   -20111 لا يُعكس قيد عكسي          -20112 القيد معكوس مسبقاً
--   -20113 تاريخ القيد في فترة محاسبية مقفلة
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_gl AS
  -- ترحيل قيد متوازن. يعيد رقم القيد. (دالة تعدّل بيانات: تُستدعى من PL/SQL لا من SELECT)
  FUNCTION post_entry (
    p_date  IN DATE,
    p_memo  IN VARCHAR2,
    p_ref   IN VARCHAR2,
    p_lines IN erp_line_tab
  ) RETURN NUMBER;

  -- قيد عكسي مقابل لقيد قائم (بتاريخ القيد الأصلي ما لم يُعطَ تاريخ). يعيد رقم القيد العكسي.
  FUNCTION reverse_entry (
    p_entry_id IN NUMBER,
    p_date     IN DATE DEFAULT NULL
  ) RETURN NUMBER;

  -- مساران داخليان لإقفال السنة لا تستدعيهما إلا حزمة ERP_PERIOD (ACCESSIBLE BY): يسمحان بقيد في فترة مقفلة،
  -- ويحملان النوع CLOSING فيُستبعدان من قائمة الدخل. لا تُمنح لأحد غيرها.
  FUNCTION post_closing_entry (
    p_date  IN DATE,
    p_memo  IN VARCHAR2,
    p_ref   IN VARCHAR2,
    p_lines IN erp_line_tab
  ) RETURN NUMBER ACCESSIBLE BY (PACKAGE erp_period);

  FUNCTION reverse_closing_entry (p_entry_id IN NUMBER) RETURN NUMBER ACCESSIBLE BY (PACKAGE erp_period);
END erp_gl;
/

CREATE OR REPLACE PACKAGE BODY erp_gl AS

  -- يرفض التاريخ إن وقع في فترة مقفلة
  PROCEDURE assert_open (p_date IN DATE) IS
    v_n NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_n FROM erp_periods WHERE period = TRUNC(p_date, 'MM') AND status = 'CLOSED';
    IF v_n > 0 THEN
      RAISE_APPLICATION_ERROR(-20113, 'الفترة ' || TO_CHAR(p_date, 'YYYY-MM') || ' مقفلة: لا قيود بتاريخ فيها. استخدم تاريخاً في فترة مفتوحة أو أعد فتح الفترة');
    END IF;
  END assert_open;

  -- يتأكد أن الحساب موجود وفعّال وطرفي (لا أبناء له)
  PROCEDURE check_postable (p_code IN VARCHAR2) IS
    v_active erp_accounts.active%TYPE;
    v_kids   NUMBER;
  BEGIN
    BEGIN
      SELECT active INTO v_active FROM erp_accounts WHERE code = p_code;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20105, 'الحساب ' || p_code || ' غير موجود');
    END;
    IF v_active <> 'Y' THEN
      RAISE_APPLICATION_ERROR(-20105, 'الحساب ' || p_code || ' موقوف');
    END IF;
    SELECT COUNT(*) INTO v_kids FROM erp_accounts WHERE parent_code = p_code;
    IF v_kids > 0 THEN
      RAISE_APPLICATION_ERROR(-20106, 'الحساب ' || p_code || ' تجميعي ولا يقبل الترحيل');
    END IF;
  END check_postable;

  FUNCTION do_post (
    p_date  IN DATE,
    p_memo  IN VARCHAR2,
    p_ref   IN VARCHAR2,
    p_lines IN erp_line_tab,
    p_kind  IN VARCHAR2
  ) RETURN NUMBER IS
    v_id     erp_entries.entry_id%TYPE;
    v_debit  NUMBER;
    v_credit NUMBER;
    v_dr_sum NUMBER := 0;
    v_cr_sum NUMBER := 0;
  BEGIN
    SAVEPOINT erp_gl_post;

    IF p_date IS NULL THEN
      RAISE_APPLICATION_ERROR(-20101, 'تاريخ القيد مطلوب');
    END IF;
    IF p_kind = 'NORMAL' THEN
      assert_open(p_date);
    END IF;
    IF p_lines IS NULL OR p_lines.COUNT < 2 THEN
      RAISE_APPLICATION_ERROR(-20102, 'القيد يحتاج سطرين على الأقل');
    END IF;

    -- التحقق من كل الأسطر قبل أي إدراج
    FOR i IN 1 .. p_lines.COUNT LOOP
      v_debit  := NVL(p_lines(i).debit, 0);
      v_credit := NVL(p_lines(i).credit, 0);
      IF v_debit <> ROUND(v_debit, 2) OR v_credit <> ROUND(v_credit, 2) THEN
        RAISE_APPLICATION_ERROR(-20104, 'السطر ' || i || ': المبلغ بأكثر من منزلتين عشريتين');
      END IF;
      IF NOT ((v_debit > 0 AND v_credit = 0) OR (v_credit > 0 AND v_debit = 0)) THEN
        RAISE_APPLICATION_ERROR(-20103, 'السطر ' || i || ': يجب أن يكون إما مدين وإما دائن بمبلغ أكبر من صفر');
      END IF;
      check_postable(p_lines(i).account_code);
      v_dr_sum := v_dr_sum + v_debit;
      v_cr_sum := v_cr_sum + v_credit;
    END LOOP;

    IF v_dr_sum <> v_cr_sum THEN
      RAISE_APPLICATION_ERROR(-20107,
        'القيد غير متوازن: المدين ' || TO_CHAR(v_dr_sum) || ' والدائن ' || TO_CHAR(v_cr_sum));
    END IF;

    INSERT INTO erp_entries (entry_date, memo, ref, kind)
    VALUES (TRUNC(p_date), SUBSTR(p_memo, 1, 300), SUBSTR(p_ref, 1, 60), p_kind)
    RETURNING entry_id INTO v_id;

    FOR i IN 1 .. p_lines.COUNT LOOP
      INSERT INTO erp_lines (entry_id, account_code, debit, credit, note)
      VALUES (v_id, p_lines(i).account_code, NVL(p_lines(i).debit, 0), NVL(p_lines(i).credit, 0),
              SUBSTR(p_lines(i).note, 1, 200));
    END LOOP;

    RETURN v_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_gl_post;
      RAISE;
  END do_post;

  FUNCTION post_entry (
    p_date  IN DATE,
    p_memo  IN VARCHAR2,
    p_ref   IN VARCHAR2,
    p_lines IN erp_line_tab
  ) RETURN NUMBER IS
  BEGIN
    RETURN do_post(p_date, p_memo, p_ref, p_lines, 'NORMAL');
  END post_entry;

  FUNCTION post_closing_entry (
    p_date  IN DATE,
    p_memo  IN VARCHAR2,
    p_ref   IN VARCHAR2,
    p_lines IN erp_line_tab
  ) RETURN NUMBER ACCESSIBLE BY (PACKAGE erp_period) IS
  BEGIN
    RETURN do_post(p_date, p_memo, p_ref, p_lines, 'CLOSING');
  END post_closing_entry;

  FUNCTION do_reverse (
    p_entry_id IN NUMBER,
    p_date     IN DATE,
    p_check    IN BOOLEAN
  ) RETURN NUMBER IS
    v_date  erp_entries.entry_date%TYPE;
    v_ref   erp_entries.ref%TYPE;
    v_void  erp_entries.void_of%TYPE;
    v_kind  erp_entries.kind%TYPE;
    v_new   erp_entries.entry_id%TYPE;
  BEGIN
    SAVEPOINT erp_gl_reverse;

    BEGIN
      SELECT entry_date, ref, void_of, kind INTO v_date, v_ref, v_void, v_kind
        FROM erp_entries WHERE entry_id = p_entry_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20110, 'القيد رقم ' || p_entry_id || ' غير موجود');
    END;
    IF v_void IS NOT NULL THEN
      RAISE_APPLICATION_ERROR(-20111, 'لا يُعكس قيد عكسي');
    END IF;
    IF p_check THEN
      assert_open(NVL(p_date, v_date));
    END IF;

    BEGIN
      INSERT INTO erp_entries (entry_date, memo, ref, void_of, kind)
      VALUES (TRUNC(NVL(p_date, v_date)), 'عكس القيد رقم ' || p_entry_id, v_ref, p_entry_id, v_kind)
      RETURNING entry_id INTO v_new;
    EXCEPTION
      WHEN DUP_VAL_ON_INDEX THEN   -- القيد UNIQUE على void_of يحمي من العكس المزدوج حتى مع التزامن
        RAISE_APPLICATION_ERROR(-20112, 'القيد رقم ' || p_entry_id || ' معكوس مسبقاً');
    END;

    INSERT INTO erp_lines (entry_id, account_code, debit, credit, note)
    SELECT v_new, account_code, credit, debit, note
      FROM erp_lines
     WHERE entry_id = p_entry_id;

    RETURN v_new;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_gl_reverse;
      RAISE;
  END do_reverse;

  FUNCTION reverse_entry (
    p_entry_id IN NUMBER,
    p_date     IN DATE DEFAULT NULL
  ) RETURN NUMBER IS
  BEGIN
    RETURN do_reverse(p_entry_id, p_date, TRUE);
  END reverse_entry;

  FUNCTION reverse_closing_entry (p_entry_id IN NUMBER) RETURN NUMBER ACCESSIBLE BY (PACKAGE erp_period) IS
  BEGIN
    RETURN do_reverse(p_entry_id, NULL, FALSE);
  END reverse_closing_entry;

END erp_gl;
/
SHOW ERRORS PACKAGE BODY erp_gl
