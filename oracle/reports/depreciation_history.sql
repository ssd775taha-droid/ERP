-- سجل الإهلاك الشهري (قيد لكل دفعة). المعاملان اختياريان: :P_FROM · :P_TO (DATE، أشهر)
SELECT r.period, r.run_id, r.entry_id, r.status, a.code AS asset_code, a.name AS asset_name, d.amount
  FROM erp_dep_runs r
  JOIN erp_depreciation d ON d.run_id = r.run_id
  JOIN erp_assets a       ON a.asset_id = d.asset_id
 WHERE (:P_FROM IS NULL OR r.period >= TRUNC(:P_FROM, 'MM'))
   AND (:P_TO   IS NULL OR r.period <= TRUNC(:P_TO, 'MM'))
 ORDER BY r.period, r.run_id, a.code;
-- تجميع بالشهر (رأس: الشهر والإجمالي) ثم الأصول. الدفعات الملغاة (VOID) تظهر بعلامتها ولا تدخل الإجمالي:
-- اجعل Summary Column بشرط status = 'OK'.
