-- ============================================================================
-- 11: حزمة نقاط البيع ERP_POS (تعتمد على ERP_GL وERP_STOCK)
-- نقطة البيع (Register) مرتبطة بمخزن، وتعمل بورديات (Shift): وردية مفتوحة واحدة لكل نقطة.
-- بيع نقدي أو ببطاقة أو بالاثنين معاً، بالباقي للعميل من النقد، ولا ذمم عملاء في نقطة البيع.
--
-- قيد البيع (واحد لكل عملية): مدين نقد النقطة (المستلم − الباقي) ومدين البنك 1200 (البطاقة) / دائن إيراد كل صنف
--   (حساب إيراد الصنف) ودائن 2200 الضريبة. وبند مخزني يحرّك المخزون من مخزن النقطة بتكلفة المتوسط ويرحّل قيداً ثانياً
--   لتكلفة المبيعات (مدين تكلفة الصنف / دائن مخزونه). كل شيء بمعاملة واحدة بلا COMMIT داخل الحزمة.
-- التسعير: إن كانت prices_include_vat = 'Y' فسعر البند شامل الضريبة (الضريبة = المبلغ × نسبة ÷ (100 + نسبة))،
--   وإلا فالسعر قبل الضريبة. الخصم نسبة مئوية على البند.
-- المرتجع: من بيع أصلي مكتمل، ببنود وكميات بحد ما بيع ولم يُرجَع (والمبالغ تُنسَب إلى البند الأصلي، والمرتجع الأخير للبند
--   يأخذ المتبقي بالضبط)، ويعيد البضاعة بتكلفتها الأصلية، ويُردّ المبلغ نقداً أو بالبطاقة في الوردية الحالية.
-- الإلغاء (VOID): لبيع أو مرتجع في وردية ما زالت مفتوحة، ولا لبيع له مرتجعات سارية.
-- إقفال الوردية: المتوقع في الصندوق = الافتتاحي + النقد الصافي من المبيعات − النقد المردود. الفرق عن المعدود
--   يُرحَّل إلى 5800 فروقات الصندوق (عجز: مدين 5800 / زيادة: دائن 5800).
--
-- رموز الأخطاء:
--   -20801 نقطة بيع/مدخلات غير صالحة          -20806 لا يمكن الإلغاء (ليس مكتملاً أو له مرتجعات)
--   -20802 وردية مفتوحة مسبقاً لهذه النقطة     -20807 الوردية مغلقة (لا إلغاء بعد إقفالها)
--   -20803 الوردية غير مفتوحة أو غير موجودة    -20808 البيع غير موجود
--   -20804 دفعات غير صالحة (أقل من الإجمالي أو الباقي أكبر من النقد)
--   -20805 بند غير صالح أو كمية مرتجع تتجاوز المتاح
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_pos AS
  FUNCTION add_register (
    p_code               IN VARCHAR2,
    p_name               IN VARCHAR2,
    p_wh_id              IN NUMBER,
    p_cash_account       IN VARCHAR2 DEFAULT '1100',
    p_prices_include_vat IN VARCHAR2 DEFAULT 'N'
  ) RETURN NUMBER;

  -- رقم الصنف من الباركود أو الرمز (الباركود أولاً). NULL إن لم يوجد.
  FUNCTION find_item (p_code IN VARCHAR2) RETURN NUMBER;

  FUNCTION open_shift (p_reg_id IN NUMBER, p_opening_cash IN NUMBER DEFAULT 0, p_time IN TIMESTAMP DEFAULT SYSTIMESTAMP) RETURN NUMBER;
  -- النقد المتوقع الآن في الصندوق للوردية
  FUNCTION expected_cash (p_shift_id IN NUMBER) RETURN NUMBER;
  -- يعيد الفرق (المعدود − المتوقع). يرحّل قيد الفرق إن لم يكن صفراً.
  FUNCTION close_shift (p_shift_id IN NUMBER, p_counted_cash IN NUMBER, p_time IN TIMESTAMP DEFAULT SYSTIMESTAMP) RETURN NUMBER;

  FUNCTION sell (
    p_shift_id IN NUMBER,
    p_date     IN DATE,
    p_lines    IN erp_pos_line_tab,
    p_payments IN erp_pos_pay_tab
  ) RETURN NUMBER;

  FUNCTION return_sale (
    p_shift_id     IN NUMBER,
    p_date         IN DATE,
    p_orig_sale_id IN NUMBER,
    p_lines        IN erp_pos_ret_tab,
    p_method       IN VARCHAR2              -- CASH | CARD (طريقة رد المبلغ)
  ) RETURN NUMBER;

  PROCEDURE void_sale (p_sale_id IN NUMBER);
END erp_pos;
/

CREATE OR REPLACE PACKAGE BODY erp_pos AS

  c_bank     CONSTANT VARCHAR2(12) := '1200';
  c_vat      CONSTANT VARCHAR2(12) := '2200';
  c_variance CONSTANT VARCHAR2(12) := '5800';

  TYPE t_amt  IS TABLE OF NUMBER       INDEX BY VARCHAR2(12);
  TYPE t_nums IS TABLE OF NUMBER       INDEX BY PLS_INTEGER;
  TYPE t_strs IS TABLE OF VARCHAR2(12) INDEX BY PLS_INTEGER;

  PROCEDURE bump (p_map IN OUT NOCOPY t_amt, p_key IN VARCHAR2, p_amount IN NUMBER) IS
  BEGIN
    IF p_map.EXISTS(p_key) THEN p_map(p_key) := p_map(p_key) + p_amount; ELSE p_map(p_key) := p_amount; END IF;
  END bump;

  FUNCTION get_reg (p_reg_id IN NUMBER) RETURN erp_pos_registers%ROWTYPE IS
    v erp_pos_registers%ROWTYPE;
  BEGIN
    SELECT * INTO v FROM erp_pos_registers WHERE reg_id = p_reg_id;
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20801, 'نقطة البيع رقم ' || p_reg_id || ' غير موجودة');
  END get_reg;

  -- الوردية المفتوحة (أو يرفع -20803)
  FUNCTION open_shift_row (p_shift_id IN NUMBER, p_lock IN BOOLEAN DEFAULT FALSE) RETURN erp_pos_shifts%ROWTYPE IS
    v erp_pos_shifts%ROWTYPE;
  BEGIN
    IF p_lock THEN
      SELECT * INTO v FROM erp_pos_shifts WHERE shift_id = p_shift_id FOR UPDATE;
    ELSE
      SELECT * INTO v FROM erp_pos_shifts WHERE shift_id = p_shift_id;
    END IF;
    IF v.status <> 'OPEN' THEN
      RAISE_APPLICATION_ERROR(-20803, 'الوردية رقم ' || p_shift_id || ' ليست مفتوحة');
    END IF;
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20803, 'الوردية رقم ' || p_shift_id || ' غير موجودة');
  END open_shift_row;

  FUNCTION add_register (
    p_code               IN VARCHAR2,
    p_name               IN VARCHAR2,
    p_wh_id              IN NUMBER,
    p_cash_account       IN VARCHAR2 DEFAULT '1100',
    p_prices_include_vat IN VARCHAR2 DEFAULT 'N'
  ) RETURN NUMBER IS
    v_id   erp_pos_registers.reg_id%TYPE;
    v_cash erp_accounts.cash_account%TYPE;
    v_type erp_accounts.acc_type%TYPE;
  BEGIN
    IF TRIM(p_code) IS NULL OR TRIM(p_name) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20801, 'رمز نقطة البيع واسمها مطلوبان');
    END IF;
    IF p_prices_include_vat NOT IN ('Y', 'N') THEN
      RAISE_APPLICATION_ERROR(-20801, 'الأسعار شاملة الضريبة: Y أو N');
    END IF;
    BEGIN
      SELECT acc_type, cash_account INTO v_type, v_cash FROM erp_accounts WHERE code = p_cash_account;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20801, 'حساب الصندوق ' || p_cash_account || ' غير موجود');
    END;
    -- يجب أن يكون حساب نقد مُصنَّفاً ليظهر في قائمة التدفقات النقدية
    IF v_type <> 'ASSET' OR v_cash <> 'Y' THEN
      RAISE_APPLICATION_ERROR(-20801, 'حساب الصندوق ' || p_cash_account || ' يجب أن يكون أصلاً مصنَّفاً كحساب نقد');
    END IF;
    BEGIN
      INSERT INTO erp_pos_registers (code, name, wh_id, cash_account, prices_include_vat)
      VALUES (SUBSTR(TRIM(p_code), 1, 12), SUBSTR(TRIM(p_name), 1, 120), p_wh_id, p_cash_account, p_prices_include_vat)
      RETURNING reg_id INTO v_id;
    EXCEPTION
      WHEN DUP_VAL_ON_INDEX THEN
        RAISE_APPLICATION_ERROR(-20801, 'رمز نقطة البيع مستخدم');
    END;
    RETURN v_id;
  END add_register;

  FUNCTION find_item (p_code IN VARCHAR2) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    BEGIN
      SELECT item_id INTO v FROM erp_items WHERE barcode = TRIM(p_code) AND active = 'Y';
      RETURN v;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN NULL;
    END;
    SELECT item_id INTO v FROM erp_items WHERE code = TRIM(p_code) AND active = 'Y';
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END find_item;

  FUNCTION open_shift (p_reg_id IN NUMBER, p_opening_cash IN NUMBER DEFAULT 0, p_time IN TIMESTAMP DEFAULT SYSTIMESTAMP) RETURN NUMBER IS
    v_reg erp_pos_registers%ROWTYPE;
    v_id  erp_pos_shifts.shift_id%TYPE;
  BEGIN
    v_reg := get_reg(p_reg_id);
    IF v_reg.active <> 'Y' THEN
      RAISE_APPLICATION_ERROR(-20801, 'نقطة البيع ' || v_reg.code || ' موقوفة');
    END IF;
    IF NVL(p_opening_cash, 0) < 0 OR NVL(p_opening_cash, 0) <> ROUND(NVL(p_opening_cash, 0), 2) THEN
      RAISE_APPLICATION_ERROR(-20801, 'النقد الافتتاحي غير صالح');
    END IF;
    BEGIN
      INSERT INTO erp_pos_shifts (reg_id, opened_at, opening_cash) VALUES (p_reg_id, NVL(p_time, SYSTIMESTAMP), NVL(p_opening_cash, 0))
      RETURNING shift_id INTO v_id;
    EXCEPTION
      WHEN DUP_VAL_ON_INDEX THEN
        RAISE_APPLICATION_ERROR(-20802, 'توجد وردية مفتوحة لنقطة البيع ' || v_reg.code || ': أقفلها أولاً');
    END;
    RETURN v_id;
  END open_shift;

  FUNCTION expected_cash (p_shift_id IN NUMBER) RETURN NUMBER IS
    v_open NUMBER;
    v_in   NUMBER;
    v_out  NUMBER;
  BEGIN
    BEGIN
      SELECT opening_cash INTO v_open FROM erp_pos_shifts WHERE shift_id = p_shift_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20803, 'الوردية رقم ' || p_shift_id || ' غير موجودة');
    END;
    -- النقد الصافي من المبيعات: النقد المستلم − الباقي
    SELECT NVL(SUM(NVL((SELECT SUM(p.amount) FROM erp_pos_payments p WHERE p.sale_id = s.sale_id AND p.method = 'CASH'), 0) - s.change_due), 0)
      INTO v_in
      FROM erp_pos_sales s WHERE s.shift_id = p_shift_id AND s.kind = 'SALE' AND s.status = 'COMPLETED';
    SELECT NVL(SUM(NVL((SELECT SUM(p.amount) FROM erp_pos_payments p WHERE p.sale_id = s.sale_id AND p.method = 'CASH'), 0)), 0)
      INTO v_out
      FROM erp_pos_sales s WHERE s.shift_id = p_shift_id AND s.kind = 'RETURN' AND s.status = 'COMPLETED';
    RETURN v_open + v_in - v_out;
  END expected_cash;

  FUNCTION close_shift (p_shift_id IN NUMBER, p_counted_cash IN NUMBER, p_time IN TIMESTAMP DEFAULT SYSTIMESTAMP) RETURN NUMBER IS
    v_shift    erp_pos_shifts%ROWTYPE;
    v_reg      erp_pos_registers%ROWTYPE;
    v_expected NUMBER;
    v_var      NUMBER;
    v_entry    NUMBER;
    v_date     DATE := TRUNC(CAST(NVL(p_time, SYSTIMESTAMP) AS DATE));
  BEGIN
    SAVEPOINT erp_pos_close;
    v_shift := open_shift_row(p_shift_id, TRUE);
    IF NVL(p_counted_cash, -1) < 0 OR p_counted_cash <> ROUND(p_counted_cash, 2) THEN
      RAISE_APPLICATION_ERROR(-20801, 'النقد المعدود غير صالح');
    END IF;
    v_reg := get_reg(v_shift.reg_id);
    v_expected := expected_cash(p_shift_id);
    v_var := p_counted_cash - v_expected;
    IF v_var < 0 THEN
      v_entry := erp_gl.post_entry(v_date, 'عجز صندوق وردية ' || p_shift_id, 'SHIFT-' || p_shift_id,
        erp_line_tab(erp_line_t(c_variance, -v_var, 0, NULL), erp_line_t(v_reg.cash_account, 0, -v_var, NULL)));
    ELSIF v_var > 0 THEN
      v_entry := erp_gl.post_entry(v_date, 'زيادة صندوق وردية ' || p_shift_id, 'SHIFT-' || p_shift_id,
        erp_line_tab(erp_line_t(v_reg.cash_account, v_var, 0, NULL), erp_line_t(c_variance, 0, v_var, NULL)));
    END IF;
    UPDATE erp_pos_shifts
       SET status = 'CLOSED', closed_at = NVL(p_time, SYSTIMESTAMP), expected_cash = v_expected,
           counted_cash = p_counted_cash, variance = v_var, variance_entry_id = v_entry
     WHERE shift_id = p_shift_id;
    RETURN v_var;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_pos_close;
      RAISE;
  END close_shift;

  FUNCTION sell (
    p_shift_id IN NUMBER,
    p_date     IN DATE,
    p_lines    IN erp_pos_line_tab,
    p_payments IN erp_pos_pay_tab
  ) RETURN NUMBER IS
    v_shift  erp_pos_shifts%ROWTYPE;
    v_reg    erp_pos_registers%ROWTYPE;
    v_item   erp_items%ROWTYPE;
    v_date   DATE := TRUNC(NVL(p_date, SYSDATE));
    v_rev    t_amt;  v_cogs t_amt;  v_inv t_amt;
    v_it     t_nums; v_net t_nums; v_vat t_nums; v_price t_nums; v_disc t_nums; v_rate t_nums; v_cost t_nums;
    v_rev_acct t_strs;
    v_gross  NUMBER; v_p NUMBER; v_d NUMBER; v_r NUMBER;
    v_sub    NUMBER := 0; v_vat_sum NUMBER := 0; v_total NUMBER;
    v_cash_t NUMBER := 0; v_card_t NUMBER := 0; v_tender NUMBER; v_change NUMBER; v_cash_net NUMBER;
    v_cogs_sum NUMBER := 0;
    v_gl     erp_line_tab := erp_line_tab();
    v_no     NUMBER; v_number VARCHAR2(20);
    v_entry  NUMBER; v_cogs_ent NUMBER; v_id NUMBER;
    v_code   VARCHAR2(12);

    PROCEDURE add_gl (p_account IN VARCHAR2, p_debit IN NUMBER, p_credit IN NUMBER) IS
    BEGIN
      v_gl.EXTEND;
      v_gl(v_gl.COUNT) := erp_line_t(p_account, p_debit, p_credit, NULL);
    END add_gl;
  BEGIN
    SAVEPOINT erp_pos_sell;
    v_shift := open_shift_row(p_shift_id);
    v_reg   := get_reg(v_shift.reg_id);
    IF p_lines IS NULL OR p_lines.COUNT = 0 THEN
      RAISE_APPLICATION_ERROR(-20805, 'السلة فارغة');
    END IF;
    IF p_payments IS NULL OR p_payments.COUNT = 0 THEN
      RAISE_APPLICATION_ERROR(-20804, 'لا توجد دفعات');
    END IF;

    FOR i IN 1 .. p_lines.COUNT LOOP
      BEGIN
        SELECT * INTO v_item FROM erp_items WHERE item_id = p_lines(i).item_id;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          RAISE_APPLICATION_ERROR(-20805, 'البند ' || i || ': الصنف غير موجود');
      END;
      IF v_item.active <> 'Y' THEN
        RAISE_APPLICATION_ERROR(-20805, 'البند ' || i || ': الصنف ' || v_item.code || ' موقوف');
      END IF;
      v_p := NVL(p_lines(i).price, v_item.sale_price);
      v_d := NVL(p_lines(i).discount_pct, 0);
      v_r := NVL(p_lines(i).vat_rate, v_item.vat_rate);
      IF NVL(p_lines(i).qty, 0) <= 0 OR p_lines(i).qty <> ROUND(p_lines(i).qty, 3)
         OR v_p < 0 OR v_p <> ROUND(v_p, 2) OR v_d < 0 OR v_d > 100 OR v_r < 0 OR v_r > 100 THEN
        RAISE_APPLICATION_ERROR(-20805, 'البند ' || i || ': كمية أو سعر أو خصم أو نسبة ضريبة غير صالحة');
      END IF;

      v_gross := ROUND(p_lines(i).qty * v_p * (1 - v_d / 100), 2);
      IF v_reg.prices_include_vat = 'Y' THEN
        v_vat(i) := ROUND(v_gross * v_r / (100 + v_r), 2);
        v_net(i) := v_gross - v_vat(i);
      ELSE
        v_net(i) := v_gross;
        v_vat(i) := ROUND(v_gross * v_r / 100, 2);
      END IF;
      v_it(i) := v_item.item_id; v_price(i) := v_p; v_disc(i) := v_d; v_rate(i) := v_r;
      v_rev_acct(i) := v_item.rev_account;
      v_sub     := v_sub + v_net(i);
      v_vat_sum := v_vat_sum + v_vat(i);
      bump(v_rev, v_item.rev_account, v_net(i));
    END LOOP;
    v_total := v_sub + v_vat_sum;
    IF v_total <= 0 THEN
      RAISE_APPLICATION_ERROR(-20805, 'إجمالي البيع يجب أن يكون أكبر من صفر');
    END IF;

    -- الدفعات والباقي (الباقي من النقد فقط)
    FOR i IN 1 .. p_payments.COUNT LOOP
      IF p_payments(i).method IS NULL OR p_payments(i).method NOT IN ('CASH', 'CARD')
         OR NVL(p_payments(i).amount, 0) <= 0 OR p_payments(i).amount <> ROUND(p_payments(i).amount, 2) THEN
        RAISE_APPLICATION_ERROR(-20804, 'الدفعة ' || i || ': طريقة (CASH أو CARD) ومبلغ موجب بمنزلتين عشريتين');
      END IF;
      IF p_payments(i).method = 'CASH' THEN v_cash_t := v_cash_t + p_payments(i).amount; ELSE v_card_t := v_card_t + p_payments(i).amount; END IF;
    END LOOP;
    v_tender := v_cash_t + v_card_t;
    IF v_tender < v_total THEN
      RAISE_APPLICATION_ERROR(-20804, 'المدفوع ' || TO_CHAR(v_tender) || ' أقل من الإجمالي ' || TO_CHAR(v_total));
    END IF;
    v_change := v_tender - v_total;
    IF v_change > v_cash_t THEN
      RAISE_APPLICATION_ERROR(-20804, 'الباقي ' || TO_CHAR(v_change) || ' أكبر من النقد المدفوع ' || TO_CHAR(v_cash_t) || ': لا يُرد باقٍ من البطاقة');
    END IF;
    v_cash_net := v_cash_t - v_change;

    -- قيد البيع
    IF v_cash_net > 0 THEN add_gl(v_reg.cash_account, v_cash_net, 0); END IF;
    IF v_card_t > 0   THEN add_gl(c_bank, v_card_t, 0); END IF;
    v_code := v_rev.FIRST;
    WHILE v_code IS NOT NULL LOOP
      IF v_rev(v_code) > 0 THEN add_gl(v_code, 0, v_rev(v_code)); END IF;
      v_code := v_rev.NEXT(v_code);
    END LOOP;
    IF v_vat_sum > 0 THEN add_gl(c_vat, 0, v_vat_sum); END IF;

    UPDATE erp_counters SET last_no = last_no + 1 WHERE name = 'POS_SALE' RETURNING last_no INTO v_no;
    v_number := 'POS-' || LPAD(v_no, 6, '0');
    v_entry := erp_gl.post_entry(v_date, 'بيع نقطة بيع ' || v_number, v_number, v_gl);

    INSERT INTO erp_pos_sales (sale_no, kind, shift_id, sale_date, subtotal, vat_amount, total, tendered, change_due, entry_id)
    VALUES (v_number, 'SALE', p_shift_id, v_date, v_sub, v_vat_sum, v_total, v_tender, v_change, v_entry)
    RETURNING sale_id INTO v_id;

    -- البنود: الأصناف المخزنية تخرج من مخزن النقطة بتكلفة المتوسط
    FOR i IN 1 .. p_lines.COUNT LOOP
      SELECT * INTO v_item FROM erp_items WHERE item_id = v_it(i);
      v_cost(i) := NULL;
      IF v_item.track_stock = 'Y' THEN
        v_cost(i) := erp_stock.stock_out(v_it(i), v_reg.wh_id, v_date, p_lines(i).qty, 'SALE', 'POS', v_id);
        bump(v_cogs, v_item.cogs_account, v_cost(i));
        bump(v_inv,  v_item.inv_account,  v_cost(i));
        v_cogs_sum := v_cogs_sum + v_cost(i);
      END IF;
      INSERT INTO erp_pos_sale_lines (sale_id, item_id, description, qty, price, discount_pct, vat_rate, net, vat, cost, wh_id, revenue_account)
      VALUES (v_id, v_it(i), SUBSTR(v_item.name, 1, 200), p_lines(i).qty, v_price(i), v_disc(i), v_rate(i), v_net(i), v_vat(i),
              v_cost(i), CASE WHEN v_item.track_stock = 'Y' THEN v_reg.wh_id END, v_rev_acct(i));
    END LOOP;

    IF v_cogs_sum > 0 THEN
      v_gl := erp_line_tab();
      v_code := v_cogs.FIRST;
      WHILE v_code IS NOT NULL LOOP
        IF v_cogs(v_code) > 0 THEN add_gl(v_code, v_cogs(v_code), 0); END IF;
        v_code := v_cogs.NEXT(v_code);
      END LOOP;
      v_code := v_inv.FIRST;
      WHILE v_code IS NOT NULL LOOP
        IF v_inv(v_code) > 0 THEN add_gl(v_code, 0, v_inv(v_code)); END IF;
        v_code := v_inv.NEXT(v_code);
      END LOOP;
      v_cogs_ent := erp_gl.post_entry(v_date, 'تكلفة مبيعات ' || v_number, v_number, v_gl);
      UPDATE erp_pos_sales SET cogs_entry_id = v_cogs_ent WHERE sale_id = v_id;
    END IF;

    FOR i IN 1 .. p_payments.COUNT LOOP
      INSERT INTO erp_pos_payments (sale_id, method, amount, account_code)
      VALUES (v_id, p_payments(i).method, p_payments(i).amount, CASE p_payments(i).method WHEN 'CASH' THEN v_reg.cash_account ELSE c_bank END);
    END LOOP;
    RETURN v_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_pos_sell;
      RAISE;
  END sell;

  FUNCTION return_sale (
    p_shift_id     IN NUMBER,
    p_date         IN DATE,
    p_orig_sale_id IN NUMBER,
    p_lines        IN erp_pos_ret_tab,
    p_method       IN VARCHAR2
  ) RETURN NUMBER IS
    v_shift  erp_pos_shifts%ROWTYPE;
    v_reg    erp_pos_registers%ROWTYPE;
    v_orig   erp_pos_sales%ROWTYPE;
    v_ol     erp_pos_sale_lines%ROWTYPE;
    v_item   erp_items%ROWTYPE;
    v_date   DATE := TRUNC(NVL(p_date, SYSDATE));
    v_seen   t_amt;
    v_oid    t_nums; v_net t_nums; v_vat t_nums; v_cost t_nums; v_qty t_nums;
    v_rq NUMBER; v_rn NUMBER; v_rv NUMBER; v_rc NUMBER;
    v_n NUMBER; v_v NUMBER; v_c NUMBER;
    v_rev t_amt; v_cogs t_amt; v_inv t_amt;
    v_sub NUMBER := 0; v_vat_sum NUMBER := 0; v_total NUMBER; v_cogs_sum NUMBER := 0;
    v_acct   VARCHAR2(12);
    v_gl     erp_line_tab := erp_line_tab();
    v_no NUMBER; v_number VARCHAR2(20); v_entry NUMBER; v_cogs_ent NUMBER; v_id NUMBER; v_code VARCHAR2(12);

    PROCEDURE add_gl (p_account IN VARCHAR2, p_debit IN NUMBER, p_credit IN NUMBER) IS
    BEGIN
      v_gl.EXTEND;
      v_gl(v_gl.COUNT) := erp_line_t(p_account, p_debit, p_credit, NULL);
    END add_gl;
  BEGIN
    SAVEPOINT erp_pos_return;
    v_shift := open_shift_row(p_shift_id);
    v_reg   := get_reg(v_shift.reg_id);
    IF p_method IS NULL OR p_method NOT IN ('CASH', 'CARD') THEN
      RAISE_APPLICATION_ERROR(-20804, 'طريقة رد المبلغ: CASH أو CARD');
    END IF;
    BEGIN
      SELECT * INTO v_orig FROM erp_pos_sales WHERE sale_id = p_orig_sale_id FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20808, 'البيع رقم ' || p_orig_sale_id || ' غير موجود');
    END;
    IF v_orig.kind <> 'SALE' OR v_orig.status <> 'COMPLETED' THEN
      RAISE_APPLICATION_ERROR(-20806, 'يُرجَع من بيع مكتمل فقط');
    END IF;
    IF p_lines IS NULL OR p_lines.COUNT = 0 THEN
      RAISE_APPLICATION_ERROR(-20805, 'لا بنود للإرجاع');
    END IF;

    FOR i IN 1 .. p_lines.COUNT LOOP
      IF p_lines(i).orig_line_id IS NULL OR NVL(p_lines(i).qty, 0) <= 0 OR p_lines(i).qty <> ROUND(p_lines(i).qty, 3) THEN
        RAISE_APPLICATION_ERROR(-20805, 'بند الإرجاع ' || i || ': بند أصلي وكمية موجبة بثلاث منازل');
      END IF;
      IF v_seen.EXISTS(TO_CHAR(p_lines(i).orig_line_id)) THEN
        RAISE_APPLICATION_ERROR(-20805, 'بند أصلي مكرر في المرتجع');
      END IF;
      v_seen(TO_CHAR(p_lines(i).orig_line_id)) := 1;
      BEGIN
        SELECT * INTO v_ol FROM erp_pos_sale_lines WHERE line_id = p_lines(i).orig_line_id AND sale_id = p_orig_sale_id;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          RAISE_APPLICATION_ERROR(-20805, 'بند الإرجاع ' || i || ' لا يخص هذا البيع');
      END;
      -- ما أُرجع سابقاً من هذا البند (مرتجعات سارية)
      SELECT NVL(SUM(l.qty), 0), NVL(SUM(l.net), 0), NVL(SUM(l.vat), 0), NVL(SUM(l.cost), 0)
        INTO v_rq, v_rn, v_rv, v_rc
        FROM erp_pos_sale_lines l JOIN erp_pos_sales s ON s.sale_id = l.sale_id
       WHERE l.orig_line_id = v_ol.line_id AND s.status = 'COMPLETED';
      IF p_lines(i).qty > v_ol.qty - v_rq THEN
        RAISE_APPLICATION_ERROR(-20805, 'بند الإرجاع ' || i || ': الكمية ' || TO_CHAR(p_lines(i).qty) || ' تتجاوز المتاح ' || TO_CHAR(v_ol.qty - v_rq));
      END IF;
      -- المبالغ بالتناسب، والمتبقي بالضبط عند إرجاع آخر كمية (ولا تتجاوز المتبقي أبداً)
      IF p_lines(i).qty = v_ol.qty - v_rq THEN
        v_n := v_ol.net - v_rn;  v_v := v_ol.vat - v_rv;  v_c := NVL(v_ol.cost, 0) - v_rc;
      ELSE
        v_n := LEAST(ROUND(v_ol.net * p_lines(i).qty / v_ol.qty, 2), v_ol.net - v_rn);
        v_v := LEAST(ROUND(v_ol.vat * p_lines(i).qty / v_ol.qty, 2), v_ol.vat - v_rv);
        v_c := LEAST(ROUND(NVL(v_ol.cost, 0) * p_lines(i).qty / v_ol.qty, 2), NVL(v_ol.cost, 0) - v_rc);
      END IF;
      v_oid(i) := v_ol.line_id; v_qty(i) := p_lines(i).qty; v_net(i) := v_n; v_vat(i) := v_v;
      v_cost(i) := CASE WHEN v_ol.cost IS NULL THEN NULL ELSE v_c END;
      v_sub := v_sub + v_n;  v_vat_sum := v_vat_sum + v_v;
      bump(v_rev, v_ol.revenue_account, v_n);
    END LOOP;
    v_total := v_sub + v_vat_sum;
    IF v_total <= 0 THEN
      RAISE_APPLICATION_ERROR(-20805, 'لا مبلغ للإرجاع');
    END IF;

    v_acct := CASE p_method WHEN 'CASH' THEN v_reg.cash_account ELSE c_bank END;
    v_code := v_rev.FIRST;
    WHILE v_code IS NOT NULL LOOP
      IF v_rev(v_code) > 0 THEN add_gl(v_code, v_rev(v_code), 0); END IF;
      v_code := v_rev.NEXT(v_code);
    END LOOP;
    IF v_vat_sum > 0 THEN add_gl(c_vat, v_vat_sum, 0); END IF;
    add_gl(v_acct, 0, v_total);

    UPDATE erp_counters SET last_no = last_no + 1 WHERE name = 'POS_RETURN' RETURNING last_no INTO v_no;
    v_number := 'POSR-' || LPAD(v_no, 6, '0');
    v_entry := erp_gl.post_entry(v_date, 'مرتجع نقطة بيع ' || v_number || ' من ' || v_orig.sale_no, v_number, v_gl);

    INSERT INTO erp_pos_sales (sale_no, kind, orig_sale_id, shift_id, sale_date, subtotal, vat_amount, total, tendered, change_due, entry_id)
    VALUES (v_number, 'RETURN', p_orig_sale_id, p_shift_id, v_date, v_sub, v_vat_sum, v_total, v_total, 0, v_entry)
    RETURNING sale_id INTO v_id;

    FOR i IN 1 .. p_lines.COUNT LOOP
      SELECT * INTO v_ol FROM erp_pos_sale_lines WHERE line_id = v_oid(i);
      SELECT * INTO v_item FROM erp_items WHERE item_id = v_ol.item_id;
      IF v_ol.cost IS NOT NULL THEN
        erp_stock.stock_in(v_ol.item_id, v_ol.wh_id, v_date, v_qty(i), v_cost(i), 'SALE', 'POS', v_id);
        IF v_cost(i) > 0 THEN
          bump(v_cogs, v_item.cogs_account, v_cost(i));
          bump(v_inv,  v_item.inv_account,  v_cost(i));
          v_cogs_sum := v_cogs_sum + v_cost(i);
        END IF;
      END IF;
      INSERT INTO erp_pos_sale_lines (sale_id, item_id, description, qty, price, discount_pct, vat_rate, net, vat, cost, wh_id, revenue_account, orig_line_id)
      VALUES (v_id, v_ol.item_id, v_ol.description, v_qty(i), v_ol.price, v_ol.discount_pct, v_ol.vat_rate, v_net(i), v_vat(i),
              v_cost(i), v_ol.wh_id, v_ol.revenue_account, v_ol.line_id);
    END LOOP;

    -- عكس التكلفة: مدين المخزون / دائن تكلفة المبيعات
    IF v_cogs_sum > 0 THEN
      v_gl := erp_line_tab();
      v_code := v_inv.FIRST;
      WHILE v_code IS NOT NULL LOOP
        IF v_inv(v_code) > 0 THEN add_gl(v_code, v_inv(v_code), 0); END IF;
        v_code := v_inv.NEXT(v_code);
      END LOOP;
      v_code := v_cogs.FIRST;
      WHILE v_code IS NOT NULL LOOP
        IF v_cogs(v_code) > 0 THEN add_gl(v_code, 0, v_cogs(v_code)); END IF;
        v_code := v_cogs.NEXT(v_code);
      END LOOP;
      v_cogs_ent := erp_gl.post_entry(v_date, 'عكس تكلفة مبيعات ' || v_number, v_number, v_gl);
      UPDATE erp_pos_sales SET cogs_entry_id = v_cogs_ent WHERE sale_id = v_id;
    END IF;

    INSERT INTO erp_pos_payments (sale_id, method, amount, account_code) VALUES (v_id, p_method, v_total, v_acct);
    RETURN v_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_pos_return;
      RAISE;
  END return_sale;

  PROCEDURE void_sale (p_sale_id IN NUMBER) IS
    v_sale  erp_pos_sales%ROWTYPE;
    v_shift erp_pos_shifts%ROWTYPE;
    v_n     NUMBER;
    v_tmp   NUMBER;
  BEGIN
    SAVEPOINT erp_pos_void;
    BEGIN
      SELECT * INTO v_sale FROM erp_pos_sales WHERE sale_id = p_sale_id FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20808, 'البيع رقم ' || p_sale_id || ' غير موجود');
    END;
    IF v_sale.status <> 'COMPLETED' THEN
      RAISE_APPLICATION_ERROR(-20806, 'العملية ' || v_sale.sale_no || ' ملغاة مسبقاً');
    END IF;
    SELECT * INTO v_shift FROM erp_pos_shifts WHERE shift_id = v_sale.shift_id;
    IF v_shift.status <> 'OPEN' THEN
      RAISE_APPLICATION_ERROR(-20807, 'وردية العملية ' || v_sale.sale_no || ' مغلقة: لا إلغاء بعد الإقفال (استخدم مرتجعاً)');
    END IF;
    IF v_sale.kind = 'SALE' THEN
      SELECT COUNT(*) INTO v_n FROM erp_pos_sales WHERE orig_sale_id = p_sale_id AND status = 'COMPLETED';
      IF v_n > 0 THEN
        RAISE_APPLICATION_ERROR(-20806, 'للبيع ' || v_sale.sale_no || ' مرتجعات سارية: ألغِها أولاً');
      END IF;
    END IF;
    v_tmp := erp_gl.reverse_entry(v_sale.entry_id);
    IF v_sale.cogs_entry_id IS NOT NULL THEN
      v_tmp := erp_gl.reverse_entry(v_sale.cogs_entry_id);
    END IF;
    erp_stock.reverse_doc('POS', p_sale_id);
    UPDATE erp_pos_sales SET status = 'VOID' WHERE sale_id = p_sale_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_pos_void;
      RAISE;
  END void_sale;

END erp_pos;
/
SHOW ERRORS PACKAGE BODY erp_pos
