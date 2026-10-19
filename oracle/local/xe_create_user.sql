-- ينشئ مستخدم المخطط erp_owner (أو يعيد ضبط كلمة سره إن وُجد) ويمنحه الصلاحيات اللازمة.
-- يُشغَّل بحساب SYS ومتصلاً بالقاعدة القابلة للتوصيل (الخدمة XEPDB1) لا بالجذر:   @local/xe_create_user.sql كلمة_السر
-- كلمة السر أحرف وأرقام فقط (يولّدها السكربت). الوسيط &1 هو كلمة سر erp_owner.
SET DEFINE ON
SET VERIFY OFF
SET SERVEROUTPUT ON
WHENEVER SQLERROR EXIT FAILURE
DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM dba_users WHERE username = 'ERP_OWNER';
  IF n = 0 THEN
    EXECUTE IMMEDIATE 'CREATE USER erp_owner IDENTIFIED BY "&1" QUOTA UNLIMITED ON USERS';
    DBMS_OUTPUT.PUT_LINE('USER_CREATED');
  ELSE
    EXECUTE IMMEDIATE 'ALTER USER erp_owner IDENTIFIED BY "&1" ACCOUNT UNLOCK';
    DBMS_OUTPUT.PUT_LINE('USER_PASSWORD_RESET');
  END IF;
END;
/
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE, CREATE PROCEDURE, CREATE TYPE, CREATE TRIGGER, UNLIMITED TABLESPACE TO erp_owner;
SELECT 'GRANTED' FROM dual;
