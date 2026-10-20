// جداول طبقة الويب (المستخدمون والأدوار وسجل العمليات). تُنشأ تلقائياً عند التشغيل إن لم توجد (idempotent)،
// بأسماء بلا بادئة ERP_ فلا يحذفها uninstall.sql ولا تدخل في فحص التثبيت.
const db = require('./db');
const { BUILTIN_ROLES, cleanPerms } = require('./security');

async function ensureSchema() {
  await db.withConn(async (c) => {
    const has = async (t) => (await c.execute('SELECT COUNT(*) AS "n" FROM user_tables WHERE table_name = :t', { t })).rows[0].n > 0;
    if (!(await has('WEB_ROLES'))) {
      await c.execute(`CREATE TABLE web_roles (
        role_id  VARCHAR2(30)  CONSTRAINT web_roles_pk PRIMARY KEY,
        name     VARCHAR2(80)  NOT NULL,
        perms    VARCHAR2(1000) NOT NULL,
        builtin  CHAR(1) DEFAULT 'N' NOT NULL CONSTRAINT web_roles_builtin_ck CHECK (builtin IN ('Y','N')))`);
    }
    if (!(await has('WEB_USERS'))) {
      await c.execute(`CREATE TABLE web_users (
        user_id    NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT web_users_pk PRIMARY KEY,
        username   VARCHAR2(40)  NOT NULL CONSTRAINT web_users_name_uk UNIQUE,
        full_name  VARCHAR2(120),
        role_id    VARCHAR2(30)  NOT NULL CONSTRAINT web_users_role_fk REFERENCES web_roles (role_id),
        pw_hash    VARCHAR2(300) NOT NULL,
        active     CHAR(1) DEFAULT 'Y' NOT NULL CONSTRAINT web_users_active_ck CHECK (active IN ('Y','N')),
        created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
        last_login TIMESTAMP)`);
    }
    if (!(await has('WEB_AUDIT'))) {
      await c.execute(`CREATE TABLE web_audit (
        audit_id NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT web_audit_pk PRIMARY KEY,
        at       TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
        username VARCHAR2(40),
        action   VARCHAR2(300),
        status   NUMBER(3),
        ip       VARCHAR2(60))`);
      await c.execute('CREATE INDEX web_audit_at_ix ON web_audit (at)');
    }
    // الأدوار الجاهزة: تُدرج الناقصة فقط (لا نكتب فوق تعديلات المدير على الصلاحيات)
    for (const r of BUILTIN_ROLES) {
      await c.execute(`MERGE INTO web_roles t USING (SELECT :id AS role_id FROM dual) s ON (t.role_id = s.role_id)
        WHEN NOT MATCHED THEN INSERT (role_id, name, perms, builtin) VALUES (:id, :name, :perms, 'Y')`,
      { id: r.id, name: r.name, perms: JSON.stringify(cleanPerms(r.perms)) });
    }
    await c.commit();
  });
}

// هل القاعدة بإصدار الكائنات الذي تتطلبه هذه الواجهة؟ (إشعارات الدائن والمدين) وإلا يُطلب تشغيل upgrade.sql
async function dbReady() {
  const r = await db.query(`SELECT (SELECT COUNT(*) FROM user_objects WHERE object_name = 'ERP_NOTE_NET' AND object_type = 'FUNCTION' AND status = 'VALID')
    + (SELECT COUNT(*) FROM user_objects WHERE object_name = 'ERP_CDNOTE' AND object_type = 'PACKAGE BODY' AND status = 'VALID') AS "n" FROM dual`);
  return r[0].n === 2;
}

module.exports = { ensureSchema, dbReady };
