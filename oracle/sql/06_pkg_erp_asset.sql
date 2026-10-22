-- ============================================================================
-- 06: حزمة الأصول الثابتة والإهلاك ERP_ASSET (تعتمد على ERP_GL)
-- الإهلاك بالقسط الثابت الشهري: (التكلفة − الخردة) ÷ العمر بالأشهر، مقرَّباً لمنزلتين، والشهر الأخير يأخذ المتبقي
-- بالضبط فلا يبقى فرق تقريب. يبدأ من شهر dep_start (شهر كامل، الافتراضي شهر الاقتناء) ولا يتجاوز التكلفة − الخردة.
-- لا COMMIT داخل الحزمة، وكل إجراء عام يتراجع إلى نقطة حفظ خاصة به عند الخطأ.
--
-- رموز الأخطاء:
--   -20401 بيانات الفئة/الأصل غير صالحة أو الرمز مكرر   -20406 حالة الأصل لا تسمح بالعملية
--   -20402 فئة غير موجودة أو موقوفة                      -20407 فاتورة الاقتناء غير صالحة
--   -20403 أصل غير موجود                                 -20408 تاريخ أو مبلغ غير صالح
--   -20404 إهلاك معلّق: شغّله حتى الشهر السابق للبيع     -20409 لا يُعكس إهلاك شهر (لاحق له إهلاك أو بيع)
--   -20405 الإهلاك مسجّل مسبقاً (تشغيل متزامن)
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_asset AS
  FUNCTION add_category (
    p_code            IN VARCHAR2,
    p_name            IN VARCHAR2,
    p_life_months     IN NUMBER,
    p_asset_account   IN VARCHAR2 DEFAULT '1500',
    p_accum_account   IN VARCHAR2 DEFAULT '1510',
    p_expense_account IN VARCHAR2 DEFAULT '5600'
  ) RETURN NUMBER;

  -- تسجيل أصل. بلا p_invoice_id يُرحَّل قيد: مدين حساب الأصل / دائن p_offset_account (بنك أو صندوق أو رأس مال).
  -- مع p_invoice_id (فاتورة مشتريات سارية) لا يُرحَّل قيد لأن الفاتورة رحّلت التكلفة: يُسجَّل الأصل ويُربط بها فقط.
  FUNCTION acquire (
    p_code           IN VARCHAR2,
    p_name           IN VARCHAR2,
    p_cat_id         IN NUMBER,
    p_acq_date       IN DATE,
    p_cost           IN NUMBER,
    p_salvage        IN NUMBER   DEFAULT 0,
    p_life_months    IN NUMBER   DEFAULT NULL,   -- الافتراضي عمر الفئة
    p_dep_start      IN DATE     DEFAULT NULL,   -- الافتراضي شهر الاقتناء
    p_offset_account IN VARCHAR2 DEFAULT '1200',
    p_invoice_id     IN NUMBER   DEFAULT NULL,
    p_note           IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER;

  FUNCTION accumulated (p_asset_id IN NUMBER) RETURN NUMBER;
  FUNCTION book_value  (p_asset_id IN NUMBER) RETURN NUMBER;

  -- تسجيل إهلاك كل الأصول السارية حتى شهر p_upto (يعوّض أي أشهر فائتة بالترتيب). قيد واحد لكل شهر.
  -- آمن للتكرار: لا يُهلك شهراً سبق إهلاكه. يعيد إجمالي ما رُحِّل في هذا الاستدعاء.
  FUNCTION run_depreciation (p_upto IN DATE) RETURN NUMBER;

  -- عكس إهلاك شهر (كل دفعاته) بقيود عكسية؛ مرفوض إن وُجد إهلاك لشهر لاحق أو بيع أصل بعده
  PROCEDURE reverse_depreciation (p_period IN DATE);

  -- بيع/استبعاد أصل: يلغي التكلفة ومجمع الإهلاك ويُثبت ربح أو خسارة البيع. يعيد رقم القيد.
  FUNCTION dispose (
    p_asset_id         IN NUMBER,
    p_date             IN DATE,
    p_proceeds         IN NUMBER   DEFAULT 0,
    p_proceeds_account IN VARCHAR2 DEFAULT '1200'
  ) RETURN NUMBER;

  -- إلغاء تسجيل أصل لم يُهلَك ولم يُبَع (يعكس قيد الاقتناء إن وُجد)
  PROCEDURE void_asset (p_asset_id IN NUMBER);
END erp_asset;
/

CREATE OR REPLACE PACKAGE BODY erp_asset AS

  c_gain CONSTANT VARCHAR2(12) := '4300';
  c_loss CONSTANT VARCHAR2(12) := '5700';

  TYPE t_amt  IS TABLE OF NUMBER INDEX BY VARCHAR2(12);
  TYPE t_nums IS TABLE OF NUMBER INDEX BY PLS_INTEGER;

  PROCEDURE bump (p_map IN OUT NOCOPY t_amt, p_key IN VARCHAR2, p_amount IN NUMBER) IS
  BEGIN
    IF p_map.EXISTS(p_key) THEN p_map(p_key) := p_map(p_key) + p_amount; ELSE p_map(p_key) := p_amount; END IF;
  END bump;

  PROCEDURE expect_type (p_code IN VARCHAR2, p_expected IN VARCHAR2, p_label IN VARCHAR2) IS
    v_type erp_accounts.acc_type%TYPE;
  BEGIN
    SELECT acc_type INTO v_type FROM erp_accounts WHERE code = p_code;
    IF v_type <> p_expected THEN
      RAISE_APPLICATION_ERROR(-20401, 'حساب ' || p_label || ' (' || p_code || ') يجب أن يكون من نوع ' || p_expected);
    END IF;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20401, 'حساب ' || p_label || ' (' || p_code || ') غير موجود');
  END expect_type;

  FUNCTION add_category (
    p_code            IN VARCHAR2,
    p_name            IN VARCHAR2,
    p_life_months     IN NUMBER,
    p_asset_account   IN VARCHAR2 DEFAULT '1500',
    p_accum_account   IN VARCHAR2 DEFAULT '1510',
    p_expense_account IN VARCHAR2 DEFAULT '5600'
  ) RETURN NUMBER IS
    v_id erp_asset_categories.cat_id%TYPE;
  BEGIN
    IF TRIM(p_code) IS NULL OR TRIM(p_name) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20401, 'رمز الفئة واسمها مطلوبان');
    END IF;
    IF NVL(p_life_months, 0) < 1 OR p_life_months > 1200 OR p_life_months <> TRUNC(p_life_months) THEN
      RAISE_APPLICATION_ERROR(-20401, 'العمر بالأشهر بين 1 و1200');
    END IF;
    expect_type(p_asset_account,   'ASSET',   'الأصل');
    expect_type(p_accum_account,   'ASSET',   'مجمع الإهلاك');
    expect_type(p_expense_account, 'EXPENSE', 'مصروف الإهلاك');
    INSERT INTO erp_asset_categories (code, name, asset_account, accum_account, expense_account, life_months)
    VALUES (SUBSTR(TRIM(p_code), 1, 12), SUBSTR(TRIM(p_name), 1, 120), p_asset_account, p_accum_account, p_expense_account, p_life_months)
    RETURNING cat_id INTO v_id;
    RETURN v_id;
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      RAISE_APPLICATION_ERROR(-20401, 'رمز الفئة مستخدم');
  END add_category;

  FUNCTION accumulated (p_asset_id IN NUMBER) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    SELECT NVL(SUM(amount), 0) INTO v FROM erp_depreciation WHERE asset_id = p_asset_id AND status = 'OK';
    RETURN v;
  END accumulated;

  FUNCTION book_value (p_asset_id IN NUMBER) RETURN NUMBER IS
    v_cost NUMBER;
  BEGIN
    BEGIN
      SELECT cost INTO v_cost FROM erp_assets WHERE asset_id = p_asset_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20403, 'الأصل رقم ' || p_asset_id || ' غير موجود');
    END;
    RETURN v_cost - accumulated(p_asset_id);
  END book_value;

  FUNCTION acquire (
    p_code           IN VARCHAR2,
    p_name           IN VARCHAR2,
    p_cat_id         IN NUMBER,
    p_acq_date       IN DATE,
    p_cost           IN NUMBER,
    p_salvage        IN NUMBER   DEFAULT 0,
    p_life_months    IN NUMBER   DEFAULT NULL,
    p_dep_start      IN DATE     DEFAULT NULL,
    p_offset_account IN VARCHAR2 DEFAULT '1200',
    p_invoice_id     IN NUMBER   DEFAULT NULL,
    p_note           IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER IS
    v_cat     erp_asset_categories%ROWTYPE;
    v_inv     erp_invoices%ROWTYPE;
    v_life    NUMBER;
    v_start   DATE;
    v_salvage NUMBER := NVL(p_salvage, 0);
    v_entry   NUMBER;
    v_id      erp_assets.asset_id%TYPE;
  BEGIN
    SAVEPOINT erp_asset_acquire;

    IF TRIM(p_code) IS NULL OR TRIM(p_name) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20401, 'رمز الأصل واسمه مطلوبان');
    END IF;
    IF p_acq_date IS NULL THEN
      RAISE_APPLICATION_ERROR(-20408, 'تاريخ الاقتناء مطلوب');
    END IF;
    IF NVL(p_cost, 0) <= 0 OR p_cost <> ROUND(p_cost, 2) OR v_salvage < 0 OR v_salvage <> ROUND(v_salvage, 2) OR v_salvage >= p_cost THEN
      RAISE_APPLICATION_ERROR(-20408, 'التكلفة موجبة وبمنزلتين عشريتين، والخردة غير سالبة وأقل من التكلفة');
    END IF;
    BEGIN
      SELECT * INTO v_cat FROM erp_asset_categories WHERE cat_id = p_cat_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20402, 'الفئة رقم ' || p_cat_id || ' غير موجودة');
    END;
    IF v_cat.active <> 'Y' THEN
      RAISE_APPLICATION_ERROR(-20402, 'الفئة ' || v_cat.code || ' موقوفة');
    END IF;
    v_life := NVL(p_life_months, v_cat.life_months);
    IF v_life < 1 OR v_life > 1200 OR v_life <> TRUNC(v_life) THEN
      RAISE_APPLICATION_ERROR(-20401, 'العمر بالأشهر بين 1 و1200');
    END IF;
    v_start := TRUNC(NVL(p_dep_start, p_acq_date), 'MM');
    IF v_start < TRUNC(p_acq_date, 'MM') THEN
      RAISE_APPLICATION_ERROR(-20408, 'بداية الإهلاك لا تسبق شهر الاقتناء');
    END IF;

    IF p_invoice_id IS NOT NULL THEN
      BEGIN
        SELECT * INTO v_inv FROM erp_invoices WHERE invoice_id = p_invoice_id;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          RAISE_APPLICATION_ERROR(-20407, 'الفاتورة رقم ' || p_invoice_id || ' غير موجودة');
      END;
      IF v_inv.kind <> 'PURCHASE' OR v_inv.status <> 'OPEN' THEN
        RAISE_APPLICATION_ERROR(-20407, 'الفاتورة يجب أن تكون فاتورة مشتريات سارية');
      END IF;
      IF p_cost > v_inv.subtotal THEN
        RAISE_APPLICATION_ERROR(-20407, 'تكلفة الأصل أكبر من صافي الفاتورة (' || TO_CHAR(v_inv.subtotal) || ')');
      END IF;
    ELSE
      v_entry := erp_gl.post_entry(
        p_acq_date, 'اقتناء أصل ' || TRIM(p_code) || ' — ' || TRIM(p_name), 'FA-' || TRIM(p_code),
        erp_line_tab(erp_line_t(v_cat.asset_account, p_cost, 0, NULL), erp_line_t(p_offset_account, 0, p_cost, NULL)));
    END IF;

    BEGIN
      INSERT INTO erp_assets (code, name, cat_id, acq_date, dep_start, cost, salvage, life_months, invoice_id, entry_id, note)
      VALUES (SUBSTR(TRIM(p_code), 1, 30), SUBSTR(TRIM(p_name), 1, 120), p_cat_id, TRUNC(p_acq_date), v_start, p_cost, v_salvage,
              v_life, p_invoice_id, v_entry, SUBSTR(p_note, 1, 300))
      RETURNING asset_id INTO v_id;
    EXCEPTION
      WHEN DUP_VAL_ON_INDEX THEN
        RAISE_APPLICATION_ERROR(-20401, 'رمز الأصل مستخدم');
    END;
    RETURN v_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_asset_acquire;
      RAISE;
  END acquire;

  FUNCTION run_depreciation (p_upto IN DATE) RETURN NUMBER IS
    -- حالة كل أصل ساري: الشهر التالي المستحق، المتراكم، وعدد الأشهر المهلكة
    CURSOR c_state IS
      SELECT a.asset_id, a.cost, a.salvage, a.life_months, c.accum_account, c.expense_account,
             NVL(ADD_MONTHS((SELECT MAX(d.period) FROM erp_depreciation d WHERE d.asset_id = a.asset_id AND d.status = 'OK'), 1), a.dep_start) AS nxt,
             (SELECT NVL(SUM(d.amount), 0) FROM erp_depreciation d WHERE d.asset_id = a.asset_id AND d.status = 'OK') AS acc,
             (SELECT COUNT(*) FROM erp_depreciation d WHERE d.asset_id = a.asset_id AND d.status = 'OK') AS done
        FROM erp_assets a
        JOIN erp_asset_categories c ON c.cat_id = a.cat_id
       WHERE a.status = 'ACTIVE';

    v_last      DATE;
    v_first     DATE;
    v_m         DATE;
    v_ids       t_nums;
    v_amts      t_nums;
    v_n         PLS_INTEGER;
    v_dr        t_amt;
    v_cr        t_amt;
    v_depr      NUMBER;
    v_rem       NUMBER;
    v_amt       NUMBER;
    v_run_total NUMBER;
    v_grand     NUMBER := 0;
    v_gl        erp_line_tab;
    v_code      VARCHAR2(12);
    v_entry     NUMBER;
    v_run_id    NUMBER;
  BEGIN
    SAVEPOINT erp_asset_dep;
    IF p_upto IS NULL THEN
      RAISE_APPLICATION_ERROR(-20408, 'شهر الإهلاك مطلوب');
    END IF;
    v_last := TRUNC(p_upto, 'MM');

    FOR r IN c_state LOOP
      IF v_first IS NULL OR r.nxt < v_first THEN v_first := r.nxt; END IF;
    END LOOP;
    IF v_first IS NULL OR v_first > v_last THEN
      RETURN 0;
    END IF;

    v_m := v_first;
    WHILE v_m <= v_last LOOP
      v_n := 0; v_run_total := 0; v_dr.DELETE; v_cr.DELETE;

      FOR r IN c_state LOOP
        IF r.nxt = v_m THEN
          v_depr := r.cost - r.salvage;
          v_rem  := v_depr - r.acc;
          IF v_rem > 0 THEN
            IF r.done + 1 >= r.life_months THEN
              v_amt := v_rem;                                         -- الشهر الأخير: المتبقي بالضبط
            ELSE
              v_amt := LEAST(ROUND(v_depr / r.life_months, 2), v_rem);
            END IF;
            IF v_amt > 0 THEN
              v_n := v_n + 1;
              v_ids(v_n)  := r.asset_id;
              v_amts(v_n) := v_amt;
              bump(v_dr, r.expense_account, v_amt);
              bump(v_cr, r.accum_account,   v_amt);
              v_run_total := v_run_total + v_amt;
            END IF;
          END IF;
        END IF;
      END LOOP;

      IF v_n > 0 THEN
        v_gl := erp_line_tab();
        v_code := v_dr.FIRST;
        WHILE v_code IS NOT NULL LOOP
          v_gl.EXTEND; v_gl(v_gl.COUNT) := erp_line_t(v_code, v_dr(v_code), 0, NULL);
          v_code := v_dr.NEXT(v_code);
        END LOOP;
        v_code := v_cr.FIRST;
        WHILE v_code IS NOT NULL LOOP
          v_gl.EXTEND; v_gl(v_gl.COUNT) := erp_line_t(v_code, 0, v_cr(v_code), NULL);
          v_code := v_cr.NEXT(v_code);
        END LOOP;

        v_entry := erp_gl.post_entry(LAST_DAY(v_m), 'إهلاك الأصول الثابتة عن شهر ' || TO_CHAR(v_m, 'YYYY-MM'), 'DEP-' || TO_CHAR(v_m, 'YYYYMM'), v_gl);
        INSERT INTO erp_dep_runs (period, entry_id, total) VALUES (v_m, v_entry, v_run_total) RETURNING run_id INTO v_run_id;
        FOR i IN 1 .. v_n LOOP
          INSERT INTO erp_depreciation (run_id, asset_id, period, amount) VALUES (v_run_id, v_ids(i), v_m, v_amts(i));
        END LOOP;
        v_grand := v_grand + v_run_total;
      END IF;

      v_m := ADD_MONTHS(v_m, 1);
    END LOOP;

    RETURN v_grand;
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      ROLLBACK TO SAVEPOINT erp_asset_dep;
      RAISE_APPLICATION_ERROR(-20405, 'الإهلاك مسجّل مسبقاً لأحد الأصول في هذه الفترة: أعد المحاولة');
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_asset_dep;
      RAISE;
  END run_depreciation;

  PROCEDURE reverse_depreciation (p_period IN DATE) IS
    v_m     DATE;
    v_count NUMBER;
    v_tmp   NUMBER;
  BEGIN
    SAVEPOINT erp_asset_dep_rev;
    IF p_period IS NULL THEN
      RAISE_APPLICATION_ERROR(-20408, 'الشهر مطلوب');
    END IF;
    v_m := TRUNC(p_period, 'MM');

    SELECT COUNT(*) INTO v_count FROM erp_depreciation WHERE status = 'OK' AND period = v_m;
    IF v_count = 0 THEN
      RAISE_APPLICATION_ERROR(-20409, 'لا يوجد إهلاك مسجّل لهذا الشهر');
    END IF;
    SELECT COUNT(*) INTO v_count FROM erp_depreciation WHERE status = 'OK' AND period > v_m;
    IF v_count > 0 THEN
      RAISE_APPLICATION_ERROR(-20409, 'يوجد إهلاك لشهر لاحق: اعكس الأحدث أولاً');
    END IF;
    SELECT COUNT(*) INTO v_count FROM erp_assets WHERE status = 'DISPOSED' AND TRUNC(disposal_date, 'MM') > v_m;
    IF v_count > 0 THEN
      RAISE_APPLICATION_ERROR(-20409, 'بيع أصل بعد هذا الشهر اعتمد على إهلاكه');
    END IF;

    FOR r IN (SELECT run_id, entry_id FROM erp_dep_runs
               WHERE status = 'OK' AND period = v_m ORDER BY run_id DESC) LOOP
      v_tmp := erp_gl.reverse_entry(r.entry_id);
      UPDATE erp_depreciation SET status = 'VOID' WHERE run_id = r.run_id;
      UPDATE erp_dep_runs SET status = 'VOID' WHERE run_id = r.run_id;
    END LOOP;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_asset_dep_rev;
      RAISE;
  END reverse_depreciation;

  FUNCTION dispose (
    p_asset_id         IN NUMBER,
    p_date             IN DATE,
    p_proceeds         IN NUMBER   DEFAULT 0,
    p_proceeds_account IN VARCHAR2 DEFAULT '1200'
  ) RETURN NUMBER IS
    v_a        erp_assets%ROWTYPE;
    v_cat      erp_asset_categories%ROWTYPE;
    v_acc      NUMBER;
    v_nxt      DATE;
    v_book     NUMBER;
    v_proceeds NUMBER := NVL(p_proceeds, 0);
    v_gl       erp_line_tab := erp_line_tab();
    v_entry    NUMBER;

    PROCEDURE add_gl (p_account IN VARCHAR2, p_debit IN NUMBER, p_credit IN NUMBER) IS
    BEGIN
      v_gl.EXTEND;
      v_gl(v_gl.COUNT) := erp_line_t(p_account, p_debit, p_credit, NULL);
    END add_gl;
  BEGIN
    SAVEPOINT erp_asset_dispose;
    IF p_date IS NULL THEN
      RAISE_APPLICATION_ERROR(-20408, 'تاريخ البيع مطلوب');
    END IF;
    IF v_proceeds < 0 OR v_proceeds <> ROUND(v_proceeds, 2) THEN
      RAISE_APPLICATION_ERROR(-20408, 'مبلغ البيع غير صالح');
    END IF;
    BEGIN
      SELECT * INTO v_a FROM erp_assets WHERE asset_id = p_asset_id FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20403, 'الأصل رقم ' || p_asset_id || ' غير موجود');
    END;
    IF v_a.status <> 'ACTIVE' THEN
      RAISE_APPLICATION_ERROR(-20406, 'الأصل ' || v_a.code || ' ليس سارياً (الحالة ' || v_a.status || ')');
    END IF;
    IF TRUNC(p_date) < v_a.acq_date THEN
      RAISE_APPLICATION_ERROR(-20408, 'تاريخ البيع قبل تاريخ الاقتناء');
    END IF;

    -- لا يُباع أصل عليه إهلاك معلّق قبل شهر البيع (لا إهلاك في شهر البيع نفسه)
    v_acc := accumulated(p_asset_id);
    SELECT NVL(ADD_MONTHS(MAX(period), 1), v_a.dep_start) INTO v_nxt
      FROM erp_depreciation WHERE asset_id = p_asset_id AND status = 'OK';
    IF v_acc < v_a.cost - v_a.salvage AND v_nxt < TRUNC(p_date, 'MM') THEN
      RAISE_APPLICATION_ERROR(-20404, 'إهلاك معلّق للأصل ' || v_a.code || ': شغّل الإهلاك حتى شهر ' || TO_CHAR(ADD_MONTHS(TRUNC(p_date, 'MM'), -1), 'YYYY-MM'));
    END IF;

    SELECT * INTO v_cat FROM erp_asset_categories WHERE cat_id = v_a.cat_id;
    v_book := v_a.cost - v_acc;

    -- مدين: النقد (إن وُجد) + مجمع الإهلاك (إن وُجد) + الخسارة (إن وُجدت)   دائن: تكلفة الأصل + الربح (إن وُجد)
    IF v_proceeds > 0 THEN add_gl(p_proceeds_account, v_proceeds, 0); END IF;
    IF v_acc > 0 THEN add_gl(v_cat.accum_account, v_acc, 0); END IF;
    add_gl(v_cat.asset_account, 0, v_a.cost);
    IF v_proceeds > v_book THEN
      add_gl(c_gain, 0, v_proceeds - v_book);
    ELSIF v_proceeds < v_book THEN
      add_gl(c_loss, v_book - v_proceeds, 0);
    END IF;

    v_entry := erp_gl.post_entry(p_date, 'بيع/استبعاد أصل ' || v_a.code || ' — ' || v_a.name, 'FA-' || v_a.code, v_gl);
    UPDATE erp_assets
       SET status = 'DISPOSED', disposal_date = TRUNC(p_date), proceeds = v_proceeds, disposal_entry_id = v_entry
     WHERE asset_id = p_asset_id;
    RETURN v_entry;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_asset_dispose;
      RAISE;
  END dispose;

  PROCEDURE void_asset (p_asset_id IN NUMBER) IS
    v_a   erp_assets%ROWTYPE;
    v_tmp NUMBER;
  BEGIN
    SAVEPOINT erp_asset_void;
    BEGIN
      SELECT * INTO v_a FROM erp_assets WHERE asset_id = p_asset_id FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20403, 'الأصل رقم ' || p_asset_id || ' غير موجود');
    END;
    IF v_a.status <> 'ACTIVE' THEN
      RAISE_APPLICATION_ERROR(-20406, 'الأصل ' || v_a.code || ' ليس سارياً (الحالة ' || v_a.status || ')');
    END IF;
    SELECT COUNT(*) INTO v_tmp FROM erp_depreciation WHERE asset_id = p_asset_id AND status = 'OK';
    IF v_tmp > 0 THEN
      RAISE_APPLICATION_ERROR(-20406, 'الأصل ' || v_a.code || ' عليه إهلاك مسجّل: اعكس الإهلاك أولاً أو استخدم البيع');
    END IF;
    IF v_a.entry_id IS NOT NULL THEN
      v_tmp := erp_gl.reverse_entry(v_a.entry_id);
    END IF;
    UPDATE erp_assets SET status = 'VOID' WHERE asset_id = p_asset_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_asset_void;
      RAISE;
  END void_asset;

END erp_asset;
/
SHOW ERRORS PACKAGE BODY erp_asset
