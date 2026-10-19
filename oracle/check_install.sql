-- فحص ما بعد التثبيت: الكائنات غير الصالحة وأخطاء التجميع. ينبغي ألا يطبع شيئاً سوى الملخص «لا أخطاء».
-- شغّله بعد install.sql:  @check_install.sql   (SQL*Plus يمرّر أخطاء تجميع الحزم بلا توقف، فهذا هو الفحص الحقيقي)
SET SERVEROUTPUT ON
SET LINESIZE 200
SET PAGESIZE 100
COLUMN name FORMAT A32
COLUMN type FORMAT A14
COLUMN text FORMAT A100

PROMPT === كائنات غير صالحة ===
SELECT object_type AS type, object_name AS name, status FROM user_objects WHERE status <> 'VALID' ORDER BY object_type, object_name;

PROMPT === أخطاء التجميع ===
SELECT name, type, line, position, text FROM user_errors WHERE attribute = 'ERROR' ORDER BY name, type, sequence;

DECLARE
  v_inv NUMBER; v_err NUMBER; v_obj NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_inv FROM user_objects WHERE status <> 'VALID';
  SELECT COUNT(*) INTO v_err FROM user_errors WHERE attribute = 'ERROR';
  SELECT COUNT(*) INTO v_obj FROM user_objects WHERE object_name LIKE 'ERP%' OR object_name LIKE 'V\_ERP%' ESCAPE '\';
  DBMS_OUTPUT.PUT_LINE('كائنات ERP: ' || v_obj || ' · غير صالحة: ' || v_inv || ' · أخطاء تجميع: ' || v_err);
  IF v_inv = 0 AND v_err = 0 THEN DBMS_OUTPUT.PUT_LINE('لا أخطاء'); END IF;
END;
/
