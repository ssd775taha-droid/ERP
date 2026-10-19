-- حذف كل كائنات نظام ERP من المخطط الحالي (للتجربة وإعادة التثبيت). **يحذف كل البيانات.**
-- شغّله بحساب المخطط نفسه فقط، وتأكد من اسم المخطط قبل التشغيل:  SELECT USER FROM dual;
SET DEFINE OFF
SET SERVEROUTPUT ON
DECLARE
  PROCEDURE run (p_sql VARCHAR2) IS
  BEGIN EXECUTE IMMEDIATE p_sql; EXCEPTION WHEN OTHERS THEN DBMS_OUTPUT.PUT_LINE('تخطّي: ' || p_sql || ' → ' || SQLERRM); END;
BEGIN
  FOR v IN (SELECT view_name FROM user_views WHERE view_name LIKE 'V\_ERP\_%' ESCAPE '\') LOOP run('DROP VIEW ' || v.view_name); END LOOP;
  run('DROP PACKAGE erp_trade');
  run('DROP PACKAGE erp_stock');
  run('DROP PACKAGE erp_gl');
  FOR t IN (SELECT table_name FROM user_tables WHERE table_name IN (
      'ERP_PAYMENTS','ERP_INVOICE_LINES','ERP_INVOICES','ERP_COUNTERS','ERP_PARTIES',
      'ERP_STOCK_MOVES','ERP_STOCK','ERP_ITEMS','ERP_WAREHOUSES','ERP_LINES','ERP_ENTRIES','ERP_ACCOUNTS')
    ORDER BY CASE table_name
      WHEN 'ERP_PAYMENTS' THEN 1 WHEN 'ERP_INVOICE_LINES' THEN 2 WHEN 'ERP_INVOICES' THEN 3 WHEN 'ERP_COUNTERS' THEN 4
      WHEN 'ERP_PARTIES' THEN 5 WHEN 'ERP_STOCK_MOVES' THEN 6 WHEN 'ERP_STOCK' THEN 7 WHEN 'ERP_ITEMS' THEN 8
      WHEN 'ERP_WAREHOUSES' THEN 9 WHEN 'ERP_LINES' THEN 10 WHEN 'ERP_ENTRIES' THEN 11 ELSE 12 END) LOOP
    run('DROP TABLE ' || t.table_name || ' CASCADE CONSTRAINTS PURGE');
  END LOOP;
  run('DROP SEQUENCE erp_stock_doc_seq');
  run('DROP TYPE erp_inv_line_tab');
  run('DROP TYPE erp_inv_line_t');
  run('DROP TYPE erp_line_tab');
  run('DROP TYPE erp_line_t');
  DBMS_OUTPUT.PUT_LINE('تم الحذف.');
END;
/
