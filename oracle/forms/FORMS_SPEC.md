# مواصفات شاشات Oracle Forms 12c

ملفات `.fmb` ثنائية تُنشأ من **Forms Builder**؛ هذا المستند هو التصميم الكامل لكل شاشة مع كود PL/SQL الجاهز للصق في المشغّلات (Triggers) ووحدات البرنامج (Program Units). كل المنطق المحاسبي موجود في حزم قاعدة البيانات (`ERP_GL`, `ERP_TRADE`)، والشاشات تستدعيها فقط ولا تكتب في جداول القيود أو الفواتير مباشرة.

> الكود هنا لم يُشغَّل في Forms Builder (لا يتوفر في بيئة التطوير التي كُتب فيها). راجع أسماء العناصر عند اللصق، وأبلغني بأي خطأ تجميع لأصلحه.

## إعدادات عامة لكل وحدة (Form Module)

| الخاصية | القيمة |
|---|---|
| Direction | Right To Left (لدعم العربية) |
| Console Window | لا شيء (استخدم نافذة رئيسية MAIN) |
| First Navigation Block | حسب الشاشة |
| الخط | Tahoma أو Arial، حجم 10 |
| NLS_LANG للعميل | `ARABIC_SAUDI ARABIA.AL32UTF8` |
| Validation Unit | Item |

الاتصال: مخطط تطبيقي واحد `erp_owner` (أو مستخدمو تطبيق بصلاحيات `EXECUTE` على الحزم و`SELECT` على الجداول والعروض فقط، وبلا `INSERT/UPDATE/DELETE` على `erp_entries` و`erp_lines` و`erp_invoices` و`erp_payments`).

## وحدات البرنامج المشتركة (مكتبة `ERP_LIB.pll`)

أنشئ مكتبة PL/SQL (Library) باسم `ERP_LIB` وأرفقها بكل الشاشات:

```plsql
-- عرض رسالة خطأ Oracle بعد تنظيفها من البادئة ORA-20xxx ومن أسطر التتبع
PROCEDURE show_error (p_msg IN VARCHAR2 DEFAULT SQLERRM) IS
  v_msg VARCHAR2(2000) := p_msg;
  v_pos PLS_INTEGER;
BEGIN
  v_pos := INSTR(v_msg, CHR(10));                 -- أول سطر فقط (قبل ORA-06512)
  IF v_pos > 0 THEN v_msg := SUBSTR(v_msg, 1, v_pos - 1); END IF;
  IF v_msg LIKE 'ORA-20%' THEN v_msg := SUBSTR(v_msg, INSTR(v_msg, ':') + 2); END IF;
  MESSAGE(SUBSTR(v_msg, 1, 200));
  MESSAGE(SUBSTR(v_msg, 1, 200));                 -- مرتان: لتظهر في نافذة التنبيه حتى لو كانت في سطر الحالة
END;

-- COMMIT للمعاملات التي نفّذتها الحزم (الكتل غير المرتبطة بجداول لا يحفظها COMMIT_FORM)
PROCEDURE commit_db IS
BEGIN
  FORMS_DDL('COMMIT');
  IF NOT FORM_SUCCESS THEN
    show_error(DBMS_ERROR_TEXT);
    RAISE FORM_TRIGGER_FAILURE;
  END IF;
END;

PROCEDURE rollback_db IS
BEGIN
  FORMS_DDL('ROLLBACK');
END;
```

> سبب استخدام `FORMS_DDL('COMMIT')`: الحزم تعدّل البيانات خارج علم Forms، فيرى `COMMIT_FORM` أنه «لا تغييرات للحفظ». هذه الشاشات تستخدم كتلاً غير مرتبطة بجداول للحركات، فلا يوجد تغيير تديره Forms نفسها يضيع بسبب هذا الاستدعاء. أما شاشتا **الحسابات** و**الأطراف** فكتلتاهما مرتبطتان بجدول، فتستخدمان `COMMIT_FORM` المعتاد.

## قوائم القيم (LOVs) ومجموعات السجلات

| LOV | استعلام Record Group | الأعمدة المُعادة |
|---|---|---|
| `LOV_POSTABLE_ACCOUNTS` | `SELECT code, name FROM erp_accounts a WHERE active = 'Y' AND NOT EXISTS (SELECT 1 FROM erp_accounts c WHERE c.parent_code = a.code) ORDER BY code` | code → عنصر الحساب |
| `LOV_ALL_ACCOUNTS` | `SELECT code, name FROM erp_accounts ORDER BY code` | code |
| `LOV_CUSTOMERS` | `SELECT party_id, name FROM erp_parties WHERE kind = 'CUSTOMER' ORDER BY name` | party_id، name |
| `LOV_ITEMS` | `SELECT code, name, item_id, sale_price, rev_account FROM erp_items WHERE active = 'Y' ORDER BY code` | code، name، item_id، sale_price |
| `LOV_WAREHOUSES` | `SELECT code, name, wh_id FROM erp_warehouses WHERE active = 'Y' ORDER BY code` | code، wh_id |
| `LOV_SUPPLIERS` | `SELECT party_id, name FROM erp_parties WHERE kind = 'SUPPLIER' ORDER BY name` | party_id، name |

---

## الشاشة 1: `FRM_ACCOUNTS` — دليل الحسابات

- **الكتلة** `ACCOUNTS`: مرتبطة بالجدول `erp_accounts`، سجلات متعددة (Records Displayed = 15)، `ORDER BY code`.
- **العناصر**: `CODE`, `NAME`, `ACC_TYPE` (قائمة List Item: ASSET=أصول، LIABILITY=خصوم، EQUITY=حقوق ملكية، REVENUE=إيرادات، EXPENSE=مصروفات), `PARENT_CODE` (LOV_ALL_ACCOUNTS), `ACTIVE` (Check Box: Y/N، القيمة الافتراضية Y).
- **الحماية**: خاصية `Delete Allowed = No` للكتلة (لا حذف للحسابات، التعطيل بـ `ACTIVE = N`). العناصر `CODE` و`ACC_TYPE` و`PARENT_CODE` بخاصية `Update Allowed = No` (تُدخل عند الإنشاء فقط).

```plsql
-- ACCOUNTS.CODE : WHEN-VALIDATE-ITEM
IF NOT REGEXP_LIKE(:ACCOUNTS.CODE, '^[0-9A-Za-z.-]{1,12}$') THEN
  MESSAGE('رمز الحساب غير صالح'); RAISE FORM_TRIGGER_FAILURE;
END IF;

-- ACCOUNTS : PRE-INSERT  (نوع الحساب يجب أن يطابق نوع الأب)
DECLARE
  v_ptype erp_accounts.acc_type%TYPE;
BEGIN
  IF :ACCOUNTS.PARENT_CODE IS NOT NULL THEN
    SELECT acc_type INTO v_ptype FROM erp_accounts WHERE code = :ACCOUNTS.PARENT_CODE;
    IF v_ptype <> :ACCOUNTS.ACC_TYPE THEN
      MESSAGE('نوع الحساب يجب أن يطابق نوع الحساب الأب'); RAISE FORM_TRIGGER_FAILURE;
    END IF;
  END IF;
EXCEPTION WHEN NO_DATA_FOUND THEN
  MESSAGE('الحساب الأب غير موجود'); RAISE FORM_TRIGGER_FAILURE;
END;
```

## الشاشة 2: `FRM_PARTIES` — العملاء والموردون

- **الكتلة** `PARTIES` (جدول `erp_parties`، سجلات متعددة) والعناصر: `PARTY_ID` (عرض فقط)، `KIND` (List: CUSTOMER=عميل، SUPPLIER=مورد)، `NAME`، `PHONE`، `TAX_NO`.
- لأن `party_id` و`created_at` أعمدة هوية/افتراضية: اجعل `PARTY_ID` و`CREATED_AT` بخاصيتي `Insert Allowed = No` و`Update Allowed = No` حتى لا تدرجهما Forms.
- `Delete Allowed = No`. `KIND` بخاصية `Update Allowed = No` بعد الإنشاء (تغيير النوع يُفسد الأرصدة).
- **الكتلة الثانية** `STATEMENT` (استعلام فقط): عرض `v_erp_party_balance` للطرف الحالي، وزر `BTN_STATEMENT` يشغّل تقرير كشف الحساب (انظر المشغّل في آخر المستند).

## الشاشة 3: `FRM_JOURNAL` — قيد يومية

كتلتان غير مرتبطتين بجدول (Base Table = لا شيء):

- **`HDR`** (سجل واحد): `ENTRY_DATE` (Date، افتراضي `SYSDATE`)، `MEMO`، `REF`، و`TOT_DEBIT`/`TOT_CREDIT`/`DIFF` (Number، عرض فقط).
- **`LINES`** (سجلات متعددة، 12 سجلاً، Scrollbar): `ACCOUNT_CODE` (LOV_POSTABLE_ACCOUNTS)، `ACCOUNT_NAME` (عرض، يُملأ من LOV أو POST-CHANGE)، `DEBIT`، `CREDIT`، `NOTE`.
- أزرار: `BTN_POST` (ترحيل)، `BTN_CLEAR` (جديد)، `BTN_ADD_LINE`.

```plsql
-- LINES.DEBIT : WHEN-VALIDATE-ITEM ، وكذلك LINES.CREDIT (بتبديل الاسمين)
IF NVL(:LINES.DEBIT, 0) < 0 THEN MESSAGE('المبلغ لا يكون سالباً'); RAISE FORM_TRIGGER_FAILURE; END IF;
IF NVL(:LINES.DEBIT, 0) > 0 THEN :LINES.CREDIT := NULL; END IF;     -- في CREDIT: عكسه
recalc_totals;

-- LINES.ACCOUNT_CODE : POST-CHANGE
BEGIN
  SELECT name INTO :LINES.ACCOUNT_NAME FROM erp_accounts WHERE code = :LINES.ACCOUNT_CODE;
EXCEPTION WHEN NO_DATA_FOUND THEN :LINES.ACCOUNT_NAME := NULL;
END;

-- LINES : WHEN-REMOVE-RECORD
recalc_totals;
```

وحدة برنامج محلية في الشاشة:

```plsql
PROCEDURE recalc_totals IS
  v_dr NUMBER := 0; v_cr NUMBER := 0;
  v_rec PLS_INTEGER := :SYSTEM.CURSOR_RECORD;
  v_blk VARCHAR2(30) := NAME_IN('SYSTEM.CURSOR_BLOCK');
BEGIN
  GO_BLOCK('LINES');
  FIRST_RECORD;
  LOOP
    v_dr := v_dr + NVL(:LINES.DEBIT, 0);
    v_cr := v_cr + NVL(:LINES.CREDIT, 0);
    EXIT WHEN :SYSTEM.LAST_RECORD = 'TRUE';
    NEXT_RECORD;
  END LOOP;
  :HDR.TOT_DEBIT := v_dr; :HDR.TOT_CREDIT := v_cr; :HDR.DIFF := v_dr - v_cr;
  GO_BLOCK(v_blk); GO_RECORD(v_rec);
END;
```

```plsql
-- BTN_POST : WHEN-BUTTON-PRESSED
DECLARE
  v_lines erp_line_tab := erp_line_tab();
  v_id    NUMBER;
BEGIN
  recalc_totals;
  IF :HDR.DIFF <> 0 OR :HDR.TOT_DEBIT = 0 THEN
    MESSAGE('القيد غير متوازن أو فارغ'); RAISE FORM_TRIGGER_FAILURE;
  END IF;
  GO_BLOCK('LINES'); FIRST_RECORD;
  LOOP
    IF :LINES.ACCOUNT_CODE IS NOT NULL THEN
      v_lines.EXTEND;
      v_lines(v_lines.COUNT) := erp_line_t(:LINES.ACCOUNT_CODE, :LINES.DEBIT, :LINES.CREDIT, :LINES.NOTE);
    END IF;
    EXIT WHEN :SYSTEM.LAST_RECORD = 'TRUE';
    NEXT_RECORD;
  END LOOP;

  v_id := erp_gl.post_entry(:HDR.ENTRY_DATE, :HDR.MEMO, :HDR.REF, v_lines);
  commit_db;
  MESSAGE('رُحّل القيد رقم ' || v_id);
  CLEAR_BLOCK(NO_VALIDATE);                       -- يمسح LINES
  GO_BLOCK('HDR'); CLEAR_RECORD;
  :HDR.ENTRY_DATE := TRUNC(SYSDATE);
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

### تبويب الاستعراض والعكس (نفس الوحدة)

- **`ENT`** مرتبطة بـ `erp_entries` (`Insert/Update/Delete Allowed = No`، استعلام فقط، `ORDER BY entry_date DESC, entry_id DESC`).
- **`ENT_LINES`** مرتبطة بـ `erp_lines` تفصيل لـ `ENT` (علاقة Master-Detail على `entry_id`، استعلام فقط).
- زر `BTN_REVERSE` في `ENT`:

```plsql
DECLARE v_new NUMBER;
BEGIN
  IF :ENT.ENTRY_ID IS NULL THEN RETURN; END IF;
  IF SHOW_ALERT('AL_CONFIRM_REVERSE') <> ALERT_BUTTON1 THEN RETURN; END IF;   -- تنبيه: «سيُنشأ قيد عكسي. متابعة؟»
  v_new := erp_gl.reverse_entry(:ENT.ENTRY_ID);
  commit_db;
  MESSAGE('أُنشئ القيد العكسي رقم ' || v_new);
  GO_BLOCK('ENT'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

## الشاشة 4: `FRM_INVOICE` — الفواتير

- **`HDR`** (غير مرتبطة): `KIND` (List: SALES=مبيعات، PURCHASE=مشتريات)، `PARTY_ID` (يُخفى)، `PARTY_NAME` (LOV ديناميكي حسب النوع)، `INVOICE_DATE`، `DUE_DATE`، `REF`، `NOTE`، و`SUBTOTAL`/`VAT_AMOUNT`/`TOTAL` (عرض فقط).
- **`LINES`** (غير مرتبطة، 10 سجلات): `ITEM_CODE` (LOV_ITEMS، اختياري)، `ITEM_ID` و`WH_ID` (غير مرئيين)، `WH_CODE` (LOV_WAREHOUSES، يلزم للصنف المخزني)، `DESCRIPTION`، `QTY`، `PRICE`، `VAT_RATE` (افتراضي 15)، `ACCOUNT_CODE` (اختياري، LOV_ALL_ACCOUNTS)، `NET`، `VAT` (عرض).
- اختيار صنف يملأ الوصف وسعر البيع (للمبيعات فقط) ويضبط المخزن الافتراضي `MAIN`. الصنف المخزني يحرّك المخزون ويرحّل التكلفة تلقائياً؛ حساب البند يُهمل في المشتريات المخزنية (يذهب إلى حساب مخزون الصنف).
- LOV الطرف: اربطه بمجموعة سجلات يُبدَّل استعلامها عند تغيير `KIND`:

```plsql
-- HDR.KIND : WHEN-LIST-CHANGED
DECLARE
  v_rg RECORDGROUP := FIND_GROUP('RG_PARTIES'); v_err NUMBER;
BEGIN
  IF NOT ID_NULL(v_rg) THEN
    v_err := POPULATE_GROUP_WITH_QUERY(v_rg,
      'SELECT name, party_id FROM erp_parties WHERE kind = ''' ||
      CASE :HDR.KIND WHEN 'SALES' THEN 'CUSTOMER' ELSE 'SUPPLIER' END || ''' ORDER BY name');
  END IF;
  :HDR.PARTY_ID := NULL; :HDR.PARTY_NAME := NULL;
END;
```

```plsql
-- LINES.ITEM_CODE : POST-CHANGE  (يملأ البيانات من الصنف؛ LOV_ITEMS يعيد item_id وsale_price أيضاً)
DECLARE
  v_item erp_items%ROWTYPE;
BEGIN
  IF :LINES.ITEM_CODE IS NULL THEN :LINES.ITEM_ID := NULL; RETURN; END IF;
  SELECT * INTO v_item FROM erp_items WHERE code = :LINES.ITEM_CODE AND active = 'Y';
  :LINES.ITEM_ID := v_item.item_id;
  IF :LINES.DESCRIPTION IS NULL THEN :LINES.DESCRIPTION := v_item.name; END IF;
  IF :HDR.KIND = 'SALES' AND :LINES.PRICE IS NULL THEN :LINES.PRICE := v_item.sale_price; END IF;
  IF v_item.track_stock = 'Y' AND :LINES.WH_ID IS NULL THEN
    SELECT wh_id, code INTO :LINES.WH_ID, :LINES.WH_CODE FROM erp_warehouses WHERE code = 'MAIN';
  END IF;
EXCEPTION WHEN NO_DATA_FOUND THEN
  MESSAGE('الصنف غير موجود أو موقوف'); RAISE FORM_TRIGGER_FAILURE;
END;

-- LINES.WH_CODE : POST-CHANGE
BEGIN
  SELECT wh_id INTO :LINES.WH_ID FROM erp_warehouses WHERE code = :LINES.WH_CODE AND active = 'Y';
EXCEPTION WHEN NO_DATA_FOUND THEN :LINES.WH_ID := NULL;
END;
```

```plsql
-- LINES.QTY / PRICE / VAT_RATE : WHEN-VALIDATE-ITEM
:LINES.NET := ROUND(NVL(:LINES.QTY, 0) * NVL(:LINES.PRICE, 0), 2);
:LINES.VAT := ROUND(:LINES.NET * NVL(:LINES.VAT_RATE, 0) / 100, 2);
recalc_invoice;

-- BTN_SAVE : WHEN-BUTTON-PRESSED
DECLARE
  v_lines erp_inv_line_tab := erp_inv_line_tab();
  v_id NUMBER;
BEGIN
  GO_BLOCK('LINES'); FIRST_RECORD;
  LOOP
    IF :LINES.DESCRIPTION IS NOT NULL OR :LINES.PRICE IS NOT NULL THEN
      v_lines.EXTEND;
      v_lines(v_lines.COUNT) := erp_inv_line_t(:LINES.DESCRIPTION, :LINES.QTY, :LINES.PRICE, :LINES.VAT_RATE, :LINES.ACCOUNT_CODE, :LINES.ITEM_ID, :LINES.WH_ID);
    END IF;
    EXIT WHEN :SYSTEM.LAST_RECORD = 'TRUE';
    NEXT_RECORD;
  END LOOP;
  v_id := erp_trade.create_invoice(:HDR.KIND, :HDR.PARTY_ID, :HDR.INVOICE_DATE, :HDR.DUE_DATE, :HDR.REF, :HDR.NOTE, v_lines);
  commit_db;
  MESSAGE('رُحّلت الفاتورة');
  GO_BLOCK('INV_LIST'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

وحدة `recalc_invoice` مماثلة لـ `recalc_totals`: تجمع `NET` و`VAT` من `LINES` إلى `HDR.SUBTOTAL` و`HDR.VAT_AMOUNT` ثم `TOTAL`. (الحساب النهائي الملزم يتم في `ERP_TRADE.CREATE_INVOICE`؛ المعروض هنا للمعاينة فقط.)

### تبويب قائمة الفواتير

- **`INV_LIST`** مرتبطة بالعرض `v_erp_invoice_status` (استعلام فقط): `INVOICE_NO`, `INVOICE_DATE`, `PARTY_NAME`, `TOTAL`, `PAID`, `REMAINING`, `STATE`، مع `ORDER BY invoice_date DESC`.
- أزرار: `BTN_PAY` (يفتح نافذة الدفع)، `BTN_VOID`، `BTN_PRINT` (طباعة الفاتورة).

```plsql
-- BTN_VOID : WHEN-BUTTON-PRESSED
BEGIN
  IF SHOW_ALERT('AL_CONFIRM_VOID') <> ALERT_BUTTON1 THEN RETURN; END IF;
  erp_trade.void_invoice(:INV_LIST.INVOICE_ID);
  commit_db;
  EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

> ملاحظة: أضف `INVOICE_ID` و`PARTY_ID` عنصرين غير مرئيين (Visible = No) في الكتلة `INV_LIST` لتستخدمهما الأزرار؛ العمودان موجودان في العرض `v_erp_invoice_status`.

## الشاشة 5: `FRM_ITEMS` — الأصناف والمخازن

نافذة بتبويبين (Tabbed Canvas):

**تبويب الأصناف:** كتلة `ITEMS` مرتبطة بـ `erp_items` (سجلات متعددة، `ORDER BY code`).
- العناصر: `ITEM_ID` (عرض فقط)، `CODE`، `NAME`، `UNIT`، `SALE_PRICE`، `TRACK_STOCK` (Check Box: Y/N، افتراضي Y)، `INV_ACCOUNT` (افتراضي 1400)، `COGS_ACCOUNT` (5100)، `REV_ACCOUNT` (4100)، `ACTIVE`.
- اجعل `ITEM_ID` و`CREATED_AT` بـ `Insert Allowed = No` و`Update Allowed = No` (هوية/افتراضي)، و`CODE` و`TRACK_STOCK` و`INV_ACCOUNT` و`COGS_ACCOUNT` بـ `Update Allowed = No` بعد الحفظ (تغييرها بعد وجود حركات يُفسد التقييم). `Delete Allowed = No` (التعطيل بـ `ACTIVE = N`).
- `INV_ACCOUNT` من LOV يعرض حسابات الأصول الطرفية فقط، و`COGS_ACCOUNT` للمصروفات، و`REV_ACCOUNT` للإيرادات (ثلاث مجموعات سجلات بحسب `acc_type`). الحزمة `ERP_INVENTORY.ADD_ITEM` تتحقق من الأنواع نفسها؛ إن فضّلت إدخال الأصناف عبرها اجعل الكتلة غير مرتبطة واستدعِ الدالة من زر «حفظ».

**تبويب المخازن:** كتلة `WAREHOUSES` مرتبطة بـ `erp_warehouses` (`WH_ID` عرض فقط بـ `Insert/Update Allowed = No`، `CODE`، `NAME`، `ACTIVE`، `Delete Allowed = No`).

## الشاشة 6: `FRM_STOCK` — أرصدة المخزون والتسويات والتحويلات

**تبويب الأرصدة:** كتلة `STOCK` مرتبطة بالعرض `v_erp_stock` (استعلام فقط): `ITEM_CODE`, `ITEM_NAME`, `WH_CODE`, `QTY`, `AVG_COST`, `VALUE`، مع `ITEM_ID` و`WH_ID` غير مرئيين. كتلة تحكم بحقول التصفية (`CTRL.F_ITEM`, `CTRL.F_WH`) تضبط `DEFAULT_WHERE` ثم `EXECUTE_QUERY`. حقل `CTRL.TOTAL_VALUE` يعرض مجموع القيمة، وحقل `CTRL.GL_BALANCE` يعرض رصيد حساب المخزون من `v_erp_stock_vs_gl` مع تنبيه لوني إن اختلف المجموعان.

```plsql
-- CTRL.BTN_REFRESH : WHEN-BUTTON-PRESSED
DECLARE v_diff NUMBER;
BEGIN
  SET_BLOCK_PROPERTY('STOCK', DEFAULT_WHERE,
    '(' || NVL(TO_CHAR(:CTRL.F_ITEM_ID), 'NULL') || ' IS NULL OR item_id = ' || NVL(TO_CHAR(:CTRL.F_ITEM_ID), '0') || ') AND ' ||
    '(' || NVL(TO_CHAR(:CTRL.F_WH_ID),   'NULL') || ' IS NULL OR wh_id = '   || NVL(TO_CHAR(:CTRL.F_WH_ID),   '0') || ')');
  GO_BLOCK('STOCK'); EXECUTE_QUERY;
  SELECT NVL(SUM(stock_value), 0), NVL(SUM(difference), 0) INTO :CTRL.TOTAL_VALUE, v_diff FROM v_erp_stock_vs_gl;
  :CTRL.GL_NOTE := CASE WHEN v_diff = 0 THEN 'مطابق لحساب المخزون' ELSE 'فرق عن الأستاذ: ' || TO_CHAR(v_diff) END;
END;
```

**تبويب التسوية:** كتلة غير مرتبطة `ADJ`: `ITEM_CODE` (LOV_ITEMS)، `ITEM_ID` (غير مرئي)، `WH_CODE` (LOV_WAREHOUSES)، `WH_ID`، `ADJ_DATE` (افتراضي اليوم)، `QTY_DELTA` (موجب زيادة، سالب نقص)، `UNIT_COST` (يلزم للزيادة إن لم يوجد متوسط)، `OFFSET_ACCOUNT` (افتراضي 5500؛ للرصيد الافتتاحي اختر 3100)، `NOTE`.

```plsql
-- ADJ.BTN_POST : WHEN-BUTTON-PRESSED
DECLARE v_entry NUMBER;
BEGIN
  v_entry := erp_inventory.adjust(:ADJ.ITEM_ID, :ADJ.WH_ID, :ADJ.ADJ_DATE, :ADJ.QTY_DELTA, :ADJ.UNIT_COST,
                              NVL(:ADJ.OFFSET_ACCOUNT, '5500'), :ADJ.NOTE);
  commit_db;
  MESSAGE('رُحّلت التسوية' || CASE WHEN v_entry IS NOT NULL THEN ' (قيد رقم ' || v_entry || ')' END);
  CLEAR_BLOCK(NO_VALIDATE);
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

**تبويب التحويل:** كتلة غير مرتبطة `TRF`: `ITEM_CODE`/`ITEM_ID`، `FROM_WH_CODE`/`FROM_WH_ID`، `TO_WH_CODE`/`TO_WH_ID`، `TRF_DATE`، `QTY`، وعرض `ON_HAND` (يُحسب بـ `erp_inventory.on_hand` عند اختيار الصنف والمخزن المصدر).

```plsql
-- TRF.BTN_POST : WHEN-BUTTON-PRESSED
DECLARE v_val NUMBER;
BEGIN
  v_val := erp_inventory.transfer(:TRF.ITEM_ID, :TRF.FROM_WH_ID, :TRF.TO_WH_ID, :TRF.TRF_DATE, :TRF.QTY);
  commit_db;
  MESSAGE('حُوّلت البضاعة بقيمة ' || TO_CHAR(v_val));
  CLEAR_BLOCK(NO_VALIDATE);
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

**بطاقة الصنف:** زر في تبويب الأرصدة يشغّل التقرير `RPT_STOCK_CARD` للسجل الحالي: `run_erp_report('RPT_STOCK_CARD', 'P_ITEM=' || :STOCK.ITEM_ID || ' P_WH=' || :STOCK.WH_ID)`.

## الشاشة 7: `FRM_ASSETS` — الأصول الثابتة والإهلاك

ثلاثة تبويبات:

**تبويب الفئات:** كتلة `CATS` مرتبطة بـ `erp_asset_categories` (`CAT_ID` عرض فقط بـ `Insert/Update Allowed = No`، `CODE`, `NAME`, `LIFE_MONTHS`, `ASSET_ACCOUNT`, `ACCUM_ACCOUNT`, `EXPENSE_ACCOUNT`, `ACTIVE`، `Delete Allowed = No`). الحسابات الثلاثة بـ `Update Allowed = No` بعد الحفظ، ومن LOV بحسب النوع (أصل / أصل / مصروف).

**تبويب الأصول:**
- كتلة `ASSETS` مرتبطة بالعرض `v_erp_asset_register` (استعلام فقط): `CODE`, `NAME`, `CAT_NAME`, `ACQ_DATE`, `COST`, `ACCUMULATED`, `BOOK_VALUE`, `STATUS`, `FULLY_DEPRECIATED`، و`ASSET_ID` غير مرئي.
- كتلة غير مرتبطة `NEWA` لتسجيل أصل: `CODE`, `NAME`, `CAT_CODE` (LOV الفئات) و`CAT_ID` (غير مرئي)، `ACQ_DATE`, `COST`, `SALVAGE`, `LIFE_MONTHS` (يُملأ من الفئة ويقبل التعديل)، `DEP_START` (شهر، افتراضي شهر الاقتناء)، `OFFSET_ACCOUNT` (افتراضي 1200، بنك/صندوق/رأس مال)، `INVOICE_ID` (اختياري: لأصل اشتُري بفاتورة مشتريات سارية، فلا يُرحَّل قيد ثانٍ)، `NOTE`.

```plsql
-- NEWA.CAT_CODE : POST-CHANGE
BEGIN
  SELECT cat_id, life_months INTO :NEWA.CAT_ID, :NEWA.LIFE_MONTHS FROM erp_asset_categories WHERE code = :NEWA.CAT_CODE AND active = 'Y';
EXCEPTION WHEN NO_DATA_FOUND THEN
  MESSAGE('الفئة غير موجودة أو موقوفة'); RAISE FORM_TRIGGER_FAILURE;
END;

-- NEWA.BTN_SAVE : WHEN-BUTTON-PRESSED
DECLARE v_id NUMBER;
BEGIN
  v_id := erp_asset.acquire(:NEWA.CODE, :NEWA.NAME, :NEWA.CAT_ID, :NEWA.ACQ_DATE, :NEWA.COST, NVL(:NEWA.SALVAGE, 0),
                            :NEWA.LIFE_MONTHS, :NEWA.DEP_START,
                            CASE WHEN :NEWA.INVOICE_ID IS NULL THEN NVL(:NEWA.OFFSET_ACCOUNT, '1200') END,
                            :NEWA.INVOICE_ID, :NEWA.NOTE);
  commit_db;
  MESSAGE('سُجّل الأصل');
  GO_BLOCK('NEWA'); CLEAR_BLOCK(NO_VALIDATE);
  GO_BLOCK('ASSETS'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

أزرار كتلة `ASSETS` (على السجل الحالي):

```plsql
-- BTN_VOID (إلغاء تسجيل أصل لم يُهلَك)
BEGIN
  IF SHOW_ALERT('AL_CONFIRM_VOID_ASSET') <> ALERT_BUTTON1 THEN RETURN; END IF;
  erp_asset.void_asset(:ASSETS.ASSET_ID);
  commit_db; EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;

-- BTN_DISPOSE : يفتح نافذة صغيرة (كتلة غير مرتبطة DISP: DISP_DATE، PROCEEDS، PROCEEDS_ACCOUNT افتراضي 1200)
-- DISP.BTN_OK : WHEN-BUTTON-PRESSED
DECLARE v_entry NUMBER;
BEGIN
  v_entry := erp_asset.dispose(:ASSETS.ASSET_ID, :DISP.DISP_DATE, NVL(:DISP.PROCEEDS, 0), NVL(:DISP.PROCEEDS_ACCOUNT, '1200'));
  commit_db;
  MESSAGE('سُجّل البيع (قيد رقم ' || v_entry || ')');
  HIDE_WINDOW('WIN_DISPOSE'); GO_BLOCK('ASSETS'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

> رسالة الخطأ `-20404` («إهلاك معلّق… شغّل الإهلاك حتى شهر …») تعني أن على المستخدم تشغيل الإهلاك من التبويب التالي قبل البيع.

**تبويب الإهلاك:** كتلة تحكم `DEP`: `UPTO` (شهر، افتراضي الشهر الحالي)، `LAST_RUN` (عرض: آخر شهر مهلك من `SELECT MAX(period) FROM erp_depreciation WHERE status = 'OK'`)، وأزرار `BTN_RUN` و`BTN_REVERSE`. وكتلة `RUNS` مرتبطة بـ `erp_dep_runs` (استعلام فقط، `ORDER BY period DESC, run_id DESC`).

```plsql
-- DEP.BTN_RUN : WHEN-BUTTON-PRESSED
DECLARE v_total NUMBER;
BEGIN
  v_total := erp_asset.run_depreciation(:DEP.UPTO);
  commit_db;
  MESSAGE(CASE WHEN v_total = 0 THEN 'لا إهلاك مستحق' ELSE 'رُحّل إهلاك بإجمالي ' || TO_CHAR(v_total) END);
  GO_BLOCK('RUNS'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;

-- DEP.BTN_REVERSE : يعكس الشهر المحدّد في UPTO (مرفوض إن وُجد إهلاك لاحق أو بيع بعده)
BEGIN
  IF SHOW_ALERT('AL_CONFIRM_REVERSE_DEP') <> ALERT_BUTTON1 THEN RETURN; END IF;
  erp_asset.reverse_depreciation(:DEP.UPTO);
  commit_db;
  MESSAGE('عُكس إهلاك الشهر');
  GO_BLOCK('RUNS'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

زر `BTN_SCHEDULE` على كتلة `ASSETS` يشغّل التقرير `RPT_ASSET_SCHEDULE` للأصل الحالي: `run_erp_report('RPT_ASSET_SCHEDULE', 'P_ASSET=' || :ASSETS.ASSET_ID)`.

## الشاشة 8: `FRM_EMPLOYEES` — الموظفون والمكوّنات

**تبويب الموظفين:** كتلة غير مرتبطة `NEWE` لإضافة موظف: `CODE`, `NAME`, `HIRE_DATE`, `BASIC_SALARY`, `DEPT_NAME` (LOV الأقسام) و`DEPT_ID`, `JOB_TITLE`, `NATIONAL_ID`, `BANK_ACCOUNT`، وكتلة `EMPS` مرتبطة بالعرض `v_erp_employee` (استعلام فقط) تعرض الموظفين مع الراتب الساري. زرا `BTN_SALARY` (تعديل راتب: نافذة `SAL` بحقلي الراتب وشهر السريان) و`BTN_TERMINATE` (إنهاء خدمة بتاريخ).

```plsql
-- NEWE.BTN_SAVE : WHEN-BUTTON-PRESSED
DECLARE v_id NUMBER;
BEGIN
  v_id := erp_hr.add_employee(:NEWE.CODE, :NEWE.NAME, :NEWE.HIRE_DATE, :NEWE.BASIC_SALARY, :NEWE.DEPT_ID,
                              :NEWE.JOB_TITLE, :NEWE.NATIONAL_ID, :NEWE.BANK_ACCOUNT);
  commit_db;
  MESSAGE('أُضيف الموظف');
  GO_BLOCK('NEWE'); CLEAR_BLOCK(NO_VALIDATE);
  GO_BLOCK('EMPS'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;

-- SAL.BTN_OK :  erp_hr.set_salary(:EMPS.EMP_ID, :SAL.BASIC_SALARY, :SAL.EFFECTIVE_FROM);  commit_db;
-- BTN_TERMINATE : erp_hr.terminate(:EMPS.EMP_ID, :TERM.TERM_DATE);  commit_db;   (كلاهما بنفس نمط معالجة الأخطاء أعلاه)
```

**تبويب المكوّنات:** كتلة `COMPS` مرتبطة بـ `erp_pay_components` للعرض فقط، وكتلة غير مرتبطة `NEWC` لتعريف مكوّن تستدعي `erp_hr.add_component(CODE, NAME, KIND, CALC_TYPE, PCT, BASE_TYPE, BASE_CAP, EXPENSE_ACCOUNT, LIABILITY_ACCOUNT)` (`KIND` وCALC_TYPE وBASE_TYPE قوائم List Item بقيمها الإنجليزية وعناوين عربية). **نسب التأمينات والضرائب وسقوفها تُضبط هنا وفق نظام بلدك**؛ لا شيء مزروع. كتلة `ASSIGN` غير مرتبطة (`EMP_CODE`, `COMP_CODE`, `AMOUNT`, `PCT`) وزر يستدعي `erp_hr.assign_component(:ASSIGN.EMP_ID, :ASSIGN.COMP_ID, :ASSIGN.AMOUNT, :ASSIGN.PCT)`، وزر `BTN_UNASSIGN` يستدعي `erp_hr.unassign_component`. كتلة `EMP_COMPS` مرتبطة بـ `erp_emp_components` (للعرض فقط، ربط Master-Detail مع `EMPS`).

## الشاشة 9: `FRM_PAYROLL` — كشوف الرواتب

- كتلة `RUNS` مرتبطة بالعرض `v_erp_payroll_summary` (استعلام فقط، `ORDER BY period DESC`): `PERIOD`, `STATUS`, `EMPLOYEES`, `TOTAL_GROSS`, `TOTAL_DEDUCTIONS`, `TOTAL_NET`, `TOTAL_EMPLOYER`، و`RUN_ID` غير مرئي.
- كتلة `LINES` تفصيل لـ `RUNS` (علاقة على `run_id`، استعلام فقط) على `erp_payroll_lines` مع اسم الموظف، وكتلة `ITEMS` تفصيل لـ `LINES` على `line_id` تعرض البنود.
- كتلة تحكم `CTRL`: `NEW_PERIOD` (شهر) وأزرار الدورة. يُفعَّل كل زر بحسب `RUNS.STATUS` (`SET_ITEM_PROPERTY(..., ENABLED, ...)` في `WHEN-NEW-RECORD-INSTANCE`):

| الزر | يُفعَّل عند | الإجراء |
|---|---|---|
| إنشاء كشف | دائماً | `erp_payroll.create_run(:CTRL.NEW_PERIOD)` |
| إعادة حساب | DRAFT | `erp_payroll.calculate_run(:RUNS.RUN_ID)` |
| إلغاء مسودة | DRAFT | `erp_payroll.cancel_run(:RUNS.RUN_ID)` |
| ترحيل | DRAFT | `v := erp_payroll.post_run(:RUNS.RUN_ID)` |
| صرف | POSTED | نافذة (التاريخ، `METHOD`) ثم `v := erp_payroll.pay_run(:RUNS.RUN_ID, :PAYW.PAY_DATE, :PAYW.METHOD)` |
| إلغاء الصرف | PAID | `erp_payroll.unpay_run(:RUNS.RUN_ID)` |
| إلغاء الكشف | POSTED | `erp_payroll.void_run(:RUNS.RUN_ID)` |
| قسيمة / كشف / بنود | أي حالة | `run_erp_report('RPT_PAYSLIP', 'P_RUN=' || :RUNS.RUN_ID || ' P_EMP=' || :LINES.EMP_ID)` وأخواتها |

```plsql
-- القالب المشترك لكل زر دورة (مثال: الترحيل) : WHEN-BUTTON-PRESSED
DECLARE v_entry NUMBER;
BEGIN
  IF SHOW_ALERT('AL_CONFIRM_POST_PAYROLL') <> ALERT_BUTTON1 THEN RETURN; END IF;
  v_entry := erp_payroll.post_run(:RUNS.RUN_ID);
  commit_db;
  MESSAGE('رُحّل الكشف (قيد رقم ' || v_entry || ')');
  GO_BLOCK('RUNS'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;

-- RUNS : WHEN-NEW-RECORD-INSTANCE  (تفعيل الأزرار بحسب الحالة)
SET_ITEM_PROPERTY('CTRL.BTN_CALC',   ENABLED, CASE WHEN :RUNS.STATUS = 'DRAFT'  THEN PROPERTY_TRUE ELSE PROPERTY_FALSE END);
SET_ITEM_PROPERTY('CTRL.BTN_POST',   ENABLED, CASE WHEN :RUNS.STATUS = 'DRAFT'  THEN PROPERTY_TRUE ELSE PROPERTY_FALSE END);
SET_ITEM_PROPERTY('CTRL.BTN_PAY',    ENABLED, CASE WHEN :RUNS.STATUS = 'POSTED' THEN PROPERTY_TRUE ELSE PROPERTY_FALSE END);
SET_ITEM_PROPERTY('CTRL.BTN_VOID',   ENABLED, CASE WHEN :RUNS.STATUS = 'POSTED' THEN PROPERTY_TRUE ELSE PROPERTY_FALSE END);
SET_ITEM_PROPERTY('CTRL.BTN_UNPAY',  ENABLED, CASE WHEN :RUNS.STATUS = 'PAID'   THEN PROPERTY_TRUE ELSE PROPERTY_FALSE END);
```

> رسائل `-20605` («صافي الراتب سالب للموظف …») و`-20604` تظهر عند إنشاء الكشف أو إعادة حسابه، وتعني مراجعة الاستقطاعات والسلف قبل المتابعة.

## الشاشة 10: `FRM_HR_ADJUST` — السلف والتسويات الشهرية

**تبويب السلف:** كتلة غير مرتبطة `ADV` (`EMP_CODE`/`EMP_ID` بـ LOV، `ADV_DATE`, `AMOUNT`, `INSTALLMENTS`, `FIRST_PERIOD` شهر، `METHOD` قائمة CASH/BANK، `NOTE`) وزر يستدعي `erp_hr.grant_advance(:ADV.EMP_ID, :ADV.ADV_DATE, :ADV.AMOUNT, :ADV.INSTALLMENTS, :ADV.FIRST_PERIOD, :ADV.METHOD, :ADV.NOTE)`. كتلة `ADVS` مرتبطة بـ `v_erp_advance_balance` (استعلام فقط) وزر `BTN_VOID_ADV` يستدعي `erp_hr.void_advance(:ADVS.ADV_ID)` (`ADV_ID` عنصر غير مرئي في الكتلة، والعمود موجود في العرض).

**تبويب التسويات:** كتلة غير مرتبطة `ADJ` (`EMP_CODE`/`EMP_ID`, `PERIOD`, `KIND` قائمة EARNING=استحقاق / DEDUCTION=خصم، `DESCRIPTION`, `AMOUNT`, `ACCOUNT_CODE` افتراضي 5200) وزر يستدعي `erp_hr.add_adjustment(...)`. كتلة `ADJS` مرتبطة بـ `erp_pay_adjustments` (استعلام فقط، `ORDER BY period DESC`) وزر `BTN_VOID_ADJ` يستدعي `erp_hr.void_adjustment(:ADJS.ADJ_ID)` (للمعلّقة فقط).

## الشاشة 11: `FRM_PAYMENT` — سند قبض/صرف (نافذة منبثقة Modal)

كتلة غير مرتبطة `PAY`: `PARTY_ID`, `PARTY_NAME` (عرض)، `INVOICE_ID` (اختياري، عرض)، `PAY_DATE`، `AMOUNT`، `METHOD` (List: CASH=نقدي، BANK=بنكي)، `NOTE`. تُفتح من `FRM_INVOICE` أو `FRM_PARTIES` عبر `CALL_FORM` مع معاملات (Parameter List: `P_PARTY_ID`, `P_INVOICE_ID`, `P_REMAINING`).

```plsql
-- WHEN-NEW-FORM-INSTANCE
:PAY.PARTY_ID := :PARAMETER.P_PARTY_ID;
:PAY.INVOICE_ID := :PARAMETER.P_INVOICE_ID;
:PAY.PAY_DATE := TRUNC(SYSDATE);
:PAY.AMOUNT := :PARAMETER.P_REMAINING;
SELECT name INTO :PAY.PARTY_NAME FROM erp_parties WHERE party_id = :PAY.PARTY_ID;

-- BTN_OK : WHEN-BUTTON-PRESSED
DECLARE v_id NUMBER;
BEGIN
  v_id := erp_trade.pay(:PAY.PARTY_ID, :PAY.INVOICE_ID, :PAY.PAY_DATE, :PAY.AMOUNT, :PAY.METHOD, :PAY.NOTE);
  commit_db;
  MESSAGE('سُجّل السند رقم ' || v_id);
  EXIT_FORM(NO_VALIDATE);
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

استدعاؤها من `FRM_INVOICE` (`BTN_PAY`):

```plsql
DECLARE v_pl PARAMLIST;
BEGIN
  v_pl := GET_PARAMETER_LIST('PL_PAY');
  IF NOT ID_NULL(v_pl) THEN DESTROY_PARAMETER_LIST(v_pl); END IF;
  v_pl := CREATE_PARAMETER_LIST('PL_PAY');
  ADD_PARAMETER(v_pl, 'P_PARTY_ID',   TEXT_PARAMETER, :INV_LIST.PARTY_ID);
  ADD_PARAMETER(v_pl, 'P_INVOICE_ID', TEXT_PARAMETER, :INV_LIST.INVOICE_ID);
  ADD_PARAMETER(v_pl, 'P_REMAINING',  TEXT_PARAMETER, :INV_LIST.REMAINING);
  CALL_FORM('FRM_PAYMENT', NO_HIDE, DO_REPLACE, NO_QUERY_ONLY, v_pl);
  GO_BLOCK('INV_LIST'); EXECUTE_QUERY;
END;
```

> عرّف معاملات النموذج `P_PARTY_ID` و`P_INVOICE_ID` و`P_REMAINING` (CHAR، 30) في وحدة `FRM_PAYMENT`.

## الشاشة 12: `FRM_PERIODS` — إقفال الفترات والسنة

- كتلة `PER` مرتبطة بالعرض `v_erp_period_status` (استعلام فقط، `ORDER BY period DESC`): `PERIOD` (شهر)، `STATUS`، `ENTRIES`.
- كتلة `ISSUES` غير مرتبطة (سجلات متعددة، عنصر `MSG` للعرض) تعرض مشكلات الشهر المحدد قبل الإقفال. تُملأ من `erp_period.close_issues`.
- كتلة `YEARS` مرتبطة بـ `erp_year_closings` (استعلام فقط): `YEAR_END`, `NET_INCOME`, `STATUS`.
- كتلة تحكم `CTRL`: `YEAR_END` (آخر يوم في شهر، افتراضي 31 ديسمبر من السنة الماضية) وأزرار: فحص الشهر، إقفال الشهر، إعادة فتح الشهر، إقفال السنة، إعادة فتح السنة.

```plsql
-- PER : WHEN-NEW-RECORD-INSTANCE  (عرض مشكلات الشهر الحالي تلقائياً)
-- وكذلك CTRL.BTN_CHECK : WHEN-BUTTON-PRESSED
DECLARE
  v_list erp_msg_tab;
BEGIN
  v_list := erp_period.close_issues(:PER.PERIOD);
  GO_BLOCK('ISSUES'); CLEAR_BLOCK(NO_VALIDATE);
  IF v_list.COUNT = 0 THEN
    :ISSUES.MSG := 'جاهز للإقفال: لا مشكلات';
  ELSE
    FOR i IN 1 .. v_list.COUNT LOOP
      :ISSUES.MSG := v_list(i);
      IF i < v_list.COUNT THEN NEXT_RECORD; END IF;
    END LOOP;
  END IF;
  GO_BLOCK('PER');
END;

-- CTRL.BTN_CLOSE : WHEN-BUTTON-PRESSED   (إعادة الفتح تستبدل الاسم: erp_period.reopen_period)
BEGIN
  IF SHOW_ALERT('AL_CONFIRM_CLOSE_PERIOD') <> ALERT_BUTTON1 THEN RETURN; END IF;
  erp_period.close_period(:PER.PERIOD);
  commit_db;
  MESSAGE('أُقفل الشهر');
  GO_BLOCK('PER'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;

-- CTRL.BTN_CLOSE_YEAR : WHEN-BUTTON-PRESSED   (reopen_year بالنمط نفسه)
DECLARE v_entry NUMBER;
BEGIN
  IF SHOW_ALERT('AL_CONFIRM_CLOSE_YEAR') <> ALERT_BUTTON1 THEN RETURN; END IF;
  v_entry := erp_period.close_year(:CTRL.YEAR_END);
  commit_db;
  MESSAGE('أُقفلت السنة' || CASE WHEN v_entry IS NOT NULL THEN ' (قيد رقم ' || v_entry || ')' END);
  GO_BLOCK('YEARS'); EXECUTE_QUERY; GO_BLOCK('PER'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

> الرسالة `-20113` («الفترة … مقفلة») تظهر في كل شاشات الحركات عند محاولة قيد بتاريخ في فترة مقفلة؛ معالجتها العامة `show_error` تكفي. إلغاء فاتورة أو كشف رواتب تاريخه في فترة مقفلة يفشل بالرسالة نفسها (عكس القيد يقع في الفترة المقفلة): المطلوب إعادة فتح الفترة أو تصحيح بقيد جديد بتاريخ مفتوح.

## الشاشة 13: `FRM_STATEMENTS` — القوائم المالية

كتلة تحكم `CTRL` فقط: `P_FROM`, `P_TO` (افتراضياً أول السنة واليوم)، `P_ASOF`، وأزرار تشغّل التقارير ببطاقة ملخص من `ERP_FIN`:

| الزر | الإجراء |
|---|---|
| قائمة الدخل | `run_erp_report('RPT_INCOME', 'P_FROM=' \|\| TO_CHAR(:CTRL.P_FROM,'YYYY-MM-DD') \|\| ' P_TO=' \|\| TO_CHAR(:CTRL.P_TO,'YYYY-MM-DD'))` |
| الميزانية | `run_erp_report('RPT_BALANCE_SHEET', 'P_ASOF=' \|\| TO_CHAR(:CTRL.P_ASOF,'YYYY-MM-DD'))` |
| التدفقات النقدية | `run_erp_report('RPT_CASH_FLOW', 'P_FROM=… P_TO=…')` |
| ميزان المراجعة | `RPT_TRIAL_BALANCE` بالمعامل `P_TO` |

```plsql
-- CTRL.BTN_SUMMARY : WHEN-BUTTON-PRESSED  (أرقام سريعة قبل فتح التقرير، وفحص توازن الميزانية)
DECLARE
  v_a NUMBER; v_l NUMBER; v_e NUMBER; v_u NUMBER;
BEGIN
  v_a := erp_fin.section_total('ASSET',     :CTRL.P_ASOF);
  v_l := erp_fin.section_total('LIABILITY', :CTRL.P_ASOF);
  v_e := erp_fin.section_total('EQUITY',    :CTRL.P_ASOF);
  v_u := erp_fin.unclosed_earnings(:CTRL.P_ASOF);
  :CTRL.SUMMARY := 'الأصول ' || TO_CHAR(v_a) || ' | الخصوم ' || TO_CHAR(v_l) || ' | حقوق الملكية ' || TO_CHAR(v_e + v_u)
                   || CASE WHEN v_a = v_l + v_e + v_u THEN ' — الميزانية متوازنة' ELSE ' — الميزانية غير متوازنة!' END
                   || ' | صافي الدخل ' || TO_CHAR(erp_fin.net_income(:CTRL.P_FROM, :CTRL.P_TO));
END;
```

## الشاشة 14: `FRM_POS` — نقطة البيع (شاشة الكاشير)

تعمل على نقطة بيع واحدة (معامل النموذج `P_REG_ID`). تصميم الشاشة للّمس والباركود: **المؤشر دائماً في حقل الباركود**.

**كتل الشاشة:**
- `SHIFT` (غير مرتبطة): `STATUS`, `CASHIER`, `OPENING_CASH`, `EXPECTED_CASH`، وأزرار فتح وإقفال الوردية. يُحمَّل `SHIFT_ID` عند بدء الشاشة من `SELECT shift_id FROM erp_pos_shifts WHERE reg_id = :PARAMETER.P_REG_ID AND status = 'OPEN'`، ويُمنع البيع (`ENABLED = FALSE` لكتلة السلة) إن لم توجد.
- `SCAN` (سجل واحد): `BARCODE` (مؤشر البداية). يملأ إدخاله سطراً في `BASKET`.
- `BASKET` (غير مرتبطة، 12 سجلاً): `ITEM_ID` (مخفي)، `NAME`، `QTY` (افتراضي 1)، `PRICE`، `DISC_PCT`، `VAT_RATE` (مخفي)، `LINE_TOTAL` (عرض).
- `TOTALS` (عرض): `SUBTOTAL`, `VAT`, `TOTAL`، و`PAY_CASH` و`PAY_CARD` (إدخال) و`CHANGE` (عرض).
- أزرار: `BTN_PAY` (إتمام البيع)، `BTN_CLEAR` (سلة جديدة)، `BTN_VOID_LAST`، `BTN_RETURN`، `BTN_RECEIPT`.

```plsql
-- SCAN.BARCODE : WHEN-VALIDATE-ITEM  (مسح باركود أو إدخال رمز صنف)
DECLARE
  v_id   NUMBER;
  v_item erp_items%ROWTYPE;
BEGIN
  IF :SCAN.BARCODE IS NULL THEN RETURN; END IF;
  v_id := erp_pos.find_item(:SCAN.BARCODE);
  IF v_id IS NULL THEN
    MESSAGE('صنف غير موجود: ' || :SCAN.BARCODE); :SCAN.BARCODE := NULL; RAISE FORM_TRIGGER_FAILURE;
  END IF;
  SELECT * INTO v_item FROM erp_items WHERE item_id = v_id;
  GO_BLOCK('BASKET');
  -- نفس الصنف مرة أخرى: زِد الكمية بدل سطر جديد
  FIRST_RECORD;
  LOOP
    IF :BASKET.ITEM_ID = v_id THEN :BASKET.QTY := :BASKET.QTY + 1; recalc_basket; GO_ITEM('SCAN.BARCODE'); :SCAN.BARCODE := NULL; RETURN; END IF;
    EXIT WHEN :SYSTEM.LAST_RECORD = 'TRUE' OR :BASKET.ITEM_ID IS NULL;
    NEXT_RECORD;
  END LOOP;
  IF :BASKET.ITEM_ID IS NOT NULL THEN CREATE_RECORD; END IF;
  :BASKET.ITEM_ID := v_id; :BASKET.NAME := v_item.name; :BASKET.QTY := 1;
  :BASKET.PRICE := v_item.sale_price; :BASKET.VAT_RATE := v_item.vat_rate; :BASKET.DISC_PCT := 0;
  recalc_basket;
  GO_ITEM('SCAN.BARCODE'); :SCAN.BARCODE := NULL;
END;
```

وحدة `recalc_basket` للمعاينة فقط (الحساب الملزم داخل `ERP_POS.SELL`، وبالمعادلات نفسها): لكل سطر `gross := ROUND(QTY * PRICE * (1 - DISC_PCT/100), 2)`؛ ثم إن كانت نقطة البيع بأسعار شاملة (`:SHIFT.PRICES_INCLUDE_VAT = 'Y'`) فالضريبة `ROUND(gross * rate / (100 + rate), 2)` والصافي `gross − vat`، وإلا فالصافي `gross` والضريبة `ROUND(gross * rate / 100, 2)`. تجمع `TOTALS.SUBTOTAL` و`VAT` و`TOTAL`، وتحسب `CHANGE := GREATEST(PAY_CASH + PAY_CARD − TOTAL, 0)`.

```plsql
-- BTN_PAY : WHEN-BUTTON-PRESSED
DECLARE
  v_lines erp_pos_line_tab := erp_pos_line_tab();
  v_pays  erp_pos_pay_tab  := erp_pos_pay_tab();
  v_id    NUMBER;
BEGIN
  GO_BLOCK('BASKET'); FIRST_RECORD;
  LOOP
    IF :BASKET.ITEM_ID IS NOT NULL THEN
      v_lines.EXTEND;
      v_lines(v_lines.COUNT) := erp_pos_line_t(:BASKET.ITEM_ID, :BASKET.QTY, :BASKET.PRICE, :BASKET.DISC_PCT, :BASKET.VAT_RATE);
    END IF;
    EXIT WHEN :SYSTEM.LAST_RECORD = 'TRUE';
    NEXT_RECORD;
  END LOOP;
  IF NVL(:TOTALS.PAY_CASH, 0) > 0 THEN v_pays.EXTEND; v_pays(v_pays.COUNT) := erp_pos_pay_t('CASH', :TOTALS.PAY_CASH); END IF;
  IF NVL(:TOTALS.PAY_CARD, 0) > 0 THEN v_pays.EXTEND; v_pays(v_pays.COUNT) := erp_pos_pay_t('CARD', :TOTALS.PAY_CARD); END IF;

  v_id := erp_pos.sell(:SHIFT.SHIFT_ID, TRUNC(SYSDATE), v_lines, v_pays);
  commit_db;
  :SHIFT.LAST_SALE_ID := v_id;                                  -- للإيصال والإلغاء الأخير
  MESSAGE('تم البيع. الباقي: ' || TO_CHAR(:TOTALS.CHANGE));
  run_erp_report('RPT_POS_RECEIPT', 'P_SALE=' || v_id);        -- طباعة الإيصال (اختياري بحسب الإعداد)
  GO_BLOCK('BASKET'); CLEAR_BLOCK(NO_VALIDATE);
  GO_BLOCK('TOTALS'); CLEAR_RECORD;
  GO_ITEM('SCAN.BARCODE');
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;

-- BTN_VOID_LAST :  erp_pos.void_sale(:SHIFT.LAST_SALE_ID);  commit_db;   (يعمل داخل الوردية المفتوحة فقط)

-- SHIFT.BTN_OPEN : :SHIFT.SHIFT_ID := erp_pos.open_shift(:PARAMETER.P_REG_ID, :SHIFT.OPENING_CASH);  commit_db;
-- SHIFT.BTN_CLOSE (نافذة تطلب النقد المعدود COUNTED):
DECLARE v_var NUMBER;
BEGIN
  v_var := erp_pos.close_shift(:SHIFT.SHIFT_ID, :CLOSEW.COUNTED);
  commit_db;
  MESSAGE('أُقفلت الوردية. الفرق: ' || TO_CHAR(v_var));
  run_erp_report('RPT_Z', 'P_SHIFT=' || :SHIFT.SHIFT_ID);       -- تقرير Z
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

**المرتجع:** زر `BTN_RETURN` يفتح نافذة `RET`: حقل `SALE_NO` (يبحث `SELECT sale_id FROM erp_pos_sales WHERE sale_no = :RET.SALE_NO AND kind = 'SALE'`) ثم كتلة `RET_LINES` (استعلام فقط على `erp_pos_sale_lines` للبيع الأصلي، مع عنصر إدخال `RET_QTY` غير مرتبط)، وحقل `METHOD` (CASH/CARD). الزر `RET.BTN_OK`:

```plsql
DECLARE
  v_lines erp_pos_ret_tab := erp_pos_ret_tab();
  v_id    NUMBER;
BEGIN
  GO_BLOCK('RET_LINES'); FIRST_RECORD;
  LOOP
    IF NVL(:RET_LINES.RET_QTY, 0) > 0 THEN
      v_lines.EXTEND; v_lines(v_lines.COUNT) := erp_pos_ret_t(:RET_LINES.LINE_ID, :RET_LINES.RET_QTY);
    END IF;
    EXIT WHEN :SYSTEM.LAST_RECORD = 'TRUE';
    NEXT_RECORD;
  END LOOP;
  v_id := erp_pos.return_sale(:SHIFT.SHIFT_ID, TRUNC(SYSDATE), :RET.SALE_ID, v_lines, :RET.METHOD);
  commit_db;
  MESSAGE('تم المرتجع'); run_erp_report('RPT_POS_RECEIPT', 'P_SALE=' || v_id);
  HIDE_WINDOW('WIN_RETURN');
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

> أخطاء الدفع (`-20804`) والمخزون (`-20302`) تظهر برسائلها العربية عبر `show_error`، ولا يترك الفشل أثراً (يتراجع البيع كاملاً). يُوصى بتعطيل أزرار القائمة والاختصارات التي تخرج من الشاشة أثناء الوردية وبضبط `Validation Unit = Item`.

## الشاشة 15: `FRM_POS_ADMIN` — نقاط البيع والورديات

كتلة `REGS` مرتبطة بـ `erp_pos_registers` (`REG_ID` عرض فقط، `CODE`, `NAME`, `WH_ID` من LOV المخازن، `CASH_ACCOUNT` من LOV حسابات النقد (`cash_account = 'Y'`)، `PRICES_INCLUDE_VAT` Check Box، `ACTIVE`، `Delete Allowed = No`). الإنشاء الأسلم بكتلة غير مرتبطة وزر يستدعي `erp_pos.add_register(...)` لأنه يتحقق من نوع حساب الصندوق. كتلة `SHIFTS` مرتبطة بالعرض `v_erp_pos_shift_summary` (استعلام فقط، `ORDER BY opened_at DESC`) وزر لتقرير Z: `run_erp_report('RPT_Z', 'P_SHIFT=' || :SHIFTS.SHIFT_ID)`. وبتبويب المبيعات: كتلة على `erp_pos_sales` (استعلام فقط) تعرض الإيصالات مع زر إعادة الطباعة `RPT_POS_RECEIPT`.

## الشاشة 16: `FRM_PO` — أوامر الشراء

**كتل الشاشة:**
- `POS` مرتبطة بالعرض `v_erp_po_status` (استعلام فقط، `ORDER BY po_id DESC`): `PO_NO`, `SUPPLIER_NAME`, `PO_DATE`, `EXPECTED_DATE`, `STATUS`, `TOTAL`, `ORDERED_QTY`, `RECEIVED_QTY`, `OVERDUE`، و`PO_ID` غير مرئي.
- `HDR` (غير مرتبطة، سجل واحد): `SUPPLIER_NAME` (LOV_SUPPLIERS) و`PARTY_ID`، `PO_DATE`, `EXPECTED_DATE`, `NOTES`، و`PO_ID` (غير مرئي: يُملأ عند فتح أمر قائم أو حفظ جديد).
- `LINES` (غير مرتبطة، 12 سجلاً): `ITEM_CODE` (LOV_ITEMS، اختياري) و`ITEM_ID`, `WH_CODE` (LOV_WAREHOUSES) و`WH_ID`, `DESCRIPTION`, `QTY`, `PRICE`, `VAT_RATE`, `ACCOUNT_CODE` (لبند بلا صنف مخزني)، و`NET`/`VAT` للعرض. اختيار صنف يملأ الوصف والضريبة، والمخزن الافتراضي `MAIN`.
- `RCV` (نافذة الاستلام، غير مرتبطة): كتلة `RCV_LINES` استعلام على `v_erp_po_open_lines` للأمر الحالي مع عنصرين غير مرتبطين `RCV_QTY` و`RCV_PRICE` (اختياري)، وحقلا `RCV_DATE` و`SUP_INV_NO` (رقم فاتورة المورد).

**الأزرار حسب حالة الأمر** (تفعيلها في `WHEN-NEW-RECORD-INSTANCE` لـ `POS` بنمط الرواتب):

| الزر | يُفعَّل عند | الإجراء |
|---|---|---|
| حفظ مسودة | جديد أو DRAFT | `erp_po.create_po(...)` لأمر جديد، أو `erp_po.replace_lines(...)` لمسودة قائمة |
| اعتماد | DRAFT | `erp_po.approve_po(:POS.PO_ID)` |
| استلام | APPROVED أو PARTIAL | يفتح نافذة الاستلام ثم `erp_po.receive(...)` |
| إلغاء استلام | أمر له استلامات (يُختار من قائمة استلامات الأمر) | `erp_po.void_receipt(:RCPTS.RECEIPT_ID)` |
| إغلاق | APPROVED أو PARTIAL | `erp_po.close_po(:POS.PO_ID)` |
| إلغاء الأمر | DRAFT أو APPROVED | `erp_po.cancel_po(:POS.PO_ID)` |
| طباعة | أي حالة | `run_erp_report('RPT_PO', 'P_PO=' \|\| :POS.PO_ID)` |

```plsql
-- BTN_SAVE : WHEN-BUTTON-PRESSED  (مسودة جديدة أو استبدال بنود مسودة)
DECLARE
  v_lines erp_po_line_tab := erp_po_line_tab();
  v_id    NUMBER := :HDR.PO_ID;
BEGIN
  GO_BLOCK('LINES'); FIRST_RECORD;
  LOOP
    IF :LINES.ITEM_ID IS NOT NULL OR :LINES.DESCRIPTION IS NOT NULL THEN
      v_lines.EXTEND;
      v_lines(v_lines.COUNT) := erp_po_line_t(:LINES.ITEM_ID, :LINES.WH_ID, :LINES.DESCRIPTION, :LINES.QTY, :LINES.PRICE,
                                              :LINES.VAT_RATE, :LINES.ACCOUNT_CODE);
    END IF;
    EXIT WHEN :SYSTEM.LAST_RECORD = 'TRUE';
    NEXT_RECORD;
  END LOOP;
  IF v_id IS NULL THEN
    v_id := erp_po.create_po(:HDR.PARTY_ID, :HDR.PO_DATE, :HDR.EXPECTED_DATE, :HDR.NOTES, v_lines);
    :HDR.PO_ID := v_id;
  ELSE
    erp_po.replace_lines(v_id, v_lines);
  END IF;
  commit_db;
  MESSAGE('حُفظ الأمر');
  GO_BLOCK('POS'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;

-- RCV.BTN_OK : WHEN-BUTTON-PRESSED
DECLARE
  v_lines erp_po_rcv_tab := erp_po_rcv_tab();
  v_rc    NUMBER;
BEGIN
  GO_BLOCK('RCV_LINES'); FIRST_RECORD;
  LOOP
    IF NVL(:RCV_LINES.RCV_QTY, 0) > 0 THEN
      v_lines.EXTEND;
      v_lines(v_lines.COUNT) := erp_po_rcv_t(:RCV_LINES.LINE_ID, :RCV_LINES.RCV_QTY, :RCV_LINES.RCV_PRICE);
    END IF;
    EXIT WHEN :SYSTEM.LAST_RECORD = 'TRUE';
    NEXT_RECORD;
  END LOOP;
  v_rc := erp_po.receive(:POS.PO_ID, :RCV.RCV_DATE, :RCV.SUP_INV_NO, v_lines);
  commit_db;
  MESSAGE('سُجّل الاستلام وأُنشئت فاتورة المشتريات');
  HIDE_WINDOW('WIN_RECEIVE'); GO_BLOCK('POS'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

> الاعتماد (`-20903`) يتطلب معتمداً غير المنشئ عند ضبط الحد `PO_APPROVAL_LIMIT`؛ يضبطه مدير النظام عبر `erp_po.set_setting('PO_APPROVAL_LIMIT', '10000')` (القيمة `NULL` تُلغيه). يُستخدم حساب Oracle لكل مستخدم فعلي (لا حساب مشترك) حتى يعمل فصل المهام.
> للاستلام الذي يتجاوز المتبقي (`-20905`) أو من أمر غير معتمد (`-20902`) تظهر الرسائل العربية عبر `show_error`.

## الشاشة 17: `FRM_QUOTE` — عروض الأسعار

**كتل الشاشة:**
- `QUOTES` مرتبطة بالعرض `v_erp_quote_status` (استعلام فقط، `ORDER BY quote_id DESC`): `QUOTE_NO`, `CUSTOMER_NAME`, `QUOTE_DATE`, `VALID_UNTIL`, `DAYS_LEFT`, `STATUS`, `TOTAL`, `EXPIRED_FLAG`، و`QUOTE_ID` غير مرئي. لوّن السجل الذي `EXPIRED_FLAG = 'Y'` بصرياً (Visual Attribute).
- `HDR` (غير مرتبطة): `CUSTOMER_NAME` (LOV_CUSTOMERS) و`PARTY_ID`، `QUOTE_DATE`, `VALID_UNTIL`, `NOTES`, `TERMS`، و`QUOTE_ID` (غير مرئي).
- `LINES` (غير مرتبطة، 12 سجلاً): `ITEM_CODE` (LOV_ITEMS) و`ITEM_ID`, `WH_CODE` و`WH_ID` (للصنف المخزني)، `DESCRIPTION`, `QTY`, `PRICE` (يُملأ من سعر الصنف ويقبل التعديل)، `DISC_PCT`, `VAT_RATE`, `ACCOUNT_CODE` (لبند حر بحساب إيراد)، و`UNIT_NET` و`NET` و`VAT` للمعاينة. معاينة البند: `UNIT_NET := ROUND(PRICE * (1 - NVL(DISC_PCT,0)/100), 2)`؛ `NET := ROUND(QTY * UNIT_NET, 2)`؛ `VAT := ROUND(NET * VAT_RATE / 100, 2)` (وهي معادلات الحزمة نفسها، والحساب الملزم داخلها).

**الأزرار حسب الحالة:**

| الزر | يُفعَّل عند | الإجراء |
|---|---|---|
| حفظ مسودة | جديد أو DRAFT | `erp_quote.create_quote(...)` أو `erp_quote.replace_lines(...)` |
| إرسال | DRAFT | `erp_quote.send_quote(:QUOTES.QUOTE_ID)` |
| قبول | SENT | `erp_quote.accept_quote(:QUOTES.QUOTE_ID)` |
| رفض | SENT | `erp_quote.reject_quote(:QUOTES.QUOTE_ID)` |
| عرض معدَّل | SENT أو REJECTED | `v := erp_quote.revise_quote(:QUOTES.QUOTE_ID, TRUNC(SYSDATE), :HDR.VALID_UNTIL)` ثم فتح الجديد |
| تحويل إلى فاتورة | ACCEPTED | نافذة (تاريخ الفاتورة، الاستحقاق) ثم `erp_quote.convert_to_invoice(...)` |
| إلغاء التحويل | CONVERTED | `erp_quote.unconvert(:QUOTES.QUOTE_ID)` |
| إلغاء | DRAFT أو SENT | `erp_quote.cancel_quote(:QUOTES.QUOTE_ID)` |
| طباعة | أي حالة | `run_erp_report('RPT_QUOTE', 'P_QUOTE=' \|\| :QUOTES.QUOTE_ID)` |

```plsql
-- BTN_SAVE : WHEN-BUTTON-PRESSED
DECLARE
  v_lines erp_quote_line_tab := erp_quote_line_tab();
  v_id    NUMBER := :HDR.QUOTE_ID;
BEGIN
  GO_BLOCK('LINES'); FIRST_RECORD;
  LOOP
    IF :LINES.ITEM_ID IS NOT NULL OR :LINES.DESCRIPTION IS NOT NULL THEN
      v_lines.EXTEND;
      v_lines(v_lines.COUNT) := erp_quote_line_t(:LINES.ITEM_ID, :LINES.WH_ID, :LINES.DESCRIPTION, :LINES.QTY, :LINES.PRICE,
                                                 :LINES.DISC_PCT, :LINES.VAT_RATE, :LINES.ACCOUNT_CODE);
    END IF;
    EXIT WHEN :SYSTEM.LAST_RECORD = 'TRUE';
    NEXT_RECORD;
  END LOOP;
  IF v_id IS NULL THEN
    v_id := erp_quote.create_quote(:HDR.PARTY_ID, :HDR.QUOTE_DATE, :HDR.VALID_UNTIL, :HDR.NOTES, :HDR.TERMS, v_lines);
    :HDR.QUOTE_ID := v_id;
  ELSE
    erp_quote.replace_lines(v_id, v_lines);
  END IF;
  commit_db;
  MESSAGE('حُفظ العرض');
  GO_BLOCK('QUOTES'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;

-- CONV.BTN_OK : WHEN-BUTTON-PRESSED  (نافذة التحويل)
DECLARE v_inv NUMBER;
BEGIN
  v_inv := erp_quote.convert_to_invoice(:QUOTES.QUOTE_ID, :CONV.INVOICE_DATE, :CONV.DUE_DATE);
  commit_db;
  MESSAGE('حُوِّل العرض إلى فاتورة مبيعات');
  HIDE_WINDOW('WIN_CONVERT'); GO_BLOCK('QUOTES'); EXECUTE_QUERY;
EXCEPTION
  WHEN FORM_TRIGGER_FAILURE THEN RAISE;
  WHEN OTHERS THEN rollback_db; show_error; RAISE FORM_TRIGGER_FAILURE;
END;
```

> `-20954` (الخصم يتجاوز الحد) يظهر عند الإرسال؛ يضبط مدير النظام الحد بـ `erp_quote.set_setting('QUOTE_MAX_DISCOUNT_PCT', '10')` (`NULL` يلغيه). `-20955` عند قبول عرض انتهت صلاحيته: يلزم عرض معدَّل. شغّل `erp_quote.expire_old` دورياً (Job في `DBMS_SCHEDULER` أو زر في الشاشة) لتحويل العروض المرسلة المنتهية إلى EXPIRED.
> التحويل يخرج المخزون ويرحّل القيود فقد يفشل برصيد غير كافٍ (`-20302`): تظهر رسالته العربية ويبقى العرض ACCEPTED دون أثر.

## الشاشة 18: القائمة الرئيسية `ERP_MENU` (Menu Module `.mmb`)

| القائمة | البند | الإجراء |
|---|---|---|
| ملفات | دليل الحسابات | `CALL_FORM('FRM_ACCOUNTS')` |
| ملفات | العملاء والموردون | `CALL_FORM('FRM_PARTIES')` |
| ملفات | الأصناف والمخازن | `CALL_FORM('FRM_ITEMS')` |
| ملفات | الموظفون ومكوّنات الراتب | `CALL_FORM('FRM_EMPLOYEES')` |
| الحركات | أرصدة المخزون والتسويات والتحويلات | `CALL_FORM('FRM_STOCK')` |
| الحركات | الأصول الثابتة والإهلاك | `CALL_FORM('FRM_ASSETS')` |
| الحركات | كشوف الرواتب | `CALL_FORM('FRM_PAYROLL')` |
| الحركات | السلف والتسويات الشهرية | `CALL_FORM('FRM_HR_ADJUST')` |
| الحركات | عروض الأسعار | `CALL_FORM('FRM_QUOTE')` |
| الحركات | أوامر الشراء | `CALL_FORM('FRM_PO')` |
| الحركات | نقطة البيع (الكاشير) | `CALL_FORM('FRM_POS', NO_HIDE, DO_REPLACE, NO_QUERY_ONLY, v_pl)` مع المعامل `P_REG_ID` |
| ملفات | نقاط البيع والورديات | `CALL_FORM('FRM_POS_ADMIN')` |
| الإقفال | إقفال الفترات والسنة | `CALL_FORM('FRM_PERIODS')` |
| التقارير | القوائم المالية | `CALL_FORM('FRM_STATEMENTS')` |
| الحركات | قيد يومية | `CALL_FORM('FRM_JOURNAL')` |
| الحركات | الفواتير | `CALL_FORM('FRM_INVOICE')` |
| التقارير | ميزان المراجعة / دفتر الأستاذ / كشف حساب / أعمار الذمم / ملخص الضريبة / أرصدة المخزون / بطاقة الصنف / سجل الأصول / سجل الإهلاك / جدول إهلاك أصل / كشف الرواتب / قسيمة راتب / ملخص الكشف بالبنود / سلف الموظفين / قائمة الدخل / الميزانية / التدفقات النقدية / تقرير Z / مبيعات نقاط البيع بالصنف / أمر شراء / أوامر الشراء المفتوحة / فروق أسعار الاستلام / عرض سعر / مسار العروض / عروض تنتظر المتابعة | `run_erp_report('<اسم التقرير>')` |
| خروج | | `EXIT_FORM` |

## تشغيل التقارير من Forms

أنشئ في Forms Builder كائنات `Report` (Object Navigator ← Reports) لكل تقرير باسم الملف و`Report Server` المعرَّف في `rwservlet`، ثم وحدة برنامج في `ERP_LIB`:

```plsql
PROCEDURE run_erp_report (p_report IN VARCHAR2, p_params IN VARCHAR2 DEFAULT NULL) IS
  v_rep   REPORT_OBJECT := FIND_REPORT_OBJECT(p_report);
  v_job   VARCHAR2(200);
BEGIN
  IF ID_NULL(v_rep) THEN MESSAGE('التقرير غير معرّف: ' || p_report); RAISE FORM_TRIGGER_FAILURE; END IF;
  SET_REPORT_OBJECT_PROPERTY(v_rep, REPORT_EXECUTION_MODE, BATCH);
  SET_REPORT_OBJECT_PROPERTY(v_rep, REPORT_COMM_MODE, SYNCHRONOUS);
  SET_REPORT_OBJECT_PROPERTY(v_rep, REPORT_DESTYPE, CACHE);
  SET_REPORT_OBJECT_PROPERTY(v_rep, REPORT_OTHER, p_params);              -- مثال: 'P_TO=2026-12-31'
  v_job := RUN_REPORT_OBJECT(v_rep);
  WEB.SHOW_DOCUMENT(COPY_REPORT_OBJECT_OUTPUT(v_rep, 'ERP_REPORT_OUT'), '_blank');   -- أو استخدم رابط rwservlet/getjobid
END;
```

مثال استدعاء الميزان من زر: `run_erp_report('RPT_TRIAL_BALANCE', 'P_TO=' || TO_CHAR(:CTRL.P_TO, 'YYYY-MM-DD'))`. تفاصيل التقارير في `../reports/REPORTS_SPEC.md`.

## قائمة التحقق قبل التسليم

- [ ] شغّل `oracle/install.sql` ثم `sql/15_selftest.sql` وتأكد أن كل الاختبارات `PASS`.
- [ ] ابنِ الشاشات الثماني عشرة بالترتيب أعلاه، وجرّب في كل منها حالة خطأ متعمدة (قيد غير متوازن، دفعة أكبر من المتبقي، بيع أكثر من رصيد المخزن، بيع أصل عليه إهلاك معلّق، قيد بتاريخ في فترة مقفلة، بيع بدفع ناقص أو بأكثر من الرصيد، استلام أمر شراء يتجاوز المتبقي، إرسال عرض سعر بخصم فوق الحد) وتأكد أن الرسالة العربية تظهر.
- [ ] أنشئ مستخدم تطبيق بلا صلاحيات DML مباشرة على جداول الحركات، وتأكد أن الشاشات تعمل به.
- [ ] اضبط `Direction = Right To Left` و`NLS_LANG` وتأكد من ظهور العربية سليمة في الشاشات والتقارير.
