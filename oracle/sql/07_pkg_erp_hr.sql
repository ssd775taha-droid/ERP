-- ============================================================================
-- 07: حزمة الموارد البشرية ERP_HR (تعتمد على ERP_GL)
-- الأقسام والموظفون وتاريخ الراتب ومكوّنات الراتب وتسويات الشهر والسلف.
-- لا COMMIT داخل الحزمة، وكل إجراء عام يتراجع إلى نقطة حفظ خاصة به عند الخطأ.
--
-- رموز الأخطاء:
--   -20501 بيانات موظف/قسم غير صالحة أو الرمز مكرر     -20504 بيانات سلفة/تسوية غير صالحة
--   -20502 موظف غير موجود                               -20505 الحالة لا تسمح بالعملية
--   -20503 مكوّن غير صالح أو غير موجود
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_hr AS
  FUNCTION add_department (p_code IN VARCHAR2, p_name IN VARCHAR2) RETURN NUMBER;

  -- يُنشئ الموظف مع أول راتب أساسي يسري من أول شهر التعيين
  FUNCTION add_employee (
    p_code         IN VARCHAR2,
    p_name         IN VARCHAR2,
    p_hire_date    IN DATE,
    p_basic_salary IN NUMBER,
    p_dept_id      IN NUMBER   DEFAULT NULL,
    p_job_title    IN VARCHAR2 DEFAULT NULL,
    p_national_id  IN VARCHAR2 DEFAULT NULL,
    p_bank_account IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER;

  -- الراتب الأساسي الساري في شهر (آخر تعديل بتاريخ سريان ≤ أول الشهر)
  FUNCTION salary_at (p_emp_id IN NUMBER, p_period IN DATE) RETURN NUMBER;

  -- تعديل راتب يسري من أول شهر p_effective_from. مرفوض بأثر رجعي على شهر رُحِّل كشفه.
  PROCEDURE set_salary (p_emp_id IN NUMBER, p_basic_salary IN NUMBER, p_effective_from IN DATE);

  -- إنهاء الخدمة بتاريخ؛ يُحتسب راتب الشهر الأخير بالتناسب. مرفوض إن سبق ترحيل كشف لشهر بعده.
  PROCEDURE terminate (p_emp_id IN NUMBER, p_term_date IN DATE);

  -- تعريف مكوّن راتب. الحسابات الافتراضية: استحقاق 5200، استقطاع 2400، تكلفة صاحب العمل 5210 مقابل 2400.
  FUNCTION add_component (
    p_code              IN VARCHAR2,
    p_name              IN VARCHAR2,
    p_kind              IN VARCHAR2,                -- EARNING | DEDUCTION | EMPLOYER
    p_calc_type         IN VARCHAR2,                -- FIXED | PCT
    p_pct               IN NUMBER   DEFAULT 0,      -- نسبة مئوية (للـ PCT)
    p_base_type         IN VARCHAR2 DEFAULT 'BASIC', -- BASIC | GROSS (الإجمالي = الأساسي + المكوّنات المستحقة)
    p_base_cap          IN NUMBER   DEFAULT NULL,   -- سقف وعاء النسبة شهرياً
    p_expense_account   IN VARCHAR2 DEFAULT NULL,
    p_liability_account IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER;

  -- ربط مكوّن بموظف. FIXED يلزمه p_amount. PCT يستخدم نسبة المكوّن ما لم تُعطَ p_pct (تتجاوزها لهذا الموظف).
  PROCEDURE assign_component (p_emp_id IN NUMBER, p_comp_id IN NUMBER, p_amount IN NUMBER DEFAULT NULL, p_pct IN NUMBER DEFAULT NULL);
  PROCEDURE unassign_component (p_emp_id IN NUMBER, p_comp_id IN NUMBER);

  -- تسوية شهرية: مكافأة/عمل إضافي (EARNING) أو جزاء/خصم (DEDUCTION). الحساب الافتراضي 5200.
  FUNCTION add_adjustment (
    p_emp_id      IN NUMBER,
    p_period      IN DATE,
    p_kind        IN VARCHAR2,
    p_description IN VARCHAR2,
    p_amount      IN NUMBER,
    p_account     IN VARCHAR2 DEFAULT '5200'
  ) RETURN NUMBER;
  PROCEDURE void_adjustment (p_adj_id IN NUMBER);

  -- سلفة موظف: قيد مدين 1350 / دائن الصندوق أو البنك، وتُقتطع أقساطاً شهرية في الكشوف من p_first_period
  FUNCTION grant_advance (
    p_emp_id       IN NUMBER,
    p_date         IN DATE,
    p_amount       IN NUMBER,
    p_installments IN NUMBER,
    p_first_period IN DATE,
    p_method       IN VARCHAR2,                    -- CASH | BANK
    p_note         IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER;
  -- إلغاء سلفة لم يُقتطع منها شيء (يعكس قيدها)
  PROCEDURE void_advance (p_adv_id IN NUMBER);
END erp_hr;
/

CREATE OR REPLACE PACKAGE BODY erp_hr AS

  c_cash CONSTANT VARCHAR2(12) := '1100';
  c_bank CONSTANT VARCHAR2(12) := '1200';
  c_adv  CONSTANT VARCHAR2(12) := '1350';

  FUNCTION get_emp (p_emp_id IN NUMBER) RETURN erp_employees%ROWTYPE IS
    v erp_employees%ROWTYPE;
  BEGIN
    SELECT * INTO v FROM erp_employees WHERE emp_id = p_emp_id;
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20502, 'الموظف رقم ' || p_emp_id || ' غير موجود');
  END get_emp;

  PROCEDURE expect_type (p_code IN VARCHAR2, p_expected IN VARCHAR2, p_label IN VARCHAR2) IS
    v_type erp_accounts.acc_type%TYPE;
  BEGIN
    SELECT acc_type INTO v_type FROM erp_accounts WHERE code = p_code;
    IF v_type <> p_expected THEN
      RAISE_APPLICATION_ERROR(-20503, 'حساب ' || p_label || ' (' || p_code || ') يجب أن يكون من نوع ' || p_expected);
    END IF;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20503, 'حساب ' || p_label || ' (' || p_code || ') غير موجود');
  END expect_type;

  FUNCTION add_department (p_code IN VARCHAR2, p_name IN VARCHAR2) RETURN NUMBER IS
    v_id erp_departments.dept_id%TYPE;
  BEGIN
    IF TRIM(p_code) IS NULL OR TRIM(p_name) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20501, 'رمز القسم واسمه مطلوبان');
    END IF;
    INSERT INTO erp_departments (code, name) VALUES (SUBSTR(TRIM(p_code), 1, 12), SUBSTR(TRIM(p_name), 1, 120))
    RETURNING dept_id INTO v_id;
    RETURN v_id;
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      RAISE_APPLICATION_ERROR(-20501, 'رمز القسم مستخدم');
  END add_department;

  FUNCTION add_employee (
    p_code         IN VARCHAR2,
    p_name         IN VARCHAR2,
    p_hire_date    IN DATE,
    p_basic_salary IN NUMBER,
    p_dept_id      IN NUMBER   DEFAULT NULL,
    p_job_title    IN VARCHAR2 DEFAULT NULL,
    p_national_id  IN VARCHAR2 DEFAULT NULL,
    p_bank_account IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER IS
    v_id erp_employees.emp_id%TYPE;
  BEGIN
    SAVEPOINT erp_hr_add_emp;
    IF TRIM(p_code) IS NULL OR TRIM(p_name) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20501, 'رمز الموظف واسمه مطلوبان');
    END IF;
    IF p_hire_date IS NULL THEN
      RAISE_APPLICATION_ERROR(-20501, 'تاريخ التعيين مطلوب');
    END IF;
    IF NVL(p_basic_salary, 0) <= 0 OR p_basic_salary <> ROUND(p_basic_salary, 2) THEN
      RAISE_APPLICATION_ERROR(-20501, 'الراتب الأساسي موجب وبمنزلتين عشريتين كحد أقصى');
    END IF;
    BEGIN
      INSERT INTO erp_employees (code, name, national_id, dept_id, job_title, hire_date, bank_account)
      VALUES (SUBSTR(TRIM(p_code), 1, 20), SUBSTR(TRIM(p_name), 1, 120), SUBSTR(p_national_id, 1, 30), p_dept_id,
              SUBSTR(p_job_title, 1, 80), TRUNC(p_hire_date), SUBSTR(p_bank_account, 1, 60))
      RETURNING emp_id INTO v_id;
    EXCEPTION
      WHEN DUP_VAL_ON_INDEX THEN
        RAISE_APPLICATION_ERROR(-20501, 'رمز الموظف مستخدم');
    END;
    INSERT INTO erp_salary_history (emp_id, effective_from, basic_salary)
    VALUES (v_id, TRUNC(p_hire_date, 'MM'), p_basic_salary);
    RETURN v_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_hr_add_emp;
      RAISE;
  END add_employee;

  FUNCTION salary_at (p_emp_id IN NUMBER, p_period IN DATE) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    SELECT basic_salary INTO v FROM erp_salary_history
     WHERE emp_id = p_emp_id
       AND effective_from = (SELECT MAX(effective_from) FROM erp_salary_history
                              WHERE emp_id = p_emp_id AND effective_from <= TRUNC(p_period, 'MM'));
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END salary_at;

  PROCEDURE set_salary (p_emp_id IN NUMBER, p_basic_salary IN NUMBER, p_effective_from IN DATE) IS
    v_emp erp_employees%ROWTYPE;
    v_eff DATE;
    v_n   NUMBER;
  BEGIN
    SAVEPOINT erp_hr_set_salary;
    v_emp := get_emp(p_emp_id);
    IF p_effective_from IS NULL THEN
      RAISE_APPLICATION_ERROR(-20501, 'تاريخ السريان مطلوب');
    END IF;
    IF NVL(p_basic_salary, 0) <= 0 OR p_basic_salary <> ROUND(p_basic_salary, 2) THEN
      RAISE_APPLICATION_ERROR(-20501, 'الراتب الأساسي موجب وبمنزلتين عشريتين كحد أقصى');
    END IF;
    v_eff := TRUNC(p_effective_from, 'MM');
    IF v_eff < TRUNC(v_emp.hire_date, 'MM') THEN
      RAISE_APPLICATION_ERROR(-20501, 'السريان قبل شهر التعيين');
    END IF;
    SELECT COUNT(*) INTO v_n FROM erp_payroll_runs WHERE status IN ('POSTED', 'PAID') AND period >= v_eff;
    IF v_n > 0 THEN
      RAISE_APPLICATION_ERROR(-20505, 'لا يُعدَّل الراتب بأثر رجعي على شهر رُحِّل كشفه');
    END IF;
    BEGIN
      INSERT INTO erp_salary_history (emp_id, effective_from, basic_salary) VALUES (p_emp_id, v_eff, p_basic_salary);
    EXCEPTION
      WHEN DUP_VAL_ON_INDEX THEN
        UPDATE erp_salary_history SET basic_salary = p_basic_salary WHERE emp_id = p_emp_id AND effective_from = v_eff;
    END;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_hr_set_salary;
      RAISE;
  END set_salary;

  PROCEDURE terminate (p_emp_id IN NUMBER, p_term_date IN DATE) IS
    v_emp erp_employees%ROWTYPE;
    v_n   NUMBER;
  BEGIN
    SAVEPOINT erp_hr_terminate;
    v_emp := get_emp(p_emp_id);
    IF v_emp.status <> 'ACTIVE' THEN
      RAISE_APPLICATION_ERROR(-20505, 'الموظف ' || v_emp.code || ' منتهي الخدمة مسبقاً');
    END IF;
    IF p_term_date IS NULL OR TRUNC(p_term_date) < v_emp.hire_date THEN
      RAISE_APPLICATION_ERROR(-20501, 'تاريخ إنهاء الخدمة غير صالح');
    END IF;
    SELECT COUNT(*) INTO v_n
      FROM erp_payroll_lines l JOIN erp_payroll_runs r ON r.run_id = l.run_id
     WHERE l.emp_id = p_emp_id AND r.status IN ('POSTED', 'PAID') AND r.period > TRUNC(p_term_date, 'MM');
    IF v_n > 0 THEN
      RAISE_APPLICATION_ERROR(-20505, 'رُحِّل كشف لشهر بعد تاريخ إنهاء الخدمة شمل الموظف');
    END IF;
    UPDATE erp_employees SET status = 'TERMINATED', term_date = TRUNC(p_term_date) WHERE emp_id = p_emp_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_hr_terminate;
      RAISE;
  END terminate;

  FUNCTION add_component (
    p_code              IN VARCHAR2,
    p_name              IN VARCHAR2,
    p_kind              IN VARCHAR2,
    p_calc_type         IN VARCHAR2,
    p_pct               IN NUMBER   DEFAULT 0,
    p_base_type         IN VARCHAR2 DEFAULT 'BASIC',
    p_base_cap          IN NUMBER   DEFAULT NULL,
    p_expense_account   IN VARCHAR2 DEFAULT NULL,
    p_liability_account IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER IS
    v_exp  VARCHAR2(12);
    v_liab VARCHAR2(12);
    v_id   erp_pay_components.comp_id%TYPE;
  BEGIN
    IF TRIM(p_code) IS NULL OR TRIM(p_name) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20503, 'رمز المكوّن واسمه مطلوبان');
    END IF;
    IF p_kind IS NULL OR p_kind NOT IN ('EARNING', 'DEDUCTION', 'EMPLOYER') THEN
      RAISE_APPLICATION_ERROR(-20503, 'نوع المكوّن: EARNING أو DEDUCTION أو EMPLOYER');
    END IF;
    IF p_calc_type IS NULL OR p_calc_type NOT IN ('FIXED', 'PCT') THEN
      RAISE_APPLICATION_ERROR(-20503, 'طريقة الحساب: FIXED أو PCT');
    END IF;
    IF p_base_type NOT IN ('BASIC', 'GROSS') THEN
      RAISE_APPLICATION_ERROR(-20503, 'وعاء النسبة: BASIC أو GROSS');
    END IF;
    IF p_kind = 'EARNING' AND p_base_type = 'GROSS' THEN
      RAISE_APPLICATION_ERROR(-20503, 'استحقاق النسبة يُحسب من الأساسي فقط');
    END IF;
    IF NVL(p_pct, 0) < 0 OR p_pct > 100 OR (p_calc_type = 'PCT' AND NVL(p_pct, 0) <= 0) THEN
      RAISE_APPLICATION_ERROR(-20503, 'النسبة بين 0 و100، وتلزم نسبة موجبة لمكوّن النسبة');
    END IF;
    IF p_base_cap IS NOT NULL AND (p_base_cap <= 0 OR p_base_cap <> ROUND(p_base_cap, 2)) THEN
      RAISE_APPLICATION_ERROR(-20503, 'سقف الوعاء غير صالح');
    END IF;

    IF p_kind = 'EARNING' THEN
      v_exp := NVL(p_expense_account, '5200');  v_liab := NULL;
    ELSIF p_kind = 'DEDUCTION' THEN
      v_exp := NULL;                            v_liab := NVL(p_liability_account, '2400');
    ELSE
      v_exp := NVL(p_expense_account, '5210');  v_liab := NVL(p_liability_account, '2400');
    END IF;
    IF v_exp  IS NOT NULL THEN expect_type(v_exp,  'EXPENSE',   'المصروف');  END IF;
    IF v_liab IS NOT NULL THEN expect_type(v_liab, 'LIABILITY', 'الالتزام'); END IF;

    INSERT INTO erp_pay_components (code, name, kind, calc_type, pct, base_type, base_cap, expense_account, liability_account)
    VALUES (SUBSTR(TRIM(p_code), 1, 20), SUBSTR(TRIM(p_name), 1, 120), p_kind, p_calc_type, NVL(p_pct, 0), p_base_type, p_base_cap, v_exp, v_liab)
    RETURNING comp_id INTO v_id;
    RETURN v_id;
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      RAISE_APPLICATION_ERROR(-20503, 'رمز المكوّن مستخدم');
  END add_component;

  PROCEDURE assign_component (p_emp_id IN NUMBER, p_comp_id IN NUMBER, p_amount IN NUMBER DEFAULT NULL, p_pct IN NUMBER DEFAULT NULL) IS
    v_emp  erp_employees%ROWTYPE;
    v_comp erp_pay_components%ROWTYPE;
  BEGIN
    SAVEPOINT erp_hr_assign;
    v_emp := get_emp(p_emp_id);
    BEGIN
      SELECT * INTO v_comp FROM erp_pay_components WHERE comp_id = p_comp_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20503, 'المكوّن رقم ' || p_comp_id || ' غير موجود');
    END;
    IF v_comp.active <> 'Y' THEN
      RAISE_APPLICATION_ERROR(-20503, 'المكوّن ' || v_comp.code || ' موقوف');
    END IF;
    IF v_comp.calc_type = 'FIXED' AND (NVL(p_amount, 0) <= 0 OR p_amount <> ROUND(p_amount, 2)) THEN
      RAISE_APPLICATION_ERROR(-20503, 'المكوّن الثابت يلزمه مبلغ موجب');
    END IF;
    IF v_comp.calc_type = 'PCT' AND p_pct IS NOT NULL AND (p_pct <= 0 OR p_pct > 100) THEN
      RAISE_APPLICATION_ERROR(-20503, 'النسبة بين 0 و100');
    END IF;
    UPDATE erp_emp_components
       SET amount = CASE v_comp.calc_type WHEN 'FIXED' THEN p_amount END,
           pct    = CASE v_comp.calc_type WHEN 'PCT' THEN p_pct END
     WHERE emp_id = p_emp_id AND comp_id = p_comp_id;
    IF SQL%ROWCOUNT = 0 THEN
      INSERT INTO erp_emp_components (emp_id, comp_id, amount, pct)
      VALUES (p_emp_id, p_comp_id, CASE v_comp.calc_type WHEN 'FIXED' THEN p_amount END, CASE v_comp.calc_type WHEN 'PCT' THEN p_pct END);
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_hr_assign;
      RAISE;
  END assign_component;

  PROCEDURE unassign_component (p_emp_id IN NUMBER, p_comp_id IN NUMBER) IS
  BEGIN
    DELETE FROM erp_emp_components WHERE emp_id = p_emp_id AND comp_id = p_comp_id;
  END unassign_component;

  FUNCTION add_adjustment (
    p_emp_id      IN NUMBER,
    p_period      IN DATE,
    p_kind        IN VARCHAR2,
    p_description IN VARCHAR2,
    p_amount      IN NUMBER,
    p_account     IN VARCHAR2 DEFAULT '5200'
  ) RETURN NUMBER IS
    v_emp  erp_employees%ROWTYPE;
    v_type erp_accounts.acc_type%TYPE;
    v_id   erp_pay_adjustments.adj_id%TYPE;
  BEGIN
    v_emp := get_emp(p_emp_id);
    IF p_period IS NULL OR p_kind IS NULL OR p_kind NOT IN ('EARNING', 'DEDUCTION') THEN
      RAISE_APPLICATION_ERROR(-20504, 'الفترة مطلوبة ونوع التسوية EARNING أو DEDUCTION');
    END IF;
    IF TRIM(p_description) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20504, 'وصف التسوية مطلوب');
    END IF;
    IF NVL(p_amount, 0) <= 0 OR p_amount <> ROUND(p_amount, 2) THEN
      RAISE_APPLICATION_ERROR(-20504, 'المبلغ موجب وبمنزلتين عشريتين كحد أقصى');
    END IF;
    BEGIN
      SELECT acc_type INTO v_type FROM erp_accounts WHERE code = p_account;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20504, 'الحساب ' || p_account || ' غير موجود');
    END;
    -- استحقاق: حساب مصروف. خصم: حساب مصروف (يخفضه) أو التزام (جهة خارجية)
    IF (p_kind = 'EARNING' AND v_type <> 'EXPENSE') OR (p_kind = 'DEDUCTION' AND v_type NOT IN ('EXPENSE', 'LIABILITY')) THEN
      RAISE_APPLICATION_ERROR(-20504, 'الحساب ' || p_account || ' لا يناسب نوع التسوية');
    END IF;
    INSERT INTO erp_pay_adjustments (emp_id, period, kind, description, amount, account_code)
    VALUES (p_emp_id, TRUNC(p_period, 'MM'), p_kind, SUBSTR(TRIM(p_description), 1, 200), p_amount, p_account)
    RETURNING adj_id INTO v_id;
    RETURN v_id;
  END add_adjustment;

  PROCEDURE void_adjustment (p_adj_id IN NUMBER) IS
    v_status erp_pay_adjustments.status%TYPE;
  BEGIN
    BEGIN
      SELECT status INTO v_status FROM erp_pay_adjustments WHERE adj_id = p_adj_id FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20504, 'التسوية رقم ' || p_adj_id || ' غير موجودة');
    END;
    IF v_status <> 'PENDING' THEN
      RAISE_APPLICATION_ERROR(-20505, 'لا تُلغى تسوية طُبِّقت في كشف: ألغِ الكشف أولاً');
    END IF;
    UPDATE erp_pay_adjustments SET status = 'VOID' WHERE adj_id = p_adj_id;
  END void_adjustment;

  FUNCTION grant_advance (
    p_emp_id       IN NUMBER,
    p_date         IN DATE,
    p_amount       IN NUMBER,
    p_installments IN NUMBER,
    p_first_period IN DATE,
    p_method       IN VARCHAR2,
    p_note         IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER IS
    v_emp   erp_employees%ROWTYPE;
    v_cash  VARCHAR2(12);
    v_entry NUMBER;
    v_id    erp_advances.adv_id%TYPE;
  BEGIN
    SAVEPOINT erp_hr_advance;
    v_emp := get_emp(p_emp_id);
    IF v_emp.status <> 'ACTIVE' THEN
      RAISE_APPLICATION_ERROR(-20505, 'لا تُمنح سلفة لموظف منتهي الخدمة');
    END IF;
    IF p_date IS NULL OR p_first_period IS NULL THEN
      RAISE_APPLICATION_ERROR(-20504, 'التاريخ وفترة أول قسط مطلوبان');
    END IF;
    IF NVL(p_amount, 0) <= 0 OR p_amount <> ROUND(p_amount, 2) THEN
      RAISE_APPLICATION_ERROR(-20504, 'مبلغ السلفة موجب وبمنزلتين عشريتين كحد أقصى');
    END IF;
    IF NVL(p_installments, 0) < 1 OR p_installments > 120 OR p_installments <> TRUNC(p_installments) THEN
      RAISE_APPLICATION_ERROR(-20504, 'عدد الأقساط بين 1 و120');
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('CASH', 'BANK') THEN
      RAISE_APPLICATION_ERROR(-20504, 'طريقة الصرف: CASH أو BANK');
    END IF;
    v_cash := CASE p_method WHEN 'CASH' THEN c_cash ELSE c_bank END;

    v_entry := erp_gl.post_entry(p_date, 'سلفة موظف ' || v_emp.code || ' — ' || v_emp.name, 'ADV-' || v_emp.code,
      erp_line_tab(erp_line_t(c_adv, p_amount, 0, NULL), erp_line_t(v_cash, 0, p_amount, NULL)));
    INSERT INTO erp_advances (emp_id, grant_date, amount, installments, first_period, entry_id, note)
    VALUES (p_emp_id, TRUNC(p_date), p_amount, p_installments, TRUNC(p_first_period, 'MM'), v_entry, SUBSTR(p_note, 1, 300))
    RETURNING adv_id INTO v_id;
    RETURN v_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_hr_advance;
      RAISE;
  END grant_advance;

  PROCEDURE void_advance (p_adv_id IN NUMBER) IS
    v_adv erp_advances%ROWTYPE;
    v_tmp NUMBER;
  BEGIN
    SAVEPOINT erp_hr_void_advance;
    BEGIN
      SELECT * INTO v_adv FROM erp_advances WHERE adv_id = p_adv_id FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20504, 'السلفة رقم ' || p_adv_id || ' غير موجودة');
    END;
    IF v_adv.status <> 'OPEN' OR v_adv.repaid > 0 OR v_adv.installments_done > 0 THEN
      RAISE_APPLICATION_ERROR(-20505, 'لا تُلغى سلفة اقتُطع منها أو سُوّيت');
    END IF;
    v_tmp := erp_gl.reverse_entry(v_adv.entry_id);
    UPDATE erp_advances SET status = 'VOID' WHERE adv_id = p_adv_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_hr_void_advance;
      RAISE;
  END void_advance;

END erp_hr;
/
SHOW ERRORS PACKAGE BODY erp_hr
