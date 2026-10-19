-- 02: دليل الحسابات الافتراضي وعدّادات الفواتير والمخزن الرئيسي وفئات الأصول. (مكوّنات الرواتب تُعرَّف بنسب نظام بلدك: لا تُزرع هنا) الآباء قبل الأبناء بسبب المفتاح الأجنبي.
SET DEFINE OFF

INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1000', 'الأصول',               'ASSET',     NULL);
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1100', 'النقدية بالصندوق',     'ASSET',     '1000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1200', 'البنوك',               'ASSET',     '1000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1300', 'العملاء (ذمم مدينة)', 'ASSET',     '1000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1350', 'سلف الموظفين',         'ASSET',     '1000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1400', 'المخزون',              'ASSET',     '1000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1500', 'الأصول الثابتة',       'ASSET',     '1000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1510', 'مجمع إهلاك الأصول الثابتة', 'ASSET',  '1000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('2000', 'الخصوم',               'LIABILITY', NULL);
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('2100', 'الموردون (ذمم دائنة)', 'LIABILITY', '2000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('2200', 'ضريبة القيمة المضافة', 'LIABILITY', '2000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('2300', 'رواتب مستحقة',        'LIABILITY', '2000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('2400', 'تأمينات اجتماعية مستحقة', 'LIABILITY', '2000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('2500', 'ضريبة دخل الرواتب مستحقة', 'LIABILITY', '2000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('3000', 'حقوق الملكية',         'EQUITY',    NULL);
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('3100', 'رأس المال',            'EQUITY',    '3000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('3200', 'الأرباح المحتجزة',     'EQUITY',    '3000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('4000', 'الإيرادات',            'REVENUE',   NULL);
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('4100', 'إيرادات المبيعات',     'REVENUE',   '4000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('4200', 'إيرادات الخدمات',      'REVENUE',   '4000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('4300', 'أرباح بيع أصول ثابتة', 'REVENUE',   '4000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5000', 'المصروفات',            'EXPENSE',   NULL);
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5100', 'تكلفة البضاعة المباعة', 'EXPENSE',  '5000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5200', 'الرواتب والأجور',      'EXPENSE',   '5000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5210', 'تأمينات - حصة صاحب العمل', 'EXPENSE', '5000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5300', 'الإيجار',              'EXPENSE',   '5000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5400', 'مصروفات عمومية',       'EXPENSE',   '5000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5500', 'فروقات وتسويات المخزون', 'EXPENSE', '5000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5600', 'مصروف الإهلاك',        'EXPENSE',   '5000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5800', 'فروقات الصندوق (عجز وزيادة)', 'EXPENSE', '5000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5700', 'خسائر بيع أصول ثابتة', 'EXPENSE',   '5000');

-- تصنيف الحسابات لقائمة التدفقات النقدية: النقد والبنوك، والاستثمارية (الأصول الثابتة ومجمعها)، والتمويلية (حقوق الملكية)
UPDATE erp_accounts SET cash_account = 'Y' WHERE code IN ('1100', '1200');
UPDATE erp_accounts SET cf_category = 'INVESTING' WHERE code IN ('1500', '1510');
UPDATE erp_accounts SET cf_category = 'FINANCING' WHERE code IN ('3000', '3100', '3200');

INSERT INTO erp_counters (name, last_no) VALUES ('SALES',    0);
INSERT INTO erp_counters (name, last_no) VALUES ('PURCHASE', 0);
INSERT INTO erp_counters (name, last_no) VALUES ('PO', 0);
INSERT INTO erp_counters (name, last_no) VALUES ('QUOTE', 0);
INSERT INTO erp_counters (name, last_no) VALUES ('POS_SALE', 0);
INSERT INTO erp_counters (name, last_no) VALUES ('POS_RETURN', 0);

INSERT INTO erp_warehouses (code, name) VALUES ('MAIN', 'المخزن الرئيسي');
INSERT INTO erp_pos_registers (code, name, wh_id) SELECT 'POS1', 'نقطة بيع 1', wh_id FROM erp_warehouses WHERE code = 'MAIN';

-- فئات أصول افتراضية (الأعمار تقديرية: عدّلها وفق سياستك وأنظمة بلدك الضريبية)
INSERT INTO erp_asset_categories (code, name, life_months) VALUES ('EQP', 'آلات ومعدات',      60);
INSERT INTO erp_asset_categories (code, name, life_months) VALUES ('VEH', 'سيارات ومركبات',   60);
INSERT INTO erp_asset_categories (code, name, life_months) VALUES ('FUR', 'أثاث وتجهيزات',    120);
INSERT INTO erp_asset_categories (code, name, life_months) VALUES ('IT',  'أجهزة حاسب وشبكات', 36);

COMMIT;
