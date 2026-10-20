// تفويض الواجهة البرمجية: كل مسار يطلب وحدة ومستوى (قراءة للـ GET، وكتابة لغيره). ما لا يطابق أي قاعدة يُمنع لغير المدير.
const { HttpError } = require('./db');

const R = (re, module, opt = {}) => ({ re, module, ...opt });
// الترتيب مهم: أول قاعدة مطابقة. any = أي مستخدم مسجَّل، admin = مدير فقط
const RULES = [
  R(/^\/(me|account\/password|search|alerts)$/, 'any'),   // /search يقتصر داخلياً على الأنواع المسموحة للمستخدم
  R(/^\/(users|roles|audit|meta)(\/|$)/, 'admin'),
  R(/^\/accounts(\/|$)/, 'accounting', { readAny: true }),     // دليل الحسابات يُقرأ لتعبئة القوائم في كل الوحدات
  R(/^\/entries(\/|$)/, 'accounting'),
  R(/^\/summary$/, 'summary'),
  R(/^\/reports\//, 'reports'),
  R(/^\/(periods|years)(\/|$)/, 'periods'),
  R(/^\/import\/parties$/, 'trade'),
  R(/^\/import\/items$/, 'inventory'),
  R(/^\/(parties|invoices|payments|notes)(\/|$)/, 'trade'),
  R(/^\/(items|warehouses)$/, 'inventory', { readAny: true }),
  R(/^\/inventory(\/|$)/, 'inventory'),
  R(/^\/(assets|depreciation)(\/|$)/, 'assets'),
  R(/^\/hr(\/|$)/, 'hr'),
  R(/^\/payroll(\/|$)/, 'payroll'),
  R(/^\/pos(\/|$)/, 'pos'),
  R(/^\/(po|quotes)(\/|$)/, 'orders'),
  R(/^\/settings$/, 'settings'),
  R(/^\/(tax\/settings|letterhead)$/, 'settings', { readAny: true }),
];

const rank = { n: 0, r: 1, w: 2 };

function authorize(req, res, next) {
  const user = req.user;
  const need = req.method === 'GET' || req.method === 'HEAD' ? 'r' : 'w';
  const rule = RULES.find((x) => x.re.test(req.path));
  const deny = () => next(new HttpError(403, 'ليست لديك صلاحية لهذه العملية'));
  if (!rule) return user.isAdmin ? next() : deny();
  if (rule.module === 'any') return next();
  if (rule.module === 'admin') return user.isAdmin ? next() : deny();
  if (rule.readAny && need === 'r') return next();
  if (rule.module === 'summary') return rank[user.perms.reports] >= 1 || rank[user.perms.accounting] >= 1 ? next() : deny();
  return rank[user.perms[rule.module] || 'n'] >= rank[need] ? next() : deny();
}

// سجل العمليات: كل طلب معدِّل بعد اكتماله (اسم المستخدم والمسار والحالة، دون محتوى الطلب)
function auditWrites(auth) {
  return (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      res.on('finish', () => auth.audit(req.user && req.user.username, `${req.method} ${req.baseUrl}${req.path}`.replace('/api', ''), res.statusCode, req.ip));
    }
    next();
  };
}

module.exports = { authorize, auditWrites, RULES };
