-- ============================================================================
-- 12: حزمة أوامر الشراء ERP_PO (تعتمد على ERP_TRADE وERP_INVENTORY)
-- أمر الشراء التزام مع المورد بلا أثر محاسبي. الاستلام (RECEIVE) ينشئ فاتورة مشتريات فعلية عبر ERP_TRADE.CREATE_INVOICE
-- فتدخل البضاعة المخزن بصافي البند ويُرحَّل القيد، كله في معاملة واحدة (والفاتورة والاستلام يُحفظان أو يفشلان معاً).
--   DRAFT (قابل للتعديل واستبدال البنود) ← APPROVED (البنود مقفلة) ← PARTIAL ← RECEIVED
--   CLOSED: أُغلق ما تبقى من أمر مستلم جزئياً. CANCELLED: أمر لم يُستلم منه شيء.
-- الاستلام الزائد عن المطلوب مرفوض. سعر الفاتورة الفعلي قد يختلف عن سعر الأمر (يُسجَّل الفرق في بنود الاستلام).
-- فصل المهام: إن ضُبط الإعداد PO_APPROVAL_LIMIT فالأمر ذو الإجمالي ≥ الحد لا يعتمده من أنشأه.
-- الإلغاء: استلام يُلغى عبر VOID_RECEIPT (يلغي الفاتورة ويعيد الكميات)، ولا تُلغى فاتورته مباشرة في ERP_TRADE.
--
-- رموز الأخطاء:
--   -20901 مورد/بيانات غير صالحة                  -20905 كمية/سعر استلام غير صالح أو يتجاوز المتبقي
--   -20902 حالة الأمر لا تسمح بالعملية             -20906 أمر شراء غير موجود
--   -20903 يلزم معتمد غير منشئ الأمر               -20907 استلام غير موجود أو غير فعّال
--   -20904 بند غير صالح                            -20908 إعداد غير معروف أو قيمة غير صالحة
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_po AS
  FUNCTION create_po (
    p_party_id IN NUMBER,
    p_date     IN DATE,
    p_expected IN DATE,
    p_notes    IN VARCHAR2,
    p_lines    IN erp_po_line_tab
  ) RETURN NUMBER;

  -- استبدال كل بنود مسودة
  PROCEDURE replace_lines (p_po_id IN NUMBER, p_lines IN erp_po_line_tab);

  PROCEDURE approve_po (p_po_id IN NUMBER);
  PROCEDURE cancel_po  (p_po_id IN NUMBER);
  PROCEDURE close_po   (p_po_id IN NUMBER);

  -- استلام كل أو بعض البنود: ينشئ فاتورة مشتريات ويحدّث الكميات المستلمة. يعيد رقم الاستلام.
  FUNCTION receive (
    p_po_id IN NUMBER,
    p_date  IN DATE,
    p_ref   IN VARCHAR2,                 -- رقم فاتورة المورد
    p_lines IN erp_po_rcv_tab,
    p_note  IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER;

  PROCEDURE void_receipt (p_receipt_id IN NUMBER);

  -- إعدادات: PO_APPROVAL_LIMIT (مبلغ). القيمة NULL تحذف الإعداد.
  PROCEDURE set_setting (p_name IN VARCHAR2, p_value IN VARCHAR2);
  FUNCTION get_setting (p_name IN VARCHAR2) RETURN VARCHAR2;
END erp_po;
/

CREATE OR REPLACE PACKAGE BODY erp_po AS

  FUNCTION get_po (p_po_id IN NUMBER, p_lock IN BOOLEAN DEFAULT FALSE) RETURN erp_purchase_orders%ROWTYPE IS
    v erp_purchase_orders%ROWTYPE;
  BEGIN
    IF p_lock THEN
      SELECT * INTO v FROM erp_purchase_orders WHERE po_id = p_po_id FOR UPDATE;
    ELSE
      SELECT * INTO v FROM erp_purchase_orders WHERE po_id = p_po_id;
    END IF;
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20906, 'أمر الشراء رقم ' || p_po_id || ' غير موجود');
  END get_po;

  -- يتحقق من البنود ويدرجها ويحدّث إجماليات الأمر
  PROCEDURE insert_lines (p_po_id IN NUMBER, p_lines IN erp_po_line_tab) IS
    v_item erp_items%ROWTYPE;
    v_type erp_accounts.acc_type%TYPE;
    v_wh_active erp_warehouses.active%TYPE;
    v_desc VARCHAR2(200);
    v_rate NUMBER;
    v_net  NUMBER; v_vat NUMBER;
    v_sub  NUMBER := 0; v_vat_sum NUMBER := 0;
    v_acct VARCHAR2(12);
  BEGIN
    IF p_lines IS NULL OR p_lines.COUNT = 0 THEN
      RAISE_APPLICATION_ERROR(-20904, 'الأمر يحتاج بنداً واحداً على الأقل');
    END IF;
    FOR i IN 1 .. p_lines.COUNT LOOP
      v_desc := p_lines(i).description;
      v_rate := p_lines(i).vat_rate;
      v_acct := p_lines(i).account_code;
      IF p_lines(i).item_id IS NOT NULL THEN
        BEGIN
          SELECT * INTO v_item FROM erp_items WHERE item_id = p_lines(i).item_id;
        EXCEPTION
          WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20904, 'البند ' || i || ': الصنف غير موجود');
        END;
        IF v_item.active <> 'Y' THEN
          RAISE_APPLICATION_ERROR(-20904, 'البند ' || i || ': الصنف ' || v_item.code || ' موقوف');
        END IF;
        v_desc := NVL(TRIM(v_desc), v_item.name);
        v_rate := NVL(v_rate, v_item.vat_rate);
        IF v_item.track_stock = 'Y' THEN
          IF p_lines(i).wh_id IS NULL THEN
            RAISE_APPLICATION_ERROR(-20904, 'البند ' || i || ': مخزن الاستلام مطلوب للصنف ' || v_item.code);
          END IF;
          BEGIN
            SELECT active INTO v_wh_active FROM erp_warehouses WHERE wh_id = p_lines(i).wh_id;
          EXCEPTION
            WHEN NO_DATA_FOUND THEN
              RAISE_APPLICATION_ERROR(-20904, 'البند ' || i || ': المخزن غير موجود');
          END;
          IF v_wh_active <> 'Y' THEN
            RAISE_APPLICATION_ERROR(-20904, 'البند ' || i || ': المخزن موقوف');
          END IF;
          v_acct := NULL;                       -- يُرحَّل إلى حساب مخزون الصنف عند الاستلام
        ELSIF v_acct IS NULL THEN
          v_acct := '5100';                     -- صنف غير مخزني (خدمة) بلا حساب: تكلفة البضاعة/الخدمات
        END IF;
      ELSE
        IF v_desc IS NULL OR TRIM(v_desc) IS NULL THEN
          RAISE_APPLICATION_ERROR(-20904, 'البند ' || i || ': الوصف مطلوب لبند بلا صنف');
        END IF;
        IF v_acct IS NULL THEN
          RAISE_APPLICATION_ERROR(-20904, 'البند ' || i || ': الحساب مطلوب لبند بلا صنف');
        END IF;
      END IF;
      IF v_acct IS NOT NULL THEN
        BEGIN
          SELECT acc_type INTO v_type FROM erp_accounts WHERE code = v_acct;
        EXCEPTION
          WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20904, 'البند ' || i || ': الحساب ' || v_acct || ' غير موجود');
        END;
        IF v_type NOT IN ('EXPENSE', 'ASSET') THEN
          RAISE_APPLICATION_ERROR(-20904, 'البند ' || i || ': حساب المشتريات يجب أن يكون مصروفاً أو أصلاً');
        END IF;
      END IF;
      v_rate := NVL(v_rate, 0);
      IF NVL(p_lines(i).qty, 0) <= 0 OR p_lines(i).qty <> ROUND(p_lines(i).qty, 3)
         OR NVL(p_lines(i).price, -1) < 0 OR p_lines(i).price <> ROUND(p_lines(i).price, 2) OR v_rate < 0 OR v_rate > 100 THEN
        RAISE_APPLICATION_ERROR(-20904, 'البند ' || i || ': كمية (ثلاث منازل) أو سعر (منزلتان) أو نسبة ضريبة غير صالحة');
      END IF;
      v_net := ROUND(p_lines(i).qty * p_lines(i).price, 2);
      v_vat := ROUND(v_net * v_rate / 100, 2);
      INSERT INTO erp_po_lines (po_id, line_no, item_id, wh_id, description, qty, price, vat_rate, account_code, net, vat)
      VALUES (p_po_id, i, p_lines(i).item_id, p_lines(i).wh_id, SUBSTR(TRIM(v_desc), 1, 200), p_lines(i).qty, p_lines(i).price,
              v_rate, v_acct, v_net, v_vat);
      v_sub := v_sub + v_net; v_vat_sum := v_vat_sum + v_vat;
    END LOOP;
    UPDATE erp_purchase_orders SET subtotal = v_sub, vat_amount = v_vat_sum, total = v_sub + v_vat_sum WHERE po_id = p_po_id;
  END insert_lines;

  FUNCTION create_po (
    p_party_id IN NUMBER,
    p_date     IN DATE,
    p_expected IN DATE,
    p_notes    IN VARCHAR2,
    p_lines    IN erp_po_line_tab
  ) RETURN NUMBER IS
    v_kind erp_parties.kind%TYPE;
    v_no   NUMBER;
    v_id   erp_purchase_orders.po_id%TYPE;
  BEGIN
    SAVEPOINT erp_po_create;
    IF p_date IS NULL THEN
      RAISE_APPLICATION_ERROR(-20901, 'تاريخ الأمر مطلوب');
    END IF;
    IF p_expected IS NOT NULL AND TRUNC(p_expected) < TRUNC(p_date) THEN
      RAISE_APPLICATION_ERROR(-20901, 'تاريخ التوريد المتوقع قبل تاريخ الأمر');
    END IF;
    BEGIN
      SELECT kind INTO v_kind FROM erp_parties WHERE party_id = p_party_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20901, 'الطرف رقم ' || p_party_id || ' غير موجود');
    END;
    IF v_kind <> 'SUPPLIER' THEN
      RAISE_APPLICATION_ERROR(-20901, 'أمر الشراء يحتاج مورداً');
    END IF;
    UPDATE erp_counters SET last_no = last_no + 1 WHERE name = 'PO' RETURNING last_no INTO v_no;
    INSERT INTO erp_purchase_orders (po_no, party_id, po_date, expected_date, notes)
    VALUES ('PO-' || LPAD(v_no, 6, '0'), p_party_id, TRUNC(p_date), TRUNC(p_expected), SUBSTR(p_notes, 1, 300))
    RETURNING po_id INTO v_id;
    insert_lines(v_id, p_lines);
    RETURN v_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_po_create;
      RAISE;
  END create_po;

  PROCEDURE replace_lines (p_po_id IN NUMBER, p_lines IN erp_po_line_tab) IS
    v_po erp_purchase_orders%ROWTYPE;
  BEGIN
    SAVEPOINT erp_po_replace;
    v_po := get_po(p_po_id, TRUE);
    IF v_po.status <> 'DRAFT' THEN
      RAISE_APPLICATION_ERROR(-20902, 'تُعدَّل بنود المسودة فقط (حالة الأمر ' || v_po.status || ')');
    END IF;
    DELETE FROM erp_po_lines WHERE po_id = p_po_id;
    insert_lines(p_po_id, p_lines);
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_po_replace;
      RAISE;
  END replace_lines;

  PROCEDURE approve_po (p_po_id IN NUMBER) IS
    v_po    erp_purchase_orders%ROWTYPE;
    v_limit NUMBER;
    v_user  VARCHAR2(128) := SYS_CONTEXT('USERENV', 'SESSION_USER');
  BEGIN
    SAVEPOINT erp_po_approve;
    v_po := get_po(p_po_id, TRUE);
    IF v_po.status <> 'DRAFT' THEN
      RAISE_APPLICATION_ERROR(-20902, 'يُعتمد الأمر من حالة DRAFT (الحالة ' || v_po.status || ')');
    END IF;
    IF v_po.total <= 0 THEN
      RAISE_APPLICATION_ERROR(-20904, 'لا يُعتمد أمر بإجمالي صفر');
    END IF;
    BEGIN
      v_limit := TO_NUMBER(get_setting('PO_APPROVAL_LIMIT'));
    EXCEPTION
      WHEN VALUE_ERROR OR INVALID_NUMBER THEN
        RAISE_APPLICATION_ERROR(-20908, 'قيمة الإعداد PO_APPROVAL_LIMIT غير رقمية');
    END;
    IF v_limit IS NOT NULL AND v_po.total >= v_limit AND v_po.created_by = v_user THEN
      RAISE_APPLICATION_ERROR(-20903, 'الأمر بإجمالي ' || TO_CHAR(v_po.total) || ' (≥ حد الاعتماد ' || TO_CHAR(v_limit) || ') يلزمه معتمد غير منشئه');
    END IF;
    UPDATE erp_purchase_orders SET status = 'APPROVED', approved_by = v_user, approved_at = SYSTIMESTAMP WHERE po_id = p_po_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_po_approve;
      RAISE;
  END approve_po;

  PROCEDURE cancel_po (p_po_id IN NUMBER) IS
    v_po erp_purchase_orders%ROWTYPE;
    v_n  NUMBER;
  BEGIN
    v_po := get_po(p_po_id, TRUE);
    IF v_po.status NOT IN ('DRAFT', 'APPROVED') THEN
      RAISE_APPLICATION_ERROR(-20902, 'يُلغى الأمر من DRAFT أو APPROVED فقط (الحالة ' || v_po.status || ')؛ استخدم الإغلاق لأمر استُلم بعضه');
    END IF;
    SELECT COUNT(*) INTO v_n FROM erp_po_receipts WHERE po_id = p_po_id AND status = 'ACTIVE';
    IF v_n > 0 THEN
      RAISE_APPLICATION_ERROR(-20902, 'للأمر استلامات فعّالة: أغلقه بدل إلغائه');
    END IF;
    UPDATE erp_purchase_orders SET status = 'CANCELLED' WHERE po_id = p_po_id;
  END cancel_po;

  PROCEDURE close_po (p_po_id IN NUMBER) IS
    v_po erp_purchase_orders%ROWTYPE;
  BEGIN
    v_po := get_po(p_po_id, TRUE);
    IF v_po.status NOT IN ('APPROVED', 'PARTIAL') THEN
      RAISE_APPLICATION_ERROR(-20902, 'يُغلق الأمر المعتمد أو المستلم جزئياً فقط (الحالة ' || v_po.status || ')');
    END IF;
    UPDATE erp_purchase_orders SET status = 'CLOSED' WHERE po_id = p_po_id;
  END close_po;

  -- حالة الأمر من الكميات المستلمة
  PROCEDURE recompute_status (p_po_id IN NUMBER) IS
    v_recv NUMBER; v_open NUMBER;
  BEGIN
    SELECT NVL(SUM(received_qty), 0), NVL(SUM(CASE WHEN received_qty < qty THEN 1 ELSE 0 END), 0)
      INTO v_recv, v_open FROM erp_po_lines WHERE po_id = p_po_id;
    UPDATE erp_purchase_orders
       SET status = CASE WHEN v_recv = 0 THEN 'APPROVED' WHEN v_open = 0 THEN 'RECEIVED' ELSE 'PARTIAL' END
     WHERE po_id = p_po_id AND status IN ('APPROVED', 'PARTIAL', 'RECEIVED');
  END recompute_status;

  FUNCTION receive (
    p_po_id IN NUMBER,
    p_date  IN DATE,
    p_ref   IN VARCHAR2,
    p_lines IN erp_po_rcv_tab,
    p_note  IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER IS
    TYPE t_nums IS TABLE OF NUMBER INDEX BY PLS_INTEGER;
    TYPE t_flags IS TABLE OF NUMBER INDEX BY VARCHAR2(20);
    v_po     erp_purchase_orders%ROWTYPE;
    v_ln     erp_po_lines%ROWTYPE;
    v_item   erp_items%ROWTYPE;
    v_seen   t_flags;
    v_ids    t_nums; v_qty t_nums; v_price t_nums; v_poprice t_nums;
    v_inv_lines erp_inv_line_tab := erp_inv_line_tab();
    v_p      NUMBER;
    v_inv    NUMBER;
    v_rc     NUMBER;
  BEGIN
    SAVEPOINT erp_po_receive;
    v_po := get_po(p_po_id, TRUE);
    IF v_po.status NOT IN ('APPROVED', 'PARTIAL') THEN
      RAISE_APPLICATION_ERROR(-20902, 'يُستلم من أمر معتمد أو مستلم جزئياً فقط (الحالة ' || v_po.status || ')');
    END IF;
    IF p_date IS NULL THEN
      RAISE_APPLICATION_ERROR(-20905, 'تاريخ الاستلام مطلوب');
    END IF;
    IF p_lines IS NULL OR p_lines.COUNT = 0 THEN
      RAISE_APPLICATION_ERROR(-20905, 'لا بنود للاستلام');
    END IF;

    FOR i IN 1 .. p_lines.COUNT LOOP
      IF p_lines(i).po_line_id IS NULL OR NVL(p_lines(i).qty, 0) <= 0 OR p_lines(i).qty <> ROUND(p_lines(i).qty, 3) THEN
        RAISE_APPLICATION_ERROR(-20905, 'بند الاستلام ' || i || ': بند أمر وكمية موجبة بثلاث منازل');
      END IF;
      IF v_seen.EXISTS(TO_CHAR(p_lines(i).po_line_id)) THEN
        RAISE_APPLICATION_ERROR(-20905, 'بند أمر مكرر في الاستلام');
      END IF;
      v_seen(TO_CHAR(p_lines(i).po_line_id)) := 1;
      BEGIN
        SELECT * INTO v_ln FROM erp_po_lines WHERE line_id = p_lines(i).po_line_id AND po_id = p_po_id FOR UPDATE;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          RAISE_APPLICATION_ERROR(-20905, 'بند الاستلام ' || i || ' لا يخص هذا الأمر');
      END;
      IF p_lines(i).qty > v_ln.qty - v_ln.received_qty THEN
        RAISE_APPLICATION_ERROR(-20905, 'بند الاستلام ' || i || ': الكمية ' || TO_CHAR(p_lines(i).qty) || ' تتجاوز المتبقي ' || TO_CHAR(v_ln.qty - v_ln.received_qty));
      END IF;
      v_p := NVL(p_lines(i).price, v_ln.price);
      IF v_p < 0 OR v_p <> ROUND(v_p, 2) THEN
        RAISE_APPLICATION_ERROR(-20905, 'بند الاستلام ' || i || ': سعر غير صالح');
      END IF;
      v_ids(i) := v_ln.line_id; v_qty(i) := p_lines(i).qty; v_price(i) := v_p; v_poprice(i) := v_ln.price;

      -- بند الفاتورة: الصنف المخزني بصنفه ومخزنه (حسابه حساب مخزونه)، وغيره بحسابه
      IF v_ln.item_id IS NOT NULL THEN
        SELECT * INTO v_item FROM erp_items WHERE item_id = v_ln.item_id;
      END IF;
      v_inv_lines.EXTEND;
      IF v_ln.item_id IS NOT NULL AND v_item.track_stock = 'Y' THEN
        v_inv_lines(v_inv_lines.COUNT) := erp_inv_line_t(v_ln.description, p_lines(i).qty, v_p, v_ln.vat_rate, NULL, v_ln.item_id, v_ln.wh_id);
      ELSE
        v_inv_lines(v_inv_lines.COUNT) := erp_inv_line_t(v_ln.description, p_lines(i).qty, v_p, v_ln.vat_rate, v_ln.account_code, NULL, NULL);
      END IF;
    END LOOP;

    v_inv := erp_trade.create_invoice('PURCHASE', v_po.party_id, p_date, NULL, p_ref,
                                      SUBSTR('استلام أمر شراء ' || v_po.po_no || CASE WHEN p_note IS NOT NULL THEN ' — ' || p_note END, 1, 300),
                                      v_inv_lines);
    INSERT INTO erp_po_receipts (po_id, invoice_id, receipt_date, note)
    VALUES (p_po_id, v_inv, TRUNC(p_date), SUBSTR(p_note, 1, 300)) RETURNING receipt_id INTO v_rc;
    FOR i IN 1 .. p_lines.COUNT LOOP
      INSERT INTO erp_po_receipt_lines (receipt_id, po_line_id, qty, price, po_price) VALUES (v_rc, v_ids(i), v_qty(i), v_price(i), v_poprice(i));
      UPDATE erp_po_lines SET received_qty = received_qty + v_qty(i) WHERE line_id = v_ids(i);
    END LOOP;
    recompute_status(p_po_id);
    RETURN v_rc;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_po_receive;
      RAISE;
  END receive;

  PROCEDURE void_receipt (p_receipt_id IN NUMBER) IS
    v_rc erp_po_receipts%ROWTYPE;
  BEGIN
    SAVEPOINT erp_po_void_receipt;
    BEGIN
      SELECT * INTO v_rc FROM erp_po_receipts WHERE receipt_id = p_receipt_id FOR UPDATE;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20907, 'الاستلام رقم ' || p_receipt_id || ' غير موجود');
    END;
    IF v_rc.status <> 'ACTIVE' THEN
      RAISE_APPLICATION_ERROR(-20907, 'الاستلام رقم ' || p_receipt_id || ' ملغى مسبقاً');
    END IF;
    -- يُعلَّم ملغى أولاً ليسمح حارس ERP_TRADE بإلغاء فاتورته (وأي فشل يتراجع كله)
    UPDATE erp_po_receipts SET status = 'VOID' WHERE receipt_id = p_receipt_id;
    erp_trade.void_invoice(v_rc.invoice_id);
    FOR l IN (SELECT po_line_id, qty FROM erp_po_receipt_lines WHERE receipt_id = p_receipt_id) LOOP
      UPDATE erp_po_lines SET received_qty = received_qty - l.qty WHERE line_id = l.po_line_id;
    END LOOP;
    recompute_status(v_rc.po_id);
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_po_void_receipt;
      RAISE;
  END void_receipt;

  PROCEDURE set_setting (p_name IN VARCHAR2, p_value IN VARCHAR2) IS
    v NUMBER;
  BEGIN
    IF p_name IS NULL OR p_name NOT IN ('PO_APPROVAL_LIMIT') THEN
      RAISE_APPLICATION_ERROR(-20908, 'إعداد غير معروف: ' || p_name);
    END IF;
    IF p_value IS NULL THEN
      DELETE FROM erp_settings WHERE name = p_name;
      RETURN;
    END IF;
    BEGIN
      v := TO_NUMBER(p_value);
    EXCEPTION
      WHEN VALUE_ERROR OR INVALID_NUMBER THEN
        RAISE_APPLICATION_ERROR(-20908, 'قيمة الإعداد ' || p_name || ' يجب أن تكون رقماً');
    END;
    IF v < 0 THEN
      RAISE_APPLICATION_ERROR(-20908, 'قيمة الإعداد ' || p_name || ' لا تكون سالبة');
    END IF;
    UPDATE erp_settings SET value = p_value WHERE name = p_name;
    IF SQL%ROWCOUNT = 0 THEN
      INSERT INTO erp_settings (name, value) VALUES (p_name, p_value);
    END IF;
  END set_setting;

  FUNCTION get_setting (p_name IN VARCHAR2) RETURN VARCHAR2 IS
    v erp_settings.value%TYPE;
  BEGIN
    SELECT value INTO v FROM erp_settings WHERE name = p_name;
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END get_setting;

END erp_po;
/
SHOW ERRORS PACKAGE BODY erp_po
