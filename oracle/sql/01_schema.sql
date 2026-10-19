-- ============================================================================
-- نظام ERP على Oracle 19c: المحاسبة العامة والمبيعات والمشتريات
-- 01: المخطط (الجداول والقيود والأنواع). شغّله بحساب المخطط (schema owner).
-- ترميز الجلسة: AL32UTF8 (على ويندوز: set NLS_LANG=ARABIC_SAUDI ARABIA.AL32UTF8)
-- المبالغ NUMBER(18,2): دقيقة عشرياً في Oracle فلا حاجة لتحويلها إلى أعداد صحيحة.
-- ============================================================================
SET DEFINE OFF

-- ---------------------------------------------------------------- الأنواع
-- أسطر القيد، تُمرَّر إلى ERP_GL.POST_ENTRY (ومن Oracle Forms عبر كتلة غير مرتبطة بجدول)
CREATE OR REPLACE TYPE erp_line_t AS OBJECT (
  account_code VARCHAR2(12),
  debit        NUMBER,
  credit       NUMBER,
  note         VARCHAR2(200)
);
/
CREATE OR REPLACE TYPE erp_line_tab AS TABLE OF erp_line_t;
/
-- بنود الفاتورة
CREATE OR REPLACE TYPE erp_inv_line_t AS OBJECT (
  description  VARCHAR2(200),
  qty          NUMBER,
  price        NUMBER,
  vat_rate     NUMBER,
  account_code VARCHAR2(12),     -- اختياري: الافتراضي 4100 للمبيعات و5100 للمشتريات (أو حسابات الصنف)
  item_id      NUMBER,           -- اختياري: صنف مخزني (يحرّك المخزون ويرحّل التكلفة)
  wh_id        NUMBER            -- المخزن (إلزامي لو حُدِّد صنف مخزني)
);
/
CREATE OR REPLACE TYPE erp_inv_line_tab AS TABLE OF erp_inv_line_t;
/

-- نقاط البيع: بنود البيع، الدفعات، وبنود المرتجع
CREATE OR REPLACE TYPE erp_pos_line_t AS OBJECT (
  item_id       NUMBER,
  qty           NUMBER,
  price         NUMBER,     -- اختياري: الافتراضي سعر بيع الصنف
  discount_pct  NUMBER,     -- اختياري: نسبة خصم % على البند
  vat_rate      NUMBER      -- اختياري: الافتراضي نسبة ضريبة الصنف
);
/
CREATE OR REPLACE TYPE erp_pos_line_tab AS TABLE OF erp_pos_line_t;
/
CREATE OR REPLACE TYPE erp_pos_pay_t AS OBJECT (
  method  VARCHAR2(4),      -- CASH | CARD
  amount  NUMBER
);
/
CREATE OR REPLACE TYPE erp_pos_pay_tab AS TABLE OF erp_pos_pay_t;
/
CREATE OR REPLACE TYPE erp_pos_ret_t AS OBJECT (
  orig_line_id  NUMBER,
  qty           NUMBER
);
/
CREATE OR REPLACE TYPE erp_pos_ret_tab AS TABLE OF erp_pos_ret_t;
/

-- قائمة رسائل (مشكلات تمنع إقفال فترة)
CREATE OR REPLACE TYPE erp_msg_tab AS TABLE OF VARCHAR2(300);
/

-- ---------------------------------------------------------------- دليل الحسابات
CREATE TABLE erp_accounts (
  code         VARCHAR2(12)  CONSTRAINT erp_accounts_pk PRIMARY KEY,
  name         VARCHAR2(120) NOT NULL,
  acc_type     VARCHAR2(10)  NOT NULL
               CONSTRAINT erp_accounts_type_ck CHECK (acc_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  parent_code  VARCHAR2(12)  CONSTRAINT erp_accounts_parent_fk REFERENCES erp_accounts (code),
  active       CHAR(1)       DEFAULT 'Y' NOT NULL CONSTRAINT erp_accounts_active_ck CHECK (active IN ('Y','N')),
  -- لقائمة التدفقات النقدية: حسابات النقد والبنوك، وتصنيف باقي الحسابات (التشغيلي هو الافتراضي)
  cash_account CHAR(1)       DEFAULT 'N' NOT NULL CONSTRAINT erp_accounts_cash_ck CHECK (cash_account IN ('Y','N')),
  cf_category  VARCHAR2(9)   DEFAULT 'OPERATING' NOT NULL CONSTRAINT erp_accounts_cf_ck CHECK (cf_category IN ('OPERATING','INVESTING','FINANCING')),
  CONSTRAINT erp_accounts_cash_type_ck CHECK (cash_account = 'N' OR acc_type = 'ASSET')
);
CREATE INDEX erp_accounts_parent_ix ON erp_accounts (parent_code);

-- ---------------------------------------------------------------- القيود (دفتر اليومية)
CREATE TABLE erp_entries (
  entry_id    NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_entries_pk PRIMARY KEY,
  entry_date  DATE          NOT NULL,
  memo        VARCHAR2(300),
  ref         VARCHAR2(60),
  void_of     NUMBER        CONSTRAINT erp_entries_void_fk REFERENCES erp_entries (entry_id),
  kind        VARCHAR2(7)   DEFAULT 'NORMAL' NOT NULL CONSTRAINT erp_entries_kind_ck CHECK (kind IN ('NORMAL','CLOSING')),   -- CLOSING: قيد إقفال سنة (يُستبعد من قائمة الدخل)
  created_by  VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  created_at  TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT erp_entries_void_uk UNIQUE (void_of)      -- القيد يُعكس مرة واحدة فقط
);
CREATE INDEX erp_entries_date_ix ON erp_entries (entry_date);

CREATE TABLE erp_lines (
  line_id       NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_lines_pk PRIMARY KEY,
  entry_id      NUMBER        NOT NULL CONSTRAINT erp_lines_entry_fk REFERENCES erp_entries (entry_id),
  account_code  VARCHAR2(12)  NOT NULL CONSTRAINT erp_lines_acct_fk REFERENCES erp_accounts (code),
  debit         NUMBER(18,2)  DEFAULT 0 NOT NULL,
  credit        NUMBER(18,2)  DEFAULT 0 NOT NULL,
  note          VARCHAR2(200),
  -- كل سطر إما مدين وإما دائن بمبلغ أكبر من صفر
  CONSTRAINT erp_lines_side_ck CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX erp_lines_entry_ix   ON erp_lines (entry_id);
CREATE INDEX erp_lines_account_ix ON erp_lines (account_code);

-- لا تعديل ولا حذف للقيود: التصحيح بقيد عكسي فقط (ERP_GL.REVERSE_ENTRY)
CREATE OR REPLACE TRIGGER erp_entries_immutable_trg
  BEFORE UPDATE OR DELETE ON erp_entries
BEGIN
  RAISE_APPLICATION_ERROR(-20900, 'القيود المحاسبية لا تُعدَّل ولا تُحذف: استخدم القيد العكسي');
END;
/
CREATE OR REPLACE TRIGGER erp_lines_immutable_trg
  BEFORE UPDATE OR DELETE ON erp_lines
BEGIN
  RAISE_APPLICATION_ERROR(-20900, 'القيود المحاسبية لا تُعدَّل ولا تُحذف: استخدم القيد العكسي');
END;
/

-- ---------------------------------------------------------------- العملاء والموردون
CREATE TABLE erp_parties (
  party_id    NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_parties_pk PRIMARY KEY,
  kind        VARCHAR2(8)   NOT NULL CONSTRAINT erp_parties_kind_ck CHECK (kind IN ('CUSTOMER','SUPPLIER')),
  name        VARCHAR2(120) NOT NULL,
  phone       VARCHAR2(40),
  tax_no      VARCHAR2(40),
  created_at  TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL
);

-- عدّاد ترقيم الفواتير بلا فجوات (يُقفل الصف أثناء المعاملة، بخلاف SEQUENCE الذي يترك فجوات عند التراجع)
CREATE TABLE erp_counters (
  name     VARCHAR2(20) CONSTRAINT erp_counters_pk PRIMARY KEY,
  last_no  NUMBER       DEFAULT 0 NOT NULL
);

-- ---------------------------------------------------------------- المخازن والأصناف
CREATE TABLE erp_warehouses (
  wh_id   NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_warehouses_pk PRIMARY KEY,
  code    VARCHAR2(12)  NOT NULL CONSTRAINT erp_warehouses_code_uk UNIQUE,
  name    VARCHAR2(120) NOT NULL,
  active  CHAR(1) DEFAULT 'Y' NOT NULL CONSTRAINT erp_warehouses_active_ck CHECK (active IN ('Y','N'))
);

CREATE TABLE erp_items (
  item_id        NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_items_pk PRIMARY KEY,
  code           VARCHAR2(30)  NOT NULL CONSTRAINT erp_items_code_uk UNIQUE,
  name           VARCHAR2(120) NOT NULL,
  unit           VARCHAR2(20)  DEFAULT 'قطعة' NOT NULL,
  sale_price     NUMBER(18,2)  DEFAULT 0 NOT NULL CONSTRAINT erp_items_price_ck CHECK (sale_price >= 0),
  vat_rate       NUMBER(5,2)   DEFAULT 0 NOT NULL CONSTRAINT erp_items_vat_ck CHECK (vat_rate BETWEEN 0 AND 100),   -- نسبة الضريبة الافتراضية عند البيع
  barcode        VARCHAR2(40),
  track_stock    CHAR(1)       DEFAULT 'Y' NOT NULL CONSTRAINT erp_items_track_ck CHECK (track_stock IN ('Y','N')),
  inv_account    VARCHAR2(12)  DEFAULT '1400' NOT NULL CONSTRAINT erp_items_inv_fk  REFERENCES erp_accounts (code),
  cogs_account   VARCHAR2(12)  DEFAULT '5100' NOT NULL CONSTRAINT erp_items_cogs_fk REFERENCES erp_accounts (code),
  rev_account    VARCHAR2(12)  DEFAULT '4100' NOT NULL CONSTRAINT erp_items_rev_fk  REFERENCES erp_accounts (code),
  active         CHAR(1)       DEFAULT 'Y' NOT NULL CONSTRAINT erp_items_active_ck CHECK (active IN ('Y','N')),
  created_at     TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX erp_items_barcode_uk ON erp_items (barcode);   -- فريد عند وجوده (القيم الفارغة متعددة)

-- الرصيد الحالي لكل صنف في كل مخزن: الكمية والقيمة (التكلفة بالمتوسط المرجّح = القيمة ÷ الكمية)
CREATE TABLE erp_stock (
  item_id  NUMBER       NOT NULL CONSTRAINT erp_stock_item_fk REFERENCES erp_items (item_id),
  wh_id    NUMBER       NOT NULL CONSTRAINT erp_stock_wh_fk   REFERENCES erp_warehouses (wh_id),
  qty      NUMBER(18,3) DEFAULT 0 NOT NULL CONSTRAINT erp_stock_qty_ck CHECK (qty >= 0),
  value    NUMBER(18,2) DEFAULT 0 NOT NULL CONSTRAINT erp_stock_value_ck CHECK (value >= 0),
  CONSTRAINT erp_stock_pk PRIMARY KEY (item_id, wh_id),
  CONSTRAINT erp_stock_zero_ck CHECK (qty > 0 OR value = 0)     -- لا قيمة بلا كمية
);

-- سجل حركات المخزون (لا يُعدَّل ولا يُحذف). الكمية بإشارة: موجب وارد، سالب صادر. القيمة بإشارة الكمية نفسها.
CREATE TABLE erp_stock_moves (
  move_id    NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_stock_moves_pk PRIMARY KEY,
  move_date  DATE         NOT NULL,
  item_id    NUMBER       NOT NULL CONSTRAINT erp_stock_moves_item_fk REFERENCES erp_items (item_id),
  wh_id      NUMBER       NOT NULL CONSTRAINT erp_stock_moves_wh_fk   REFERENCES erp_warehouses (wh_id),
  move_type  VARCHAR2(10) NOT NULL CONSTRAINT erp_stock_moves_type_ck CHECK (move_type IN ('PURCHASE','SALE','ADJUST','TRANSFER','REVERSAL')),
  qty        NUMBER(18,3) NOT NULL CONSTRAINT erp_stock_moves_qty_ck CHECK (qty <> 0),
  value      NUMBER(18,2) NOT NULL,
  ref_type   VARCHAR2(10) NOT NULL,                -- INVOICE | ADJUST | TRANSFER
  ref_id     NUMBER       NOT NULL,
  reverses   NUMBER       CONSTRAINT erp_stock_moves_rev_fk REFERENCES erp_stock_moves (move_id),
  created_by VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  created_at TIMESTAMP    DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT erp_stock_moves_rev_uk UNIQUE (reverses),
  CONSTRAINT erp_stock_moves_sign_ck CHECK ((qty > 0 AND value >= 0) OR (qty < 0 AND value <= 0))
);
CREATE INDEX erp_stock_moves_item_ix ON erp_stock_moves (item_id, wh_id, move_id);
CREATE INDEX erp_stock_moves_ref_ix  ON erp_stock_moves (ref_type, ref_id);

CREATE OR REPLACE TRIGGER erp_stock_moves_immutable_trg
  BEFORE UPDATE OR DELETE ON erp_stock_moves
BEGIN
  RAISE_APPLICATION_ERROR(-20901, 'حركات المخزون لا تُعدَّل ولا تُحذف: استخدم التسوية أو الإلغاء');
END;
/

-- أرقام مستندات المخزون الداخلية (تسوية/تحويل). الفجوات مقبولة هنا.
CREATE SEQUENCE erp_stock_doc_seq START WITH 1 INCREMENT BY 1 NOCACHE;

-- ---------------------------------------------------------------- الفواتير
CREATE TABLE erp_invoices (
  invoice_id     NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_invoices_pk PRIMARY KEY,
  kind           VARCHAR2(8)  NOT NULL CONSTRAINT erp_invoices_kind_ck CHECK (kind IN ('SALES','PURCHASE')),
  invoice_no     VARCHAR2(20) NOT NULL CONSTRAINT erp_invoices_no_uk UNIQUE,
  ref            VARCHAR2(60),
  party_id       NUMBER       NOT NULL CONSTRAINT erp_invoices_party_fk REFERENCES erp_parties (party_id),
  invoice_date   DATE         NOT NULL,
  due_date       DATE,
  subtotal       NUMBER(18,2) NOT NULL,
  vat_amount     NUMBER(18,2) NOT NULL,
  total          NUMBER(18,2) NOT NULL,
  paid           NUMBER(18,2) DEFAULT 0 NOT NULL,
  status         VARCHAR2(4)  DEFAULT 'OPEN' NOT NULL CONSTRAINT erp_invoices_status_ck CHECK (status IN ('OPEN','VOID')),
  note           VARCHAR2(300),
  entry_id       NUMBER       NOT NULL CONSTRAINT erp_invoices_entry_fk REFERENCES erp_entries (entry_id),
  cogs_entry_id  NUMBER       CONSTRAINT erp_invoices_cogs_fk REFERENCES erp_entries (entry_id),   -- قيد تكلفة البضاعة المباعة (مبيعات بأصناف مخزنية)
  void_entry_id  NUMBER       CONSTRAINT erp_invoices_void_fk REFERENCES erp_entries (entry_id),
  created_by     VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  created_at     TIMESTAMP    DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT erp_invoices_amount_ck CHECK (total > 0 AND paid >= 0 AND paid <= total AND total = subtotal + vat_amount)
);
CREATE INDEX erp_invoices_party_ix ON erp_invoices (party_id);
CREATE INDEX erp_invoices_date_ix  ON erp_invoices (invoice_date);

CREATE TABLE erp_invoice_lines (
  line_id       NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_invoice_lines_pk PRIMARY KEY,
  invoice_id    NUMBER        NOT NULL CONSTRAINT erp_invoice_lines_inv_fk REFERENCES erp_invoices (invoice_id),
  description   VARCHAR2(200) NOT NULL,
  qty           NUMBER(18,3)  NOT NULL CONSTRAINT erp_invoice_lines_qty_ck CHECK (qty > 0),
  price         NUMBER(18,2)  NOT NULL CONSTRAINT erp_invoice_lines_price_ck CHECK (price >= 0),
  vat_rate      NUMBER(5,2)   NOT NULL CONSTRAINT erp_invoice_lines_rate_ck CHECK (vat_rate BETWEEN 0 AND 100),
  account_code  VARCHAR2(12)  NOT NULL CONSTRAINT erp_invoice_lines_acct_fk REFERENCES erp_accounts (code),
  net           NUMBER(18,2)  NOT NULL,
  vat           NUMBER(18,2)  NOT NULL,
  item_id       NUMBER        CONSTRAINT erp_invoice_lines_item_fk REFERENCES erp_items (item_id),
  wh_id         NUMBER        CONSTRAINT erp_invoice_lines_wh_fk   REFERENCES erp_warehouses (wh_id),
  cost          NUMBER(18,2)  -- تكلفة البند المخزني: داخل للمخزون في المشتريات، وتكلفة مبيعات في المبيعات
);
CREATE INDEX erp_invoice_lines_inv_ix ON erp_invoice_lines (invoice_id);

-- ---------------------------------------------------------------- سندات القبض والصرف
CREATE TABLE erp_payments (
  payment_id  NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_payments_pk PRIMARY KEY,
  kind        VARCHAR2(7)  NOT NULL CONSTRAINT erp_payments_kind_ck CHECK (kind IN ('RECEIPT','PAYMENT')),
  party_id    NUMBER       NOT NULL CONSTRAINT erp_payments_party_fk REFERENCES erp_parties (party_id),
  invoice_id  NUMBER       CONSTRAINT erp_payments_inv_fk REFERENCES erp_invoices (invoice_id),
  pay_date    DATE         NOT NULL,
  amount      NUMBER(18,2) NOT NULL CONSTRAINT erp_payments_amount_ck CHECK (amount > 0),
  method      VARCHAR2(4)  NOT NULL CONSTRAINT erp_payments_method_ck CHECK (method IN ('CASH','BANK')),
  note        VARCHAR2(300),
  entry_id    NUMBER       NOT NULL CONSTRAINT erp_payments_entry_fk REFERENCES erp_entries (entry_id),
  created_by  VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  created_at  TIMESTAMP    DEFAULT SYSTIMESTAMP NOT NULL
);
CREATE INDEX erp_payments_party_ix ON erp_payments (party_id);
CREATE INDEX erp_payments_inv_ix   ON erp_payments (invoice_id);

-- ---------------------------------------------------------------- الأصول الثابتة والإهلاك
-- فئة الأصل: حسابات الأصل ومجمع الإهلاك ومصروفه والعمر الافتراضي
CREATE TABLE erp_asset_categories (
  cat_id           NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_asset_cat_pk PRIMARY KEY,
  code             VARCHAR2(12)  NOT NULL CONSTRAINT erp_asset_cat_code_uk UNIQUE,
  name             VARCHAR2(120) NOT NULL,
  asset_account    VARCHAR2(12)  DEFAULT '1500' NOT NULL CONSTRAINT erp_asset_cat_asset_fk REFERENCES erp_accounts (code),
  accum_account    VARCHAR2(12)  DEFAULT '1510' NOT NULL CONSTRAINT erp_asset_cat_accum_fk REFERENCES erp_accounts (code),
  expense_account  VARCHAR2(12)  DEFAULT '5600' NOT NULL CONSTRAINT erp_asset_cat_exp_fk   REFERENCES erp_accounts (code),
  life_months      NUMBER(4)     NOT NULL CONSTRAINT erp_asset_cat_life_ck CHECK (life_months BETWEEN 1 AND 1200),
  active           CHAR(1)       DEFAULT 'Y' NOT NULL CONSTRAINT erp_asset_cat_active_ck CHECK (active IN ('Y','N'))
);

CREATE TABLE erp_assets (
  asset_id          NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_assets_pk PRIMARY KEY,
  code              VARCHAR2(30)  NOT NULL CONSTRAINT erp_assets_code_uk UNIQUE,
  name              VARCHAR2(120) NOT NULL,
  cat_id            NUMBER        NOT NULL CONSTRAINT erp_assets_cat_fk REFERENCES erp_asset_categories (cat_id),
  acq_date          DATE          NOT NULL,
  dep_start         DATE          NOT NULL CONSTRAINT erp_assets_start_ck CHECK (dep_start = TRUNC(dep_start, 'MM')),
  cost              NUMBER(18,2)  NOT NULL,
  salvage           NUMBER(18,2)  DEFAULT 0 NOT NULL,
  life_months       NUMBER(4)     NOT NULL CONSTRAINT erp_assets_life_ck CHECK (life_months BETWEEN 1 AND 1200),
  status            VARCHAR2(8)   DEFAULT 'ACTIVE' NOT NULL CONSTRAINT erp_assets_status_ck CHECK (status IN ('ACTIVE','DISPOSED','VOID')),
  invoice_id        NUMBER        CONSTRAINT erp_assets_inv_fk REFERENCES erp_invoices (invoice_id),   -- اقتناء عبر فاتورة مشتريات
  entry_id          NUMBER        CONSTRAINT erp_assets_entry_fk REFERENCES erp_entries (entry_id),     -- قيد الاقتناء (NULL إن كان عبر فاتورة)
  disposal_date     DATE,
  proceeds          NUMBER(18,2),
  disposal_entry_id NUMBER        CONSTRAINT erp_assets_disp_fk REFERENCES erp_entries (entry_id),
  note              VARCHAR2(300),
  created_by        VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  created_at        TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT erp_assets_amount_ck CHECK (cost > 0 AND salvage >= 0 AND salvage < cost)
);
CREATE INDEX erp_assets_cat_ix ON erp_assets (cat_id);

-- دفعة إهلاك لشهر (قيد واحد مجمَّع). قد يوجد أكثر من دفعة لنفس الشهر (تعويض أصل أُضيف متأخراً).
CREATE TABLE erp_dep_runs (
  run_id      NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_dep_runs_pk PRIMARY KEY,
  period      DATE          NOT NULL CONSTRAINT erp_dep_runs_period_ck CHECK (period = TRUNC(period, 'MM')),
  entry_id    NUMBER        NOT NULL CONSTRAINT erp_dep_runs_entry_fk REFERENCES erp_entries (entry_id),
  total       NUMBER(18,2)  NOT NULL,
  status      VARCHAR2(4)   DEFAULT 'OK' NOT NULL CONSTRAINT erp_dep_runs_status_ck CHECK (status IN ('OK','VOID')),
  created_by  VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  created_at  TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE erp_depreciation (
  dep_id    NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_depreciation_pk PRIMARY KEY,
  run_id    NUMBER       NOT NULL CONSTRAINT erp_depreciation_run_fk   REFERENCES erp_dep_runs (run_id),
  asset_id  NUMBER       NOT NULL CONSTRAINT erp_depreciation_asset_fk REFERENCES erp_assets (asset_id),
  period    DATE         NOT NULL,
  amount    NUMBER(18,2) NOT NULL CONSTRAINT erp_depreciation_amount_ck CHECK (amount > 0),
  status    VARCHAR2(4)  DEFAULT 'OK' NOT NULL CONSTRAINT erp_depreciation_status_ck CHECK (status IN ('OK','VOID'))
);
CREATE INDEX erp_depreciation_asset_ix ON erp_depreciation (asset_id, period);
-- لا يُهلَك أصل مرتين عن الشهر نفسه (الدفعات الملغاة لا تُحتسب)؛ يحمي أيضاً من التشغيل المتزامن
CREATE UNIQUE INDEX erp_depreciation_uk ON erp_depreciation (
  CASE WHEN status = 'OK' THEN asset_id END,
  CASE WHEN status = 'OK' THEN period END
);

-- ---------------------------------------------------------------- الموارد البشرية والرواتب
CREATE TABLE erp_departments (
  dept_id  NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_departments_pk PRIMARY KEY,
  code     VARCHAR2(12)  NOT NULL CONSTRAINT erp_departments_code_uk UNIQUE,
  name     VARCHAR2(120) NOT NULL,
  active   CHAR(1) DEFAULT 'Y' NOT NULL CONSTRAINT erp_departments_active_ck CHECK (active IN ('Y','N'))
);

CREATE TABLE erp_employees (
  emp_id        NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_employees_pk PRIMARY KEY,
  code          VARCHAR2(20)  NOT NULL CONSTRAINT erp_employees_code_uk UNIQUE,
  name          VARCHAR2(120) NOT NULL,
  national_id   VARCHAR2(30),
  dept_id       NUMBER        CONSTRAINT erp_employees_dept_fk REFERENCES erp_departments (dept_id),
  job_title     VARCHAR2(80),
  hire_date     DATE          NOT NULL,
  term_date     DATE,
  bank_account  VARCHAR2(60),
  status        VARCHAR2(10)  DEFAULT 'ACTIVE' NOT NULL CONSTRAINT erp_employees_status_ck CHECK (status IN ('ACTIVE','TERMINATED')),
  created_at    TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT erp_employees_term_ck CHECK (
    (status = 'ACTIVE' AND term_date IS NULL) OR (status = 'TERMINATED' AND term_date IS NOT NULL AND term_date >= hire_date))
);

-- تاريخ الراتب الأساسي: يسري الراتب من أول شهر effective_from
CREATE TABLE erp_salary_history (
  sal_id          NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_salary_history_pk PRIMARY KEY,
  emp_id          NUMBER       NOT NULL CONSTRAINT erp_salary_history_emp_fk REFERENCES erp_employees (emp_id),
  effective_from  DATE         NOT NULL CONSTRAINT erp_salary_history_eff_ck CHECK (effective_from = TRUNC(effective_from, 'MM')),
  basic_salary    NUMBER(18,2) NOT NULL CONSTRAINT erp_salary_history_amt_ck CHECK (basic_salary > 0),
  created_by      VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  created_at      TIMESTAMP    DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT erp_salary_history_uk UNIQUE (emp_id, effective_from)
);

-- مكوّنات الراتب القابلة للتعريف (بدلات، استقطاعات، حصة صاحب العمل). النسب والسقوف تضبطها أنت وفق نظام بلدك.
--   EARNING : استحقاق (مصروف)        DEDUCTION: استقطاع من الموظف (التزام لجهة خارجية)
--   EMPLOYER: تكلفة على صاحب العمل (مصروف مقابل التزام لجهة خارجية)، لا تُخصم من الموظف
CREATE TABLE erp_pay_components (
  comp_id           NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_pay_components_pk PRIMARY KEY,
  code              VARCHAR2(20)  NOT NULL CONSTRAINT erp_pay_components_code_uk UNIQUE,
  name              VARCHAR2(120) NOT NULL,
  kind              VARCHAR2(9)   NOT NULL CONSTRAINT erp_pay_components_kind_ck CHECK (kind IN ('EARNING','DEDUCTION','EMPLOYER')),
  calc_type         VARCHAR2(5)   NOT NULL CONSTRAINT erp_pay_components_calc_ck CHECK (calc_type IN ('FIXED','PCT')),
  pct               NUMBER(7,4)   DEFAULT 0 NOT NULL CONSTRAINT erp_pay_components_pct_ck CHECK (pct BETWEEN 0 AND 100),
  base_type         VARCHAR2(5)   DEFAULT 'BASIC' NOT NULL CONSTRAINT erp_pay_components_base_ck CHECK (base_type IN ('BASIC','GROSS')),
  base_cap          NUMBER(18,2)  CONSTRAINT erp_pay_components_cap_ck CHECK (base_cap > 0),   -- سقف وعاء النسبة (شهرياً)
  expense_account   VARCHAR2(12)  CONSTRAINT erp_pay_components_exp_fk REFERENCES erp_accounts (code),
  liability_account VARCHAR2(12)  CONSTRAINT erp_pay_components_liab_fk REFERENCES erp_accounts (code),
  active            CHAR(1)       DEFAULT 'Y' NOT NULL CONSTRAINT erp_pay_components_active_ck CHECK (active IN ('Y','N')),
  CONSTRAINT erp_pay_components_acct_ck CHECK (
    (kind = 'EARNING'   AND expense_account IS NOT NULL) OR
    (kind = 'DEDUCTION' AND liability_account IS NOT NULL) OR
    (kind = 'EMPLOYER'  AND expense_account IS NOT NULL AND liability_account IS NOT NULL)),
  -- الاستحقاق النسبي يُحسب من الأساسي فقط (الوعاء الإجمالي يعتمد على الاستحقاقات نفسها)
  CONSTRAINT erp_pay_components_gross_ck CHECK (kind <> 'EARNING' OR base_type = 'BASIC')
);

-- ربط المكوّنات بالموظفين (مبلغ للثابت، ونسبة اختيارية تتجاوز نسبة المكوّن)
CREATE TABLE erp_emp_components (
  emp_id   NUMBER NOT NULL CONSTRAINT erp_emp_components_emp_fk  REFERENCES erp_employees (emp_id),
  comp_id  NUMBER NOT NULL CONSTRAINT erp_emp_components_comp_fk REFERENCES erp_pay_components (comp_id),
  amount   NUMBER(18,2) CONSTRAINT erp_emp_components_amt_ck CHECK (amount >= 0),
  pct      NUMBER(7,4)  CONSTRAINT erp_emp_components_pct_ck CHECK (pct BETWEEN 0 AND 100),
  CONSTRAINT erp_emp_components_pk PRIMARY KEY (emp_id, comp_id)
);

-- كشوف الرواتب: DRAFT (قابل لإعادة الحساب) ← POSTED (رُحّل القيد) ← PAID (صُرفت الرواتب). VOID/CANCELLED نهائيان.
CREATE TABLE erp_payroll_runs (
  run_id           NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_payroll_runs_pk PRIMARY KEY,
  period           DATE         NOT NULL CONSTRAINT erp_payroll_runs_period_ck CHECK (period = TRUNC(period, 'MM')),
  status           VARCHAR2(9)  DEFAULT 'DRAFT' NOT NULL CONSTRAINT erp_payroll_runs_status_ck CHECK (status IN ('DRAFT','POSTED','PAID','VOID','CANCELLED')),
  total_gross      NUMBER(18,2) DEFAULT 0 NOT NULL,
  total_deductions NUMBER(18,2) DEFAULT 0 NOT NULL,    -- استقطاعات + أقساط سلف
  total_net        NUMBER(18,2) DEFAULT 0 NOT NULL,
  total_employer   NUMBER(18,2) DEFAULT 0 NOT NULL,
  entry_id         NUMBER       CONSTRAINT erp_payroll_runs_entry_fk REFERENCES erp_entries (entry_id),
  pay_entry_id     NUMBER       CONSTRAINT erp_payroll_runs_pay_fk   REFERENCES erp_entries (entry_id),
  pay_date         DATE,
  pay_method       VARCHAR2(4)  CONSTRAINT erp_payroll_runs_method_ck CHECK (pay_method IN ('CASH','BANK')),
  created_by       VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  created_at       TIMESTAMP    DEFAULT SYSTIMESTAMP NOT NULL
);
-- كشف واحد فعّال لكل شهر (الملغى لا يُحتسب)
CREATE UNIQUE INDEX erp_payroll_runs_active_uk ON erp_payroll_runs (CASE WHEN status IN ('DRAFT','POSTED','PAID') THEN period END);

CREATE TABLE erp_payroll_lines (
  line_id          NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_payroll_lines_pk PRIMARY KEY,
  run_id           NUMBER       NOT NULL CONSTRAINT erp_payroll_lines_run_fk REFERENCES erp_payroll_runs (run_id),
  emp_id           NUMBER       NOT NULL CONSTRAINT erp_payroll_lines_emp_fk REFERENCES erp_employees (emp_id),
  basic            NUMBER(18,2) DEFAULT 0 NOT NULL,   -- بعد التناسب بالأيام
  days_worked      NUMBER(3)    NOT NULL,
  days_in_period   NUMBER(3)    NOT NULL,
  earnings         NUMBER(18,2) DEFAULT 0 NOT NULL,   -- كل الاستحقاقات غير الأساسي (مكوّنات + تسويات)
  gross            NUMBER(18,2) DEFAULT 0 NOT NULL,
  deductions       NUMBER(18,2) DEFAULT 0 NOT NULL,
  advance_deduction NUMBER(18,2) DEFAULT 0 NOT NULL,
  net              NUMBER(18,2) DEFAULT 0 NOT NULL,
  employer_cost    NUMBER(18,2) DEFAULT 0 NOT NULL,
  CONSTRAINT erp_payroll_lines_uk UNIQUE (run_id, emp_id)
);

-- أبعاد الكشف: كل بند بحسابه، ومنها يُبنى قيد الترحيل
CREATE TABLE erp_advances (
  adv_id            NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_advances_pk PRIMARY KEY,
  emp_id            NUMBER       NOT NULL CONSTRAINT erp_advances_emp_fk REFERENCES erp_employees (emp_id),
  grant_date        DATE         NOT NULL,
  amount            NUMBER(18,2) NOT NULL CONSTRAINT erp_advances_amount_ck CHECK (amount > 0),
  installments      NUMBER(3)    NOT NULL CONSTRAINT erp_advances_inst_ck CHECK (installments BETWEEN 1 AND 120),
  first_period      DATE         NOT NULL CONSTRAINT erp_advances_first_ck CHECK (first_period = TRUNC(first_period, 'MM')),
  repaid            NUMBER(18,2) DEFAULT 0 NOT NULL,
  installments_done NUMBER(3)    DEFAULT 0 NOT NULL,
  status            VARCHAR2(7)  DEFAULT 'OPEN' NOT NULL CONSTRAINT erp_advances_status_ck CHECK (status IN ('OPEN','SETTLED','VOID')),
  entry_id          NUMBER       NOT NULL CONSTRAINT erp_advances_entry_fk REFERENCES erp_entries (entry_id),
  note              VARCHAR2(300),
  created_by        VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  created_at        TIMESTAMP    DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT erp_advances_repaid_ck CHECK (repaid >= 0 AND repaid <= amount)
);

-- تسويات الشهر (مكافأة، عمل إضافي، جزاء...). تبقى PENDING وتنتقل لأول كشف يغطي فترتها أو بعدها.
CREATE TABLE erp_pay_adjustments (
  adj_id       NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_pay_adjustments_pk PRIMARY KEY,
  emp_id       NUMBER       NOT NULL CONSTRAINT erp_pay_adjustments_emp_fk REFERENCES erp_employees (emp_id),
  period       DATE         NOT NULL CONSTRAINT erp_pay_adjustments_period_ck CHECK (period = TRUNC(period, 'MM')),
  kind         VARCHAR2(9)  NOT NULL CONSTRAINT erp_pay_adjustments_kind_ck CHECK (kind IN ('EARNING','DEDUCTION')),
  description  VARCHAR2(200) NOT NULL,
  amount       NUMBER(18,2) NOT NULL CONSTRAINT erp_pay_adjustments_amount_ck CHECK (amount > 0),
  account_code VARCHAR2(12) NOT NULL CONSTRAINT erp_pay_adjustments_acct_fk REFERENCES erp_accounts (code),
  status       VARCHAR2(7)  DEFAULT 'PENDING' NOT NULL CONSTRAINT erp_pay_adjustments_status_ck CHECK (status IN ('PENDING','APPLIED','VOID')),
  run_id       NUMBER       CONSTRAINT erp_pay_adjustments_run_fk REFERENCES erp_payroll_runs (run_id),
  created_by   VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  created_at   TIMESTAMP    DEFAULT SYSTIMESTAMP NOT NULL
);
CREATE INDEX erp_pay_adjustments_emp_ix ON erp_pay_adjustments (emp_id, status);

CREATE TABLE erp_payroll_items (
  item_id          NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_payroll_items_pk PRIMARY KEY,
  line_id          NUMBER       NOT NULL CONSTRAINT erp_payroll_items_line_fk REFERENCES erp_payroll_lines (line_id),
  kind             VARCHAR2(9)  NOT NULL CONSTRAINT erp_payroll_items_kind_ck CHECK (kind IN ('BASIC','EARNING','DEDUCTION','EMPLOYER','ADVANCE')),
  comp_id          NUMBER       CONSTRAINT erp_payroll_items_comp_fk REFERENCES erp_pay_components (comp_id),
  adj_id           NUMBER       CONSTRAINT erp_payroll_items_adj_fk  REFERENCES erp_pay_adjustments (adj_id),
  adv_id           NUMBER       CONSTRAINT erp_payroll_items_adv_fk  REFERENCES erp_advances (adv_id),
  description      VARCHAR2(200) NOT NULL,
  amount           NUMBER(18,2) NOT NULL CONSTRAINT erp_payroll_items_amount_ck CHECK (amount > 0),
  expense_account  VARCHAR2(12) CONSTRAINT erp_payroll_items_exp_fk  REFERENCES erp_accounts (code),
  liability_account VARCHAR2(12) CONSTRAINT erp_payroll_items_liab_fk REFERENCES erp_accounts (code)
);
CREATE INDEX erp_payroll_items_line_ix ON erp_payroll_items (line_id);

-- بعد الترحيل لا يُعدَّل سطر أو بند في كشف: التصحيح بإلغاء الكشف وإعادة إنشائه
CREATE OR REPLACE TRIGGER erp_payroll_lines_lock_trg
  BEFORE UPDATE OR DELETE ON erp_payroll_lines FOR EACH ROW
DECLARE
  v_status erp_payroll_runs.status%TYPE;
BEGIN
  SELECT status INTO v_status FROM erp_payroll_runs WHERE run_id = :OLD.run_id;
  IF v_status <> 'DRAFT' THEN
    RAISE_APPLICATION_ERROR(-20910, 'لا يُعدَّل كشف رواتب بعد ترحيله أو إلغائه');
  END IF;
END;
/
CREATE OR REPLACE TRIGGER erp_payroll_items_lock_trg
  BEFORE UPDATE OR DELETE ON erp_payroll_items FOR EACH ROW
DECLARE
  v_status erp_payroll_runs.status%TYPE;
BEGIN
  SELECT r.status INTO v_status
    FROM erp_payroll_lines l JOIN erp_payroll_runs r ON r.run_id = l.run_id
   WHERE l.line_id = :OLD.line_id;
  IF v_status <> 'DRAFT' THEN
    RAISE_APPLICATION_ERROR(-20910, 'لا يُعدَّل كشف رواتب بعد ترحيله أو إلغائه');
  END IF;
END;
/

-- ---------------------------------------------------------------- الفترات المحاسبية وإقفال السنة
-- فترة بلا صف = مفتوحة. القفل يرفضه الدفتر نفسه (ERP_GL.POST_ENTRY) فلا يمرّ منه قيد بتاريخ في فترة مقفلة.
CREATE TABLE erp_periods (
  period     DATE         CONSTRAINT erp_periods_pk PRIMARY KEY CONSTRAINT erp_periods_first_ck CHECK (period = TRUNC(period, 'MM')),
  status     VARCHAR2(6)  DEFAULT 'OPEN' NOT NULL CONSTRAINT erp_periods_status_ck CHECK (status IN ('OPEN','CLOSED')),
  changed_by VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  changed_at TIMESTAMP    DEFAULT SYSTIMESTAMP NOT NULL
);

-- إقفال سنة مالية (12 شهراً تنتهي في year_end): قيد يصفّر الإيرادات والمصروفات إلى الأرباح المحتجزة
CREATE TABLE erp_year_closings (
  year_end         DATE         CONSTRAINT erp_year_closings_pk PRIMARY KEY CONSTRAINT erp_year_closings_end_ck CHECK (year_end = LAST_DAY(year_end)),
  net_income       NUMBER(18,2) NOT NULL,
  entry_id         NUMBER       CONSTRAINT erp_year_closings_entry_fk REFERENCES erp_entries (entry_id),   -- NULL إن لم تكن هناك أرصدة
  status           VARCHAR2(8)  DEFAULT 'CLOSED' NOT NULL CONSTRAINT erp_year_closings_status_ck CHECK (status IN ('CLOSED','REOPENED')),
  reopen_entry_id  NUMBER       CONSTRAINT erp_year_closings_reopen_fk REFERENCES erp_entries (entry_id),
  changed_by       VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  changed_at       TIMESTAMP    DEFAULT SYSTIMESTAMP NOT NULL
);

-- ---------------------------------------------------------------- نقاط البيع (POS)
CREATE TABLE erp_pos_registers (
  reg_id              NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_pos_registers_pk PRIMARY KEY,
  code                VARCHAR2(12)  NOT NULL CONSTRAINT erp_pos_registers_code_uk UNIQUE,
  name                VARCHAR2(120) NOT NULL,
  wh_id               NUMBER        NOT NULL CONSTRAINT erp_pos_registers_wh_fk REFERENCES erp_warehouses (wh_id),
  cash_account        VARCHAR2(12)  DEFAULT '1100' NOT NULL CONSTRAINT erp_pos_registers_cash_fk REFERENCES erp_accounts (code),
  prices_include_vat  CHAR(1)       DEFAULT 'N' NOT NULL CONSTRAINT erp_pos_registers_vat_ck CHECK (prices_include_vat IN ('Y','N')),
  active              CHAR(1)       DEFAULT 'Y' NOT NULL CONSTRAINT erp_pos_registers_active_ck CHECK (active IN ('Y','N'))
);

-- وردية الصندوق: وردية مفتوحة واحدة لكل نقطة بيع
CREATE TABLE erp_pos_shifts (
  shift_id         NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_pos_shifts_pk PRIMARY KEY,
  reg_id           NUMBER        NOT NULL CONSTRAINT erp_pos_shifts_reg_fk REFERENCES erp_pos_registers (reg_id),
  cashier          VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  opened_at        TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
  opening_cash     NUMBER(18,2)  DEFAULT 0 NOT NULL CONSTRAINT erp_pos_shifts_open_ck CHECK (opening_cash >= 0),
  status           VARCHAR2(6)   DEFAULT 'OPEN' NOT NULL CONSTRAINT erp_pos_shifts_status_ck CHECK (status IN ('OPEN','CLOSED')),
  closed_at        TIMESTAMP,
  expected_cash    NUMBER(18,2),
  counted_cash     NUMBER(18,2),
  variance         NUMBER(18,2),
  variance_entry_id NUMBER       CONSTRAINT erp_pos_shifts_entry_fk REFERENCES erp_entries (entry_id)
);
CREATE UNIQUE INDEX erp_pos_shifts_open_uk ON erp_pos_shifts (CASE WHEN status = 'OPEN' THEN reg_id END);

-- بيع (SALE) أو مرتجع (RETURN) مرتبط ببيع أصلي
CREATE TABLE erp_pos_sales (
  sale_id        NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_pos_sales_pk PRIMARY KEY,
  sale_no        VARCHAR2(20)  NOT NULL CONSTRAINT erp_pos_sales_no_uk UNIQUE,
  kind           VARCHAR2(6)   NOT NULL CONSTRAINT erp_pos_sales_kind_ck CHECK (kind IN ('SALE','RETURN')),
  orig_sale_id   NUMBER        CONSTRAINT erp_pos_sales_orig_fk REFERENCES erp_pos_sales (sale_id),
  shift_id       NUMBER        NOT NULL CONSTRAINT erp_pos_sales_shift_fk REFERENCES erp_pos_shifts (shift_id),
  sale_date      DATE          NOT NULL,
  subtotal       NUMBER(18,2)  NOT NULL,          -- قبل الضريبة
  vat_amount     NUMBER(18,2)  NOT NULL,
  total          NUMBER(18,2)  NOT NULL,
  tendered       NUMBER(18,2)  NOT NULL,          -- مجموع الدفعات المستلمة (للمرتجع: المردود)
  change_due     NUMBER(18,2)  DEFAULT 0 NOT NULL,
  status         VARCHAR2(9)   DEFAULT 'COMPLETED' NOT NULL CONSTRAINT erp_pos_sales_status_ck CHECK (status IN ('COMPLETED','VOID')),
  entry_id       NUMBER        NOT NULL CONSTRAINT erp_pos_sales_entry_fk REFERENCES erp_entries (entry_id),
  cogs_entry_id  NUMBER        CONSTRAINT erp_pos_sales_cogs_fk REFERENCES erp_entries (entry_id),
  created_by     VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
  created_at     TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT erp_pos_sales_amount_ck CHECK (total > 0 AND total = subtotal + vat_amount AND tendered >= total AND change_due = tendered - total),
  CONSTRAINT erp_pos_sales_orig_ck CHECK ((kind = 'RETURN' AND orig_sale_id IS NOT NULL) OR (kind = 'SALE' AND orig_sale_id IS NULL))
);
CREATE INDEX erp_pos_sales_shift_ix ON erp_pos_sales (shift_id);
CREATE INDEX erp_pos_sales_orig_ix  ON erp_pos_sales (orig_sale_id);

CREATE TABLE erp_pos_sale_lines (
  line_id          NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_pos_sale_lines_pk PRIMARY KEY,
  sale_id          NUMBER        NOT NULL CONSTRAINT erp_pos_sale_lines_sale_fk REFERENCES erp_pos_sales (sale_id),
  item_id          NUMBER        NOT NULL CONSTRAINT erp_pos_sale_lines_item_fk REFERENCES erp_items (item_id),
  description      VARCHAR2(200) NOT NULL,
  qty              NUMBER(18,3)  NOT NULL CONSTRAINT erp_pos_sale_lines_qty_ck CHECK (qty > 0),
  price            NUMBER(18,2)  NOT NULL CONSTRAINT erp_pos_sale_lines_price_ck CHECK (price >= 0),
  discount_pct     NUMBER(5,2)   DEFAULT 0 NOT NULL CONSTRAINT erp_pos_sale_lines_disc_ck CHECK (discount_pct BETWEEN 0 AND 100),
  vat_rate         NUMBER(5,2)   DEFAULT 0 NOT NULL CONSTRAINT erp_pos_sale_lines_rate_ck CHECK (vat_rate BETWEEN 0 AND 100),
  net              NUMBER(18,2)  NOT NULL,
  vat              NUMBER(18,2)  NOT NULL,
  cost             NUMBER(18,2),                  -- تكلفة البند المخزني (NULL للخدمات)
  wh_id            NUMBER        CONSTRAINT erp_pos_sale_lines_wh_fk REFERENCES erp_warehouses (wh_id),
  revenue_account  VARCHAR2(12)  NOT NULL CONSTRAINT erp_pos_sale_lines_rev_fk REFERENCES erp_accounts (code),
  orig_line_id     NUMBER        CONSTRAINT erp_pos_sale_lines_orig_fk REFERENCES erp_pos_sale_lines (line_id)
);
CREATE INDEX erp_pos_sale_lines_sale_ix ON erp_pos_sale_lines (sale_id);
CREATE INDEX erp_pos_sale_lines_orig_ix ON erp_pos_sale_lines (orig_line_id);

CREATE TABLE erp_pos_payments (
  pay_id        NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_pos_payments_pk PRIMARY KEY,
  sale_id       NUMBER       NOT NULL CONSTRAINT erp_pos_payments_sale_fk REFERENCES erp_pos_sales (sale_id),
  method        VARCHAR2(4)  NOT NULL CONSTRAINT erp_pos_payments_method_ck CHECK (method IN ('CASH','CARD')),
  amount        NUMBER(18,2) NOT NULL CONSTRAINT erp_pos_payments_amount_ck CHECK (amount > 0),
  account_code  VARCHAR2(12) NOT NULL CONSTRAINT erp_pos_payments_acct_fk REFERENCES erp_accounts (code)
);
CREATE INDEX erp_pos_payments_sale_ix ON erp_pos_payments (sale_id);
