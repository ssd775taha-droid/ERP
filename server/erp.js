// المحاسبة العامة: دليل حسابات وقيود يومية مزدوجة. المبالغ أعداد صحيحة بأصغر وحدة (هللة/قرش) لتفادي أخطاء الفاصلة العائمة.
const { httpError } = require('./store');

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];
// الجانب الطبيعي لرصيد كل نوع: أصول ومصروفات مدينة، والباقي دائن
const DEBIT_NATURE = new Set(['asset', 'expense']);

const DEFAULT_ACCOUNTS = [
  ['1000', 'الأصول', 'asset', null], ['1100', 'النقدية بالصندوق', 'asset', '1000'], ['1200', 'البنوك', 'asset', '1000'],
  ['1300', 'العملاء (ذمم مدينة)', 'asset', '1000'], ['1400', 'المخزون', 'asset', '1000'], ['1500', 'الأصول الثابتة', 'asset', '1000'],
  ['2000', 'الخصوم', 'liability', null], ['2100', 'الموردون (ذمم دائنة)', 'liability', '2000'], ['2200', 'ضريبة القيمة المضافة', 'liability', '2000'],
  ['2300', 'رواتب مستحقة', 'liability', '2000'],
  ['3000', 'حقوق الملكية', 'equity', null], ['3100', 'رأس المال', 'equity', '3000'], ['3200', 'الأرباح المحتجزة', 'equity', '3000'],
  ['4000', 'الإيرادات', 'revenue', null], ['4100', 'إيرادات المبيعات', 'revenue', '4000'], ['4200', 'إيرادات الخدمات', 'revenue', '4000'],
  ['5000', 'المصروفات', 'expense', null], ['5100', 'تكلفة البضاعة المباعة', 'expense', '5000'], ['5200', 'الرواتب والأجور', 'expense', '5000'],
  ['5300', 'الإيجار', 'expense', '5000'], ['5400', 'مصروفات عمومية', 'expense', '5000'],
];

const toMinor = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw httpError(400, 'مبلغ غير صالح');
  return Math.round(n * 100);
};
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

class Ledger {
  constructor(db) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS erp_accounts (
        code TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, parent TEXT,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS erp_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '',
        ref TEXT NOT NULL DEFAULT '', user_id TEXT NOT NULL, created INTEGER NOT NULL,
        void_of INTEGER REFERENCES erp_entries(id)
      );
      CREATE TABLE IF NOT EXISTS erp_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES erp_entries(id) ON DELETE CASCADE,
        account TEXT NOT NULL REFERENCES erp_accounts(code), debit INTEGER NOT NULL DEFAULT 0,
        credit INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
        CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))
      );
      CREATE INDEX IF NOT EXISTS erp_lines_account ON erp_lines(account);
      CREATE INDEX IF NOT EXISTS erp_entries_date ON erp_entries(date);
    `);
  }

  // معاملة قابلة للتداخل: الداخلية تنضم إلى الخارجية، فتفشل الفاتورة وقيدها أو تنجحان معاً
  tx(fn) {
    if (this.inTx) return fn();
    this.db.exec('BEGIN');
    this.inTx = true;
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } finally { this.inTx = false; }
  }

  seedDefaults() {
    if (this.db.prepare('SELECT COUNT(*) n FROM erp_accounts').get().n) throw httpError(409, 'دليل الحسابات موجود مسبقاً');
    const ins = this.db.prepare('INSERT INTO erp_accounts (code, name, type, parent) VALUES (?, ?, ?, ?)');
    this.tx(() => DEFAULT_ACCOUNTS.forEach((a) => ins.run(...a)));
    return DEFAULT_ACCOUNTS.length;
  }

  accounts() {
    return this.db.prepare('SELECT code, name, type, parent, active FROM erp_accounts ORDER BY code').all();
  }

  addAccount({ code, name, type, parent }) {
    code = String(code || '').trim();
    name = String(name || '').trim();
    if (!/^[0-9A-Za-z.-]{1,12}$/.test(code)) throw httpError(400, 'رمز الحساب غير صالح');
    if (!name || name.length > 120) throw httpError(400, 'اسم الحساب مطلوب');
    if (!TYPES.includes(type)) throw httpError(400, 'نوع الحساب غير صالح');
    parent = parent ? String(parent) : null;
    if (parent) {
      const p = this.db.prepare('SELECT type FROM erp_accounts WHERE code = ?').get(parent);
      if (!p) throw httpError(400, 'الحساب الأب غير موجود');
      if (p.type !== type) throw httpError(400, 'نوع الحساب يجب أن يطابق نوع الحساب الأب');
    }
    if (this.db.prepare('SELECT 1 FROM erp_accounts WHERE code = ?').get(code)) throw httpError(409, 'رمز الحساب مستخدم');
    this.db.prepare('INSERT INTO erp_accounts (code, name, type, parent) VALUES (?, ?, ?, ?)').run(code, name, type, parent);
    return { code, name, type, parent, active: 1 };
  }

  // حساب «تجميعي» له أبناء لا يقبل الترحيل المباشر
  isLeaf(code) {
    return !this.db.prepare('SELECT 1 FROM erp_accounts WHERE parent = ?').get(code);
  }

  post({ date, memo, ref, lines }, userId) {
    if (!isDate(date)) throw httpError(400, 'تاريخ القيد غير صالح');
    if (!Array.isArray(lines) || lines.length < 2 || lines.length > 200) throw httpError(400, 'القيد يحتاج سطرين على الأقل');
    const rows = lines.map((l) => {
      const debit = toMinor(l.debit || 0);
      const credit = toMinor(l.credit || 0);
      if ((debit > 0) === (credit > 0)) throw httpError(400, 'كل سطر إما مدين وإما دائن (بمبلغ أكبر من صفر)');
      const acc = this.db.prepare('SELECT active FROM erp_accounts WHERE code = ?').get(String(l.account));
      if (!acc) throw httpError(400, `الحساب ${l.account} غير موجود`);
      if (!acc.active) throw httpError(400, `الحساب ${l.account} موقوف`);
      if (!this.isLeaf(String(l.account))) throw httpError(400, `الحساب ${l.account} تجميعي ولا يقبل الترحيل`);
      return { account: String(l.account), debit, credit, note: String(l.note || '').slice(0, 200) };
    });
    const dr = rows.reduce((s, r) => s + r.debit, 0);
    const cr = rows.reduce((s, r) => s + r.credit, 0);
    if (dr !== cr) throw httpError(400, 'القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن');
    return this.tx(() => {
      const e = this.db.prepare('INSERT INTO erp_entries (date, memo, ref, user_id, created) VALUES (?, ?, ?, ?, ?)')
        .run(date, String(memo || '').slice(0, 300), String(ref || '').slice(0, 60), userId, Date.now());
      const id = Number(e.lastInsertRowid);
      const ins = this.db.prepare('INSERT INTO erp_lines (entry_id, account, debit, credit, note) VALUES (?, ?, ?, ?, ?)');
      rows.forEach((r) => ins.run(id, r.account, r.debit, r.credit, r.note));
      return this.entry(id);
    });
  }

  // لا حذف للقيود: العكس يُنشئ قيداً مقابلاً مرتبطاً بالأصل
  reverse(id, userId, date) {
    const orig = this.entry(id);
    if (!orig) throw httpError(404, 'القيد غير موجود');
    if (orig.void_of) throw httpError(400, 'لا يُعكس قيد عكسي');
    if (this.db.prepare('SELECT 1 FROM erp_entries WHERE void_of = ?').get(id)) throw httpError(409, 'القيد معكوس مسبقاً');
    return this.tx(() => {
      const e = this.db.prepare('INSERT INTO erp_entries (date, memo, ref, user_id, created, void_of) VALUES (?, ?, ?, ?, ?, ?)')
        .run(isDate(date) ? date : orig.date, `عكس القيد رقم ${id}`, orig.ref, userId, Date.now(), id);
      const nid = Number(e.lastInsertRowid);
      const ins = this.db.prepare('INSERT INTO erp_lines (entry_id, account, debit, credit, note) VALUES (?, ?, ?, ?, ?)');
      orig.lines.forEach((l) => ins.run(nid, l.account, l.credit, l.debit, l.note));
      return this.entry(nid);
    });
  }

  entry(id) {
    const e = this.db.prepare('SELECT id, date, memo, ref, user_id, created, void_of FROM erp_entries WHERE id = ?').get(id);
    if (!e) return null;
    e.lines = this.db.prepare('SELECT account, debit, credit, note FROM erp_lines WHERE entry_id = ? ORDER BY id').all(id);
    return e;
  }

  entries({ from, to, account, limit = 100 } = {}) {
    const w = []; const a = [];
    if (from) { w.push('e.date >= ?'); a.push(from); }
    if (to) { w.push('e.date <= ?'); a.push(to); }
    if (account) { w.push('EXISTS (SELECT 1 FROM erp_lines l WHERE l.entry_id = e.id AND l.account = ?)'); a.push(String(account)); }
    const ids = this.db.prepare(`SELECT e.id FROM erp_entries e ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY e.date DESC, e.id DESC LIMIT ?`)
      .all(...a, Math.min(Math.max(Number(limit) || 100, 1), 500));
    return ids.map((r) => this.entry(r.id));
  }

  trialBalance({ to } = {}) {
    const rows = this.db.prepare(`
      SELECT a.code, a.name, a.type, COALESCE(SUM(l.debit), 0) debit, COALESCE(SUM(l.credit), 0) credit
      FROM erp_accounts a
      LEFT JOIN erp_lines l ON l.account = a.code
      LEFT JOIN erp_entries e ON e.id = l.entry_id AND (? IS NULL OR e.date <= ?)
      WHERE l.id IS NULL OR e.id IS NOT NULL
      GROUP BY a.code ORDER BY a.code`).all(to || null, to || null)
      .filter((r) => r.debit || r.credit)
      .map((r) => {
        const net = r.debit - r.credit;
        return { ...r, balance_debit: net > 0 ? net : 0, balance_credit: net < 0 ? -net : 0 };
      });
    const totals = rows.reduce((t, r) => ({ debit: t.debit + r.debit, credit: t.credit + r.credit,
      balance_debit: t.balance_debit + r.balance_debit, balance_credit: t.balance_credit + r.balance_credit }),
    { debit: 0, credit: 0, balance_debit: 0, balance_credit: 0 });
    return { rows, totals, balanced: totals.debit === totals.credit };
  }

  // دفتر الأستاذ لحساب: حركات مرتبة برصيد جارٍ بالجانب الطبيعي للحساب
  ledger(code, { from, to } = {}) {
    const acc = this.db.prepare('SELECT code, name, type FROM erp_accounts WHERE code = ?').get(String(code));
    if (!acc) throw httpError(404, 'الحساب غير موجود');
    const sign = DEBIT_NATURE.has(acc.type) ? 1 : -1;
    const open = from
      ? this.db.prepare(`SELECT COALESCE(SUM(l.debit - l.credit), 0) v FROM erp_lines l JOIN erp_entries e ON e.id = l.entry_id
          WHERE l.account = ? AND e.date < ?`).get(acc.code, from).v * sign
      : 0;
    const moves = this.db.prepare(`SELECT e.id entry_id, e.date, e.memo, e.ref, l.debit, l.credit, l.note
      FROM erp_lines l JOIN erp_entries e ON e.id = l.entry_id
      WHERE l.account = ? AND (? IS NULL OR e.date >= ?) AND (? IS NULL OR e.date <= ?)
      ORDER BY e.date, e.id, l.id`).all(acc.code, from || null, from || null, to || null, to || null);
    let run = open;
    const rows = moves.map((m) => { run += (m.debit - m.credit) * sign; return { ...m, balance: run }; });
    return { account: acc, opening: open, rows, closing: run };
  }
}

module.exports = { Ledger, TYPES, toMinor, isDate };
