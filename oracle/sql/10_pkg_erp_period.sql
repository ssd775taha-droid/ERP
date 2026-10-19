-- ============================================================================
-- 10: حزمة إقفال الفترات والسنة ERP_PERIOD (تعتمد على ERP_GL وERP_FIN)
-- الفترة الشهرية: بلا صف = مفتوحة. الإقفال يرفض بعده الدفتر أي قيد بتاريخ في الشهر (ORA-20113)، فتحميه القاعدة لا الشاشة.
--   إقفال الشهر يتطلب: إقفال كل شهر سابق فيه قيود، وخلو الشهر من المشكلات (كشف رواتب مسودة، إهلاك معلّق).
--   إعادة الفتح بالعكس: الأحدث أولاً، وليس لشهر في سنة مقفلة.
-- السنة المالية: 12 شهراً تنتهي في آخر يوم من شهر p_year_end. إقفالها يتطلب إقفال كل أشهرها التي فيها قيود وإقفال السنة
--   السابقة، وينشئ قيداً من نوع CLOSING (يصفّر الإيرادات والمصروفات إلى 3200 الأرباح المحتجزة) ثم يقفل أشهرها.
--   السنة تُعاد فتحها بعكس القيد وفتح أشهرها، والأحدث أولاً.
-- ملاحظة تشغيلية: التعديل في فترة مقفلة يكون بقيد جديد بتاريخ في فترة مفتوحة، أو بإعادة فتح الفترة. إلغاء فاتورة أو
--   كشف رواتب تاريخها في فترة مقفلة مرفوض لأن عكس قيده يقع في الفترة نفسها.
--
-- رموز الأخطاء:
--   -20701 شهر/تاريخ غير صالح أو الحالة لا تسمح    -20704 إقفال/فتح السنة غير مسموح
--   -20702 مشكلات تمنع الإقفال                      -20705 السنة السابقة لم تُقفل أو سنة لاحقة مقفلة
--   -20703 ترتيب الإقفال/الفتح غير صحيح
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_period AS
  FUNCTION is_closed (p_date IN DATE) RETURN BOOLEAN;

  -- مشكلات تمنع إقفال الشهر (قائمة فارغة = جاهز). للعرض في الشاشة قبل الإقفال.
  FUNCTION close_issues (p_month IN DATE) RETURN erp_msg_tab;

  PROCEDURE close_period  (p_month IN DATE);
  PROCEDURE reopen_period (p_month IN DATE);

  -- إقفال السنة المنتهية في p_year_end (آخر يوم من شهر). يعيد رقم قيد الإقفال (NULL إن لم توجد أرصدة).
  FUNCTION close_year (p_year_end IN DATE) RETURN NUMBER;
  PROCEDURE reopen_year (p_year_end IN DATE);
END erp_period;
/

CREATE OR REPLACE PACKAGE BODY erp_period AS

  c_retained CONSTANT VARCHAR2(12) := '3200';

  PROCEDURE set_status (p_month IN DATE, p_status IN VARCHAR2) IS
  BEGIN
    UPDATE erp_periods
       SET status = p_status, changed_by = SYS_CONTEXT('USERENV', 'SESSION_USER'), changed_at = SYSTIMESTAMP
     WHERE period = p_month;
    IF SQL%ROWCOUNT = 0 THEN
      INSERT INTO erp_periods (period, status) VALUES (p_month, p_status);
    END IF;
  END set_status;

  FUNCTION is_closed (p_date IN DATE) RETURN BOOLEAN IS
    v_n NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_n FROM erp_periods WHERE period = TRUNC(p_date, 'MM') AND status = 'CLOSED';
    RETURN v_n > 0;
  END is_closed;

  FUNCTION close_issues (p_month IN DATE) RETURN erp_msg_tab IS
    v_m    DATE := TRUNC(p_month, 'MM');
    v_list erp_msg_tab := erp_msg_tab();
  BEGIN
    FOR r IN (SELECT period FROM erp_payroll_runs WHERE status = 'DRAFT' AND period <= v_m ORDER BY period) LOOP
      v_list.EXTEND;
      v_list(v_list.COUNT) := 'كشف رواتب مسودة لشهر ' || TO_CHAR(r.period, 'YYYY-MM') || ': رحّله أو ألغه';
    END LOOP;

    -- إهلاك معلّق: أصل ساري بقي عليه إهلاك وشهره التالي المستحق ≤ الشهر
    FOR r IN (
      SELECT x.code, x.nxt FROM (
        SELECT a.code, a.cost - a.salvage AS depreciable,
               NVL(ADD_MONTHS((SELECT MAX(d.period) FROM erp_depreciation d WHERE d.asset_id = a.asset_id AND d.status = 'OK'), 1), a.dep_start) AS nxt,
               (SELECT NVL(SUM(d.amount), 0) FROM erp_depreciation d WHERE d.asset_id = a.asset_id AND d.status = 'OK') AS acc
          FROM erp_assets a WHERE a.status = 'ACTIVE'
      ) x WHERE x.acc < x.depreciable AND x.nxt <= v_m ORDER BY x.code
    ) LOOP
      v_list.EXTEND;
      v_list(v_list.COUNT) := 'إهلاك معلّق للأصل ' || r.code || ' منذ شهر ' || TO_CHAR(r.nxt, 'YYYY-MM') || ': شغّل الإهلاك';
    END LOOP;
    RETURN v_list;
  END close_issues;

  PROCEDURE close_period (p_month IN DATE) IS
    v_m      DATE;
    v_n      NUMBER;
    v_issues erp_msg_tab;
    v_text   VARCHAR2(1000);
  BEGIN
    SAVEPOINT erp_period_close;
    IF p_month IS NULL THEN
      RAISE_APPLICATION_ERROR(-20701, 'الشهر مطلوب');
    END IF;
    v_m := TRUNC(p_month, 'MM');
    IF is_closed(v_m) THEN
      RAISE_APPLICATION_ERROR(-20701, 'الشهر ' || TO_CHAR(v_m, 'YYYY-MM') || ' مقفل مسبقاً');
    END IF;

    -- لا إقفال قبل إقفال كل شهر سابق فيه قيود
    SELECT COUNT(DISTINCT TRUNC(e.entry_date, 'MM')) INTO v_n
      FROM erp_entries e
     WHERE e.entry_date < v_m AND e.kind = 'NORMAL'
       AND NOT EXISTS (SELECT 1 FROM erp_periods p WHERE p.period = TRUNC(e.entry_date, 'MM') AND p.status = 'CLOSED');
    IF v_n > 0 THEN
      RAISE_APPLICATION_ERROR(-20703, 'أقفل الأشهر السابقة أولاً (' || v_n || ' شهر سابق فيه قيود غير مقفل)');
    END IF;

    v_issues := close_issues(v_m);
    IF v_issues.COUNT > 0 THEN
      v_text := v_issues(1);
      IF v_issues.COUNT > 1 THEN v_text := v_text || ' · ' || v_issues(2); END IF;
      IF v_issues.COUNT > 2 THEN v_text := v_text || ' · (و' || (v_issues.COUNT - 2) || ' أخرى)'; END IF;
      RAISE_APPLICATION_ERROR(-20702, 'لا يُقفل الشهر ' || TO_CHAR(v_m, 'YYYY-MM') || ': ' || SUBSTR(v_text, 1, 700));
    END IF;
    set_status(v_m, 'CLOSED');
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_period_close;
      RAISE;
  END close_period;

  PROCEDURE reopen_period (p_month IN DATE) IS
    v_m DATE;
    v_n NUMBER;
  BEGIN
    SAVEPOINT erp_period_reopen;
    IF p_month IS NULL THEN
      RAISE_APPLICATION_ERROR(-20701, 'الشهر مطلوب');
    END IF;
    v_m := TRUNC(p_month, 'MM');
    IF NOT is_closed(v_m) THEN
      RAISE_APPLICATION_ERROR(-20701, 'الشهر ' || TO_CHAR(v_m, 'YYYY-MM') || ' غير مقفل');
    END IF;
    SELECT COUNT(*) INTO v_n FROM erp_year_closings c
     WHERE c.status = 'CLOSED' AND v_m BETWEEN ADD_MONTHS(TRUNC(c.year_end, 'MM'), -11) AND c.year_end;
    IF v_n > 0 THEN
      RAISE_APPLICATION_ERROR(-20704, 'الشهر ضمن سنة مقفلة: أعد فتح السنة أولاً');
    END IF;
    SELECT COUNT(*) INTO v_n FROM erp_periods WHERE status = 'CLOSED' AND period > v_m;
    IF v_n > 0 THEN
      RAISE_APPLICATION_ERROR(-20703, 'يوجد شهر لاحق مقفل: أعد فتح الأحدث أولاً');
    END IF;
    set_status(v_m, 'OPEN');
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_period_reopen;
      RAISE;
  END reopen_period;

  FUNCTION close_year (p_year_end IN DATE) RETURN NUMBER IS
    v_end    DATE;
    v_start  DATE;
    v_n      NUMBER;
    v_status erp_year_closings.status%TYPE;
    v_exists BOOLEAN := FALSE;
    v_ni     NUMBER := 0;
    v_gl     erp_line_tab := erp_line_tab();
    v_entry  NUMBER;
  BEGIN
    SAVEPOINT erp_period_close_year;
    IF p_year_end IS NULL OR TRUNC(p_year_end) <> TRUNC(LAST_DAY(p_year_end)) THEN
      RAISE_APPLICATION_ERROR(-20701, 'نهاية السنة يجب أن تكون آخر يوم في شهر');
    END IF;
    v_end   := TRUNC(p_year_end);
    v_start := ADD_MONTHS(TRUNC(v_end, 'MM'), -11);

    BEGIN
      SELECT status INTO v_status FROM erp_year_closings WHERE year_end = v_end FOR UPDATE;
      v_exists := TRUE;
      IF v_status = 'CLOSED' THEN
        RAISE_APPLICATION_ERROR(-20704, 'السنة المنتهية في ' || TO_CHAR(v_end, 'YYYY-MM-DD') || ' مقفلة مسبقاً');
      END IF;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN NULL;
    END;

    SELECT COUNT(*) INTO v_n FROM erp_year_closings WHERE status = 'CLOSED' AND year_end <> v_end
       AND ABS(MONTHS_BETWEEN(year_end, v_end)) < 12;
    IF v_n > 0 THEN
      RAISE_APPLICATION_ERROR(-20704, 'السنة تتداخل مع سنة مقفلة');
    END IF;
    SELECT COUNT(*) INTO v_n FROM erp_year_closings WHERE status = 'CLOSED' AND year_end > v_end;
    IF v_n > 0 THEN
      RAISE_APPLICATION_ERROR(-20705, 'أُقفلت سنة لاحقة: أعد فتحها أولاً');
    END IF;
    -- السنة السابقة يجب أن تكون مقفلة: لا أرباح معلّقة قبل بداية هذه السنة
    IF erp_fin.unclosed_earnings(v_start - 1) <> 0 THEN
      RAISE_APPLICATION_ERROR(-20705, 'أقفل السنة السابقة أولاً: توجد أرباح غير مقفلة قبل ' || TO_CHAR(v_start, 'YYYY-MM-DD'));
    END IF;
    -- كل شهر من السنة فيه قيود يجب أن يكون مقفلاً
    SELECT COUNT(DISTINCT TRUNC(e.entry_date, 'MM')) INTO v_n
      FROM erp_entries e
     WHERE e.entry_date BETWEEN v_start AND v_end AND e.kind = 'NORMAL'
       AND NOT EXISTS (SELECT 1 FROM erp_periods p WHERE p.period = TRUNC(e.entry_date, 'MM') AND p.status = 'CLOSED');
    IF v_n > 0 THEN
      RAISE_APPLICATION_ERROR(-20703, 'أقفل كل أشهر السنة أولاً (' || v_n || ' شهر فيه قيود غير مقفل)');
    END IF;

    -- قيد الإقفال: يصفّر كل حساب إيراد ومصروف بما تراكم له حتى نهاية السنة، والفرق إلى الأرباح المحتجزة
    FOR r IN (
      SELECT a.code, SUM(l.credit - l.debit) AS bal
        FROM erp_accounts a
        JOIN erp_lines l   ON l.account_code = a.code
        JOIN erp_entries e ON e.entry_id = l.entry_id
       WHERE a.acc_type IN ('REVENUE', 'EXPENSE') AND e.entry_date <= v_end
       GROUP BY a.code HAVING SUM(l.credit - l.debit) <> 0 ORDER BY a.code
    ) LOOP
      v_ni := v_ni + r.bal;
      v_gl.EXTEND;
      v_gl(v_gl.COUNT) := CASE WHEN r.bal > 0 THEN erp_line_t(r.code, r.bal, 0, NULL) ELSE erp_line_t(r.code, 0, -r.bal, NULL) END;
    END LOOP;
    IF v_gl.COUNT > 0 THEN
      v_gl.EXTEND;
      v_gl(v_gl.COUNT) := CASE WHEN v_ni >= 0 THEN erp_line_t(c_retained, 0, v_ni, NULL) ELSE erp_line_t(c_retained, -v_ni, 0, NULL) END;
      -- ربح صفري تماماً مع أرصدة متقابلة: سطر الأرباح المحتجزة صفر فيُحذف
      IF v_ni = 0 THEN v_gl.TRIM; END IF;
      v_entry := erp_gl.post_closing_entry(v_end, 'قيد إقفال السنة المالية المنتهية في ' || TO_CHAR(v_end, 'YYYY-MM-DD'),
                                           'CLOSE-' || TO_CHAR(v_end, 'YYYYMM'), v_gl);
    END IF;

    IF v_exists THEN
      UPDATE erp_year_closings
         SET status = 'CLOSED', net_income = v_ni, entry_id = v_entry, reopen_entry_id = NULL,
             changed_by = SYS_CONTEXT('USERENV', 'SESSION_USER'), changed_at = SYSTIMESTAMP
       WHERE year_end = v_end;
    ELSE
      INSERT INTO erp_year_closings (year_end, net_income, entry_id) VALUES (v_end, v_ni, v_entry);
    END IF;
    FOR i IN 0 .. 11 LOOP
      set_status(ADD_MONTHS(v_start, i), 'CLOSED');
    END LOOP;
    RETURN v_entry;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_period_close_year;
      RAISE;
  END close_year;

  PROCEDURE reopen_year (p_year_end IN DATE) IS
    v_end   DATE;
    v_start DATE;
    v_c     erp_year_closings%ROWTYPE;
    v_n     NUMBER;
    v_rev   NUMBER;
  BEGIN
    SAVEPOINT erp_period_reopen_year;
    IF p_year_end IS NULL THEN
      RAISE_APPLICATION_ERROR(-20701, 'نهاية السنة مطلوبة');
    END IF;
    v_end   := TRUNC(p_year_end);
    v_start := ADD_MONTHS(TRUNC(v_end, 'MM'), -11);
    BEGIN
      SELECT * INTO v_c FROM erp_year_closings WHERE year_end = v_end FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20704, 'لا إقفال للسنة المنتهية في ' || TO_CHAR(v_end, 'YYYY-MM-DD'));
    END;
    IF v_c.status <> 'CLOSED' THEN
      RAISE_APPLICATION_ERROR(-20704, 'السنة غير مقفلة حالياً');
    END IF;
    SELECT COUNT(*) INTO v_n FROM erp_year_closings WHERE status = 'CLOSED' AND year_end > v_end;
    IF v_n > 0 THEN
      RAISE_APPLICATION_ERROR(-20705, 'أُقفلت سنة لاحقة: أعد فتحها أولاً');
    END IF;
    SELECT COUNT(*) INTO v_n FROM erp_periods WHERE status = 'CLOSED' AND period > TRUNC(v_end, 'MM');
    IF v_n > 0 THEN
      RAISE_APPLICATION_ERROR(-20703, 'يوجد شهر مقفل بعد نهاية السنة: أعد فتح الأحدث أولاً');
    END IF;

    IF v_c.entry_id IS NOT NULL THEN
      v_rev := erp_gl.reverse_closing_entry(v_c.entry_id);
    END IF;
    UPDATE erp_year_closings
       SET status = 'REOPENED', reopen_entry_id = v_rev,
           changed_by = SYS_CONTEXT('USERENV', 'SESSION_USER'), changed_at = SYSTIMESTAMP
     WHERE year_end = v_end;
    UPDATE erp_periods SET status = 'OPEN', changed_by = SYS_CONTEXT('USERENV', 'SESSION_USER'), changed_at = SYSTIMESTAMP
     WHERE period BETWEEN v_start AND TRUNC(v_end, 'MM') AND status = 'CLOSED';
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_period_reopen_year;
      RAISE;
  END reopen_year;

END erp_period;
/
SHOW ERRORS PACKAGE BODY erp_period
