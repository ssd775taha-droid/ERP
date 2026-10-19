// تسجيل الدخول: مدير أساسي من الإعدادات (ERP_WEB_USER/ERP_WEB_PASSWORD) + مستخدمون في القاعدة (WEB_USERS) بأدوار وصلاحيات.
// الجلسة كعكة موقَّعة HMAC تحمل اسم المستخدم وبصمة كلمة سره (تغييرها يُسقط جلساته). تنبيه: الواجهة كلها تتصل بالقاعدة
// بمستخدم Oracle واحد (erp_owner)؛ الفصل بين المستخدمين على مستوى الواجهة والخادم فقط.
const crypto = require('node:crypto');
const db = require('./db');
const { HttpError } = db;
const { verifyPassword, KEYS, cleanPerms } = require('./security');

const COOKIE = 'erp_sid';
const TTL_MS = 12 * 3600 * 1000;
const CACHE_MS = 5000;

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function sign(secret, payload) { return crypto.createHmac('sha256', secret).update(payload).digest('base64url'); }
function sha(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

function createAuth(cfg) {
  if (!cfg.secret || !cfg.webPassword) throw new Error('ERP_WEB_SECRET وERP_WEB_PASSWORD مطلوبان. شغّل: npm run init');
  const fails = new Map(); // ip -> {n, until}
  const cache = new Map(); // username -> {at, user}
  const rootName = cfg.webUser.trim();
  const rootFp = sha(cfg.webPassword.trim()).slice(0, 10);

  const allW = Object.fromEntries(KEYS.map((k) => [k, 'w']));
  const rootUser = { username: rootName, fullName: 'المدير الأساسي', role: 'admin', roleName: 'مدير النظام', perms: allW, isAdmin: true, builtin: true, fp: rootFp };

  async function loadDbUser(username) {
    const rows = await db.query(`SELECT u.user_id AS "id", u.username AS "username", u.full_name AS "fullName", u.role_id AS "role", r.name AS "roleName", r.perms AS "perms",
        u.pw_hash AS "hash", u.active AS "active" FROM web_users u JOIN web_roles r ON r.role_id = u.role_id WHERE u.username = :u`, { u: username.toLowerCase() });
    if (!rows.length) return null;
    const x = rows[0];
    let perms; try { perms = cleanPerms(JSON.parse(x.perms)); } catch { perms = cleanPerms({}); }
    if (x.role === 'admin') perms = allW;
    return { id: x.id, username: x.username, fullName: x.fullName, role: x.role, roleName: x.roleName, perms, isAdmin: x.role === 'admin', builtin: false, active: x.active === 'Y', hash: x.hash, fp: sha(x.hash).slice(0, 10) };
  }

  async function resolveUser(username) {
    if (username === rootName) return rootUser;
    const hit = cache.get(username);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
    const user = await loadDbUser(username);
    cache.set(username, { at: Date.now(), user });
    return user;
  }

  function issue(user) {
    const payload = b64u(JSON.stringify({ u: user.username, f: user.fp, exp: Date.now() + TTL_MS }));
    return `${payload}.${sign(cfg.secret, payload)}`;
  }
  function verifyToken(token) {
    if (!token) return null;
    const [payload, sig] = String(token).split('.');
    if (!payload || !sig || !safeEqual(sig, sign(cfg.secret, payload))) return null;
    try {
      const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return d.exp > Date.now() ? d : null;
    } catch { return null; }
  }
  const cookieAttrs = (maxAge) => `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${cfg.cookieSecure ? '; Secure' : ''}`;

  function audit(username, action, status, ip) {
    db.run('INSERT INTO web_audit (username, action, status, ip) VALUES (:u, :a, :s, :i)', { u: (username || '').slice(0, 40), a: String(action).slice(0, 300), s: status, i: String(ip || '').slice(0, 60) })
      .catch((e) => console.error('audit:', String(e.message).split('\n')[0]));
  }

  return {
    audit,
    invalidate(username) { if (username) cache.delete(String(username).toLowerCase()); else cache.clear(); },
    async attachUser(req, res, next) {
      req.user = null;
      try {
        const d = verifyToken(parseCookies(req.headers.cookie)[COOKIE]);
        if (d) {
          const u = await resolveUser(d.u);
          if (u && u.fp === d.f && (u.builtin || u.active)) req.user = u;
        }
      } catch (e) { return next(e); }
      next();
    },
    requireUser(req, res, next) {
      if (req.user) return next();
      next(new HttpError(401, 'يلزم تسجيل الدخول'));
    },
    async login(req, res, next) {
      try {
        const ip = req.ip;
        const f = fails.get(ip);
        if (f && f.n >= 5 && f.until > Date.now()) return next(new HttpError(429, 'محاولات كثيرة. حاول بعد دقائق'));
        const body = req.body || {};
        // المسافات حول القيم (شائعة عند اللصق) تُتجاهل
        const username = typeof body.username === 'string' ? body.username.trim() : null;
        const password = typeof body.password === 'string' ? body.password.trim() : null;
        let user = null;
        if (username !== null && password !== null) {
          if (safeEqual(username, rootName) && safeEqual(password, cfg.webPassword.trim())) user = rootUser;
          else {
            const u = await loadDbUser(username);
            // التحقق يجري دائماً (حتى لو لم يوجد المستخدم) لتقليل الفرق الزمني
            const ok = verifyPassword(password, u ? u.hash : 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
            if (u && u.active && ok) user = u;
          }
        }
        if (user) {
          fails.delete(ip);
          if (!user.builtin) db.run('UPDATE web_users SET last_login = SYSTIMESTAMP WHERE user_id = :i', { i: user.id }).catch(() => {});
          audit(user.username, 'LOGIN', 200, ip);
          res.set('Set-Cookie', `${COOKIE}=${issue(user)}; ${cookieAttrs(TTL_MS / 1000)}`);
          return res.json({ user: user.username });
        }
        audit(username || '', 'LOGIN فاشل', 401, ip);
        fails.set(ip, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 10 * 60 * 1000 });
        next(new HttpError(401, 'اسم المستخدم أو كلمة السر غير صحيحة'));
      } catch (e) { next(e); }
    },
    logout(req, res) {
      res.set('Set-Cookie', `${COOKIE}=; ${cookieAttrs(0)}`);
      res.json({ ok: true });
    },
    rootName,
  };
}

module.exports = { createAuth };
