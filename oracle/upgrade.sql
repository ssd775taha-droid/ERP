-- ترقية قاعدة قائمة إلى آخر إصدار دون حذف بياناتك: يضيف الجداول/الدوال الجديدة (متكرر التشغيل) ثم يعيد تجميع كل الحزم والعروض (CREATE OR REPLACE).
-- يُشغَّل من داخل مجلد oracle/ بحساب المخطط:  sqlplus erp_owner/كلمة_السر@service @upgrade.sql
-- الإصدارات: 0.4 إشعارات الدائن والمدين (جداول erp_notes وerp_note_lines والحزمة ERP_CDNOTE وتعديل ERP_TRADE).
WHENEVER SQLERROR EXIT FAILURE ROLLBACK
SET DEFINE OFF
@sql/01b_notes_schema.sql
@sql/03_pkg_erp_gl.sql
@sql/04_pkg_erp_inventory.sql
@sql/05_pkg_erp_trade.sql
@sql/06_pkg_erp_asset.sql
@sql/07_pkg_erp_hr.sql
@sql/08_pkg_erp_payroll.sql
@sql/09_pkg_erp_fin.sql
@sql/10_pkg_erp_period.sql
@sql/11_pkg_erp_pos.sql
@sql/12_pkg_erp_po.sql
@sql/13_pkg_erp_quote.sql
@sql/13b_pkg_erp_cdnote.sql
@sql/14_views.sql
PROMPT تمت الترقية.
