-- ============================================================================
-- 09: حزمة القوائم المالية ERP_FIN (قراءة فقط، لا تعدّل شيئاً)
-- دوال لأرقام القوائم الثلاث تُستخدم في الشاشات والاختبار؛ وتقارير reports/*.sql تعرض التفاصيل بالاستعلامات نفسها.
--   قائمة الدخل : قيود NORMAL فقط (تُستبعد قيود إقفال السنة) فتظهر السنة المقفلة بأرقامها.
--   الميزانية   : كل القيود حتى تاريخ، وما لم يُقفَل من أرباح يظهر بنداً «أرباح الفترة الحالية».
--   التدفقات    : الطريقة المباشرة من حسابات النقد (cash_account = 'Y'): يُصنَّف كل قيد يمس النقد حسب حسابات
--                 الطرف المقابل (استثمارية ثم تمويلية ثم تشغيلية بحسب cf_category). تقريب معقول، ليس نظرية محاسبية كاملة.
-- ============================================================================
CREATE OR REPLACE PACKAGE erp_fin AS
  -- رصيد حساب (مدين − دائن) بكل القيود حتى تاريخ (NULL = بلا حد)
  FUNCTION account_balance (p_code IN VARCHAR2, p_asof IN DATE DEFAULT NULL) RETURN NUMBER;
  -- صافي الدخل لفترة = الإيرادات − المصروفات من قيود NORMAL (يستبعد إقفال السنة)
  FUNCTION net_income (p_from IN DATE, p_to IN DATE) RETURN NUMBER;
  -- مجموع قسم في الميزانية: ASSET (مدين − دائن)، LIABILITY أو EQUITY (دائن − مدين)، بكل القيود حتى تاريخ
  FUNCTION section_total (p_type IN VARCHAR2, p_asof IN DATE) RETURN NUMBER;
  -- أرباح لم تُقفَل بعد حتى تاريخ: (دائن − مدين) لحسابات الإيرادات والمصروفات بكل القيود بما فيها قيود الإقفال
  FUNCTION unclosed_earnings (p_asof IN DATE) RETURN NUMBER;
  -- رصيد النقد والبنوك (مدين − دائن) حتى تاريخ
  FUNCTION cash_balance (p_asof IN DATE) RETURN NUMBER;
  -- صافي التدفق النقدي لفئة (OPERATING | INVESTING | FINANCING) في فترة
  FUNCTION cash_flow (p_from IN DATE, p_to IN DATE, p_category IN VARCHAR2) RETURN NUMBER;
END erp_fin;
/

CREATE OR REPLACE PACKAGE BODY erp_fin AS

  FUNCTION account_balance (p_code IN VARCHAR2, p_asof IN DATE DEFAULT NULL) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    SELECT NVL(SUM(l.debit - l.credit), 0) INTO v
      FROM erp_lines l JOIN erp_entries e ON e.entry_id = l.entry_id
     WHERE l.account_code = p_code AND (p_asof IS NULL OR e.entry_date <= p_asof);
    RETURN v;
  END account_balance;

  FUNCTION net_income (p_from IN DATE, p_to IN DATE) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    -- الإيراد (دائن − مدين) ناقص المصروف (مدين − دائن) = مجموع (دائن − مدين) للنوعين
    SELECT NVL(SUM(l.credit - l.debit), 0) INTO v
      FROM erp_lines l
      JOIN erp_entries e  ON e.entry_id = l.entry_id
      JOIN erp_accounts a ON a.code = l.account_code
     WHERE a.acc_type IN ('REVENUE', 'EXPENSE') AND e.kind = 'NORMAL'
       AND (p_from IS NULL OR e.entry_date >= p_from) AND (p_to IS NULL OR e.entry_date <= p_to);
    RETURN v;
  END net_income;

  FUNCTION section_total (p_type IN VARCHAR2, p_asof IN DATE) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    IF p_type NOT IN ('ASSET', 'LIABILITY', 'EQUITY') THEN
      RAISE_APPLICATION_ERROR(-20720, 'قسم الميزانية: ASSET أو LIABILITY أو EQUITY');
    END IF;
    SELECT NVL(SUM(CASE WHEN a.acc_type = 'ASSET' THEN l.debit - l.credit ELSE l.credit - l.debit END), 0) INTO v
      FROM erp_lines l
      JOIN erp_entries e  ON e.entry_id = l.entry_id
      JOIN erp_accounts a ON a.code = l.account_code
     WHERE a.acc_type = p_type AND (p_asof IS NULL OR e.entry_date <= p_asof);
    RETURN v;
  END section_total;

  FUNCTION unclosed_earnings (p_asof IN DATE) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    SELECT NVL(SUM(l.credit - l.debit), 0) INTO v
      FROM erp_lines l
      JOIN erp_entries e  ON e.entry_id = l.entry_id
      JOIN erp_accounts a ON a.code = l.account_code
     WHERE a.acc_type IN ('REVENUE', 'EXPENSE') AND (p_asof IS NULL OR e.entry_date <= p_asof);
    RETURN v;
  END unclosed_earnings;

  FUNCTION cash_balance (p_asof IN DATE) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    SELECT NVL(SUM(l.debit - l.credit), 0) INTO v
      FROM erp_lines l
      JOIN erp_entries e  ON e.entry_id = l.entry_id
      JOIN erp_accounts a ON a.code = l.account_code
     WHERE a.cash_account = 'Y' AND (p_asof IS NULL OR e.entry_date <= p_asof);
    RETURN v;
  END cash_balance;

  FUNCTION cash_flow (p_from IN DATE, p_to IN DATE, p_category IN VARCHAR2) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    IF p_category NOT IN ('OPERATING', 'INVESTING', 'FINANCING') THEN
      RAISE_APPLICATION_ERROR(-20720, 'فئة التدفق: OPERATING أو INVESTING أو FINANCING');
    END IF;
    SELECT NVL(SUM(ce.cash_change), 0) INTO v
      FROM (
        SELECT e.entry_id, SUM(l.debit - l.credit) AS cash_change
          FROM erp_entries e
          JOIN erp_lines l    ON l.entry_id = e.entry_id
          JOIN erp_accounts a ON a.code = l.account_code AND a.cash_account = 'Y'
         WHERE (p_from IS NULL OR e.entry_date >= p_from) AND (p_to IS NULL OR e.entry_date <= p_to)
         GROUP BY e.entry_id
        HAVING SUM(l.debit - l.credit) <> 0
      ) ce
     WHERE p_category = CASE
             WHEN EXISTS (SELECT 1 FROM erp_lines l2 JOIN erp_accounts a2 ON a2.code = l2.account_code
                           WHERE l2.entry_id = ce.entry_id AND a2.cash_account = 'N' AND a2.cf_category = 'INVESTING') THEN 'INVESTING'
             WHEN EXISTS (SELECT 1 FROM erp_lines l2 JOIN erp_accounts a2 ON a2.code = l2.account_code
                           WHERE l2.entry_id = ce.entry_id AND a2.cash_account = 'N' AND a2.cf_category = 'FINANCING') THEN 'FINANCING'
             ELSE 'OPERATING' END;
    RETURN v;
  END cash_flow;

END erp_fin;
/
SHOW ERRORS PACKAGE BODY erp_fin
