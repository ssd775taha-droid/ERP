-- ============================================================================
-- 01c: مراكز التكلفة والموازنات. **متكرر التشغيل (idempotent)**: للتثبيت الجديد والترقية.
--   ERP_COST_CENTERS : مراكز التكلفة (رمز واسم).
--   ERP_LINE_CC      : وسم سطر قيد بمركز تكلفة (جدول جانبي فلا تتغير حزمة ERP_GL).
--   ERP_BUDGETS      : موازنة شهرية لكل حساب إيراد/مصروف، ولمركز تكلفة أو للمنشأة كلها (cc_id = 0).
--   V_ERP_LINE_CC    : أسطر القيود مع مركز كل سطر؛ سطر القيد العكسي يرث مركز السطر المقابل في القيد الأصلي.
-- ============================================================================
SET DEFINE OFF

DECLARE
  FUNCTION has_tab (p_name VARCHAR2) RETURN BOOLEAN IS
    v NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v FROM user_tables WHERE table_name = p_name;
    RETURN v > 0;
  END has_tab;
BEGIN
  IF NOT has_tab('ERP_COST_CENTERS') THEN
    EXECUTE IMMEDIATE 'CREATE TABLE erp_cost_centers (
      cc_id   NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT erp_cost_centers_pk PRIMARY KEY,
      code    VARCHAR2(20)  NOT NULL CONSTRAINT erp_cost_centers_code_uk UNIQUE,
      name    VARCHAR2(120) NOT NULL,
      active  CHAR(1)       DEFAULT ''Y'' NOT NULL CONSTRAINT erp_cost_centers_active_ck CHECK (active IN (''Y'',''N''))
    )';
  END IF;
  IF NOT has_tab('ERP_LINE_CC') THEN
    EXECUTE IMMEDIATE 'CREATE TABLE erp_line_cc (
      line_id NUMBER NOT NULL CONSTRAINT erp_line_cc_pk PRIMARY KEY CONSTRAINT erp_line_cc_line_fk REFERENCES erp_lines (line_id) ON DELETE CASCADE,
      cc_id   NUMBER NOT NULL CONSTRAINT erp_line_cc_cc_fk REFERENCES erp_cost_centers (cc_id)
    )';
    EXECUTE IMMEDIATE 'CREATE INDEX erp_line_cc_cc_ix ON erp_line_cc (cc_id)';
  END IF;
  IF NOT has_tab('ERP_BUDGETS') THEN
    EXECUTE IMMEDIATE 'CREATE TABLE erp_budgets (
      year_no      NUMBER(4)    NOT NULL,
      account_code VARCHAR2(12) NOT NULL CONSTRAINT erp_budgets_acct_fk REFERENCES erp_accounts (code),
      cc_id        NUMBER       DEFAULT 0 NOT NULL,
      month_no     NUMBER(2)    NOT NULL CONSTRAINT erp_budgets_month_ck CHECK (month_no BETWEEN 1 AND 12),
      amount       NUMBER(18,2) NOT NULL CONSTRAINT erp_budgets_amount_ck CHECK (amount >= 0),
      CONSTRAINT erp_budgets_pk PRIMARY KEY (year_no, account_code, cc_id, month_no)
    )';
  END IF;
  EXECUTE IMMEDIATE q'[CREATE OR REPLACE VIEW v_erp_line_cc AS
    SELECT l.line_id, l.entry_id, l.account_code, l.debit, l.credit, e.entry_date, e.kind, e.void_of,
           COALESCE(t.cc_id, o.cc_id) AS cc_id
      FROM (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY entry_id, account_code, GREATEST(debit, credit) ORDER BY line_id) AS rn FROM erp_lines x) l
      JOIN erp_entries e ON e.entry_id = l.entry_id
      LEFT JOIN erp_line_cc t ON t.line_id = l.line_id
      LEFT JOIN (SELECT y.entry_id, y.account_code, GREATEST(y.debit, y.credit) AS amt, c.cc_id,
                        ROW_NUMBER() OVER (PARTITION BY y.entry_id, y.account_code, GREATEST(y.debit, y.credit) ORDER BY y.line_id) AS rn
                   FROM erp_lines y JOIN erp_line_cc c ON c.line_id = y.line_id) o
        ON o.entry_id = e.void_of AND o.account_code = l.account_code AND o.amt = GREATEST(l.debit, l.credit) AND o.rn = l.rn]';
END;
/
