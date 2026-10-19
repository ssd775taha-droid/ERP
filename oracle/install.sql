-- التثبيت الكامل: sqlplus erp_owner/كلمة_السر@service @install.sql
-- يُشغَّل من داخل مجلد oracle/. ترتيب الملفات مهم.
WHENEVER SQLERROR EXIT FAILURE ROLLBACK
SET DEFINE OFF
@sql/01_schema.sql
@sql/02_seed.sql
@sql/03_pkg_erp_gl.sql
@sql/04_pkg_erp_trade.sql
@sql/05_views.sql
PROMPT تم التثبيت. للاختبار الذاتي: SET SERVEROUTPUT ON ثم @sql/06_selftest.sql
