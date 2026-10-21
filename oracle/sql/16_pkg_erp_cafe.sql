-- ============================================================================
-- نظام المقاهي: طاولات، خيارات أصناف (مقاسات/إضافات بسعر إضافي)، وطلب يبقى مفتوحاً يُضاف إليه بمرور الوقت.
-- إغلاق الطلب (الدفع) يستدعي ERP_POS.SELL نفسها، فيُعاد استخدام ترحيل المخزون والتكلفة والقيد المحاسبي المختبَر
-- بلا أي تكرار. هذه الحزمة طبقة تشغيلية (طاولات/طلب/مطبخ) فوق نقاط البيع القائمة، لا بديلاً لها.
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_cafe AS

  -- فتح طلب جديد على طاولة (أو بلا طاولة = سفري/كاونتر). يتطلب وردية مفتوحة على نقطة البيع.
  FUNCTION open_order (p_reg_id IN NUMBER, p_table_id IN NUMBER DEFAULT NULL, p_guests IN NUMBER DEFAULT NULL) RETURN NUMBER;

  -- إضافة بند بخياراته (مقاس/إضافات) إلى طلب مفتوح. p_option_ids: معرّفات خيارات من مجموعات الصنف نفسه.
  FUNCTION add_line (p_order_id IN NUMBER, p_item_id IN NUMBER, p_qty IN NUMBER, p_option_ids IN erp_id_tab DEFAULT erp_id_tab(), p_note IN VARCHAR2 DEFAULT NULL) RETURN NUMBER;
  -- بند لم يُرسَل بعد للمطبخ (NEW) يُحذف؛ بند أُرسل (SENT) يُلغى ويبقى أثره ليعرفه المطبخ
  PROCEDURE remove_line (p_line_id IN NUMBER);

  -- إرسال بنود الطلب (أو بنود محددة منه) إلى شاشة المطبخ/البار
  PROCEDURE send_to_kitchen (p_order_id IN NUMBER, p_line_ids IN erp_id_tab DEFAULT NULL);
  PROCEDURE mark_served (p_line_ids IN erp_id_tab);

  PROCEDURE transfer_table (p_order_id IN NUMBER, p_new_table_id IN NUMBER);
  -- فصل بنود محددة من الطلب إلى طلب جديد على الطاولة نفسها (لفاتورة منفصلة). يعيد رقم الطلب الجديد.
  FUNCTION split_order (p_order_id IN NUMBER, p_line_ids IN erp_id_tab) RETURN NUMBER;
  -- ضم طلب مفتوح في طلب آخر مفتوح (لدمج طاولتين)؛ الطلب المصدر يُلغى وتتحرر طاولته
  PROCEDURE merge_orders (p_order_id IN NUMBER, p_into_order_id IN NUMBER);

  -- إغلاق الطلب بالدفع: يحوّل بنوده إلى عملية بيع فعلية عبر ERP_POS.SELL، ويعيد رقم العملية
  FUNCTION close_order (p_order_id IN NUMBER, p_payments IN erp_pos_pay_tab) RETURN NUMBER;
  -- إلغاء طلب مفتوح بلا دفع (لم يُرحَّل بعد فلا أثر محاسبي)
  PROCEDURE cancel_order (p_order_id IN NUMBER);

END erp_cafe;
/

CREATE OR REPLACE PACKAGE BODY erp_cafe AS

  FUNCTION open_order (p_reg_id IN NUMBER, p_table_id IN NUMBER DEFAULT NULL, p_guests IN NUMBER DEFAULT NULL) RETURN NUMBER IS
    v_shift NUMBER;
    v_id    NUMBER;
  BEGIN
    BEGIN
      SELECT shift_id INTO v_shift FROM erp_pos_shifts WHERE reg_id = p_reg_id AND status = 'OPEN';
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20901, 'لا وردية مفتوحة على هذه النقطة: افتحها أولاً');
    END;
    IF p_table_id IS NOT NULL THEN
      DECLARE v_reg NUMBER; v_active CHAR(1); BEGIN
        SELECT reg_id, active INTO v_reg, v_active FROM erp_cafe_tables WHERE table_id = p_table_id;
        IF v_reg <> p_reg_id THEN RAISE_APPLICATION_ERROR(-20902, 'الطاولة لا تتبع هذه النقطة'); END IF;
        IF v_active <> 'Y' THEN RAISE_APPLICATION_ERROR(-20902, 'الطاولة معطّلة'); END IF;
      EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20902, 'الطاولة غير موجودة'); END;
    END IF;
    BEGIN
      INSERT INTO erp_cafe_orders (reg_id, table_id, shift_id, guests)
      VALUES (p_reg_id, p_table_id, v_shift, p_guests) RETURNING order_id INTO v_id;
    EXCEPTION WHEN DUP_VAL_ON_INDEX THEN
      RAISE_APPLICATION_ERROR(-20903, 'الطاولة مشغولة بطلب مفتوح آخر');
    END;
    RETURN v_id;
  END open_order;

  FUNCTION add_line (p_order_id IN NUMBER, p_item_id IN NUMBER, p_qty IN NUMBER, p_option_ids IN erp_id_tab DEFAULT erp_id_tab(), p_note IN VARCHAR2 DEFAULT NULL) RETURN NUMBER IS
    v_status erp_cafe_orders.status%TYPE;
    v_item   erp_items%ROWTYPE;
    v_delta  NUMBER := 0;
    v_text   VARCHAR2(400);
    v_opts   erp_id_tab := NVL(p_option_ids, erp_id_tab());
    v_id     NUMBER;
  BEGIN
    BEGIN SELECT status INTO v_status FROM erp_cafe_orders WHERE order_id = p_order_id FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20904, 'الطلب غير موجود'); END;
    IF v_status <> 'OPEN' THEN RAISE_APPLICATION_ERROR(-20904, 'الطلب ليس مفتوحاً'); END IF;

    BEGIN SELECT * INTO v_item FROM erp_items WHERE item_id = p_item_id;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20905, 'الصنف غير موجود'); END;
    IF v_item.active <> 'Y' THEN RAISE_APPLICATION_ERROR(-20905, 'الصنف ' || v_item.code || ' موقوف'); END IF;
    IF NVL(p_qty, 0) <= 0 OR p_qty <> ROUND(p_qty, 3) THEN RAISE_APPLICATION_ERROR(-20906, 'كمية غير صالحة'); END IF;

    FOR g IN (SELECT mg.group_id, mg.name, mg.required, mg.multi FROM erp_item_modifier_groups img
                JOIN erp_modifier_groups mg ON mg.group_id = img.group_id AND mg.active = 'Y'
               WHERE img.item_id = p_item_id ORDER BY img.seq) LOOP
      DECLARE v_n NUMBER := 0; BEGIN
        FOR o IN (SELECT name, price_delta FROM erp_modifier_options
                   WHERE group_id = g.group_id AND active = 'Y' AND option_id IN (SELECT column_value FROM TABLE(v_opts))) LOOP
          v_n := v_n + 1; v_delta := v_delta + o.price_delta;
          v_text := v_text || CASE WHEN v_text IS NULL THEN '' ELSE '، ' END || o.name;
        END LOOP;
        IF g.required = 'Y' AND v_n = 0 THEN RAISE_APPLICATION_ERROR(-20907, 'اختر ' || g.name); END IF;
        IF g.multi = 'N' AND v_n > 1 THEN RAISE_APPLICATION_ERROR(-20908, 'اختر خياراً واحداً فقط من ' || g.name); END IF;
      END;
    END LOOP;

    INSERT INTO erp_cafe_order_lines (order_id, item_id, qty, base_price, mod_delta, mod_text, note, station)
    VALUES (p_order_id, p_item_id, p_qty, v_item.sale_price, v_delta, v_text, p_note, v_item.station)
    RETURNING line_id INTO v_id;
    RETURN v_id;
  END add_line;

  PROCEDURE remove_line (p_line_id IN NUMBER) IS
    v_status erp_cafe_order_lines.status%TYPE;
  BEGIN
    BEGIN SELECT status INTO v_status FROM erp_cafe_order_lines WHERE line_id = p_line_id FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20909, 'البند غير موجود'); END;
    IF v_status = 'NEW' THEN
      DELETE FROM erp_cafe_order_lines WHERE line_id = p_line_id;
    ELSIF v_status = 'SENT' THEN
      UPDATE erp_cafe_order_lines SET status = 'CANCELLED' WHERE line_id = p_line_id;
    ELSE
      RAISE_APPLICATION_ERROR(-20910, 'لا يُلغى بند قُدِّم فعلاً');
    END IF;
  END remove_line;

  PROCEDURE send_to_kitchen (p_order_id IN NUMBER, p_line_ids IN erp_id_tab DEFAULT NULL) IS
  BEGIN
    UPDATE erp_cafe_order_lines SET status = 'SENT', sent_at = SYSTIMESTAMP
     WHERE order_id = p_order_id AND status = 'NEW' AND (p_line_ids IS NULL OR line_id IN (SELECT column_value FROM TABLE(p_line_ids)));
  END send_to_kitchen;

  PROCEDURE mark_served (p_line_ids IN erp_id_tab) IS
  BEGIN
    UPDATE erp_cafe_order_lines SET status = 'SERVED', served_at = SYSTIMESTAMP
     WHERE status = 'SENT' AND line_id IN (SELECT column_value FROM TABLE(p_line_ids));
  END mark_served;

  PROCEDURE transfer_table (p_order_id IN NUMBER, p_new_table_id IN NUMBER) IS
    v_status erp_cafe_orders.status%TYPE; v_reg NUMBER;
    v_treg   NUMBER; v_active CHAR(1);
  BEGIN
    BEGIN SELECT status, reg_id INTO v_status, v_reg FROM erp_cafe_orders WHERE order_id = p_order_id FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20911, 'الطلب غير موجود'); END;
    IF v_status <> 'OPEN' THEN RAISE_APPLICATION_ERROR(-20911, 'الطلب ليس مفتوحاً'); END IF;
    BEGIN SELECT reg_id, active INTO v_treg, v_active FROM erp_cafe_tables WHERE table_id = p_new_table_id;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20912, 'الطاولة غير موجودة'); END;
    IF v_treg <> v_reg THEN RAISE_APPLICATION_ERROR(-20912, 'الطاولة لا تتبع نقطة البيع نفسها'); END IF;
    IF v_active <> 'Y' THEN RAISE_APPLICATION_ERROR(-20912, 'الطاولة معطّلة'); END IF;
    BEGIN
      UPDATE erp_cafe_orders SET table_id = p_new_table_id WHERE order_id = p_order_id;
    EXCEPTION WHEN DUP_VAL_ON_INDEX THEN RAISE_APPLICATION_ERROR(-20913, 'الطاولة الجديدة مشغولة بطلب آخر');
    END;
  END transfer_table;

  FUNCTION split_order (p_order_id IN NUMBER, p_line_ids IN erp_id_tab) RETURN NUMBER IS
    v_order erp_cafe_orders%ROWTYPE;
    v_n     NUMBER;
    v_new   NUMBER;
  BEGIN
    BEGIN SELECT * INTO v_order FROM erp_cafe_orders WHERE order_id = p_order_id FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20914, 'الطلب غير موجود'); END;
    IF v_order.status <> 'OPEN' THEN RAISE_APPLICATION_ERROR(-20914, 'الطلب ليس مفتوحاً'); END IF;
    IF p_line_ids IS NULL OR p_line_ids.COUNT = 0 THEN RAISE_APPLICATION_ERROR(-20915, 'حدّد بنوداً للفصل'); END IF;
    SELECT COUNT(*) INTO v_n FROM erp_cafe_order_lines WHERE order_id = p_order_id AND status <> 'CANCELLED' AND line_id IN (SELECT column_value FROM TABLE(p_line_ids));
    IF v_n <> p_line_ids.COUNT THEN RAISE_APPLICATION_ERROR(-20915, 'بعض البنود لا تنتمي لهذا الطلب'); END IF;
    -- الطلب الجديد لا طاولة حصرية له (الأصل يبقى صاحب الطاولة): يُسجَّل بلا طاولة فلا يتعارض مع قيد الفهرس الفريد
    INSERT INTO erp_cafe_orders (reg_id, table_id, shift_id, guests, waiter)
    VALUES (v_order.reg_id, NULL, v_order.shift_id, NULL, v_order.waiter) RETURNING order_id INTO v_new;
    UPDATE erp_cafe_order_lines SET order_id = v_new WHERE line_id IN (SELECT column_value FROM TABLE(p_line_ids));
    RETURN v_new;
  END split_order;

  PROCEDURE merge_orders (p_order_id IN NUMBER, p_into_order_id IN NUMBER) IS
    v_s1 erp_cafe_orders.status%TYPE; v_s2 erp_cafe_orders.status%TYPE; v_r1 NUMBER; v_r2 NUMBER;
  BEGIN
    IF p_order_id = p_into_order_id THEN RAISE_APPLICATION_ERROR(-20916, 'لا يُدمج الطلب في نفسه'); END IF;
    BEGIN SELECT status, reg_id INTO v_s1, v_r1 FROM erp_cafe_orders WHERE order_id = p_order_id FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20916, 'الطلب المصدر غير موجود'); END;
    BEGIN SELECT status, reg_id INTO v_s2, v_r2 FROM erp_cafe_orders WHERE order_id = p_into_order_id FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20916, 'الطلب الهدف غير موجود'); END;
    IF v_s1 <> 'OPEN' OR v_s2 <> 'OPEN' THEN RAISE_APPLICATION_ERROR(-20917, 'كلا الطلبين يجب أن يكونا مفتوحين'); END IF;
    IF v_r1 <> v_r2 THEN RAISE_APPLICATION_ERROR(-20917, 'الطلبان من نقطتي بيع مختلفتين'); END IF;
    UPDATE erp_cafe_order_lines SET order_id = p_into_order_id WHERE order_id = p_order_id;
    UPDATE erp_cafe_orders SET status = 'CANCELLED', table_id = NULL WHERE order_id = p_order_id;
  END merge_orders;

  FUNCTION close_order (p_order_id IN NUMBER, p_payments IN erp_pos_pay_tab) RETURN NUMBER IS
    v_order erp_cafe_orders%ROWTYPE;
    v_lines erp_pos_line_tab := erp_pos_line_tab();
    v_sale  NUMBER;
  BEGIN
    BEGIN SELECT * INTO v_order FROM erp_cafe_orders WHERE order_id = p_order_id FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20918, 'الطلب غير موجود'); END;
    IF v_order.status <> 'OPEN' THEN RAISE_APPLICATION_ERROR(-20918, 'الطلب ليس مفتوحاً'); END IF;
    FOR l IN (SELECT item_id, qty, base_price + mod_delta AS price FROM erp_cafe_order_lines
               WHERE order_id = p_order_id AND status <> 'CANCELLED') LOOP
      v_lines.EXTEND;
      v_lines(v_lines.COUNT) := erp_pos_line_t(l.item_id, l.qty, l.price, 0, NULL);
    END LOOP;
    IF v_lines.COUNT = 0 THEN RAISE_APPLICATION_ERROR(-20919, 'الطلب فارغ: لا بنود للدفع'); END IF;
    v_sale := erp_pos.sell(v_order.shift_id, TRUNC(SYSDATE), v_lines, p_payments);
    UPDATE erp_cafe_orders SET status = 'CLOSED', closed_at = SYSTIMESTAMP, pos_sale_id = v_sale WHERE order_id = p_order_id;
    RETURN v_sale;
  END close_order;

  PROCEDURE cancel_order (p_order_id IN NUMBER) IS
    v_status erp_cafe_orders.status%TYPE;
  BEGIN
    BEGIN SELECT status INTO v_status FROM erp_cafe_orders WHERE order_id = p_order_id FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20920, 'الطلب غير موجود'); END;
    IF v_status <> 'OPEN' THEN RAISE_APPLICATION_ERROR(-20920, 'الطلب ليس مفتوحاً'); END IF;
    UPDATE erp_cafe_orders SET status = 'CANCELLED', table_id = NULL WHERE order_id = p_order_id;
  END cancel_order;

END erp_cafe;
/
SHOW ERRORS PACKAGE BODY erp_cafe
