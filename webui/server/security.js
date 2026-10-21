// كلمات السر (scrypt) والوحدات والأدوار الجاهزة.
const crypto = require('node:crypto');

const N = 16384, R = 8, P = 1, KEYLEN = 32;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${h.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expect = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), expect.length, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(got, expect);
}

// وحدات النظام التي تُمنح عليها الصلاحيات (n لا شيء، r قراءة، w قراءة وكتابة)
const MODULES = [
  ['accounting', 'المحاسبة (الحسابات والقيود)'], ['periods', 'إقفال الفترات'], ['reports', 'التقارير المالية والضريبية'],
  ['trade', 'العملاء والموردون والفواتير والسندات'], ['inventory', 'المخزون'], ['assets', 'الأصول الثابتة'],
  ['hr', 'الموظفون والتسويات والسلف'], ['payroll', 'كشوف الرواتب'], ['pos', 'نقاط البيع'], ['orders', 'أوامر الشراء وعروض الأسعار'],
  ['settings', 'إعدادات الضريبة والضوابط'],
];
const KEYS = MODULES.map((m) => m[0]);
// صلاحيات الإجراءات الحساسة (y/n) فوق مستوى الوحدة: لا تنفع كتابة الوحدة وحدها لإلغاء مستند أو اعتماده
const ACTIONS = [['_void', 'الإلغاء والحذف والعكس'], ['_approve', 'الاعتماد والترحيل والإقفال']];
const ACTION_KEYS = ACTIONS.map((a) => a[0]);
const LEVELS = ['n', 'r', 'w'];

const allOf = (lv) => Object.fromEntries(KEYS.map((k) => [k, lv]));
const some = (base, over) => ({ ...allOf(base), ...over });

const BUILTIN_ROLES = [
  { id: 'admin', name: 'مدير النظام', perms: allOf('w') },
  { id: 'accountant', name: 'محاسب', perms: some('n', { accounting: 'w', periods: 'w', reports: 'w', trade: 'w', inventory: 'r', assets: 'w', pos: 'r', orders: 'r', settings: 'r', _void: 'y', _approve: 'y' }) },
  { id: 'sales', name: 'مبيعات', perms: some('n', { reports: 'r', trade: 'w', inventory: 'r', pos: 'w', orders: 'w', _void: 'n', _approve: 'n' }) },
  { id: 'purchasing', name: 'مشتريات ومخازن', perms: some('n', { reports: 'r', trade: 'w', inventory: 'w', orders: 'w', _void: 'n', _approve: 'y' }) },
  { id: 'cashier', name: 'كاشير', perms: some('n', { pos: 'w', _void: 'n', _approve: 'n' }) },
  { id: 'hr', name: 'موارد بشرية ورواتب', perms: some('n', { hr: 'w', payroll: 'w', _void: 'n', _approve: 'y' }) },
  { id: 'viewer', name: 'مشاهدة فقط', perms: some('r', { hr: 'n', payroll: 'n', settings: 'n', periods: 'n', _void: 'n', _approve: 'n' }) },
];

function cleanPerms(p) {
  const out = {};
  for (const k of KEYS) {
    const lv = p && p[k];
    out[k] = LEVELS.includes(lv) ? lv : 'n';
  }
  // غياب علم الإجراء يعني «ممنوع» (أكثر أماناً): دور لم يُحفَظ بعد هذه الميزة يُعامَل كأنه لا يملك الإجراء حتى يُفعَّل صراحة.
  // migrate.js يُكمِّل الأعلام الناقصة للأدوار الجاهزة من BUILTIN_ROLES عند الترقية؛ القيمة الصريحة المخزَّنة تُحترم دائماً.
  for (const k of ACTION_KEYS) out[k] = p && p[k] === 'y' ? 'y' : 'n';
  return out;
}

module.exports = { hashPassword, verifyPassword, MODULES, KEYS, ACTIONS, ACTION_KEYS, LEVELS, BUILTIN_ROLES, cleanPerms };
