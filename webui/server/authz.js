// تفويض الواجهة البرمجية: كل مسار يطلب وحدة ومستوى (قراءة للـ GET، وكتابة لغيره). ما لا يطابق أي قاعدة يُمنع لغير المدير.
const { HttpError } = require('./db');

const R = (re, module, opt = {}) => ({ re, module, ...opt });
// الترتيب مهم: أول قاعدة مطابقة. any = أي مستخدم مسجَّل، admin = مدير فقط
const RULES = [
  R(/^\/(me|account\/password|search|alerts)$/, 'any'),   // /search يقتصر داخلياً على الأنواع المسموحة للمستخدم
  R(/^\/(users|roles|audit|meta|system)(\/|$)/, 'admin'),
  R(/^\/accounts(\/|$)/, 'accounting', { readAny: true }),     // دليل الحسابات يُقرأ لتعبئة القوائم في كل الوحدات
  R(/^\/entries(\/|$)/, 'accounting'),
  R(/^\/cost-centers(\/|$)/, 'accounting', { readAny: true }),
  R(/^\/budgets(\/|$)/, 'accounting'),
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

// إجراءات حساسة: تتطلب علم الإجراء في الدور فوق كتابة الوحدة (المدير يملكها دائماً)
const VOID_RE = /(\/(void|reverse|unconvert|unpay|cancel)|\/components\/\d+\/remove)$/;
const APPROVE_RE = /^(\/po\/\d+\/approve|\/payroll\/runs\/\d+\/(post|pay)|\/periods\/(close|reopen)|\/years\/(close|reopen)|\/depreciation\/run)$/;
function sensitive(req) {
  if (req.method === 'DELETE') return '_void';
  if (req.method !== 'POST') return null;
  if (APPROVE_RE.test(req.path)) return '_approve';
  if (VOID_RE.test(req.path)) return '_void';
  return null;
}
const DENY_MSG = { _void: 'ليست لديك صلاحية الإلغاء والحذف والعكس', _approve: 'ليست لديك صلاحية الاعتماد والترحيل والإقفال' };

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
  if (rank[user.perms[rule.module] || 'n'] < rank[need]) return deny();
  const act = sensitive(req);
  if (act && !user.isAdmin && user.perms[act] !== 'y') return next(new HttpError(403, DENY_MSG[act]));
  return next();
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
