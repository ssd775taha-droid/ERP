-- ============================================================================
-- 13: حزمة عروض الأسعار ERP_QUOTE (تعتمد على ERP_TRADE)
-- عرض السعر التزام تجاري لعميل بلا أثر محاسبي ولا حجز مخزون. التحويل ينشئ فاتورة مبيعات فعلية عبر ERP_TRADE.CREATE_INVOICE
-- (فيخرج المخزون ويُرحَّل القيد وتكلفة المبيعات في المعاملة نفسها) بإجمالي العرض بالضبط.
--   DRAFT (قابل للاستبدال) ← SENT (البنود مقفلة) ← ACCEPTED ← CONVERTED (فاتورة)
--   REJECTED (رفضه العميل) · CANCELLED (من DRAFT أو SENT) · EXPIRED (SENT تجاوز صلاحيته، بـ EXPIRE_OLD)
--   SUPERSEDED (حلّ محله عرض معدَّل: REVISE_QUOTE من SENT أو REJECTED)
-- التسعير: سعر الوحدة بعد الخصم = ROUND(السعر × (1 − الخصم/100), 2)، وصافي البند = ROUND(الكمية × ذلك السعر, 2)،
--   والضريبة = ROUND(الصافي × النسبة/100, 2): نفس معادلة فاتورة المبيعات فيتطابق إجمالي الفاتورة مع إجمالي العرض.
-- التحويل يعيد الفاتورة إلى ACCEPTED عبر UNCONVERT (يلغي الفاتورة)، ولا تُلغى الفاتورة مباشرة في ERP_TRADE.
-- الإعداد QUOTE_MAX_DISCOUNT_PCT: أعلى خصم % لبند يُسمح بإرسال العرض به. ولاختبار الصلاحية في أي وقت تقبل الإجراءات
--   p_asof (الافتراضي اليوم).
--
-- رموز الأخطاء (النطاق 20950 فما فوق لأن 209xx الأدنى مستخدم):
--   -20950 عميل/بيانات غير صالحة             -20954 خصم أعلى من الحد المسموح
--   -20951 حالة العرض لا تسمح بالعملية        -20955 العرض منتهي الصلاحية
--   -20952 بند غير صالح                       -20956 مدخلات غير صالحة للإعداد
--   -20953 عرض سعر غير موجود
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_quote AS
  FUNCTION create_quote (
    p_party_id    IN NUMBER,
    p_date        IN DATE,
    p_valid_until IN DATE,
    p_notes       IN VARCHAR2,
    p_terms       IN VARCHAR2,
    p_lines       IN erp_quote_line_tab
  ) RETURN NUMBER;

  PROCEDURE replace_lines (p_quote_id IN NUMBER, p_lines IN erp_quote_line_tab);
  PROCEDURE send_quote   (p_quote_id IN NUMBER);
  PROCEDURE accept_quote (p_quote_id IN NUMBER, p_asof IN DATE DEFAULT NULL);
  PROCEDURE reject_quote (p_quote_id IN NUMBER);
  PROCEDURE cancel_quote (p_quote_id IN NUMBER);

  -- عرض معدَّل: نسخة DRAFT من عرض SENT أو REJECTED، ويصير الأصل SUPERSEDED. يعيد رقم الجديد.
  FUNCTION revise_quote (p_quote_id IN NUMBER, p_date IN DATE DEFAULT NULL, p_valid_until IN DATE DEFAULT NULL) RETURN NUMBER;

  -- تحويل عرض مقبول إلى فاتورة مبيعات. يعيد رقم الفاتورة.
  FUNCTION convert_to_invoice (p_quote_id IN NUMBER, p_invoice_date IN DATE, p_due IN DATE DEFAULT NULL) RETURN NUMBER;
  -- إلغاء التحويل: يلغي الفاتورة ويعيد العرض ACCEPTED
  PROCEDURE unconvert (p_quote_id IN NUMBER);

  -- يحوّل العروض المرسلة التي انتهت صلاحيتها قبل p_asof إلى EXPIRED. يعيد عددها.
  FUNCTION expire_old (p_asof IN DATE DEFAULT NULL) RETURN NUMBER;

  PROCEDURE set_setting (p_name IN VARCHAR2, p_value IN VARCHAR2);
  FUNCTION get_setting (p_name IN VARCHAR2) RETURN VARCHAR2;
END erp_quote;
/

CREATE OR REPLACE PACKAGE BODY erp_quote AS

  FUNCTION get_quote (p_quote_id IN NUMBER, p_lock IN BOOLEAN DEFAULT FALSE) RETURN erp_quotations%ROWTYPE IS
    v erp_quotations%ROWTYPE;
  BEGIN
    IF p_lock THEN
      SELECT * INTO v FROM erp_quotations WHERE quote_id = p_quote_id FOR UPDATE;
    ELSE
      SELECT * INTO v FROM erp_quotations WHERE quote_id = p_quote_id;
    END IF;
    RETURN v;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20953, 'عرض السعر رقم ' || p_quote_id || ' غير موجود');
  END get_quote;

  PROCEDURE insert_lines (p_quote_id IN NUMBER, p_lines IN erp_quote_line_tab) IS
    v_item erp_items%ROWTYPE;
    v_type erp_accounts.acc_type%TYPE;
    v_wh_active erp_warehouses.active%TYPE;
    v_desc VARCHAR2(200); v_price NUMBER; v_disc NUMBER; v_rate NUMBER; v_acct VARCHAR2(12);
    v_unit NUMBER; v_net NUMBER; v_vat NUMBER;
    v_sub NUMBER := 0; v_vat_sum NUMBER := 0;
  BEGIN
    IF p_lines IS NULL OR p_lines.COUNT = 0 THEN
      RAISE_APPLICATION_ERROR(-20952, 'العرض يحتاج بنداً واحداً على الأقل');
    END IF;
    FOR i IN 1 .. p_lines.COUNT LOOP
      v_desc := p_lines(i).description;
      v_price := p_lines(i).price;
      v_rate := p_lines(i).vat_rate;
      v_acct := p_lines(i).account_code;
      v_disc := NVL(p_lines(i).discount_pct, 0);
      IF p_lines(i).item_id IS NOT NULL THEN
        BEGIN
          SELECT * INTO v_item FROM erp_items WHERE item_id = p_lines(i).item_id;
        EXCEPTION
          WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20952, 'البند ' || i || ': الصنف غير موجود');
        END;
        IF v_item.active <> 'Y' THEN
          RAISE_APPLICATION_ERROR(-20952, 'البند ' || i || ': الصنف ' || v_item.code || ' موقوف');
        END IF;
        v_desc  := NVL(TRIM(v_desc), v_item.name);
        v_price := NVL(v_price, v_item.sale_price);
        v_rate  := NVL(v_rate, v_item.vat_rate);
        IF v_item.track_stock = 'Y' THEN
          IF p_lines(i).wh_id IS NULL THEN
            RAISE_APPLICATION_ERROR(-20952, 'البند ' || i || ': مخزن الصرف مطلوب للصنف ' || v_item.code);
          END IF;
          BEGIN
            SELECT active INTO v_wh_active FROM erp_warehouses WHERE wh_id = p_lines(i).wh_id;
          EXCEPTION
            WHEN NO_DATA_FOUND THEN
              RAISE_APPLICATION_ERROR(-20952, 'البند ' || i || ': المخزن غير موجود');
          END;
          IF v_wh_active <> 'Y' THEN
            RAISE_APPLICATION_ERROR(-20952, 'البند ' || i || ': المخزن موقوف');
          END IF;
        END IF;
      ELSE
        IF TRIM(v_desc) IS NULL THEN
          RAISE_APPLICATION_ERROR(-20952, 'البند ' || i || ': الوصف مطلوب لبند بلا صنف');
        END IF;
        IF v_acct IS NULL THEN
          RAISE_APPLICATION_ERROR(-20952, 'البند ' || i || ': حساب الإيراد مطلوب لبند بلا صنف');
        END IF;
      END IF;
      IF v_acct IS NOT NULL THEN
        BEGIN
          SELECT acc_type INTO v_type FROM erp_accounts WHERE code = v_acct;
        EXCEPTION
          WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20952, 'البند ' || i || ': الحساب ' || v_acct || ' غير موجود');
        END;
        IF v_type <> 'REVENUE' THEN
          RAISE_APPLICATION_ERROR(-20952, 'البند ' || i || ': حساب المبيعات يجب أن يكون إيراداً');
        END IF;
      END IF;
      v_rate := NVL(v_rate, 0);
      IF NVL(p_lines(i).qty, 0) <= 0 OR p_lines(i).qty <> ROUND(p_lines(i).qty, 3)
         OR NVL(v_price, -1) < 0 OR v_price <> ROUND(v_price, 2)
         OR v_disc < 0 OR v_disc > 100 OR v_rate < 0 OR v_rate > 100 THEN
        RAISE_APPLICATION_ERROR(-20952, 'البند ' || i || ': كمية (ثلاث منازل) أو سعر (منزلتان) أو خصم أو نسبة ضريبة غير صالحة');
      END IF;
      v_unit := ROUND(v_price * (1 - v_disc / 100), 2);
      v_net  := ROUND(p_lines(i).qty * v_unit, 2);
      v_vat  := ROUND(v_net * v_rate / 100, 2);
      INSERT INTO erp_quote_lines (quote_id, line_no, item_id, wh_id, description, qty, price, discount_pct, unit_net_price, vat_rate, account_code, net, vat)
      VALUES (p_quote_id, i, p_lines(i).item_id, p_lines(i).wh_id, SUBSTR(TRIM(v_desc), 1, 200), p_lines(i).qty, v_price, v_disc,
              v_unit, v_rate, v_acct, v_net, v_vat);
      v_sub := v_sub + v_net; v_vat_sum := v_vat_sum + v_vat;
    END LOOP;
    UPDATE erp_quotations SET subtotal = v_sub, vat_amount = v_vat_sum, total = v_sub + v_vat_sum WHERE quote_id = p_quote_id;
  END insert_lines;

  FUNCTION create_quote (
    p_party_id    IN NUMBER,
    p_date        IN DATE,
    p_valid_until IN DATE,
    p_notes       IN VARCHAR2,
    p_terms       IN VARCHAR2,
    p_lines       IN erp_quote_line_tab
  ) RETURN NUMBER IS
    v_kind erp_parties.kind%TYPE;
    v_no   NUMBER;
    v_id   erp_quotations.quote_id%TYPE;
  BEGIN
    SAVEPOINT erp_quote_create;
    IF p_date IS NULL OR p_valid_until IS NULL THEN
      RAISE_APPLICATION_ERROR(-20950, 'تاريخ العرض وتاريخ صلاحيته مطلوبان');
    END IF;
    IF TRUNC(p_valid_until) < TRUNC(p_date) THEN
      RAISE_APPLICATION_ERROR(-20950, 'تاريخ الصلاحية قبل تاريخ العرض');
    END IF;
    BEGIN
      SELECT kind INTO v_kind FROM erp_parties WHERE party_id = p_party_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20950, 'الطرف رقم ' || p_party_id || ' غير موجود');
    END;
    IF v_kind <> 'CUSTOMER' THEN
      RAISE_APPLICATION_ERROR(-20950, 'عرض السعر يحتاج عميلاً');
    END IF;
    UPDATE erp_counters SET last_no = last_no + 1 WHERE name = 'QUOTE' RETURNING last_no INTO v_no;
    INSERT INTO erp_quotations (quote_no, party_id, quote_date, valid_until, notes, terms)
    VALUES ('Q-' || LPAD(v_no, 6, '0'), p_party_id, TRUNC(p_date), TRUNC(p_valid_until), SUBSTR(p_notes, 1, 300), SUBSTR(p_terms, 1, 500))
    RETURNING quote_id INTO v_id;
    insert_lines(v_id, p_lines);
    RETURN v_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_quote_create;
      RAISE;
  END create_quote;

  PROCEDURE replace_lines (p_quote_id IN NUMBER, p_lines IN erp_quote_line_tab) IS
    v_q erp_quotations%ROWTYPE;
  BEGIN
    SAVEPOINT erp_quote_replace;
    v_q := get_quote(p_quote_id, TRUE);
    IF v_q.status <> 'DRAFT' THEN
      RAISE_APPLICATION_ERROR(-20951, 'تُعدَّل بنود المسودة فقط (حالة العرض ' || v_q.status || ')');
    END IF;
    DELETE FROM erp_quote_lines WHERE quote_id = p_quote_id;
    insert_lines(p_quote_id, p_lines);
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_quote_replace;
      RAISE;
  END replace_lines;

  PROCEDURE send_quote (p_quote_id IN NUMBER) IS
    v_q     erp_quotations%ROWTYPE;
    v_max   NUMBER;
    v_worst NUMBER;
  BEGIN
    SAVEPOINT erp_quote_send;
    v_q := get_quote(p_quote_id, TRUE);
    IF v_q.status <> 'DRAFT' THEN
      RAISE_APPLICATION_ERROR(-20951, 'يُرسَل العرض من حالة DRAFT (الحالة ' || v_q.status || ')');
    END IF;
    IF v_q.total <= 0 THEN
      RAISE_APPLICATION_ERROR(-20952, 'لا يُرسل عرض بإجمالي صفر');
    END IF;
    BEGIN
      v_max := TO_NUMBER(get_setting('QUOTE_MAX_DISCOUNT_PCT'));
    EXCEPTION
      WHEN VALUE_ERROR OR INVALID_NUMBER THEN
        RAISE_APPLICATION_ERROR(-20956, 'قيمة الإعداد QUOTE_MAX_DISCOUNT_PCT غير رقمية');
    END;
    IF v_max IS NOT NULL THEN
      SELECT NVL(MAX(discount_pct), 0) INTO v_worst FROM erp_quote_lines WHERE quote_id = p_quote_id;
      IF v_worst > v_max THEN
        RAISE_APPLICATION_ERROR(-20954, 'خصم ' || TO_CHAR(v_worst) || '% يتجاوز الحد المسموح ' || TO_CHAR(v_max) || '%');
      END IF;
    END IF;
    UPDATE erp_quotations SET status = 'SENT', sent_at = SYSTIMESTAMP WHERE quote_id = p_quote_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_quote_send;
      RAISE;
  END send_quote;

  PROCEDURE accept_quote (p_quote_id IN NUMBER, p_asof IN DATE DEFAULT NULL) IS
    v_q erp_quotations%ROWTYPE;
  BEGIN
    v_q := get_quote(p_quote_id, TRUE);
    IF v_q.status <> 'SENT' THEN
      RAISE_APPLICATION_ERROR(-20951, 'يُقبل العرض المرسل فقط (الحالة ' || v_q.status || ')');
    END IF;
    IF v_q.valid_until < TRUNC(NVL(p_asof, SYSDATE)) THEN
      RAISE_APPLICATION_ERROR(-20955, 'العرض ' || v_q.quote_no || ' انتهت صلاحيته في ' || TO_CHAR(v_q.valid_until, 'YYYY-MM-DD'));
    END IF;
    UPDATE erp_quotations SET status = 'ACCEPTED', decided_at = SYSTIMESTAMP WHERE quote_id = p_quote_id;
  END accept_quote;

  PROCEDURE reject_quote (p_quote_id IN NUMBER) IS
    v_q erp_quotations%ROWTYPE;
  BEGIN
    v_q := get_quote(p_quote_id, TRUE);
    IF v_q.status <> 'SENT' THEN
      RAISE_APPLICATION_ERROR(-20951, 'يُرفض العرض المرسل فقط (الحالة ' || v_q.status || ')');
    END IF;
    UPDATE erp_quotations SET status = 'REJECTED', decided_at = SYSTIMESTAMP WHERE quote_id = p_quote_id;
  END reject_quote;

  PROCEDURE cancel_quote (p_quote_id IN NUMBER) IS
    v_q erp_quotations%ROWTYPE;
  BEGIN
    v_q := get_quote(p_quote_id, TRUE);
    IF v_q.status NOT IN ('DRAFT', 'SENT') THEN
      RAISE_APPLICATION_ERROR(-20951, 'يُلغى العرض من DRAFT أو SENT فقط (الحالة ' || v_q.status || ')');
    END IF;
    UPDATE erp_quotations SET status = 'CANCELLED' WHERE quote_id = p_quote_id;
  END cancel_quote;

  FUNCTION revise_quote (p_quote_id IN NUMBER, p_date IN DATE DEFAULT NULL, p_valid_until IN DATE DEFAULT NULL) RETURN NUMBER IS
    v_q     erp_quotations%ROWTYPE;
    v_lines erp_quote_line_tab := erp_quote_line_tab();
    v_new   NUMBER;
    v_date  DATE;
  BEGIN
    SAVEPOINT erp_quote_revise;
    v_q := get_quote(p_quote_id, TRUE);
    IF v_q.status NOT IN ('SENT', 'REJECTED') THEN
      RAISE_APPLICATION_ERROR(-20951, 'يُعدَّل العرض المرسل أو المرفوض فقط (الحالة ' || v_q.status || ')');
    END IF;
    FOR l IN (SELECT * FROM erp_quote_lines WHERE quote_id = p_quote_id ORDER BY line_no) LOOP
      v_lines.EXTEND;
      -- تُنسخ الأسعار كما كانت (لا عودة إلى سعر الصنف الحالي) فيبقى العرض المعدَّل قابلاً للتعديل من نقطة معروفة
      v_lines(v_lines.COUNT) := erp_quote_line_t(l.item_id, l.wh_id, l.description, l.qty, l.price, l.discount_pct, l.vat_rate, l.account_code);
    END LOOP;
    v_date := TRUNC(NVL(p_date, v_q.quote_date));
    v_new := create_quote(v_q.party_id, v_date, NVL(p_valid_until, GREATEST(v_q.valid_until, v_date)), v_q.notes, v_q.terms, v_lines);
    UPDATE erp_quotations SET revision_of = p_quote_id WHERE quote_id = v_new;
    UPDATE erp_quotations SET status = 'SUPERSEDED', decided_at = SYSTIMESTAMP WHERE quote_id = p_quote_id;
    RETURN v_new;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_quote_revise;
      RAISE;
  END revise_quote;

  FUNCTION convert_to_invoice (p_quote_id IN NUMBER, p_invoice_date IN DATE, p_due IN DATE DEFAULT NULL) RETURN NUMBER IS
    v_q     erp_quotations%ROWTYPE;
    v_item  erp_items%ROWTYPE;
    v_lines erp_inv_line_tab := erp_inv_line_tab();
    v_inv   NUMBER;
  BEGIN
    SAVEPOINT erp_quote_convert;
    v_q := get_quote(p_quote_id, TRUE);
    IF v_q.status <> 'ACCEPTED' THEN
      RAISE_APPLICATION_ERROR(-20951, 'يُحوَّل العرض المقبول فقط (الحالة ' || v_q.status || ')');
    END IF;
    IF p_invoice_date IS NULL THEN
      RAISE_APPLICATION_ERROR(-20950, 'تاريخ الفاتورة مطلوب');
    END IF;
    FOR l IN (SELECT * FROM erp_quote_lines WHERE quote_id = p_quote_id ORDER BY line_no) LOOP
      v_lines.EXTEND;
      IF l.item_id IS NOT NULL THEN
        SELECT * INTO v_item FROM erp_items WHERE item_id = l.item_id;
        v_lines(v_lines.COUNT) := erp_inv_line_t(l.description, l.qty, l.unit_net_price, l.vat_rate, l.account_code, l.item_id,
                                                 CASE WHEN v_item.track_stock = 'Y' THEN l.wh_id END);
      ELSE
        v_lines(v_lines.COUNT) := erp_inv_line_t(l.description, l.qty, l.unit_net_price, l.vat_rate, l.account_code, NULL, NULL);
      END IF;
    END LOOP;
    v_inv := erp_trade.create_invoice('SALES', v_q.party_id, p_invoice_date, p_due, v_q.quote_no,
                                      'من عرض السعر ' || v_q.quote_no, v_lines);
    UPDATE erp_quotations SET status = 'CONVERTED', invoice_id = v_inv, decided_at = SYSTIMESTAMP WHERE quote_id = p_quote_id;
    RETURN v_inv;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_quote_convert;
      RAISE;
  END convert_to_invoice;

  PROCEDURE unconvert (p_quote_id IN NUMBER) IS
    v_q erp_quotations%ROWTYPE;
  BEGIN
    SAVEPOINT erp_quote_unconvert;
    v_q := get_quote(p_quote_id, TRUE);
    IF v_q.status <> 'CONVERTED' THEN
      RAISE_APPLICATION_ERROR(-20951, 'العرض غير محوَّل (الحالة ' || v_q.status || ')');
    END IF;
    -- يعود ACCEPTED أولاً ليسمح حارس ERP_TRADE بإلغاء فاتورته (وأي فشل يتراجع كله)
    UPDATE erp_quotations SET status = 'ACCEPTED' WHERE quote_id = p_quote_id;
    erp_trade.void_invoice(v_q.invoice_id);
    UPDATE erp_quotations SET invoice_id = NULL WHERE quote_id = p_quote_id;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK TO SAVEPOINT erp_quote_unconvert;
      RAISE;
  END unconvert;

  FUNCTION expire_old (p_asof IN DATE DEFAULT NULL) RETURN NUMBER IS
    v_n NUMBER;
  BEGIN
    UPDATE erp_quotations SET status = 'EXPIRED', decided_at = SYSTIMESTAMP
     WHERE status = 'SENT' AND valid_until < TRUNC(NVL(p_asof, SYSDATE));
    v_n := SQL%ROWCOUNT;
    RETURN v_n;
  END expire_old;

  PROCEDURE set_setting (p_name IN VARCHAR2, p_value IN VARCHAR2) IS
    v NUMBER;
  BEGIN
    IF p_name IS NULL OR p_name NOT IN ('QUOTE_MAX_DISCOUNT_PCT') THEN
      RAISE_APPLICATION_ERROR(-20956, 'إعداد غير معروف: ' || p_name);
    END IF;
    IF p_value IS NULL THEN
      DELETE FROM erp_settings WHERE name = p_name;
      RETURN;
    END IF;
    BEGIN
      v := TO_NUMBER(p_value);
    EXCEPTION
      WHEN VALUE_ERROR OR INVALID_NUMBER THEN
        RAISE_APPLICATION_ERROR(-20956, 'قيمة الإعداد ' || p_name || ' يجب أن تكون رقماً');
    END;
    IF v < 0 OR v > 100 THEN
      RAISE_APPLICATION_ERROR(-20956, 'قيمة الإعداد ' || p_name || ' بين 0 و100');
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

END erp_quote;
/
SHOW ERRORS PACKAGE BODY erp_quote
