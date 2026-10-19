// الاتصال بـ Oracle (oracledb بوضع Thin: لا يحتاج عميل Oracle) وأدوات التنفيذ وتحويل أخطاء PL/SQL إلى رسائل للمستخدم.
const oracledb = require('oracledb');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let pool = null;

async function init(cfg) {
  if (!cfg.dbPassword) throw new Error('كلمة سر قاعدة البيانات غير مضبوطة (ERP_DB_PASSWORD). شغّل: npm run init');
  pool = await oracledb.createPool({
    user: cfg.dbUser, password: cfg.dbPassword, connectString: cfg.dbConnect,
    poolMin: 1, poolMax: cfg.poolMax, poolIncrement: 1,
    // كل اتصال يقرأ التواريخ بصيغة ثابتة
    sessionCallback: (conn, requestedTag, cb) => {
      conn.execute("ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'").then(() => cb(), cb);
    },
  });
  return pool;
}

async function close() {
  if (pool) { await pool.close(5); pool = null; }
}

async function withConn(fn) {
  const conn = await pool.getConnection();
  try { return await fn(conn); } finally { await conn.close(); }
}

// استعلام قراءة: يعيد الصفوف
async function query(sql, binds = {}) {
  return withConn(async (c) => (await c.execute(sql, binds)).rows);
}

// تنفيذ كتلة DML/PLSQL بمعاملة: COMMIT عند النجاح وROLLBACK عند الخطأ
async function run(sql, binds = {}) {
  return withConn(async (c) => {
    try {
      const r = await c.execute(sql, binds, { autoCommit: false });
      await c.commit();
      return r;
    } catch (e) {
      try { await c.rollback(); } catch { /* الاتصال قد يكون سقط */ }
      throw e;
    }
  });
}

// رسالة الخطأ للمستخدم: أخطاء الحزم (ORA-20xxx) برسالتها العربية، وغيرها رسالة عامة دون كشف التفاصيل
function toHttpError(e) {
  if (e instanceof HttpError) return e;
  const msg = String((e && e.message) || e);
  const m = /ORA-(20\d{3}):\s*([^\n]+)/.exec(msg);
  if (m) return new HttpError(400, m[2].trim());
  if (/ORA-00001/.test(msg)) return new HttpError(409, 'القيمة مكررة (قيد فريد)');
  if (/ORA-02292/.test(msg)) return new HttpError(409, 'لا يمكن الحذف: توجد سجلات مرتبطة');
  if (/ORA-02290|ORA-01400|ORA-01438|ORA-12899/.test(msg)) return new HttpError(400, 'بيانات غير صالحة لقيود قاعدة البيانات');
  if (/ORA-12541|ORA-12514|ORA-12170|ORA-03113|ORA-03114|ORA-17002|NJS-040|NJS-500|DPY-/.test(msg)) {
    return new HttpError(503, 'تعذّر الاتصال بقاعدة البيانات');
  }
  return new HttpError(500, 'خطأ داخلي في الخادم');
}

module.exports = { init, close, query, run, withConn, toHttpError, HttpError, oracledb };
