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
- **`LINES`** (غير مرتبطة، 10 سجلات): `DESCRIPTION`، `QTY`، `PRICE`، `VAT_RATE` (افتراضي 15)، `ACCOUNT_CODE` (اختياري، LOV_ALL_ACCOUNTS)، `NET`، `VAT` (عرض).
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
      v_lines(v_lines.COUNT) := erp_inv_line_t(:LINES.DESCRIPTION, :LINES.QTY, :LINES.PRICE, :LINES.VAT_RATE, :LINES.ACCOUNT_CODE);
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

## الشاشة 5: `FRM_PAYMENT` — سند قبض/صرف (نافذة منبثقة Modal)

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

## الشاشة 6: القائمة الرئيسية `ERP_MENU` (Menu Module `.mmb`)

| القائمة | البند | الإجراء |
|---|---|---|
| ملفات | دليل الحسابات | `CALL_FORM('FRM_ACCOUNTS')` |
| ملفات | العملاء والموردون | `CALL_FORM('FRM_PARTIES')` |
| الحركات | قيد يومية | `CALL_FORM('FRM_JOURNAL')` |
| الحركات | الفواتير | `CALL_FORM('FRM_INVOICE')` |
| التقارير | ميزان المراجعة / دفتر الأستاذ / كشف حساب / أعمار الذمم / ملخص الضريبة | `run_erp_report('<اسم التقرير>')` |
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

- [ ] شغّل `oracle/install.sql` ثم `sql/06_selftest.sql` وتأكد أن كل الاختبارات `PASS`.
- [ ] ابنِ الشاشات الست بالترتيب أعلاه، وجرّب في كل منها حالة خطأ متعمدة (قيد غير متوازن، دفعة أكبر من المتبقي) وتأكد أن الرسالة العربية تظهر.
- [ ] أنشئ مستخدم تطبيق بلا صلاحيات DML مباشرة على جداول الحركات، وتأكد أن الشاشات تعمل به.
- [ ] اضبط `Direction = Right To Left` و`NLS_LANG` وتأكد من ظهور العربية سليمة في الشاشات والتقارير.
