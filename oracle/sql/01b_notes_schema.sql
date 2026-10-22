-- ============================================================================
-- 01b: إشعارات الدائن والمدين (جداول وأنواع ودالة). **متكرر التشغيل (idempotent)** فيُستخدم في التثبيت الجديد وفي ترقية قاعدة قائمة.
-- يجب أن يسبق 05_pkg_erp_trade لأن الحزمة تستدعي ERP_NOTE_NET.
--   إشعار دائن مبيعات : يخفّض ما على العميل (مرتجع أو خصم لاحق).  إشعار مدين مبيعات: يزيد ما على العميل.
--   إشعار دائن مشتريات: يخفّض ما للمورد (مرتجع إليه).             إشعار مدين مشتريات: يزيد ما للمورد.
-- الإشعار مرتبط بفاتورة سارية وله سبب إلزامي. المتبقي الفعلي للفاتورة = الإجمالي + ERP_NOTE_NET − المدفوع.
-- ============================================================================
SET DEFINE OFF

DECLARE
  FUNCTION has_obj (p_type VARCHAR2, p_name VARCHAR2) RETURN BOOLEAN IS
    v NUMBER;
  BEGIN
    IF p_type = 'TABLE' THEN SELECT COUNT(*) INTO v FROM user_tables WHERE table_name = p_name;
    ELSE SELECT COUNT(*) INTO v FROM user_sequences WHERE sequence_name = p_name; END IF;
    RETURN v > 0;
  END has_obj;
  FUNCTION has_type (p_name VARCHAR2) RETURN BOOLEAN IS
    v NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v FROM user_types WHERE type_name = p_name;
    RETURN v > 0;
  END has_type;
BEGIN
  -- الأنواع تُنشأ مرة واحدة فقط: CREATE OR REPLACE على نوع له نوع تابع يفشل بـ ORA-02303 عند إعادة التشغيل
  IF NOT has_type('ERP_NOTE_LINE_T') THEN
    EXECUTE IMMEDIATE q'[CREATE TYPE erp_note_line_t AS OBJECT (
      description   VARCHAR2(200),
      qty           NUMBER,
      price         NUMBER,
      vat_rate      NUMBER,
      account_code  VARCHAR2(12),   -- لبند حر (بلا orig_line_id)؛ الافتراضي حساب الإيراد/المصروف كما في الفاتورة
      orig_line_id  NUMBER,         -- بند الفاتورة الأصلي (للإشعار الدائن: مرتجع أو تخفيض سعر)
      restock       VARCHAR2(1)     -- Y (الافتراضي) = تعود البضاعة للمخزن (أو تخرج منه في مشتريات)؛ N = تخفيض سعر بلا حركة مخزون
    )]';
  END IF;
  IF NOT has_type('ERP_NOTE_LINE_TAB') THEN
    EXECUTE IMMEDIATE 'CREATE TYPE erp_note_line_tab AS TABLE OF erp_note_line_t';
  END IF;
  IF NOT has_obj('SEQ', 'ERP_NOTE_SEQ') THEN
    EXECUTE IMMEDIATE 'CREATE SEQUENCE erp_note_seq START WITH 1 INCREMENT BY 1 NOCACHE';
  END IF;

  IF NOT has_obj('TABLE', 'ERP_NOTES') THEN
    EXECUTE IMMEDIATE q'[CREATE TABLE erp_notes (
      note_id        NUMBER DEFAULT erp_note_seq.NEXTVAL CONSTRAINT erp_notes_pk PRIMARY KEY,
      note_no        VARCHAR2(20)  NOT NULL CONSTRAINT erp_notes_no_uk UNIQUE,
      doc_kind       VARCHAR2(8)   NOT NULL CONSTRAINT erp_notes_kind_ck CHECK (doc_kind IN ('SALES','PURCHASE')),
      note_type      VARCHAR2(6)   NOT NULL CONSTRAINT erp_notes_type_ck CHECK (note_type IN ('CREDIT','DEBIT')),
      invoice_id     NUMBER        NOT NULL CONSTRAINT erp_notes_inv_fk REFERENCES erp_invoices (invoice_id),
      party_id       NUMBER        NOT NULL CONSTRAINT erp_notes_party_fk REFERENCES erp_parties (party_id),
      note_date      DATE          NOT NULL,
      reason         VARCHAR2(300) NOT NULL,
      subtotal       NUMBER(18,2)  NOT NULL,
      vat_amount     NUMBER(18,2)  NOT NULL,
      total          NUMBER(18,2)  NOT NULL,
      refund         NUMBER(18,2)  DEFAULT 0 NOT NULL,
      refund_method  VARCHAR2(4)   CONSTRAINT erp_notes_method_ck CHECK (refund_method IN ('CASH','BANK')),
      status         VARCHAR2(4)   DEFAULT 'OPEN' NOT NULL CONSTRAINT erp_notes_status_ck CHECK (status IN ('OPEN','VOID')),
      entry_id       NUMBER        NOT NULL CONSTRAINT erp_notes_entry_fk REFERENCES erp_entries (entry_id),
      stock_entry_id NUMBER        CONSTRAINT erp_notes_stock_fk REFERENCES erp_entries (entry_id),
      void_entry_id  NUMBER        CONSTRAINT erp_notes_void_fk REFERENCES erp_entries (entry_id),
      void_stock_entry_id NUMBER   CONSTRAINT erp_notes_vstock_fk REFERENCES erp_entries (entry_id),
      created_by     VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL,
      created_at     TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT erp_notes_amount_ck CHECK (total > 0 AND total = subtotal + vat_amount AND refund >= 0 AND refund <= total),
      CONSTRAINT erp_notes_refund_ck CHECK (refund = 0 OR (note_type = 'CREDIT' AND refund_method IS NOT NULL))
    )]';
    EXECUTE IMMEDIATE 'CREATE INDEX erp_notes_inv_ix ON erp_notes (invoice_id)';
    EXECUTE IMMEDIATE 'CREATE INDEX erp_notes_party_ix ON erp_notes (party_id)';
  END IF;

  IF NOT has_obj('TABLE', 'ERP_NOTE_LINES') THEN
    EXECUTE IMMEDIATE q'[CREATE TABLE erp_note_lines (
      line_id       NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_note_lines_pk PRIMARY KEY,
      note_id       NUMBER        NOT NULL CONSTRAINT erp_note_lines_note_fk REFERENCES erp_notes (note_id),
      description   VARCHAR2(200) NOT NULL,
      qty           NUMBER(18,3)  NOT NULL CONSTRAINT erp_note_lines_qty_ck CHECK (qty > 0),
      price         NUMBER(18,2)  NOT NULL CONSTRAINT erp_note_lines_price_ck CHECK (price >= 0),
      vat_rate      NUMBER(5,2)   NOT NULL CONSTRAINT erp_note_lines_rate_ck CHECK (vat_rate BETWEEN 0 AND 100),
      account_code  VARCHAR2(12)  NOT NULL CONSTRAINT erp_note_lines_acct_fk REFERENCES erp_accounts (code),
      net           NUMBER(18,2)  NOT NULL,
      vat           NUMBER(18,2)  NOT NULL,
      orig_line_id  NUMBER        CONSTRAINT erp_note_lines_orig_fk REFERENCES erp_invoice_lines (line_id),
      item_id       NUMBER        CONSTRAINT erp_note_lines_item_fk REFERENCES erp_items (item_id),
      wh_id         NUMBER        CONSTRAINT erp_note_lines_wh_fk REFERENCES erp_warehouses (wh_id),
      cost          NUMBER(18,2)
    )]';
    EXECUTE IMMEDIATE 'CREATE INDEX erp_note_lines_note_ix ON erp_note_lines (note_id)';
    EXECUTE IMMEDIATE 'CREATE INDEX erp_note_lines_orig_ix ON erp_note_lines (orig_line_id)';
  END IF;

  -- الدفع قد يتجاوز الإجمالي الأصلي بعد إشعار مدين: يُفرَض الحد الفعلي في ERP_TRADE.PAY لا في قيد الجدول
  FOR c IN (SELECT constraint_name FROM user_constraints
             WHERE table_name = 'ERP_INVOICES' AND constraint_name = 'ERP_INVOICES_AMOUNT_CK'
               AND search_condition_vc LIKE '%paid <= total%') LOOP
    EXECUTE IMMEDIATE 'ALTER TABLE erp_invoices DROP CONSTRAINT erp_invoices_amount_ck';
    EXECUTE IMMEDIATE 'ALTER TABLE erp_invoices ADD CONSTRAINT erp_invoices_amount_ck CHECK (total > 0 AND paid >= 0 AND total = subtotal + vat_amount)';
  END LOOP;

  -- عدّادات ترقيم الإشعارات (بلا فجوات)
  FOR n IN (SELECT column_value AS name FROM TABLE(sys.odcivarchar2list('SALES_CN', 'SALES_DN', 'PURCH_CN', 'PURCH_DN'))) LOOP
    MERGE INTO erp_counters c USING (SELECT n.name AS name FROM dual) s ON (c.name = s.name)
    WHEN NOT MATCHED THEN INSERT (name, last_no) VALUES (s.name, 0);
  END LOOP;
  COMMIT;
END;
/

-- أثر الإشعارات السارية على فاتورة: + مدين، − دائن، + المبلغ المردود نقداً/بنكاً (يرفع المتبقي لأنه سدّد زيادة سابقة)
CREATE OR REPLACE FUNCTION erp_note_net (p_invoice_id IN NUMBER) RETURN NUMBER IS
  v NUMBER;
BEGIN
  SELECT NVL(SUM(CASE note_type WHEN 'DEBIT' THEN total ELSE refund - total END), 0) INTO v
    FROM erp_notes WHERE invoice_id = p_invoice_id AND status = 'OPEN';
  RETURN v;
END erp_note_net;
/

-- ترويسة المستندات (شعار وبيانات اتصال وتذييل). الواجهة تنشئه عند أول استخدام إن غاب، وهنا للتثبيت/الترقية.
DECLARE
  v NUMBER;
BEGIN
  SELECT COUNT(*) INTO v FROM user_tables WHERE table_name = 'ERP_COMPANY_PROFILE';
  IF v = 0 THEN
    EXECUTE IMMEDIATE 'CREATE TABLE erp_company_profile (
      id NUMBER(1) CONSTRAINT erp_company_profile_pk PRIMARY KEY CONSTRAINT erp_company_profile_ck CHECK (id = 1),
      name_en VARCHAR2(120), cr_no VARCHAR2(30), phone VARCHAR2(40), email VARCHAR2(120), website VARCHAR2(120),
      footer_note VARCHAR2(500), logo CLOB, addr_en VARCHAR2(200), bank_info VARCHAR2(500), stamp CLOB)';
  ELSE
    SELECT COUNT(*) INTO v FROM user_tab_columns WHERE table_name = 'ERP_COMPANY_PROFILE' AND column_name = 'ADDR_EN';
    IF v = 0 THEN EXECUTE IMMEDIATE 'ALTER TABLE erp_company_profile ADD (addr_en VARCHAR2(200))'; END IF;
    SELECT COUNT(*) INTO v FROM user_tab_columns WHERE table_name = 'ERP_COMPANY_PROFILE' AND column_name = 'BANK_INFO';
    IF v = 0 THEN EXECUTE IMMEDIATE 'ALTER TABLE erp_company_profile ADD (bank_info VARCHAR2(500))'; END IF;
    SELECT COUNT(*) INTO v FROM user_tab_columns WHERE table_name = 'ERP_COMPANY_PROFILE' AND column_name = 'STAMP';
    IF v = 0 THEN EXECUTE IMMEDIATE 'ALTER TABLE erp_company_profile ADD (stamp CLOB)'; END IF;
  END IF;
END;
/
