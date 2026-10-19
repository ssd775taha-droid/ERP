// تسجيل دخول بمستخدم واحد (ERP_WEB_USER/ERP_WEB_PASSWORD) وجلسة بكعكة موقَّعة HMAC.
// تنبيه: الواجهة كلها تتصل بالقاعدة بمستخدم Oracle واحد (erp_owner)، فلا فصل مهام بين مستخدمي الواجهة.
const crypto = require('node:crypto');
const { HttpError } = require('./db');

const COOKIE = 'erp_sid';
const TTL_MS = 12 * 3600 * 1000;

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function sign(secret, payload) { return crypto.createHmac('sha256', secret).update(payload).digest('base64url'); }
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

  function issue(user) {
    const payload = b64u(JSON.stringify({ u: user, exp: Date.now() + TTL_MS }));
    return `${payload}.${sign(cfg.secret, payload)}`;
  }
  function verify(token) {
    if (!token) return null;
    const [payload, sig] = String(token).split('.');
    if (!payload || !sig || !safeEqual(sig, sign(cfg.secret, payload))) return null;
    try {
      const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return d.exp > Date.now() ? d.u : null;
    } catch { return null; }
  }
  const cookieAttrs = (maxAge) =>
    `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${cfg.cookieSecure ? '; Secure' : ''}`;

  return {
    attachUser(req, res, next) {
      req.user = verify(parseCookies(req.headers.cookie)[COOKIE]);
      next();
    },
    requireUser(req, res, next) {
      if (req.user) return next();
      next(new HttpError(401, 'يلزم تسجيل الدخول'));
    },
    login(req, res, next) {
      const ip = req.ip;
      const f = fails.get(ip);
      if (f && f.n >= 5 && f.until > Date.now()) return next(new HttpError(429, 'محاولات كثيرة. حاول بعد دقائق'));
      const body = req.body || {};
      // المسافات حول القيم (شائعة عند اللصق) تُتجاهل
      const username = typeof body.username === 'string' ? body.username.trim() : null;
      const password = typeof body.password === 'string' ? body.password.trim() : null;
      if (username !== null && password !== null
          && safeEqual(username, cfg.webUser.trim()) && safeEqual(password, cfg.webPassword.trim())) {
        fails.delete(ip);
        res.set('Set-Cookie', `${COOKIE}=${issue(cfg.webUser)}; ${cookieAttrs(TTL_MS / 1000)}`);
        return res.json({ user: cfg.webUser });
      }
      fails.set(ip, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 10 * 60 * 1000 });
      next(new HttpError(401, 'اسم المستخدم أو كلمة السر غير صحيحة'));
    },
    logout(req, res) {
      res.set('Set-Cookie', `${COOKIE}=; ${cookieAttrs(0)}`);
      res.json({ ok: true });
    },
  };
}

module.exports = { createAuth };
