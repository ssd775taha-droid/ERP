-- سجل الأصول الثابتة. المعامل اختياري: :P_STATUS ('ACTIVE' | 'DISPOSED' | NULL = الكل)
SELECT cat_name, code, name, acq_date, cost, salvage, life_months,
       accumulated, book_value, last_period, fully_depreciated, status
  FROM v_erp_asset_register
 WHERE (:P_STATUS IS NULL OR status = :P_STATUS)
 ORDER BY cat_code, code;
-- تجميع بالفئة، وملخصات (Sum) على cost وaccumulated وbook_value لكل فئة وللتقرير.
-- سطر مطابقة أسفل التقرير من العرض v_erp_asset_vs_gl (الفرق يجب أن يكون صفراً).
