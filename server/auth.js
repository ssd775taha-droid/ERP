const crypto = require('node:crypto');
const { httpError } = require('./store');

const SESSION_MS = 12 * 3600 * 1000;
const MAX_PASSWORD = 200;
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
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
  async userCount() {
    const r = await this.s.pool.query('SELECT COUNT(*) AS n FROM users');
    return Number(r.rows[0].n);
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
    if (String(password).length > MAX_PASSWORD) throw httpError(400, 'كلمة المرور طويلة جداً');
    if (!['owner', 'member'].includes(role)) throw httpError(400, 'دور غير صالح');
    const exists = await this.s.pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (exists.rows.length) throw httpError(409, 'اسم المستخدم مستخدم مسبقاً');
    const id = crypto.randomUUID();
    await this.s.pool.query(
      'INSERT INTO users (id, username, name, role, pass, active, created) VALUES ($1, $2, $3, $4, $5, 1, $6)',
      [id, username, name, role, await hashPassword(password), Date.now()],
    );
    return id;
  }
  // يحدّ المحاولات الفاشلة: 5 لكل (عنوان+مستخدم)، و20 لكل مستخدم من أي عنوان، و30 لكل عنوان
  throttle(keys) {
    const now = Date.now();
    for (const [key, max] of keys) {
      const f = this.fails.get(key);
      if (f && now - f.t >= 15 * 60000) this.fails.delete(key);
      else if (f && f.n >= max) throw httpError(429, 'محاولات كثيرة، حاول بعد 15 دقيقة');
    }
    if (this.fails.size > 10000) for (const [k, f] of this.fails) if (now - f.t >= 15 * 60000) this.fails.delete(k);
  }
  async login(username, password, ip) {
    username = String(username ?? '');
    password = String(password ?? '');
    if (username.length > 64 || password.length > MAX_PASSWORD) throw httpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
    const uname = username.trim().toLowerCase();
    const keys = [[`${ip}|${uname}`, 5], [`user|${uname}`, 20], [`ip|${ip}`, 30]];
    this.throttle(keys);
    const r = await this.s.pool.query('SELECT * FROM users WHERE username = $1', [uname]);
    const u = r.rows[0];
    // نتحقق دائماً لتفادي كشف وجود المستخدم من زمن الاستجابة
    const ok = await verifyPassword(password, u ? u.pass : 's1$00$00');
    if (!u || !ok || !u.active) {
      for (const [key] of keys) {
        const f = this.fails.get(key) || { n: 0, t: 0 };
        this.fails.set(key, { n: f.n + 1, t: Date.now() });
      }
      throw httpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
    }
    this.fails.delete(keys[0][0]);
    const token = crypto.randomBytes(32).toString('hex');
    await this.s.pool.query('INSERT INTO sessions (token, user_id, expires) VALUES ($1, $2, $3)', [sha(token), u.id, Date.now() + SESSION_MS]);
    return { token, user: this.publicUser(u) };
  }
  async logout(token) {
    await this.s.pool.query('DELETE FROM sessions WHERE token = $1', [sha(token)]);
  }
  async fromToken(token) {
    if (!token) return null;
    await this.s.pool.query('DELETE FROM sessions WHERE expires < $1', [Date.now()]);
    const r = await this.s.pool.query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND u.active = 1`,
      [sha(token)],
    );
    const u = r.rows[0];
    if (!u) return null;
    await this.s.pool.query('UPDATE sessions SET expires = $1 WHERE token = $2', [Date.now() + SESSION_MS, sha(token)]);
    return this.publicUser(u);
  }
  async list() {
    const r = await this.s.pool.query('SELECT * FROM users ORDER BY created');
    return r.rows.map((u) => this.publicUser(u));
  }
  async patch(id, { name, password, role, active }) {
    const r = await this.s.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    const u = r.rows[0];
    if (!u) throw httpError(404, 'المستخدم غير موجود');
    const next = { name: name ?? u.name, role: role ?? u.role, active: active == null ? u.active : active ? 1 : 0, pass: u.pass };
    if (!['owner', 'member'].includes(next.role)) throw httpError(400, 'دور غير صالح');
    if (password != null) {
      if (String(password).length < 8) throw httpError(400, 'كلمة المرور 8 أحرف على الأقل');
      if (String(password).length > MAX_PASSWORD) throw httpError(400, 'كلمة المرور طويلة جداً');
      next.pass = await hashPassword(password);
    }
    const ownersR = await this.s.pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND id != $1", [id]);
    const owners = Number(ownersR.rows[0].n);
    if (!owners && (next.role !== 'owner' || !next.active)) throw httpError(400, 'يجب أن يبقى مالك فعّال واحد على الأقل');
    await this.s.pool.query('UPDATE users SET name = $1, role = $2, active = $3, pass = $4 WHERE id = $5', [next.name, next.role, next.active, next.pass, id]);
    if (password != null || !next.active) await this.s.pool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  }
}

module.exports = { Auth };
