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
  account_code VARCHAR2(12)      -- اختياري: الافتراضي 4100 للمبيعات و5100 للمشتريات
);
/
CREATE OR REPLACE TYPE erp_inv_line_tab AS TABLE OF erp_inv_line_t;
/

-- ---------------------------------------------------------------- دليل الحسابات
CREATE TABLE erp_accounts (
  code         VARCHAR2(12)  CONSTRAINT erp_accounts_pk PRIMARY KEY,
  name         VARCHAR2(120) NOT NULL,
  acc_type     VARCHAR2(10)  NOT NULL
               CONSTRAINT erp_accounts_type_ck CHECK (acc_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  parent_code  VARCHAR2(12)  CONSTRAINT erp_accounts_parent_fk REFERENCES erp_accounts (code),
  active       CHAR(1)       DEFAULT 'Y' NOT NULL CONSTRAINT erp_accounts_active_ck CHECK (active IN ('Y','N'))
);
CREATE INDEX erp_accounts_parent_ix ON erp_accounts (parent_code);

-- ---------------------------------------------------------------- القيود (دفتر اليومية)
CREATE TABLE erp_entries (
  entry_id    NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_entries_pk PRIMARY KEY,
  entry_date  DATE          NOT NULL,
  memo        VARCHAR2(300),
  ref         VARCHAR2(60),
  void_of     NUMBER        CONSTRAINT erp_entries_void_fk REFERENCES erp_entries (entry_id),
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
  vat           NUMBER(18,2)  NOT NULL
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
