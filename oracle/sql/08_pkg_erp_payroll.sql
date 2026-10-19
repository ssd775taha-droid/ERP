-- ============================================================================
-- 08: حزمة الرواتب ERP_PAYROLL (تعتمد على ERP_GL وERP_HR)
-- دورة الكشف:  CREATE_RUN (حساب، DRAFT) → [CALCULATE_RUN لإعادة الحساب] → POST_RUN (قيد) → PAY_RUN (صرف)
--              ويمكن CANCEL_RUN لمسودة، وVOID_RUN لمرحَّل غير مصروف، وUNPAY_RUN لإلغاء صرف.
--
-- قواعد الحساب لكل موظف في شهر:
--   الأيام: من max(أول الشهر، التعيين) إلى min(آخر الشهر، إنهاء الخدمة). الأساسي والمبالغ الثابتة تُنسَب بالأيام ÷ أيام الشهر.
--   الإجمالي للأوعية = الأساسي + استحقاقات المكوّنات (دون تسويات الشهر). سقف الوعاء يُنسَب بالأيام أيضاً.
--   الصافي = الأساسي + الاستحقاقات (مكوّنات وتسويات) − الاستقطاعات − أقساط السلف. الصافي السالب يوقف الحساب برسالة.
--   حصة صاحب العمل لا تُخصم من الموظف.
-- القيد: مدين مصروف الأساسي والاستحقاقات وحصة صاحب العمل / دائن الاستقطاعات والتزامات صاحب العمل وأقساط السلف (1350)
--        ودائن 2300 رواتب مستحقة بإجمالي الصافي. حسابات الأطراف الخارجية (2400 وغيره) تُسدَّد بقيد يدوي لاحقاً.
--
-- رموز الأخطاء:
--   -20601 فترة غير صالحة أو لها كشف فعّال        -20604 لا موظفون مستحقون في الفترة
--   -20602 كشف غير موجود                           -20605 صافي راتب سالب (أو غير صالح)
--   -20603 حالة الكشف لا تسمح بالعملية             -20606 طريقة صرف غير صالحة
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_payroll AS
  -- ينشئ كشف DRAFT للشهر ويحسبه. يعيد رقمه.
  FUNCTION create_run (p_period IN DATE) RETURN NUMBER;
  -- يعيد الحساب (مسودة فقط): يلتقط التعديلات على الموظفين والمكوّنات والسلف والتسويات.
  PROCEDURE calculate_run (p_run_id IN NUMBER);
  PROCEDURE cancel_run (p_run_id IN NUMBER);
  -- يرحّل قيد الكشف ويثبّت أقساط السلف والتسويات. يعيد رقم القيد.
  FUNCTION post_run (p_run_id IN NUMBER) RETURN NUMBER;
  -- صرف الرواتب: مدين 2300 / دائن الصندوق أو البنك. يعيد رقم القيد.
  FUNCTION pay_run (p_run_id IN NUMBER, p_date IN DATE, p_method IN VARCHAR2) RETURN NUMBER;
  PROCEDURE unpay_run (p_run_id IN NUMBER);
  -- إلغاء كشف مرحَّل غير مصروف بقيد عكسي، وإعادة السلف والتسويات كما كانت.
  PROCEDURE void_run (p_run_id IN NUMBER);
END erp_payroll;
/

CREATE OR REPLACE PACKAGE BODY erp_payroll AS

  c_basic_acct CONSTANT VARCHAR2(12) := '5200';
  c_payable    CONSTANT VARCHAR2(12) := '2300';
  c_adv_acct   CONSTANT VARCHAR2(12) := '1350';
  c_cash       CONSTANT VARCHAR2(12) := '1100';
  c_bank       CONSTANT VARCHAR2(12) := '1200';

  FUNCTION lock_run (p_run_id IN NUMBER) RETURN erp_payroll_runs%ROWTYPE IS
    v erp_payroll_runs%ROWTYPE;
  BEGIN
    SELECT * INTO v FROM erp_payroll_runs WHERE run_id = p_run_id FOR UPDATE;
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20602, 'الكشف رقم ' || p_run_id || ' غير موجود');
  END lock_run;

  PROCEDURE calculate_run (p_run_id IN NUMBER) IS
    v_run erp_payroll_runs%ROWTYPE;
    v_p      DATE;
    v_days_in  NUMBER;
    v_start  DATE;
    v_end    DATE;
    v_worked NUMBER;
    v_factor NUMBER;
    v_salary NUMBER;
    v_basic  NUMBER;
    v_line   NUMBER;
    v_comp_earn NUMBER;
    v_base   NUMBER;
    v_cap    NUMBER;
    v_pct    NUMBER;
    v_amt    NUMBER;
    v_adj_earn NUMBER;
    v_ded    NUMBER;
    v_adv    NUMBER;
    v_emp_cost NUMBER;
    v_remaining NUMBER;
    v_inst   NUMBER;
    v_net    NUMBER;
    v_count  PLS_INTEGER := 0;
    v_t_gross NUMBER := 0; v_t_ded NUMBER := 0; v_t_net NUMBER := 0; v_t_emp NUMBER := 0;

    PROCEDURE add_item (
      p_kind IN VARCHAR2, p_comp IN NUMBER, p_adj IN NUMBER, p_adv IN NUMBER,
      p_desc IN VARCHAR2, p_amount IN NUMBER, p_exp IN VARCHAR2, p_liab IN VARCHAR2
    ) IS
    BEGIN
      INSERT INTO erp_payroll_items (line_id, kind, comp_id, adj_id, adv_id, description, amount, expense_account, liability_account)
      VALUES (v_line, p_kind, p_comp, p_adj, p_adv, SUBSTR(p_desc, 1, 200), p_amount, p_exp, p_liab);
    END add_item;
  BEGIN
    SAVEPOINT erp_payroll_calc;
    v_run := lock_run(p_run_id);
    IF v_run.status <> 'DRAFT' THEN
      RAISE_APPLICATION_ERROR(-20603, 'يُعاد حساب المسودات فقط (حالة الكشف ' || v_run.status || ')');
    END IF;
    v_p := v_run.period;
    v_days_in := EXTRACT(DAY FROM LAST_DAY(v_p));

    DELETE FROM erp_payroll_items WHERE line_id IN (SELECT line_id FROM erp_payroll_lines WHERE run_id = p_run_id);
    DELETE FROM erp_payroll_lines WHERE run_id = p_run_id;

    FOR e IN (SELECT * FROM erp_employees
               WHERE hire_date <= LAST_DAY(v_p) AND (term_date IS NULL OR term_date >= v_p)
               ORDER BY code) LOOP
      v_start  := GREATEST(v_p, e.hire_date);
      v_end    := LEAST(LAST_DAY(v_p), NVL(e.term_date, LAST_DAY(v_p)));
      v_worked := v_end - v_start + 1;
      v_factor := v_worked / v_days_in;
      v_salary := erp_hr.salary_at(e.emp_id, v_p);
      IF v_salary IS NULL THEN
        RAISE_APPLICATION_ERROR(-20605, 'لا راتب أساسي ساري للموظف ' || e.code || ' في ' || TO_CHAR(v_p, 'YYYY-MM'));
      END IF;
      v_basic := ROUND(v_salary * v_worked / v_days_in, 2);

      INSERT INTO erp_payroll_lines (run_id, emp_id, basic, days_worked, days_in_period)
      VALUES (p_run_id, e.emp_id, v_basic, v_worked, v_days_in)
      RETURNING line_id INTO v_line;
      add_item('BASIC', NULL, NULL, NULL, 'الراتب الأساسي', v_basic, c_basic_acct, NULL);

      v_comp_earn := 0; v_adj_earn := 0; v_ded := 0; v_adv := 0; v_emp_cost := 0;

      -- مكوّنات الموظف: الاستحقاقات أولاً ثم الاستقطاعات وحصة صاحب العمل (لأن وعاءها قد يكون الإجمالي)
      FOR c IN (SELECT m.*, ec.amount AS ec_amount, ec.pct AS ec_pct
                  FROM erp_emp_components ec
                  JOIN erp_pay_components m ON m.comp_id = ec.comp_id
                 WHERE ec.emp_id = e.emp_id AND m.active = 'Y'
                 ORDER BY CASE m.kind WHEN 'EARNING' THEN 1 ELSE 2 END, m.code) LOOP
        IF c.calc_type = 'FIXED' THEN
          v_amt := ROUND(NVL(c.ec_amount, 0) * v_factor, 2);
        ELSE
          v_pct  := NVL(c.ec_pct, c.pct);
          v_base := CASE c.base_type WHEN 'GROSS' THEN v_basic + v_comp_earn ELSE v_basic END;
          IF c.base_cap IS NOT NULL THEN
            v_cap  := ROUND(c.base_cap * v_factor, 2);
            v_base := LEAST(v_base, v_cap);
          END IF;
          v_amt := ROUND(v_base * v_pct / 100, 2);
        END IF;
        IF v_amt > 0 THEN
          IF c.kind = 'EARNING' THEN
            add_item('EARNING', c.comp_id, NULL, NULL, c.name, v_amt, c.expense_account, NULL);
            v_comp_earn := v_comp_earn + v_amt;
          ELSIF c.kind = 'DEDUCTION' THEN
            add_item('DEDUCTION', c.comp_id, NULL, NULL, c.name, v_amt, NULL, c.liability_account);
            v_ded := v_ded + v_amt;
          ELSE
            add_item('EMPLOYER', c.comp_id, NULL, NULL, c.name, v_amt, c.expense_account, c.liability_account);
            v_emp_cost := v_emp_cost + v_amt;
          END IF;
        END IF;
      END LOOP;

      -- تسويات الشهر المعلّقة (فترتها ≤ شهر الكشف)
      FOR a IN (SELECT * FROM erp_pay_adjustments
                 WHERE emp_id = e.emp_id AND status = 'PENDING' AND period <= v_p ORDER BY adj_id) LOOP
        IF a.kind = 'EARNING' THEN
          add_item('EARNING', NULL, a.adj_id, NULL, a.description, a.amount, a.account_code, NULL);
          v_adj_earn := v_adj_earn + a.amount;
        ELSE
          add_item('DEDUCTION', NULL, a.adj_id, NULL, a.description, a.amount, NULL, a.account_code);
          v_ded := v_ded + a.amount;
        END IF;
      END LOOP;

      -- أقساط السلف المفتوحة التي حلّ موعدها
      FOR s IN (SELECT * FROM erp_advances
                 WHERE emp_id = e.emp_id AND status = 'OPEN' AND first_period <= v_p ORDER BY adv_id) LOOP
        v_remaining := s.amount - s.repaid;
        IF s.installments_done + 1 >= s.installments THEN
          v_inst := v_remaining;                                         -- القسط الأخير: المتبقي بالضبط
        ELSE
          v_inst := LEAST(ROUND(s.amount / s.installments, 2), v_remaining);
        END IF;
        IF v_inst > 0 THEN
          add_item('ADVANCE', NULL, NULL, s.adv_id, 'قسط سلفة ' || TO_CHAR(s.installments_done + 1) || '/' || TO_CHAR(s.installments), v_inst, NULL, c_adv_acct);
          v_adv := v_adv + v_inst;
        END IF;
      END LOOP;

      v_net := v_basic + v_comp_earn + v_adj_earn - v_ded - v_adv;
      IF v_net < 0 THEN
        RAISE_APPLICATION_ERROR(-20605, 'صافي الراتب سالب للموظف ' || e.code || ' (' || TO_CHAR(v_net) || '): راجع الاستقطاعات والسلف');
      END IF;

      UPDATE erp_payroll_lines
         SET earnings = v_comp_earn + v_adj_earn, gross = v_basic + v_comp_earn + v_adj_earn,
             deductions = v_ded, advance_deduction = v_adv, net = v_net, employer_cost = v_emp_cost
       WHERE line_id = v_line;

      v_count   := v_count + 1;
      v_t_gross := v_t_gross + v_basic + v_comp_earn + v_adj_earn;
      v_t_ded   := v_t_ded + v_ded + v_adv;
      v_t_net   := v_t_net + v_net;
      v_t_emp   := v_t_emp + v_emp_cost;
    END LOOP;

    IF v_count = 0 THEN
      RAISE_APPLICATION_ERROR(-20604, 'لا موظفون مستحقون في شهر ' || TO_CHAR(v_p, 'YYYY-MM'));
    END IF;
    UPDATE erp_payroll_runs
       SET total_gross = v_t_gross, total_deductions = v_t_ded, total_net = v_t_net, total_employer = v_t_emp
     WHERE run_id = p_run_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_payroll_calc;
      RAISE;
  END calculate_run;

  FUNCTION create_run (p_period IN DATE) RETURN NUMBER IS
    v_id erp_payroll_runs.run_id%TYPE;
  BEGIN
    SAVEPOINT erp_payroll_create;
    IF p_period IS NULL THEN
      RAISE_APPLICATION_ERROR(-20601, 'شهر الكشف مطلوب');
    END IF;
    BEGIN
      INSERT INTO erp_payroll_runs (period) VALUES (TRUNC(p_period, 'MM')) RETURNING run_id INTO v_id;
    EXCEPTION
      WHEN DUP_VAL_ON_INDEX THEN
        RAISE_APPLICATION_ERROR(-20601, 'يوجد كشف فعّال لشهر ' || TO_CHAR(p_period, 'YYYY-MM') || ': ألغِه أو أعد حسابه');
    END;
    calculate_run(v_id);
    RETURN v_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_payroll_create;
      RAISE;
  END create_run;

  PROCEDURE cancel_run (p_run_id IN NUMBER) IS
    v_run erp_payroll_runs%ROWTYPE;
  BEGIN
    v_run := lock_run(p_run_id);
    IF v_run.status <> 'DRAFT' THEN
      RAISE_APPLICATION_ERROR(-20603, 'تُلغى المسودات فقط (حالة الكشف ' || v_run.status || ')');
    END IF;
    UPDATE erp_payroll_runs SET status = 'CANCELLED' WHERE run_id = p_run_id;
  END cancel_run;

  FUNCTION post_run (p_run_id IN NUMBER) RETURN NUMBER IS
    v_run   erp_payroll_runs%ROWTYPE;
    v_adv   erp_advances%ROWTYPE;
    v_gl    erp_line_tab := erp_line_tab();
    v_entry NUMBER;
    v_n     NUMBER;
  BEGIN
    SAVEPOINT erp_payroll_post;
    v_run := lock_run(p_run_id);
    IF v_run.status <> 'DRAFT' THEN
      RAISE_APPLICATION_ERROR(-20603, 'يُرحَّل الكشف مرة واحدة من حالة DRAFT (الحالة ' || v_run.status || ')');
    END IF;
    SELECT COUNT(*) INTO v_n FROM erp_payroll_lines WHERE run_id = p_run_id;
    IF v_n = 0 OR v_run.total_net <= 0 THEN
      RAISE_APPLICATION_ERROR(-20604, 'الكشف فارغ: أعد الحساب');
    END IF;

    -- تحقق من أن السلف والتسويات لم تتغير منذ الحساب (كشف آخر رُحِّل مثلاً)
    FOR it IN (SELECT i.adv_id, i.adj_id, i.amount FROM erp_payroll_items i
                 JOIN erp_payroll_lines l ON l.line_id = i.line_id
                WHERE l.run_id = p_run_id AND (i.adv_id IS NOT NULL OR i.adj_id IS NOT NULL)) LOOP
      IF it.adv_id IS NOT NULL THEN
        SELECT * INTO v_adv FROM erp_advances WHERE adv_id = it.adv_id FOR UPDATE;
        IF v_adv.status <> 'OPEN' OR v_adv.repaid + it.amount > v_adv.amount THEN
          RAISE_APPLICATION_ERROR(-20603, 'تغيّرت السلفة رقم ' || it.adv_id || ' منذ الحساب: أعد حساب الكشف');
        END IF;
        UPDATE erp_advances
           SET repaid = repaid + it.amount,
               installments_done = installments_done + 1,
               status = CASE WHEN repaid + it.amount >= amount THEN 'SETTLED' ELSE 'OPEN' END
         WHERE adv_id = it.adv_id;
      ELSE
        UPDATE erp_pay_adjustments SET status = 'APPLIED', run_id = p_run_id WHERE adj_id = it.adj_id AND status = 'PENDING';
        IF SQL%ROWCOUNT = 0 THEN
          RAISE_APPLICATION_ERROR(-20603, 'تغيّرت التسوية رقم ' || it.adj_id || ' منذ الحساب: أعد حساب الكشف');
        END IF;
      END IF;
    END LOOP;

    -- القيد: صافي كل حساب من البنود (المدين − الدائن)، ثم دائن 2300 بإجمالي الصافي
    FOR r IN (
      SELECT account, SUM(d) - SUM(c) AS net_amount FROM (
        SELECT i.expense_account AS account, i.amount AS d, 0 AS c
          FROM erp_payroll_items i JOIN erp_payroll_lines l ON l.line_id = i.line_id
         WHERE l.run_id = p_run_id AND i.kind IN ('BASIC', 'EARNING', 'EMPLOYER')
        UNION ALL
        SELECT i.liability_account, 0, i.amount
          FROM erp_payroll_items i JOIN erp_payroll_lines l ON l.line_id = i.line_id
         WHERE l.run_id = p_run_id AND i.kind IN ('DEDUCTION', 'EMPLOYER', 'ADVANCE')
      ) GROUP BY account HAVING SUM(d) - SUM(c) <> 0 ORDER BY account
    ) LOOP
      v_gl.EXTEND;
      v_gl(v_gl.COUNT) := CASE WHEN r.net_amount > 0 THEN erp_line_t(r.account, r.net_amount, 0, NULL)
                               ELSE erp_line_t(r.account, 0, -r.net_amount, NULL) END;
    END LOOP;
    v_gl.EXTEND;
    v_gl(v_gl.COUNT) := erp_line_t(c_payable, 0, v_run.total_net, NULL);

    v_entry := erp_gl.post_entry(LAST_DAY(v_run.period), 'رواتب شهر ' || TO_CHAR(v_run.period, 'YYYY-MM'),
                                 'PAY-' || TO_CHAR(v_run.period, 'YYYYMM'), v_gl);
    UPDATE erp_payroll_runs SET status = 'POSTED', entry_id = v_entry WHERE run_id = p_run_id;
    RETURN v_entry;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_payroll_post;
      RAISE;
  END post_run;

  FUNCTION pay_run (p_run_id IN NUMBER, p_date IN DATE, p_method IN VARCHAR2) RETURN NUMBER IS
    v_run   erp_payroll_runs%ROWTYPE;
    v_cash  VARCHAR2(12);
    v_entry NUMBER;
  BEGIN
    SAVEPOINT erp_payroll_pay;
    v_run := lock_run(p_run_id);
    IF v_run.status <> 'POSTED' THEN
      RAISE_APPLICATION_ERROR(-20603, 'يُصرف الكشف المرحَّل غير المصروف فقط (الحالة ' || v_run.status || ')');
    END IF;
    IF p_date IS NULL THEN
      RAISE_APPLICATION_ERROR(-20601, 'تاريخ الصرف مطلوب');
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('CASH', 'BANK') THEN
      RAISE_APPLICATION_ERROR(-20606, 'طريقة الصرف: CASH أو BANK');
    END IF;
    v_cash := CASE p_method WHEN 'CASH' THEN c_cash ELSE c_bank END;
    v_entry := erp_gl.post_entry(p_date, 'صرف رواتب شهر ' || TO_CHAR(v_run.period, 'YYYY-MM'),
                                 'PAY-' || TO_CHAR(v_run.period, 'YYYYMM'),
      erp_line_tab(erp_line_t(c_payable, v_run.total_net, 0, NULL), erp_line_t(v_cash, 0, v_run.total_net, NULL)));
    UPDATE erp_payroll_runs SET status = 'PAID', pay_entry_id = v_entry, pay_date = TRUNC(p_date), pay_method = p_method
     WHERE run_id = p_run_id;
    RETURN v_entry;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_payroll_pay;
      RAISE;
  END pay_run;

  PROCEDURE unpay_run (p_run_id IN NUMBER) IS
    v_run erp_payroll_runs%ROWTYPE;
    v_tmp NUMBER;
  BEGIN
    SAVEPOINT erp_payroll_unpay;
    v_run := lock_run(p_run_id);
    IF v_run.status <> 'PAID' THEN
      RAISE_APPLICATION_ERROR(-20603, 'الكشف غير مصروف (الحالة ' || v_run.status || ')');
    END IF;
    v_tmp := erp_gl.reverse_entry(v_run.pay_entry_id);
    UPDATE erp_payroll_runs SET status = 'POSTED', pay_entry_id = NULL, pay_date = NULL, pay_method = NULL WHERE run_id = p_run_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_payroll_unpay;
      RAISE;
  END unpay_run;

  PROCEDURE void_run (p_run_id IN NUMBER) IS
    v_run erp_payroll_runs%ROWTYPE;
    v_tmp NUMBER;
  BEGIN
    SAVEPOINT erp_payroll_void;
    v_run := lock_run(p_run_id);
    IF v_run.status = 'PAID' THEN
      RAISE_APPLICATION_ERROR(-20603, 'الكشف مصروف: ألغِ الصرف أولاً (UNPAY_RUN)');
    END IF;
    IF v_run.status <> 'POSTED' THEN
      RAISE_APPLICATION_ERROR(-20603, 'يُلغى الكشف المرحَّل فقط (الحالة ' || v_run.status || ')');
    END IF;
    v_tmp := erp_gl.reverse_entry(v_run.entry_id);

    -- إعادة السلف: القسط يعود، والسلفة تفتح من جديد إن كانت قد سُوّيت به
    FOR it IN (SELECT i.adv_id, i.amount FROM erp_payroll_items i JOIN erp_payroll_lines l ON l.line_id = i.line_id
                WHERE l.run_id = p_run_id AND i.adv_id IS NOT NULL) LOOP
      UPDATE erp_advances
         SET repaid = repaid - it.amount, installments_done = installments_done - 1, status = 'OPEN'
       WHERE adv_id = it.adv_id AND status <> 'VOID';
    END LOOP;
    UPDATE erp_pay_adjustments SET status = 'PENDING', run_id = NULL WHERE run_id = p_run_id AND status = 'APPLIED';
    UPDATE erp_payroll_runs SET status = 'VOID' WHERE run_id = p_run_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_payroll_void;
      RAISE;
  END void_run;

END erp_payroll;
/
SHOW ERRORS PACKAGE BODY erp_payroll
