-- 02: دليل الحسابات الافتراضي وعدّادات الفواتير. الآباء قبل الأبناء بسبب المفتاح الأجنبي.
SET DEFINE OFF

INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1000', 'الأصول',               'ASSET',     NULL);
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1100', 'النقدية بالصندوق',     'ASSET',     '1000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1200', 'البنوك',               'ASSET',     '1000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1300', 'العملاء (ذمم مدينة)', 'ASSET',     '1000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1400', 'المخزون',              'ASSET',     '1000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('1500', 'الأصول الثابتة',       'ASSET',     '1000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('2000', 'الخصوم',               'LIABILITY', NULL);
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('2100', 'الموردون (ذمم دائنة)', 'LIABILITY', '2000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('2200', 'ضريبة القيمة المضافة', 'LIABILITY', '2000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('2300', 'رواتب مستحقة',        'LIABILITY', '2000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('3000', 'حقوق الملكية',         'EQUITY',    NULL);
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('3100', 'رأس المال',            'EQUITY',    '3000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('3200', 'الأرباح المحتجزة',     'EQUITY',    '3000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('4000', 'الإيرادات',            'REVENUE',   NULL);
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('4100', 'إيرادات المبيعات',     'REVENUE',   '4000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('4200', 'إيرادات الخدمات',      'REVENUE',   '4000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5000', 'المصروفات',            'EXPENSE',   NULL);
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5100', 'تكلفة البضاعة المباعة', 'EXPENSE',  '5000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5200', 'الرواتب والأجور',      'EXPENSE',   '5000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5300', 'الإيجار',              'EXPENSE',   '5000');
INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES ('5400', 'مصروفات عمومية',       'EXPENSE',   '5000');

INSERT INTO erp_counters (name, last_no) VALUES ('SALES',    0);
INSERT INTO erp_counters (name, last_no) VALUES ('PURCHASE', 0);

COMMIT;
