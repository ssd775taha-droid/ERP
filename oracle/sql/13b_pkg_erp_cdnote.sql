-- ============================================================================
-- 13b: حزمة إشعارات الدائن والمدين ERP_CDNOTE (تعتمد على ERP_GL وERP_INVENTORY وجداول 01b)
-- الترحيل (لكل إشعار قيد واحد، ولمرتجع بضاعة مبيعات قيد ثانٍ لتكلفتها):
--   دائن مبيعات : مدين الإيراد (الصافي) + مدين 2200 / دائن العملاء 1300 (الإجمالي)؛ والمرتجع المخزني بتكلفته الأصلية: مدين المخزون / دائن التكلفة
--   مدين مبيعات : مدين العملاء / دائن الإيراد + دائن 2200
--   دائن مشتريات: مدين الموردين 2100 / دائن المخزون أو المصروف (الصافي) + دائن 2200؛ المخزني يُخرَج بتكلفة المتوسط والفرق عن الصافي إلى 5500
--   مدين مشتريات: مدين المصروف + مدين 2200 / دائن الموردين
--   المردود نقداً/بنكاً (إشعار دائن لفاتورة سُدِّدت زيادة): مبيعات: مدين العملاء / دائن الصندوق أو البنك. مشتريات: مدين الصندوق أو البنك / دائن الموردين.
-- القواعد: الإشعار لفاتورة سارية، السبب إلزامي، مجموع الإشعارات الدائنة ≤ إجمالي الفاتورة + مدينها، وكمية البند الأصلي المرتجعة لا تتجاوز الأصل،
--   وسعر الإشعار الدائن لبند أصلي ≤ سعره الأصلي. إن صار الدفع أكبر من الإجمالي الفعلي فيجب تحديد المبلغ المردود.
-- لا COMMIT داخل الحزمة، وكل إجراء عام يتراجع إلى نقطة حفظ خاصة به عند الخطأ.
--
-- رموز الأخطاء:
--   -20960 فاتورة غير موجودة أو ملغاة     -20967 حساب البند لا يناسب النوع أو غير موجود
--   -20961 نوع إشعار غير صالح              -20968 مجموع الدائن يتجاوز الفاتورة / الدفع يزيد على الفعلي بلا رد كافٍ
--   -20962 تاريخ مطلوب                     -20969 مبلغ/طريقة الرد غير صالحة
--   -20963 السبب مطلوب                     -20970 إشعار غير موجود
--   -20964 بنود غير صالحة                  -20971 الإشعار ملغى مسبقاً
--   -20965 بند أصلي غير صالح أو كميته أكبر -20972 لا يمكن إلغاؤه: يجعل المتبقي سالباً أو الدائن أكبر من الفاتورة
--   -20966 سعر أعلى من سعر البند الأصلي
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_cdnote AS
  -- ينشئ إشعاراً ويرحّله. p_type: CREDIT | DEBIT. يعيد رقم الإشعار.
  FUNCTION create_note (
    p_invoice_id    IN NUMBER,
    p_type          IN VARCHAR2,
    p_date          IN DATE,
    p_reason        IN VARCHAR2,
    p_lines         IN erp_note_line_tab,
    p_refund        IN NUMBER   DEFAULT 0,
    p_refund_method IN VARCHAR2 DEFAULT NULL      -- CASH | BANK عند p_refund > 0
  ) RETURN NUMBER;

  -- إلغاء بقيود عكسية (وعكس حركة المخزون إن وُجدت)
  PROCEDURE void_note (p_note_id IN NUMBER);
END erp_cdnote;
/

CREATE OR REPLACE PACKAGE BODY erp_cdnote AS

  c_cash CONSTANT VARCHAR2(12) := '1100';
  c_bank CONSTANT VARCHAR2(12) := '1200';
  c_ar   CONSTANT VARCHAR2(12) := '1300';
  c_ap   CONSTANT VARCHAR2(12) := '2100';
  c_vat  CONSTANT VARCHAR2(12) := '2200';
  c_var  CONSTANT VARCHAR2(12) := '5500';
  c_sales CONSTANT VARCHAR2(12) := '4100';
  c_cogs  CONSTANT VARCHAR2(12) := '5100';

  FUNCTION create_note (
    p_invoice_id    IN NUMBER,
    p_type          IN VARCHAR2,
    p_date          IN DATE,
    p_reason        IN VARCHAR2,
    p_lines         IN erp_note_line_tab,
    p_refund        IN NUMBER   DEFAULT 0,
    p_refund_method IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER IS
    TYPE t_amt  IS TABLE OF NUMBER       INDEX BY VARCHAR2(12);
    TYPE t_nums IS TABLE OF NUMBER       INDEX BY PLS_INTEGER;
    TYPE t_strs IS TABLE OF VARCHAR2(12) INDEX BY PLS_INTEGER;

    v_inv      erp_invoices%ROWTYPE;
    v_party    erp_parties%ROWTYPE;
    v_ol       erp_invoice_lines%ROWTYPE;
    v_item     erp_items%ROWTYPE;
    v_by_acct  t_amt;                 -- صافي كل حساب
    v_inv_dr   t_amt;                 -- مرتجع مبيعات مخزني: مدين المخزون
    v_cogs_cr  t_amt;                 --                      دائن التكلفة
    v_used     t_nums;                -- كمية المرتجع المخزني المستعملة من كل بند أصلي داخل هذا الاستدعاء
    v_usedv    t_nums;                -- قيمة (صافي) الإشعار المستعملة من كل بند أصلي داخل هذا الاستدعاء
    v_vdone    NUMBER;
    v_stk      BOOLEAN;
    v_net      t_nums;
    v_vat      t_nums;
    v_cost     t_nums;
    v_acct     t_strs;
    v_stock    t_strs;                -- Y للبند الذي يحرّك المخزون
    v_code     VARCHAR2(12);
    v_type     erp_accounts.acc_type%TYPE;
    v_price    NUMBER;
    v_rate     NUMBER;
    v_done     NUMBER;
    v_unit     NUMBER;
    v_subtotal NUMBER := 0;
    v_vat_sum  NUMBER := 0;
    v_total    NUMBER;
    v_variance NUMBER := 0;
    v_stock_sum NUMBER := 0;
    v_cr_prev  NUMBER;
    v_db_prev  NUMBER;
    v_net_prev NUMBER;
    v_rem_after NUMBER;
    v_refund   NUMBER := NVL(p_refund, 0);
    v_gl       erp_line_tab := erp_line_tab();
    v_no       NUMBER;
    v_ctr      VARCHAR2(20);
    v_pref     VARCHAR2(4);
    v_number   erp_notes.note_no%TYPE;
    v_entry    NUMBER;
    v_stock_ent NUMBER;
    v_id       NUMBER;
    v_sales    BOOLEAN;
    v_credit   BOOLEAN;

    PROCEDURE add_gl (p_account IN VARCHAR2, p_debit IN NUMBER, p_credit IN NUMBER) IS
    BEGIN
      IF NVL(p_debit, 0) = 0 AND NVL(p_credit, 0) = 0 THEN RETURN; END IF;
      v_gl.EXTEND;
      v_gl(v_gl.COUNT) := erp_line_t(p_account, NVL(p_debit, 0), NVL(p_credit, 0), NULL);
    END add_gl;

    PROCEDURE bump (p_map IN OUT NOCOPY t_amt, p_key IN VARCHAR2, p_amount IN NUMBER) IS
    BEGIN
      IF p_map.EXISTS(p_key) THEN p_map(p_key) := p_map(p_key) + p_amount; ELSE p_map(p_key) := p_amount; END IF;
    END bump;
  BEGIN
    SAVEPOINT erp_notes_create;

    IF p_type IS NULL OR p_type NOT IN ('CREDIT', 'DEBIT') THEN
      RAISE_APPLICATION_ERROR(-20961, 'نوع الإشعار: CREDIT أو DEBIT');
    END IF;
    IF p_date IS NULL THEN RAISE_APPLICATION_ERROR(-20962, 'تاريخ الإشعار مطلوب'); END IF;
    IF TRIM(p_reason) IS NULL THEN RAISE_APPLICATION_ERROR(-20963, 'سبب الإشعار مطلوب'); END IF;
    IF p_lines IS NULL OR p_lines.COUNT = 0 THEN RAISE_APPLICATION_ERROR(-20964, 'الإشعار يحتاج بنداً واحداً على الأقل'); END IF;
    v_credit := (p_type = 'CREDIT');

    BEGIN
      SELECT * INTO v_inv FROM erp_invoices WHERE invoice_id = p_invoice_id FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20960, 'الفاتورة رقم ' || p_invoice_id || ' غير موجودة');
    END;
    IF v_inv.status <> 'OPEN' THEN RAISE_APPLICATION_ERROR(-20960, 'الفاتورة ' || v_inv.invoice_no || ' ملغاة'); END IF;
    v_sales := (v_inv.kind = 'SALES');
    SELECT * INTO v_party FROM erp_parties WHERE party_id = v_inv.party_id;

    -- التحقق من البنود وحساب المبالغ (بلا أثر على المخزون بعد)
    FOR i IN 1 .. p_lines.COUNT LOOP
      v_price := NVL(p_lines(i).price, -1);
      v_rate  := NVL(p_lines(i).vat_rate, 0);
      IF NVL(p_lines(i).qty, 0) <= 0 OR p_lines(i).qty <> ROUND(p_lines(i).qty, 3)
         OR v_price < 0 OR v_price <> ROUND(v_price, 2) OR v_rate < 0 OR v_rate > 100 THEN
        RAISE_APPLICATION_ERROR(-20964, 'البند ' || i || ': كمية أو سعر أو نسبة ضريبة غير صالحة');
      END IF;
      v_stock(i) := 'N';
      v_cost(i)  := NULL;

      IF p_lines(i).orig_line_id IS NOT NULL THEN
        IF NOT v_credit THEN RAISE_APPLICATION_ERROR(-20965, 'البند ' || i || ': الإشعار المدين لا يرتبط ببند أصلي'); END IF;
        BEGIN
          SELECT * INTO v_ol FROM erp_invoice_lines WHERE line_id = p_lines(i).orig_line_id AND invoice_id = p_invoice_id;
        EXCEPTION
          WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20965, 'البند ' || i || ': ليس من بنود الفاتورة ' || v_inv.invoice_no);
        END;
        v_stk := (v_ol.item_id IS NOT NULL AND NVL(p_lines(i).restock, 'Y') = 'Y');
        -- ما أُشعِر عنه سابقاً: كمية المرتجع المخزني (للبنود المخزنية فقط) وقيمة الصافي (لكل الإشعارات السارية على البند)
        SELECT NVL(SUM(CASE WHEN l.item_id IS NOT NULL THEN l.qty END), 0), NVL(SUM(l.net), 0) INTO v_done, v_vdone
          FROM erp_note_lines l JOIN erp_notes n ON n.note_id = l.note_id
         WHERE l.orig_line_id = v_ol.line_id AND n.status = 'OPEN';
        IF v_used.EXISTS(v_ol.line_id)  THEN v_done  := v_done  + v_used(v_ol.line_id);  END IF;
        IF v_usedv.EXISTS(v_ol.line_id) THEN v_vdone := v_vdone + v_usedv(v_ol.line_id); END IF;
        IF p_lines(i).qty > v_ol.qty THEN
          RAISE_APPLICATION_ERROR(-20965, 'البند ' || i || ': الكمية تتجاوز كمية البند الأصلي (' || v_ol.qty || ')');
        END IF;
        IF v_stk AND p_lines(i).qty + v_done > v_ol.qty THEN
          RAISE_APPLICATION_ERROR(-20965, 'البند ' || i || ': الكمية تتجاوز المتاح للإرجاع (الأصلية ' || v_ol.qty || '، المُرجَعة سابقاً ' || v_done || ')');
        END IF;
        IF v_price > v_ol.price THEN
          RAISE_APPLICATION_ERROR(-20966, 'البند ' || i || ': السعر أعلى من سعر الفاتورة الأصلي (' || v_ol.price || ')');
        END IF;
        IF ROUND(p_lines(i).qty * v_price, 2) + v_vdone > v_ol.net THEN
          RAISE_APPLICATION_ERROR(-20965, 'البند ' || i || ': قيمة الإشعارات على هذا البند تتجاوز قيمته في الفاتورة (' || v_ol.net || ')');
        END IF;
        IF v_stk THEN
          IF v_used.EXISTS(v_ol.line_id) THEN v_used(v_ol.line_id) := v_used(v_ol.line_id) + p_lines(i).qty; ELSE v_used(v_ol.line_id) := p_lines(i).qty; END IF;
        END IF;
        IF v_usedv.EXISTS(v_ol.line_id) THEN v_usedv(v_ol.line_id) := v_usedv(v_ol.line_id) + ROUND(p_lines(i).qty * v_price, 2);
        ELSE v_usedv(v_ol.line_id) := ROUND(p_lines(i).qty * v_price, 2); END IF;
        v_acct(i) := v_ol.account_code;
        IF v_stk THEN v_stock(i) := 'Y'; END IF;
      ELSE
        v_code := NVL(p_lines(i).account_code, CASE WHEN v_sales THEN c_sales ELSE c_cogs END);
        BEGIN
          SELECT acc_type INTO v_type FROM erp_accounts WHERE code = v_code AND active = 'Y';
        EXCEPTION
          WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20967, 'البند ' || i || ': الحساب ' || v_code || ' غير موجود أو موقوف');
        END;
        IF (v_sales AND v_type <> 'REVENUE') OR (NOT v_sales AND v_type NOT IN ('EXPENSE', 'ASSET')) THEN
          RAISE_APPLICATION_ERROR(-20967, 'البند ' || i || ': الحساب ' || v_code || ' لا يناسب نوع الإشعار');
        END IF;
        v_acct(i) := v_code;
      END IF;

      v_net(i) := ROUND(p_lines(i).qty * v_price, 2);
      v_vat(i) := ROUND(v_net(i) * v_rate / 100, 2);
      v_subtotal := v_subtotal + v_net(i);
      v_vat_sum  := v_vat_sum + v_vat(i);
    END LOOP;
    v_total := v_subtotal + v_vat_sum;
    IF v_total <= 0 THEN RAISE_APPLICATION_ERROR(-20964, 'إجمالي الإشعار يجب أن يكون أكبر من صفر'); END IF;

    -- حدود الفاتورة والمردود
    SELECT NVL(SUM(CASE WHEN note_type = 'CREDIT' THEN total END), 0), NVL(SUM(CASE WHEN note_type = 'DEBIT' THEN total END), 0)
      INTO v_cr_prev, v_db_prev FROM erp_notes WHERE invoice_id = p_invoice_id AND status = 'OPEN';
    v_net_prev := erp_note_net(p_invoice_id);
    IF v_credit THEN
      IF v_cr_prev + v_total > v_inv.total + v_db_prev THEN
        RAISE_APPLICATION_ERROR(-20968, 'مجموع الإشعارات الدائنة (' || TO_CHAR(v_cr_prev + v_total) || ') يتجاوز قيمة الفاتورة (' || TO_CHAR(v_inv.total + v_db_prev) || ')');
      END IF;
      v_rem_after := v_inv.total + v_net_prev - v_total - v_inv.paid;
      IF v_refund < 0 OR v_refund <> ROUND(v_refund, 2) THEN
        RAISE_APPLICATION_ERROR(-20969, 'المبلغ المردود غير صالح');
      END IF;
      IF v_refund > 0 AND (p_refund_method IS NULL OR p_refund_method NOT IN ('CASH', 'BANK')) THEN
        RAISE_APPLICATION_ERROR(-20969, 'طريقة الرد: CASH أو BANK');
      END IF;
      IF v_refund > GREATEST(-v_rem_after, 0) THEN
        RAISE_APPLICATION_ERROR(-20969, 'المبلغ المردود (' || v_refund || ') أكبر مما دُفع زيادة على الفاتورة بعد الإشعار (' || GREATEST(-v_rem_after, 0) || ')');
      END IF;
      IF v_rem_after + v_refund < 0 THEN
        RAISE_APPLICATION_ERROR(-20968, 'الفاتورة مسدَّدة بأكثر من قيمتها بعد الإشعار بمقدار ' || TO_CHAR(-v_rem_after) || ': حدّد المبلغ المردود (نقداً أو بنك)');
      END IF;
    ELSIF v_refund > 0 THEN
      RAISE_APPLICATION_ERROR(-20969, 'لا رد مبلغ في الإشعار المدين');
    END IF;

    -- الرقم بلا فجوات ثم رقم الإشعار الداخلي (يلزم قبل حركات المخزون لأنها تشير إليه)
    v_ctr  := CASE WHEN v_sales THEN 'SALES_' ELSE 'PURCH_' END || CASE WHEN v_credit THEN 'CN' ELSE 'DN' END;
    v_pref := CASE WHEN v_sales THEN 'S' ELSE 'P' END || CASE WHEN v_credit THEN 'CN-' ELSE 'DN-' END;
    UPDATE erp_counters SET last_no = last_no + 1 WHERE name = v_ctr RETURNING last_no INTO v_no;
    IF v_no IS NULL THEN RAISE_APPLICATION_ERROR(-20961, 'عدّاد الإشعارات غير موجود: شغّل ترقية القاعدة (upgrade.sql)'); END IF;
    v_number := v_pref || LPAD(v_no, 6, '0');
    v_id := erp_note_seq.NEXTVAL;

    -- حركات المخزون
    FOR i IN 1 .. p_lines.COUNT LOOP
      IF v_stock(i) = 'Y' THEN
        SELECT * INTO v_ol FROM erp_invoice_lines WHERE line_id = p_lines(i).orig_line_id;
        SELECT * INTO v_item FROM erp_items WHERE item_id = v_ol.item_id;
        IF v_sales THEN
          -- مرتجع مبيعات: يعود الصنف بتكلفته الأصلية (تكلفة البند ÷ كميته)
          v_unit := NVL(v_ol.cost, 0) / v_ol.qty;
          v_cost(i) := ROUND(v_unit * p_lines(i).qty, 2);
          erp_inventory.stock_in(v_ol.item_id, v_ol.wh_id, p_date, p_lines(i).qty, v_cost(i), 'REVERSAL', 'NOTE', v_id);
          bump(v_inv_dr,  v_item.inv_account,  v_cost(i));
          bump(v_cogs_cr, v_item.cogs_account, v_cost(i));
          v_stock_sum := v_stock_sum + v_cost(i);
        ELSE
          -- مرتجع مشتريات: يخرج بتكلفة المتوسط الحالي؛ الفرق عن صافي الإشعار يذهب إلى 5500
          v_cost(i) := erp_inventory.stock_out(v_ol.item_id, v_ol.wh_id, p_date, p_lines(i).qty, 'REVERSAL', 'NOTE', v_id);
          v_variance := v_variance + (v_net(i) - v_cost(i));
        END IF;
      END IF;
      bump(v_by_acct, v_acct(i), CASE WHEN NOT v_sales AND v_stock(i) = 'Y' THEN v_cost(i) ELSE v_net(i) END);
    END LOOP;

    -- قيد الإشعار
    IF v_sales THEN
      IF v_credit THEN
        v_code := v_by_acct.FIRST;
        WHILE v_code IS NOT NULL LOOP add_gl(v_code, v_by_acct(v_code), 0); v_code := v_by_acct.NEXT(v_code); END LOOP;
        add_gl(c_vat, v_vat_sum, 0);
        add_gl(c_ar, 0, v_total);
        IF v_refund > 0 THEN
          add_gl(c_ar, v_refund, 0);
          add_gl(CASE p_refund_method WHEN 'CASH' THEN c_cash ELSE c_bank END, 0, v_refund);
        END IF;
      ELSE
        add_gl(c_ar, v_total, 0);
        v_code := v_by_acct.FIRST;
        WHILE v_code IS NOT NULL LOOP add_gl(v_code, 0, v_by_acct(v_code)); v_code := v_by_acct.NEXT(v_code); END LOOP;
        add_gl(c_vat, 0, v_vat_sum);
      END IF;
    ELSE
      IF v_credit THEN
        add_gl(c_ap, v_total, 0);
        v_code := v_by_acct.FIRST;
        WHILE v_code IS NOT NULL LOOP add_gl(v_code, 0, v_by_acct(v_code)); v_code := v_by_acct.NEXT(v_code); END LOOP;
        add_gl(c_vat, 0, v_vat_sum);
        IF v_variance > 0 THEN add_gl(c_var, 0, v_variance); ELSIF v_variance < 0 THEN add_gl(c_var, -v_variance, 0); END IF;
        IF v_refund > 0 THEN
          add_gl(CASE p_refund_method WHEN 'CASH' THEN c_cash ELSE c_bank END, v_refund, 0);
          add_gl(c_ap, 0, v_refund);
        END IF;
      ELSE
        v_code := v_by_acct.FIRST;
        WHILE v_code IS NOT NULL LOOP add_gl(v_code, v_by_acct(v_code), 0); v_code := v_by_acct.NEXT(v_code); END LOOP;
        add_gl(c_vat, v_vat_sum, 0);
        add_gl(c_ap, 0, v_total);
      END IF;
    END IF;

    v_entry := erp_gl.post_entry(
      p_date,
      CASE WHEN v_credit THEN 'إشعار دائن ' ELSE 'إشعار مدين ' END || CASE WHEN v_sales THEN 'مبيعات ' ELSE 'مشتريات ' END
        || v_number || ' — ' || v_party.name || ' (فاتورة ' || v_inv.invoice_no || ')',
      v_number, v_gl);

    -- قيد تكلفة مرتجع المبيعات المخزني: مدين المخزون / دائن تكلفة المبيعات
    IF v_stock_sum > 0 THEN
      v_gl := erp_line_tab();
      v_code := v_inv_dr.FIRST;
      WHILE v_code IS NOT NULL LOOP add_gl(v_code, v_inv_dr(v_code), 0); v_code := v_inv_dr.NEXT(v_code); END LOOP;
      v_code := v_cogs_cr.FIRST;
      WHILE v_code IS NOT NULL LOOP add_gl(v_code, 0, v_cogs_cr(v_code)); v_code := v_cogs_cr.NEXT(v_code); END LOOP;
      v_stock_ent := erp_gl.post_entry(p_date, 'تكلفة مرتجع إشعار ' || v_number, v_number, v_gl);
    END IF;

    INSERT INTO erp_notes (note_id, note_no, doc_kind, note_type, invoice_id, party_id, note_date, reason,
                           subtotal, vat_amount, total, refund, refund_method, entry_id, stock_entry_id)
    VALUES (v_id, v_number, v_inv.kind, p_type, p_invoice_id, v_inv.party_id, TRUNC(p_date), SUBSTR(TRIM(p_reason), 1, 300),
            v_subtotal, v_vat_sum, v_total, v_refund, CASE WHEN v_refund > 0 THEN p_refund_method END, v_entry, v_stock_ent);

    FOR i IN 1 .. p_lines.COUNT LOOP
      INSERT INTO erp_note_lines (note_id, description, qty, price, vat_rate, account_code, net, vat, orig_line_id, item_id, wh_id, cost)
      VALUES (v_id, NVL(SUBSTR(TRIM(p_lines(i).description), 1, 200), '—'), p_lines(i).qty, p_lines(i).price, NVL(p_lines(i).vat_rate, 0),
              v_acct(i), v_net(i), v_vat(i), p_lines(i).orig_line_id,
              CASE WHEN v_stock(i) = 'Y' THEN v_ol.item_id END, CASE WHEN v_stock(i) = 'Y' THEN v_ol.wh_id END, v_cost(i));
    END LOOP;
    RETURN v_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_notes_create;
      RAISE;
  END create_note;

  PROCEDURE void_note (p_note_id IN NUMBER) IS
    v_n         erp_notes%ROWTYPE;
    v_inv       erp_invoices%ROWTYPE;
    v_effect    NUMBER;
    v_rem_after NUMBER;
    v_cr_o      NUMBER;
    v_db_o      NUMBER;
    v_rev       NUMBER;
    v_rev_stock NUMBER;
  BEGIN
    SAVEPOINT erp_notes_void;
    BEGIN
      SELECT * INTO v_n FROM erp_notes WHERE note_id = p_note_id FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20970, 'الإشعار رقم ' || p_note_id || ' غير موجود');
    END;
    IF v_n.status <> 'OPEN' THEN RAISE_APPLICATION_ERROR(-20971, 'الإشعار ' || v_n.note_no || ' ملغى مسبقاً'); END IF;
    SELECT * INTO v_inv FROM erp_invoices WHERE invoice_id = v_n.invoice_id FOR UPDATE;

    v_effect := CASE v_n.note_type WHEN 'DEBIT' THEN v_n.total ELSE v_n.refund - v_n.total END;
    v_rem_after := v_inv.total + (erp_note_net(v_n.invoice_id) - v_effect) - v_inv.paid;
    SELECT NVL(SUM(CASE WHEN note_type = 'CREDIT' THEN total END), 0), NVL(SUM(CASE WHEN note_type = 'DEBIT' THEN total END), 0)
      INTO v_cr_o, v_db_o FROM erp_notes WHERE invoice_id = v_n.invoice_id AND status = 'OPEN' AND note_id <> v_n.note_id;
    IF v_rem_after < 0 OR v_cr_o > v_inv.total + v_db_o THEN
      RAISE_APPLICATION_ERROR(-20972, 'لا يُلغى الإشعار ' || v_n.note_no || ': يتجاوز المدفوع قيمة الفاتورة بعد إلغائه أو يزيد الدائن عن الفاتورة');
    END IF;

    v_rev := erp_gl.reverse_entry(v_n.entry_id);
    IF v_n.stock_entry_id IS NOT NULL THEN v_rev_stock := erp_gl.reverse_entry(v_n.stock_entry_id); END IF;
    erp_inventory.reverse_doc('NOTE', v_n.note_id);
    UPDATE erp_notes SET status = 'VOID', void_entry_id = v_rev, void_stock_entry_id = v_rev_stock WHERE note_id = v_n.note_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_notes_void;
      RAISE;
  END void_note;

END erp_cdnote;
/
SHOW ERRORS PACKAGE BODY erp_cdnote
