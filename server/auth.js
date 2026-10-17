const crypto = require('node:crypto');
const { httpError } = require('./store');

const SESSION_MS = 12 * 3600 * 1000;
const scrypt = (pw, salt) => new Promise((res, rej) =>
  crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `s1$${salt.toString('hex')}$${(await scrypt(pw, salt)).toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [v, salt, hash] = String(stored).split('$');
  if (v !== 's1' || !salt || !hash) return false;
  const k = await scrypt(pw, Buffer.from(salt, 'hex'));
  const h = Buffer.from(hash, 'hex');
  return h.length === k.length && crypto.timingSafeEqual(h, k);
}

class Auth {
  constructor(store) {
    this.s = store;
    this.fails = new Map();
  }
  userCount() {
    return this.s.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  }
  publicUser(u) {
    return { id: u.id, username: u.username, name: u.name, role: u.role, active: !!u.active };
  }
  async createUser({ username, name, password, role }) {
    username = String(username || '').trim().toLowerCase();
    name = String(name || '').trim();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw httpError(400, 'اسم المستخدم: 3 إلى 32 حرفاً إنجليزياً أو أرقاماً');
    if (!name) throw httpError(400, 'الاسم مطلوب');
    if (String(password || '').length < 8) throw httpError(400, 'كلمة المرور 8 أحرف على الأقل');
    if (!['owner', 'member'].includes(role)) throw httpError(400, 'دور غير صالح');
    if (this.s.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw httpError(409, 'اسم المستخدم مستخدم مسبقاً');
    const id = crypto.randomUUID();
    this.s.db.prepare('INSERT INTO users (id, username, name, role, pass, active, created) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(id, username, name, role, await hashPassword(password), Date.now());
    return id;
  }
  throttle(key) {
    const f = this.fails.get(key);
    if (f && f.n >= 5 && Date.now() - f.t < 15 * 60000) throw httpError(429, 'محاولات كثيرة، حاول بعد 15 دقيقة');
  }
  async login(username, password, ip) {
    const key = `${ip}|${String(username).toLowerCase()}`;
    this.throttle(key);
    const u = this.s.db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim().toLowerCase());
    // نتحقق دائماً لتفادي كشف وجود المستخدم من زمن الاستجابة
    const ok = await verifyPassword(String(password || ''), u ? u.pass : 's1$00$00');
    if (!u || !ok || !u.active) {
      const f = this.fails.get(key) || { n: 0, t: 0 };
      this.fails.set(key, { n: f.n + 1, t: Date.now() });
      throw httpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
    }
    this.fails.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    this.s.db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').run(token, u.id, Date.now() + SESSION_MS);
    return { token, user: this.publicUser(u) };
  }
  logout(token) {
    this.s.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  fromToken(token) {
    if (!token) return null;
    this.s.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    const u = this.s.db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND u.active = 1`).get(token);
    if (!u) return null;
    this.s.db.prepare('UPDATE sessions SET expires = ? WHERE token = ?').run(Date.now() + SESSION_MS, token);
    return this.publicUser(u);
  }
  list() {
    return this.s.db.prepare('SELECT * FROM users ORDER BY created').all().map((u) => this.publicUser(u));
  }
  async patch(id, { name, password, role, active }) {
    const u = this.s.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw httpError(404, 'المستخدم غير موجود');
    const next = { name: name ?? u.name, role: role ?? u.role, active: active == null ? u.active : active ? 1 : 0, pass: u.pass };
    if (!['owner', 'member'].includes(next.role)) throw httpError(400, 'دور غير صالح');
    if (password != null) {
      if (String(password).length < 8) throw httpError(400, 'كلمة المرور 8 أحرف على الأقل');
      next.pass = await hashPassword(password);
    }
    const owners = this.s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND id != ?").get(id).n;
    if (!owners && (next.role !== 'owner' || !next.active)) throw httpError(400, 'يجب أن يبقى مالك فعّال واحد على الأقل');
    this.s.db.prepare('UPDATE users SET name = ?, role = ?, active = ?, pass = ? WHERE id = ?').run(next.name, next.role, next.active, next.pass, id);
    if (password != null || !next.active) this.s.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
}

module.exports = { Auth };
