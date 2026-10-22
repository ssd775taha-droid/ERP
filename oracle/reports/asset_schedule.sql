-- جدول إهلاك متوقع لأصل حتى نهاية عمره. المعامل: :P_ASSET (إلزامي)
-- القسط الشهري مقرَّب لمنزلتين، والشهر الأخير يأخذ المتبقي بالضبط (مطابق لمنطق ERP_ASSET).
-- العمود done = 'Y' للأشهر المسجَّلة فعلاً.
WITH a AS (
  SELECT asset_id, code, name, cost, salvage, life_months, dep_start,
         cost - salvage AS depreciable, ROUND((cost - salvage) / life_months, 2) AS monthly
    FROM erp_assets WHERE asset_id = :P_ASSET
), months AS (
  SELECT a.*, LEVEL AS n FROM a CONNECT BY LEVEL <= a.life_months
)
SELECT m.code, m.name, ADD_MONTHS(m.dep_start, m.n - 1) AS period, m.n,
       CASE WHEN m.n = m.life_months THEN m.depreciable - m.monthly * (m.life_months - 1) ELSE m.monthly END AS amount,
       SUM(CASE WHEN m.n = m.life_months THEN m.depreciable - m.monthly * (m.life_months - 1) ELSE m.monthly END)
         OVER (ORDER BY m.n) AS accumulated,
       m.cost - SUM(CASE WHEN m.n = m.life_months THEN m.depreciable - m.monthly * (m.life_months - 1) ELSE m.monthly END)
         OVER (ORDER BY m.n) AS book_value,
       CASE WHEN EXISTS (SELECT 1 FROM erp_depreciation d WHERE d.asset_id = m.asset_id AND d.status = 'OK'
                           AND d.period = ADD_MONTHS(m.dep_start, m.n - 1)) THEN 'Y' ELSE 'N' END AS done
  FROM months m
 ORDER BY m.n;
