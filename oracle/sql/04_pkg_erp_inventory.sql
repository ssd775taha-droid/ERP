-- ============================================================================
-- 04: حزمة المخازن والأصناف ERP_INVENTORY (تعتمد على ERP_GL)
-- التقييم بالمتوسط المرجّح لكل (صنف، مخزن): تكلفة الوحدة = قيمة الرصيد ÷ كميته.
--   الوارد يرفع الكمية والقيمة معاً؛ الصادر يخرج بتكلفة المتوسط الحالي، وعند إخراج كل الكمية تخرج كل القيمة
--   (لا تبقى كسور قيمة بلا كمية).
-- لا رصيد سالب. لا COMMIT داخل الحزمة، وكل إجراء عام يتراجع إلى نقطة حفظ خاصة به عند الخطأ.
--
-- رموز الأخطاء:
--   -20301 صنف غير موجود أو موقوف أو غير مخزني   -20306 مخزن غير موجود أو موقوف
--   -20302 الرصيد لا يكفي                          -20307 صنف أو مخزن مكرر / بيانات غير صالحة
--   -20303 تكلفة الوحدة مطلوبة (لا متوسط حالي)     -20308 كمية غير صالحة (موجبة وبثلاث منازل)
--   -20304 المخزنان متطابقان                       -20305 تعذّر عكس الحركة (كان سيجعل الرصيد سالباً)
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_inventory AS
  FUNCTION add_warehouse (p_code IN VARCHAR2, p_name IN VARCHAR2) RETURN NUMBER;

  FUNCTION add_item (
    p_code         IN VARCHAR2,
    p_name         IN VARCHAR2,
    p_unit         IN VARCHAR2 DEFAULT 'قطعة',
    p_sale_price   IN NUMBER   DEFAULT 0,
    p_track_stock  IN VARCHAR2 DEFAULT 'Y',
    p_inv_account  IN VARCHAR2 DEFAULT '1400',
    p_cogs_account IN VARCHAR2 DEFAULT '5100',
    p_rev_account  IN VARCHAR2 DEFAULT '4100',
    p_vat_rate     IN NUMBER   DEFAULT 0,       -- نسبة الضريبة الافتراضية عند البيع (نقاط البيع)
    p_barcode      IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER;

  FUNCTION on_hand  (p_item_id IN NUMBER, p_wh_id IN NUMBER) RETURN NUMBER;
  -- متوسط تكلفة الوحدة الحالي، أو NULL إن لم يوجد رصيد
  FUNCTION avg_cost (p_item_id IN NUMBER, p_wh_id IN NUMBER) RETURN NUMBER;

  -- وارد بقيمة إجمالية معروفة (تستدعيه فاتورة المشتريات). لا يرحّل قيداً: المتصل يرحّل.
  PROCEDURE stock_in (
    p_item_id   IN NUMBER,
    p_wh_id     IN NUMBER,
    p_date      IN DATE,
    p_qty       IN NUMBER,
    p_value     IN NUMBER,
    p_move_type IN VARCHAR2,
    p_ref_type  IN VARCHAR2,
    p_ref_id    IN NUMBER
  );

  -- صادر بتكلفة المتوسط. يعيد قيمة التكلفة (موجبة). لا يرحّل قيداً: المتصل يرحّل.
  FUNCTION stock_out (
    p_item_id   IN NUMBER,
    p_wh_id     IN NUMBER,
    p_date      IN DATE,
    p_qty       IN NUMBER,
    p_move_type IN VARCHAR2,
    p_ref_type  IN VARCHAR2,
    p_ref_id    IN NUMBER
  ) RETURN NUMBER;

  -- عكس كل حركات مستند (فاتورة) غير المعكوسة، بالتكلفة الأصلية نفسها
  PROCEDURE reverse_doc (p_ref_type IN VARCHAR2, p_ref_id IN NUMBER, p_date IN DATE DEFAULT NULL);

  -- هل جرت على أصناف المستند حركات من مستندات أخرى بعده؟ (يمنع إلغاء مشتريات يُفسد التقييم)
  FUNCTION has_later_moves (p_ref_type IN VARCHAR2, p_ref_id IN NUMBER) RETURN BOOLEAN;

  -- تسوية جرد: p_qty_delta موجب = زيادة (تلزم p_unit_cost عند عدم وجود متوسط)، سالب = نقص بتكلفة المتوسط.
  -- يرحّل قيداً مع حساب المقابل (الافتراضي 5500 فروقات المخزون؛ لرصيد افتتاحي استخدم 3100 رأس المال).
  -- يعيد رقم القيد (NULL إن كانت القيمة صفراً فلا قيد).
  FUNCTION adjust (
    p_item_id        IN NUMBER,
    p_wh_id          IN NUMBER,
    p_date           IN DATE,
    p_qty_delta      IN NUMBER,
    p_unit_cost      IN NUMBER   DEFAULT NULL,
    p_offset_account IN VARCHAR2 DEFAULT '5500',
    p_note           IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER;

  -- تحويل بين مخزنين بتكلفة المصدر. لا أثر محاسبي. يعيد قيمة المحوَّل.
  FUNCTION transfer (
    p_item_id IN NUMBER,
    p_from_wh IN NUMBER,
    p_to_wh   IN NUMBER,
    p_date    IN DATE,
    p_qty     IN NUMBER
  ) RETURN NUMBER;
END erp_inventory;
/

CREATE OR REPLACE PACKAGE BODY erp_inventory AS

  FUNCTION get_item (p_item_id IN NUMBER) RETURN erp_items%ROWTYPE IS
    v_row erp_items%ROWTYPE;
  BEGIN
    SELECT * INTO v_row FROM erp_items WHERE item_id = p_item_id;
    IF v_row.active <> 'Y' OR v_row.track_stock <> 'Y' THEN
      RAISE_APPLICATION_ERROR(-20301, 'الصنف ' || v_row.code || ' موقوف أو غير مخزني');
    END IF;
    RETURN v_row;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20301, 'الصنف رقم ' || p_item_id || ' غير موجود');
  END get_item;

  PROCEDURE check_wh (p_wh_id IN NUMBER) IS
    v_active erp_warehouses.active%TYPE;
  BEGIN
    SELECT active INTO v_active FROM erp_warehouses WHERE wh_id = p_wh_id;
    IF v_active <> 'Y' THEN
      RAISE_APPLICATION_ERROR(-20306, 'المخزن رقم ' || p_wh_id || ' موقوف');
    END IF;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20306, 'المخزن رقم ' || p_wh_id || ' غير موجود');
  END check_wh;

  PROCEDURE check_qty (p_qty IN NUMBER) IS
  BEGIN
    IF NVL(p_qty, 0) <= 0 OR p_qty <> ROUND(p_qty, 3) THEN
      RAISE_APPLICATION_ERROR(-20308, 'الكمية يجب أن تكون أكبر من صفر وبثلاث منازل عشرية كحد أقصى');
    END IF;
  END check_qty;

  -- يضمن وجود صف الرصيد ثم يقفله ويعيد (الكمية، القيمة)
  PROCEDURE lock_stock (p_item_id IN NUMBER, p_wh_id IN NUMBER, p_qty OUT NUMBER, p_value OUT NUMBER) IS
  BEGIN
    BEGIN
      INSERT INTO erp_stock (item_id, wh_id, qty, value) VALUES (p_item_id, p_wh_id, 0, 0);
    EXCEPTION
      WHEN DUP_VAL_ON_INDEX THEN NULL;
    END;
    SELECT qty, value INTO p_qty, p_value
      FROM erp_stock WHERE item_id = p_item_id AND wh_id = p_wh_id FOR UPDATE;
  END lock_stock;

  FUNCTION add_warehouse (p_code IN VARCHAR2, p_name IN VARCHAR2) RETURN NUMBER IS
    v_id erp_warehouses.wh_id%TYPE;
  BEGIN
    IF TRIM(p_code) IS NULL OR TRIM(p_name) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20307, 'رمز المخزن واسمه مطلوبان');
    END IF;
    INSERT INTO erp_warehouses (code, name) VALUES (SUBSTR(TRIM(p_code), 1, 12), SUBSTR(TRIM(p_name), 1, 120))
    RETURNING wh_id INTO v_id;
    RETURN v_id;
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      RAISE_APPLICATION_ERROR(-20307, 'رمز المخزن مستخدم');
  END add_warehouse;

  FUNCTION add_item (
    p_code         IN VARCHAR2,
    p_name         IN VARCHAR2,
    p_unit         IN VARCHAR2 DEFAULT 'قطعة',
    p_sale_price   IN NUMBER   DEFAULT 0,
    p_track_stock  IN VARCHAR2 DEFAULT 'Y',
    p_inv_account  IN VARCHAR2 DEFAULT '1400',
    p_cogs_account IN VARCHAR2 DEFAULT '5100',
    p_rev_account  IN VARCHAR2 DEFAULT '4100',
    p_vat_rate     IN NUMBER   DEFAULT 0,
    p_barcode      IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER IS
    v_id   erp_items.item_id%TYPE;
    v_type erp_accounts.acc_type%TYPE;

    PROCEDURE expect_type (p_code IN VARCHAR2, p_expected IN VARCHAR2, p_label IN VARCHAR2) IS
    BEGIN
      SELECT acc_type INTO v_type FROM erp_accounts WHERE code = p_code;
      IF v_type <> p_expected THEN
        RAISE_APPLICATION_ERROR(-20307, 'حساب ' || p_label || ' (' || p_code || ') يجب أن يكون من نوع ' || p_expected);
      END IF;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20307, 'حساب ' || p_label || ' (' || p_code || ') غير موجود');
    END expect_type;
  BEGIN
    IF TRIM(p_code) IS NULL OR TRIM(p_name) IS NULL THEN
      RAISE_APPLICATION_ERROR(-20307, 'رمز الصنف واسمه مطلوبان');
    END IF;
    IF NVL(p_sale_price, 0) < 0 OR NVL(p_sale_price, 0) <> ROUND(NVL(p_sale_price, 0), 2) THEN
      RAISE_APPLICATION_ERROR(-20307, 'سعر البيع غير صالح');
    END IF;
    IF NVL(p_vat_rate, 0) < 0 OR NVL(p_vat_rate, 0) > 100 THEN
      RAISE_APPLICATION_ERROR(-20307, 'نسبة الضريبة بين 0 و100');
    END IF;
    IF p_track_stock NOT IN ('Y', 'N') THEN
      RAISE_APPLICATION_ERROR(-20307, 'تتبّع المخزون: Y أو N');
    END IF;
    expect_type(p_inv_account,  'ASSET',   'المخزون');
    expect_type(p_cogs_account, 'EXPENSE', 'تكلفة المبيعات');
    expect_type(p_rev_account,  'REVENUE', 'الإيراد');
    INSERT INTO erp_items (code, name, unit, sale_price, vat_rate, barcode, track_stock, inv_account, cogs_account, rev_account)
    VALUES (SUBSTR(TRIM(p_code), 1, 30), SUBSTR(TRIM(p_name), 1, 120), NVL(SUBSTR(p_unit, 1, 20), 'قطعة'),
            NVL(p_sale_price, 0), NVL(p_vat_rate, 0), SUBSTR(TRIM(p_barcode), 1, 40), p_track_stock, p_inv_account, p_cogs_account, p_rev_account)
    RETURNING item_id INTO v_id;
    RETURN v_id;
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      RAISE_APPLICATION_ERROR(-20307, 'رمز الصنف أو الباركود مستخدم');
  END add_item;

  FUNCTION on_hand (p_item_id IN NUMBER, p_wh_id IN NUMBER) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    SELECT NVL(MAX(qty), 0) INTO v FROM erp_stock WHERE item_id = p_item_id AND wh_id = p_wh_id;
    RETURN v;
  END on_hand;

  FUNCTION avg_cost (p_item_id IN NUMBER, p_wh_id IN NUMBER) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    SELECT ROUND(value / qty, 4) INTO v FROM erp_stock WHERE item_id = p_item_id AND wh_id = p_wh_id AND qty > 0;
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END avg_cost;

  PROCEDURE stock_in (
    p_item_id   IN NUMBER,
    p_wh_id     IN NUMBER,
    p_date      IN DATE,
    p_qty       IN NUMBER,
    p_value     IN NUMBER,
    p_move_type IN VARCHAR2,
    p_ref_type  IN VARCHAR2,
    p_ref_id    IN NUMBER
  ) IS
    v_item erp_items%ROWTYPE;
    v_qty  NUMBER;
    v_val  NUMBER;
  BEGIN
    SAVEPOINT erp_stock_in;
    v_item := get_item(p_item_id);
    check_wh(p_wh_id);
    check_qty(p_qty);
    IF NVL(p_value, -1) < 0 OR p_value <> ROUND(p_value, 2) THEN
      RAISE_APPLICATION_ERROR(-20307, 'قيمة الوارد غير صالحة');
    END IF;
    lock_stock(p_item_id, p_wh_id, v_qty, v_val);
    UPDATE erp_stock SET qty = qty + p_qty, value = value + p_value WHERE item_id = p_item_id AND wh_id = p_wh_id;
    INSERT INTO erp_stock_moves (move_date, item_id, wh_id, move_type, qty, value, ref_type, ref_id)
    VALUES (TRUNC(p_date), p_item_id, p_wh_id, p_move_type, p_qty, p_value, p_ref_type, p_ref_id);
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_stock_in;
      RAISE;
  END stock_in;

  FUNCTION stock_out (
    p_item_id   IN NUMBER,
    p_wh_id     IN NUMBER,
    p_date      IN DATE,
    p_qty       IN NUMBER,
    p_move_type IN VARCHAR2,
    p_ref_type  IN VARCHAR2,
    p_ref_id    IN NUMBER
  ) RETURN NUMBER IS
    v_item erp_items%ROWTYPE;
    v_qty  NUMBER;
    v_val  NUMBER;
    v_cost NUMBER;
  BEGIN
    SAVEPOINT erp_stock_out;
    v_item := get_item(p_item_id);
    check_wh(p_wh_id);
    check_qty(p_qty);
    lock_stock(p_item_id, p_wh_id, v_qty, v_val);
    IF v_qty < p_qty THEN
      RAISE_APPLICATION_ERROR(-20302,
        'الرصيد لا يكفي للصنف ' || v_item.code || ': المتاح ' || TO_CHAR(v_qty) || ' والمطلوب ' || TO_CHAR(p_qty));
    END IF;
    v_cost := CASE WHEN p_qty = v_qty THEN v_val ELSE ROUND(v_val * p_qty / v_qty, 2) END;
    UPDATE erp_stock SET qty = qty - p_qty, value = value - v_cost WHERE item_id = p_item_id AND wh_id = p_wh_id;
    INSERT INTO erp_stock_moves (move_date, item_id, wh_id, move_type, qty, value, ref_type, ref_id)
    VALUES (TRUNC(p_date), p_item_id, p_wh_id, p_move_type, -p_qty, -v_cost, p_ref_type, p_ref_id);
    RETURN v_cost;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_stock_out;
      RAISE;
  END stock_out;

  PROCEDURE reverse_doc (p_ref_type IN VARCHAR2, p_ref_id IN NUMBER, p_date IN DATE DEFAULT NULL) IS
    v_qty NUMBER;
    v_val NUMBER;
  BEGIN
    SAVEPOINT erp_stock_reverse;
    FOR m IN (
      SELECT * FROM erp_stock_moves o
       WHERE o.ref_type = p_ref_type AND o.ref_id = p_ref_id AND o.reverses IS NULL
         AND NOT EXISTS (SELECT 1 FROM erp_stock_moves r WHERE r.reverses = o.move_id)
       ORDER BY o.move_id DESC
    ) LOOP
      lock_stock(m.item_id, m.wh_id, v_qty, v_val);
      IF v_qty - m.qty < 0 OR v_val - m.value < 0 THEN
        RAISE_APPLICATION_ERROR(-20305, 'تعذّر عكس الحركة رقم ' || m.move_id || ': الرصيد الحالي لا يسمح');
      END IF;
      UPDATE erp_stock SET qty = qty - m.qty, value = value - m.value WHERE item_id = m.item_id AND wh_id = m.wh_id;
      INSERT INTO erp_stock_moves (move_date, item_id, wh_id, move_type, qty, value, ref_type, ref_id, reverses)
      VALUES (TRUNC(NVL(p_date, m.move_date)), m.item_id, m.wh_id, 'REVERSAL', -m.qty, -m.value, m.ref_type, m.ref_id, m.move_id);
    END LOOP;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_stock_reverse;
      RAISE;
  END reverse_doc;

  FUNCTION has_later_moves (p_ref_type IN VARCHAR2, p_ref_id IN NUMBER) RETURN BOOLEAN IS
    v_n NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_n
      FROM erp_stock_moves m1
     WHERE m1.ref_type = p_ref_type AND m1.ref_id = p_ref_id AND m1.reverses IS NULL
       AND EXISTS (SELECT 1 FROM erp_stock_moves m2
                    WHERE m2.item_id = m1.item_id AND m2.wh_id = m1.wh_id AND m2.move_id > m1.move_id
                      AND NOT (m2.ref_type = m1.ref_type AND m2.ref_id = m1.ref_id));
    RETURN v_n > 0;
  END has_later_moves;

  FUNCTION adjust (
    p_item_id        IN NUMBER,
    p_wh_id          IN NUMBER,
    p_date           IN DATE,
    p_qty_delta      IN NUMBER,
    p_unit_cost      IN NUMBER   DEFAULT NULL,
    p_offset_account IN VARCHAR2 DEFAULT '5500',
    p_note           IN VARCHAR2 DEFAULT NULL
  ) RETURN NUMBER IS
    v_item  erp_items%ROWTYPE;
    v_doc   NUMBER;
    v_cost  NUMBER;
    v_unit  NUMBER;
    v_gl    erp_line_tab;
    v_entry NUMBER;
    v_memo  VARCHAR2(300);
  BEGIN
    SAVEPOINT erp_stock_adjust;
    IF p_date IS NULL THEN
      RAISE_APPLICATION_ERROR(-20307, 'تاريخ التسوية مطلوب');
    END IF;
    IF NVL(p_qty_delta, 0) = 0 OR ABS(p_qty_delta) <> ROUND(ABS(p_qty_delta), 3) THEN
      RAISE_APPLICATION_ERROR(-20308, 'كمية التسوية غير صالحة');
    END IF;
    v_item := get_item(p_item_id);
    v_doc  := erp_stock_doc_seq.NEXTVAL;
    v_memo := 'تسوية مخزون ' || v_item.code || CASE WHEN p_note IS NOT NULL THEN ' — ' || SUBSTR(p_note, 1, 150) END;

    IF p_qty_delta > 0 THEN
      v_unit := NVL(p_unit_cost, avg_cost(p_item_id, p_wh_id));
      IF v_unit IS NULL OR v_unit < 0 THEN
        RAISE_APPLICATION_ERROR(-20303, 'تكلفة الوحدة مطلوبة: لا يوجد متوسط حالي للصنف في هذا المخزن');
      END IF;
      v_cost := ROUND(p_qty_delta * v_unit, 2);
      stock_in(p_item_id, p_wh_id, p_date, p_qty_delta, v_cost, 'ADJUST', 'ADJUST', v_doc);
      IF v_cost > 0 THEN
        v_gl := erp_line_tab(erp_line_t(v_item.inv_account, v_cost, 0, NULL), erp_line_t(p_offset_account, 0, v_cost, NULL));
      END IF;
    ELSE
      v_cost := stock_out(p_item_id, p_wh_id, p_date, -p_qty_delta, 'ADJUST', 'ADJUST', v_doc);
      IF v_cost > 0 THEN
        v_gl := erp_line_tab(erp_line_t(p_offset_account, v_cost, 0, NULL), erp_line_t(v_item.inv_account, 0, v_cost, NULL));
      END IF;
    END IF;

    IF v_cost > 0 THEN
      v_entry := erp_gl.post_entry(p_date, v_memo, 'ADJ-' || v_doc, v_gl);
    END IF;
    RETURN v_entry;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_stock_adjust;
      RAISE;
  END adjust;

  FUNCTION transfer (
    p_item_id IN NUMBER,
    p_from_wh IN NUMBER,
    p_to_wh   IN NUMBER,
    p_date    IN DATE,
    p_qty     IN NUMBER
  ) RETURN NUMBER IS
    v_doc  NUMBER;
    v_cost NUMBER;
  BEGIN
    SAVEPOINT erp_stock_transfer;
    IF p_date IS NULL THEN
      RAISE_APPLICATION_ERROR(-20307, 'تاريخ التحويل مطلوب');
    END IF;
    IF p_from_wh = p_to_wh THEN
      RAISE_APPLICATION_ERROR(-20304, 'المخزنان متطابقان');
    END IF;
    v_doc  := erp_stock_doc_seq.NEXTVAL;
    v_cost := stock_out(p_item_id, p_from_wh, p_date, p_qty, 'TRANSFER', 'TRANSFER', v_doc);
    stock_in(p_item_id, p_to_wh, p_date, p_qty, v_cost, 'TRANSFER', 'TRANSFER', v_doc);
    RETURN v_cost;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_stock_transfer;
      RAISE;
  END transfer;

END erp_inventory;
/
SHOW ERRORS PACKAGE BODY erp_inventory
