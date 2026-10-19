-- ============================================================================
-- 05: حزمة المبيعات والمشتريات ERP_TRADE (تعتمد على ERP_GL وERP_INVENTORY)
-- كل فاتورة أو سند يُرحَّل إلى قيد في المعاملة نفسها؛ لا COMMIT داخل الحزمة.
--
-- الترحيل:
--   مبيعات : مدين 1300 العملاء (الإجمالي) / دائن الإيراد (الصافي) + دائن 2200 الضريبة
--   مشتريات: مدين المصروف أو الأصل (الصافي) + مدين 2200 الضريبة / دائن 2100 الموردين (الإجمالي)
--   قبض    : مدين 1100 أو 1200 / دائن 1300      صرف: مدين 2100 / دائن 1100 أو 1200
--   بند مخزني في المشتريات: المدين يذهب إلى حساب مخزون الصنف ويدخل المخزن بصافي البند (دون الضريبة).
--   بند مخزني في المبيعات: قيد ثانٍ لتكلفة المبيعات بمتوسط التكلفة: مدين حساب تكلفة الصنف / دائن حساب مخزونه.
--
-- رموز الأخطاء: -20201 نوع طرف/فاتورة غير صالح   -20207 مبلغ أكبر من المتبقي
--   -20202 طرف غير موجود أو لا يطابق النوع       -20208 فاتورة ملغاة
--   -20203 تاريخ مطلوب                            -20209 لا تُلغى فاتورة عليها مدفوعات
--   -20204 بنود الفاتورة غير صالحة                -20210 فاتورة غير موجودة
--   -20205 حساب البند لا يناسب نوع الفاتورة       -20211 طريقة دفع غير صالحة
--   -20206 إجمالي الفاتورة يجب أن يكون موجباً     -20212 الفاتورة لا تخص الطرف
--   -20213 لا تُلغى مشتريات بعد حركات لاحقة       -20214 صنف/مخزن البند غير صالح
--   -20215 فاتورة مرتبطة بأصل ثابت لا تُلغى     -20216 فاتورة استلام أمر شراء (استخدم ERP_PO.VOID_RECEIPT)
--   -20217 فاتورة محوَّلة من عرض سعر (استخدم ERP_QUOTE.UNCONVERT)
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_trade AS
  FUNCTION add_party (
    p_kind   IN VARCHAR2,          -- CUSTOMER | SUPPLIER
    p_name   IN VARCHAR2,
    p_phone  IN VARCHAR2 DEFAULT NULL,
    p_tax_no IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER;

  FUNCTION create_invoice (
    p_kind     IN VARCHAR2,        -- SALES | PURCHASE
    p_party_id IN NUMBER,
    p_date     IN DATE,
    p_due      IN DATE,
    p_ref      IN VARCHAR2,
    p_note     IN VARCHAR2,
    p_lines    IN erp_inv_line_tab
  ) RETURN NUMBER;

  -- إلغاء بقيد عكسي (فاتورة بلا مدفوعات فقط)
  PROCEDURE void_invoice (p_invoice_id IN NUMBER);

  -- سند قبض (طرف عميل) أو صرف (طرف مورد)، ربط الفاتورة اختياري
  FUNCTION pay (
    p_party_id   IN NUMBER,
    p_invoice_id IN NUMBER,        -- NULL = دفعة على الحساب
    p_date       IN DATE,
    p_amount     IN NUMBER,
    p_method     IN VARCHAR2,      -- CASH | BANK
    p_note       IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER;

  -- الرصيد المستحق: موجب = على العميل / للمورد
  FUNCTION party_balance (p_party_id IN NUMBER) RETURN NUMBER;
END erp_trade;
/

CREATE OR REPLACE PACKAGE BODY erp_trade AS

  c_cash    CONSTANT VARCHAR2(12) := '1100';
  c_bank    CONSTANT VARCHAR2(12) := '1200';
  c_ar      CONSTANT VARCHAR2(12) := '1300';
  c_ap      CONSTANT VARCHAR2(12) := '2100';
  c_vat     CONSTANT VARCHAR2(12) := '2200';
  c_sales   CONSTANT VARCHAR2(12) := '4100';
  c_cogs    CONSTANT VARCHAR2(12) := '5100';

  FUNCTION get_party (p_party_id IN NUMBER) RETURN erp_parties%ROWTYPE IS
    v_row erp_parties%ROWTYPE;
  BEGIN
    SELECT * INTO v_row FROM erp_parties WHERE party_id = p_party_id;
    RETURN v_row;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20202, 'الطرف رقم ' || p_party_id || ' غير موجود');
  END get_party;

  FUNCTION add_party (
    p_kind   IN VARCHAR2,
    p_name   IN VARCHAR2,
    p_phone  IN VARCHAR2 DEFAULT NULL,
    p_tax_no IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER IS
    v_id erp_parties.party_id%TYPE;
  BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('CUSTOMER', 'SUPPLIER') THEN
      RAISE_APPLICATION_ERROR(-20201, 'نوع الطرف: CUSTOMER أو SUPPLIER');
    END IF;
    IF TRIM(p_name) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20202, 'اسم الطرف مطلوب');
    END IF;
    INSERT INTO erp_parties (kind, name, phone, tax_no)
    VALUES (p_kind, SUBSTR(TRIM(p_name), 1, 120), SUBSTR(p_phone, 1, 40), SUBSTR(p_tax_no, 1, 40))
    RETURNING party_id INTO v_id;
    RETURN v_id;
  END add_party;

  FUNCTION create_invoice (
    p_kind     IN VARCHAR2,
    p_party_id IN NUMBER,
    p_date     IN DATE,
    p_due      IN DATE,
    p_ref      IN VARCHAR2,
    p_note     IN VARCHAR2,
    p_lines    IN erp_inv_line_tab
  ) RETURN NUMBER IS
    TYPE t_amt  IS TABLE OF NUMBER       INDEX BY VARCHAR2(12);
    TYPE t_nums IS TABLE OF NUMBER       INDEX BY PLS_INTEGER;
    TYPE t_strs IS TABLE OF VARCHAR2(12) INDEX BY PLS_INTEGER;

    v_party    erp_parties%ROWTYPE;
    v_item     erp_items%ROWTYPE;
    v_by_acct  t_amt;                 -- صافي كل حساب (لاختصار قيد الفاتورة)
    v_cogs_dr  t_amt;                 -- تكلفة المبيعات بحسب حساب التكلفة
    v_inv_cr   t_amt;                 -- مقابلها بحسب حساب المخزون
    v_net      t_nums;
    v_vat      t_nums;
    v_cost     t_nums;
    v_acct     t_strs;
    v_stocked  t_strs;                -- 'Y' للبند الذي يحرّك المخزون
    v_code     VARCHAR2(12);
    v_type     erp_accounts.acc_type%TYPE;
    v_price    NUMBER;
    v_rate     NUMBER;
    v_subtotal NUMBER := 0;
    v_vat_sum  NUMBER := 0;
    v_total    NUMBER;
    v_cogs_sum NUMBER := 0;
    v_gl       erp_line_tab := erp_line_tab();
    v_no       NUMBER;
    v_number   erp_invoices.invoice_no%TYPE;
    v_entry    NUMBER;
    v_cogs_ent NUMBER;
    v_id       erp_invoices.invoice_id%TYPE;

    PROCEDURE add_gl (p_account IN VARCHAR2, p_debit IN NUMBER, p_credit IN NUMBER) IS
    BEGIN
      v_gl.EXTEND;
      v_gl(v_gl.COUNT) := erp_line_t(p_account, p_debit, p_credit, NULL);
    END add_gl;

    PROCEDURE bump (p_map IN OUT NOCOPY t_amt, p_key IN VARCHAR2, p_amount IN NUMBER) IS
    BEGIN
      IF p_map.EXISTS(p_key) THEN p_map(p_key) := p_map(p_key) + p_amount; ELSE p_map(p_key) := p_amount; END IF;
    END bump;
  BEGIN
    SAVEPOINT erp_trade_invoice;

    IF p_kind IS NULL OR p_kind NOT IN ('SALES', 'PURCHASE') THEN
      RAISE_APPLICATION_ERROR(-20201, 'نوع الفاتورة: SALES أو PURCHASE');
    END IF;
    IF p_date IS NULL THEN
      RAISE_APPLICATION_ERROR(-20203, 'تاريخ الفاتورة مطلوب');
    END IF;
    v_party := get_party(p_party_id);
    IF (p_kind = 'SALES' AND v_party.kind <> 'CUSTOMER') OR (p_kind = 'PURCHASE' AND v_party.kind <> 'SUPPLIER') THEN
      RAISE_APPLICATION_ERROR(-20202, CASE p_kind WHEN 'SALES' THEN 'فاتورة المبيعات تحتاج عميلاً' ELSE 'فاتورة المشتريات تحتاج مورداً' END);
    END IF;
    IF p_lines IS NULL OR p_lines.COUNT = 0 THEN
      RAISE_APPLICATION_ERROR(-20204, 'الفاتورة تحتاج بنداً واحداً على الأقل');
    END IF;

    -- حساب البنود والتحقق منها (بلا أي أثر على المخزون بعد)
    FOR i IN 1 .. p_lines.COUNT LOOP
      v_price := NVL(p_lines(i).price, -1);
      v_rate  := NVL(p_lines(i).vat_rate, 0);
      IF NVL(p_lines(i).qty, 0) <= 0 OR v_price < 0 OR v_price <> ROUND(v_price, 2) OR v_rate < 0 OR v_rate > 100 THEN
        RAISE_APPLICATION_ERROR(-20204, 'البند ' || i || ': كمية أو سعر أو نسبة ضريبة غير صالحة');
      END IF;

      v_stocked(i) := 'N';
      v_code := p_lines(i).account_code;
      IF p_lines(i).item_id IS NOT NULL THEN
        BEGIN
          SELECT * INTO v_item FROM erp_items WHERE item_id = p_lines(i).item_id;
        EXCEPTION
          WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20214, 'البند ' || i || ': الصنف غير موجود');
        END;
        IF v_item.active <> 'Y' THEN
          RAISE_APPLICATION_ERROR(-20214, 'البند ' || i || ': الصنف ' || v_item.code || ' موقوف');
        END IF;
        IF v_item.track_stock = 'Y' THEN
          IF p_lines(i).wh_id IS NULL THEN
            RAISE_APPLICATION_ERROR(-20214, 'البند ' || i || ': المخزن مطلوب للصنف ' || v_item.code);
          END IF;
          IF p_lines(i).qty <> ROUND(p_lines(i).qty, 3) THEN
            RAISE_APPLICATION_ERROR(-20204, 'البند ' || i || ': كمية الصنف المخزني بثلاث منازل عشرية كحد أقصى');
          END IF;
          v_stocked(i) := 'Y';
          -- المشتريات المخزنية تُرحَّل دائماً إلى حساب مخزون الصنف؛ المبيعات إلى إيراده ما لم يُحدَّد غيره
          IF p_kind = 'PURCHASE' THEN v_code := v_item.inv_account; ELSIF v_code IS NULL THEN v_code := v_item.rev_account; END IF;
        ELSIF v_code IS NULL AND p_kind = 'SALES' THEN
          v_code := v_item.rev_account;
        END IF;
      END IF;
      v_code := NVL(v_code, CASE p_kind WHEN 'SALES' THEN c_sales ELSE c_cogs END);

      BEGIN
        SELECT acc_type INTO v_type FROM erp_accounts WHERE code = v_code;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          RAISE_APPLICATION_ERROR(-20205, 'البند ' || i || ': الحساب ' || v_code || ' غير موجود');
      END;
      IF (p_kind = 'SALES' AND v_type <> 'REVENUE') OR (p_kind = 'PURCHASE' AND v_type NOT IN ('EXPENSE', 'ASSET')) THEN
        RAISE_APPLICATION_ERROR(-20205, 'البند ' || i || ': الحساب ' || v_code || ' لا يناسب نوع الفاتورة');
      END IF;
      v_acct(i) := v_code;
      v_net(i)  := ROUND(p_lines(i).qty * v_price, 2);
      v_vat(i)  := ROUND(v_net(i) * v_rate / 100, 2);
      v_subtotal := v_subtotal + v_net(i);
      v_vat_sum  := v_vat_sum + v_vat(i);
      bump(v_by_acct, v_code, v_net(i));
    END LOOP;
    v_total := v_subtotal + v_vat_sum;
    IF v_total <= 0 THEN
      RAISE_APPLICATION_ERROR(-20206, 'إجمالي الفاتورة يجب أن يكون أكبر من صفر');
    END IF;

    -- أسطر قيد الفاتورة
    IF p_kind = 'SALES' THEN
      add_gl(c_ar, v_total, 0);
    END IF;
    v_code := v_by_acct.FIRST;
    WHILE v_code IS NOT NULL LOOP
      IF v_by_acct(v_code) > 0 THEN
        IF p_kind = 'SALES' THEN add_gl(v_code, 0, v_by_acct(v_code)); ELSE add_gl(v_code, v_by_acct(v_code), 0); END IF;
      END IF;
      v_code := v_by_acct.NEXT(v_code);
    END LOOP;
    IF v_vat_sum > 0 THEN
      IF p_kind = 'SALES' THEN add_gl(c_vat, 0, v_vat_sum); ELSE add_gl(c_vat, v_vat_sum, 0); END IF;
    END IF;
    IF p_kind = 'PURCHASE' THEN
      add_gl(c_ap, 0, v_total);
    END IF;

    -- ترقيم بلا فجوات: UPDATE يقفل صف العدّاد حتى نهاية المعاملة
    UPDATE erp_counters SET last_no = last_no + 1 WHERE name = p_kind RETURNING last_no INTO v_no;
    v_number := CASE p_kind WHEN 'SALES' THEN 'S-' ELSE 'P-' END || LPAD(v_no, 6, '0');

    v_entry := erp_gl.post_entry(
      p_date, CASE p_kind WHEN 'SALES' THEN 'فاتورة مبيعات ' ELSE 'فاتورة مشتريات ' END || v_number || ' — ' || v_party.name,
      v_number, v_gl);

    INSERT INTO erp_invoices (kind, invoice_no, ref, party_id, invoice_date, due_date, subtotal, vat_amount, total, note, entry_id)
    VALUES (p_kind, v_number, SUBSTR(p_ref, 1, 60), p_party_id, TRUNC(p_date), TRUNC(p_due), v_subtotal, v_vat_sum, v_total,
            SUBSTR(p_note, 1, 300), v_entry)
    RETURNING invoice_id INTO v_id;

    -- حركات المخزون: المشتريات تُدخل بصافي البند (دون الضريبة)، والمبيعات تُخرج بتكلفة المتوسط
    FOR i IN 1 .. p_lines.COUNT LOOP
      v_cost(i) := NULL;
      IF v_stocked(i) = 'Y' THEN
        IF p_kind = 'PURCHASE' THEN
          erp_inventory.stock_in(p_lines(i).item_id, p_lines(i).wh_id, p_date, p_lines(i).qty, v_net(i), 'PURCHASE', 'INVOICE', v_id);
          v_cost(i) := v_net(i);
        ELSE
          v_cost(i) := erp_inventory.stock_out(p_lines(i).item_id, p_lines(i).wh_id, p_date, p_lines(i).qty, 'SALE', 'INVOICE', v_id);
          SELECT * INTO v_item FROM erp_items WHERE item_id = p_lines(i).item_id;
          bump(v_cogs_dr, v_item.cogs_account, v_cost(i));
          bump(v_inv_cr,  v_item.inv_account,  v_cost(i));
          v_cogs_sum := v_cogs_sum + v_cost(i);
        END IF;
      END IF;

      INSERT INTO erp_invoice_lines (invoice_id, description, qty, price, vat_rate, account_code, net, vat, item_id, wh_id, cost)
      VALUES (v_id, NVL(SUBSTR(TRIM(p_lines(i).description), 1, 200), '—'), p_lines(i).qty, p_lines(i).price,
              NVL(p_lines(i).vat_rate, 0), v_acct(i), v_net(i), v_vat(i),
              CASE WHEN v_stocked(i) = 'Y' THEN p_lines(i).item_id END, CASE WHEN v_stocked(i) = 'Y' THEN p_lines(i).wh_id END, v_cost(i));
    END LOOP;

    -- قيد تكلفة البضاعة المباعة: مدين حساب التكلفة / دائن حساب المخزون
    IF v_cogs_sum > 0 THEN
      v_gl := erp_line_tab();
      v_code := v_cogs_dr.FIRST;
      WHILE v_code IS NOT NULL LOOP
        IF v_cogs_dr(v_code) > 0 THEN add_gl(v_code, v_cogs_dr(v_code), 0); END IF;
        v_code := v_cogs_dr.NEXT(v_code);
      END LOOP;
      v_code := v_inv_cr.FIRST;
      WHILE v_code IS NOT NULL LOOP
        IF v_inv_cr(v_code) > 0 THEN add_gl(v_code, 0, v_inv_cr(v_code)); END IF;
        v_code := v_inv_cr.NEXT(v_code);
      END LOOP;
      v_cogs_ent := erp_gl.post_entry(p_date, 'تكلفة مبيعات فاتورة ' || v_number, v_number, v_gl);
      UPDATE erp_invoices SET cogs_entry_id = v_cogs_ent WHERE invoice_id = v_id;
    END IF;

    RETURN v_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_trade_invoice;
      RAISE;
  END create_invoice;

  PROCEDURE void_invoice (p_invoice_id IN NUMBER) IS
    v_inv erp_invoices%ROWTYPE;
    v_rev NUMBER;
    v_tmp NUMBER;
  BEGIN
    SAVEPOINT erp_trade_void;
    BEGIN
      SELECT * INTO v_inv FROM erp_invoices WHERE invoice_id = p_invoice_id FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20210, 'الفاتورة رقم ' || p_invoice_id || ' غير موجودة');
    END;
    IF v_inv.status <> 'OPEN' THEN
      RAISE_APPLICATION_ERROR(-20208, 'الفاتورة ملغاة مسبقاً');
    END IF;
    IF v_inv.paid > 0 THEN
      RAISE_APPLICATION_ERROR(-20209, 'لا تُلغى فاتورة عليها مدفوعات');
    END IF;
    IF v_inv.kind = 'PURCHASE' THEN
      SELECT COUNT(*) INTO v_tmp FROM erp_assets WHERE invoice_id = p_invoice_id AND status <> 'VOID';
      IF v_tmp > 0 THEN
        RAISE_APPLICATION_ERROR(-20215, 'الفاتورة مرتبطة بأصل ثابت: ألغِ تسجيل الأصل (ERP_ASSET.VOID_ASSET) أولاً');
      END IF;
      SELECT COUNT(*) INTO v_tmp FROM erp_po_receipts WHERE invoice_id = p_invoice_id AND status = 'ACTIVE';
      IF v_tmp > 0 THEN
        RAISE_APPLICATION_ERROR(-20216, 'الفاتورة من استلام أمر شراء: ألغِ الاستلام عبر ERP_PO.VOID_RECEIPT');
      END IF;
    END IF;
    IF v_inv.kind = 'SALES' THEN
      SELECT COUNT(*) INTO v_tmp FROM erp_quotations WHERE invoice_id = p_invoice_id AND status = 'CONVERTED';
      IF v_tmp > 0 THEN
        RAISE_APPLICATION_ERROR(-20217, 'الفاتورة محوَّلة من عرض سعر: استخدم ERP_QUOTE.UNCONVERT');
      END IF;
    END IF;
    -- إلغاء مشتريات بعد حركات لاحقة على أصنافها يُفسد متوسط التكلفة؛ المسموح تسوية المخزون بدلاً منه
    IF v_inv.kind = 'PURCHASE' AND erp_inventory.has_later_moves('INVOICE', p_invoice_id) THEN
      RAISE_APPLICATION_ERROR(-20213, 'لا تُلغى فاتورة مشتريات جرت بعدها حركات على أصنافها: استخدم تسوية المخزون');
    END IF;
    v_rev := erp_gl.reverse_entry(v_inv.entry_id);
    IF v_inv.cogs_entry_id IS NOT NULL THEN
      v_tmp := erp_gl.reverse_entry(v_inv.cogs_entry_id);
    END IF;
    erp_inventory.reverse_doc('INVOICE', p_invoice_id);
    UPDATE erp_invoices SET status = 'VOID', void_entry_id = v_rev WHERE invoice_id = p_invoice_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_trade_void;
      RAISE;
  END void_invoice;

  FUNCTION pay (
    p_party_id   IN NUMBER,
    p_invoice_id IN NUMBER,
    p_date       IN DATE,
    p_amount     IN NUMBER,
    p_method     IN VARCHAR2,
    p_note       IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER IS
    v_party erp_parties%ROWTYPE;
    v_inv   erp_invoices%ROWTYPE;
    v_kind  VARCHAR2(7);
    v_cash  VARCHAR2(12);
    v_gl    erp_line_tab;
    v_entry NUMBER;
    v_id    erp_payments.payment_id%TYPE;
  BEGIN
    SAVEPOINT erp_trade_pay;

    IF p_date IS NULL THEN
      RAISE_APPLICATION_ERROR(-20203, 'التاريخ مطلوب');
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('CASH', 'BANK') THEN
      RAISE_APPLICATION_ERROR(-20211, 'طريقة الدفع: CASH أو BANK');
    END IF;
    IF NVL(p_amount, 0) <= 0 OR p_amount <> ROUND(p_amount, 2) THEN
      RAISE_APPLICATION_ERROR(-20207, 'المبلغ يجب أن يكون أكبر من صفر وبمنزلتين عشريتين كحد أقصى');
    END IF;
    v_party := get_party(p_party_id);
    v_kind  := CASE v_party.kind WHEN 'CUSTOMER' THEN 'RECEIPT' ELSE 'PAYMENT' END;
    v_cash  := CASE p_method WHEN 'CASH' THEN c_cash ELSE c_bank END;

    IF p_invoice_id IS NOT NULL THEN
      BEGIN
        SELECT * INTO v_inv FROM erp_invoices WHERE invoice_id = p_invoice_id FOR UPDATE;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          RAISE_APPLICATION_ERROR(-20210, 'الفاتورة رقم ' || p_invoice_id || ' غير موجودة');
      END;
      IF v_inv.party_id <> p_party_id THEN
        RAISE_APPLICATION_ERROR(-20212, 'الفاتورة لا تخص هذا الطرف');
      END IF;
      IF v_inv.status <> 'OPEN' THEN
        RAISE_APPLICATION_ERROR(-20208, 'الفاتورة ملغاة');
      END IF;
      IF p_amount > v_inv.total - v_inv.paid THEN
        RAISE_APPLICATION_ERROR(-20207, 'المبلغ أكبر من المتبقي على الفاتورة (' || TO_CHAR(v_inv.total - v_inv.paid) || ')');
      END IF;
    END IF;

    IF v_kind = 'RECEIPT' THEN
      v_gl := erp_line_tab(erp_line_t(v_cash, p_amount, 0, NULL), erp_line_t(c_ar, 0, p_amount, NULL));
    ELSE
      v_gl := erp_line_tab(erp_line_t(c_ap, p_amount, 0, NULL), erp_line_t(v_cash, 0, p_amount, NULL));
    END IF;

    v_entry := erp_gl.post_entry(
      p_date,
      CASE v_kind WHEN 'RECEIPT' THEN 'سند قبض من ' ELSE 'سند صرف إلى ' END || v_party.name
        || CASE WHEN p_invoice_id IS NOT NULL THEN ' — ' || v_inv.invoice_no END,
      CASE WHEN p_invoice_id IS NOT NULL THEN v_inv.invoice_no END,
      v_gl);

    INSERT INTO erp_payments (kind, party_id, invoice_id, pay_date, amount, method, note, entry_id)
    VALUES (v_kind, p_party_id, p_invoice_id, TRUNC(p_date), p_amount, p_method, SUBSTR(p_note, 1, 300), v_entry)
    RETURNING payment_id INTO v_id;

    IF p_invoice_id IS NOT NULL THEN
      UPDATE erp_invoices SET paid = paid + p_amount WHERE invoice_id = p_invoice_id;
    END IF;
    RETURN v_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_trade_pay;
      RAISE;
  END pay;

  FUNCTION party_balance (p_party_id IN NUMBER) RETURN NUMBER IS
    v_inv NUMBER;
    v_pay NUMBER;
  BEGIN
    SELECT NVL(SUM(total), 0) INTO v_inv FROM erp_invoices WHERE party_id = p_party_id AND status = 'OPEN';
    SELECT NVL(SUM(amount), 0) INTO v_pay FROM erp_payments WHERE party_id = p_party_id;
    RETURN v_inv - v_pay;
  END party_balance;

END erp_trade;
/
SHOW ERRORS PACKAGE BODY erp_trade
