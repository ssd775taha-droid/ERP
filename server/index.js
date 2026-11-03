const path = require('node:path');
const express = require('express');
const { Store, httpError } = require('./store');
const { Auth } = require('./auth');
const { schedule } = require('./backup');
const { createAi } = require('./ai');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OPEN = [/^\/healthz$/, /^\/theme\.css$/, /^\/favicon\.(svg|ico)$/, /^\/login\.(html|js)$/, /^\/vendor\/fonts(\.css|\/)/, /^\/api\/auth\//, /^\/brand\//];

function cookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

async function createApp({ ai = createAi(), databaseUrl = process.env.DATABASE_URL, secureCookie = process.env.COOKIE_SECURE === '1' } = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URL غير مضبوط: يلزم رابط اتصال PostgreSQL');
  const store = await new Store(databaseUrl).init();
  const auth = new Auth(store);
  const app = express();
  const clients = new Set();
  const notify = (p) => { for (const c of clients) c.write(`data: ${JSON.stringify({ path: p })}\n\n`); };

  app.disable('x-powered-by');
  // خطوة وكيل واحدة فقط (الوكيل/النفق): نقرأ آخر عنوان في X-Forwarded-For فلا يستطيع المهاجم تزييف عنوانه لتجاوز تحديد المحاولات
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'Content-Security-Policy': "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
    });
    if (secureCookie) res.set('Strict-Transport-Security', 'max-age=15552000');
    // صفحات وبيانات المنصة خاصة: لا تُخزَّن في ذاكرة وسيطة
    if (!req.path.startsWith('/vendor/') && !req.path.startsWith('/brand/')) res.set('Cache-Control', 'no-store');
    next();
  });
  // قبل تسجيل الدخول: حجم صغير فقط، فلا يستطيع زائر مجهول إرسال 25 ميغابايت
  app.use('/api/auth', express.json({ limit: '10kb' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) return next(httpError(415, 'يلزم JSON'));
    // حماية CSRF: الطلبات المغيِّرة يجب أن تأتي من نفس الموقع
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
      let ok = false;
      try { ok = new URL(origin).host === req.headers.host; } catch { /* origin غير صالح */ }
      if (!ok) return next(httpError(403, 'طلب مرفوض (مصدر غير مطابق)'));
    }
    req.token = cookie(req, 'sid');
    auth.fromToken(req.token).then((u) => { req.user = u; next(); }, next);
  });
  // الحجم الكبير (حتى 25 ميغابايت) للمستخدمين المسجّلين فقط
  app.use((req, res, next) => (req.user ? express.json({ limit: '25mb' })(req, res, next) : next()));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const needUser = (req, res, next) => (req.user ? next() : next(httpError(401, 'يلزم تسجيل الدخول')));
  const needOwner = (req, res, next) => (req.user && req.user.role === 'owner' ? next() : next(httpError(403, 'للمالك فقط')));
  const setCookie = (res, token, maxAge) =>
    res.set('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`);

  app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

  app.get('/healthz', wrap(async (req, res) => {
    await store.pool.query('SELECT 1');
    res.json({ ok: true });
  }));

  // ---- المصادقة ----
  app.get('/api/auth/state', wrap(async (req, res) => res.json({ needsSetup: (await auth.userCount()) === 0, user: req.user })));
  app.post('/api/auth/setup', wrap(async (req, res) => {
    if (await auth.userCount()) throw httpError(403, 'تم الإعداد مسبقاً');
    await auth.createUser({ ...req.body, role: 'owner' });
    const { token, user } = await auth.login(req.body.username, req.body.password, req.ip);
    setCookie(res, token, 43200);
    res.json({ user });
  }));
  app.post('/api/auth/login', wrap(async (req, res) => {
    const { token, user } = await auth.login(req.body.username, req.body.password, req.ip);
    setCookie(res, token, 43200);
    res.json({ user });
  }));
  app.post('/api/auth/logout', wrap(async (req, res) => {
    if (req.token) await auth.logout(req.token);
    setCookie(res, '', 0);
    res.json({ ok: true });
  }));

  // ---- إدارة المستخدمين (للمالك) ----
  app.get('/api/admin/users', needOwner, wrap(async (req, res) => res.json({ users: await auth.list() })));
  app.post('/api/admin/users', needOwner, wrap(async (req, res) => {
    res.json({ id: await auth.createUser({ ...req.body, role: req.body.role || 'member' }) });
  }));
  app.patch('/api/admin/users/:id', needOwner, wrap(async (req, res) => {
    await auth.patch(req.params.id, req.body);
    res.json({ ok: true });
  }));

  // ---- قاعدة البيانات ----
  app.post('/api/db', needUser, wrap(async (req, res) => {
    const { op, path: p, data, where, orderBy, limit } = req.body || {};
    switch (op) {
      case 'get': { const d = await store.getDoc(p); return res.json({ exists: !!d, data: d }); }
      case 'set': notify((await store.setDoc(p, data)).path); return res.json({ ok: true });
      case 'update': notify((await store.updateDoc(p, data)).path); return res.json({ ok: true });
      case 'delete': notify((await store.deleteDoc(p)).path); return res.json({ ok: true });
      case 'add': { const d = await store.addDoc(p, data); notify(d.path); return res.json({ id: d.id, path: d.path }); }
      case 'query': return res.json({ docs: await store.query(p, { where, orderBy, limit }) });
      default: throw httpError(400, 'عملية غير معروفة');
    }
  }));
  app.post('/api/profiles', needUser, wrap(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 500).map(String) : [];
    const out = {};
    for (const u of await auth.list()) if (ids.includes(u.id)) out[u.id] = { name: u.name, avatarUrl: '' };
    res.json({ profiles: out });
  }));
  app.get('/api/ai/status', needUser, (req, res) => res.json({ enabled: ai.enabled() }));
  app.post('/api/ai', needUser, wrap(async (req, res) => {
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
    res.json(await ai.ask(req.user.id, req.body, ctl.signal));
  }));
  app.get('/api/events', needUser, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
  });

  // ---- الملفات الثابتة (محمية بالجلسة عدا صفحة الدخول) ----
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.user || OPEN.some((r) => r.test(req.path))) return next();
    if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'))) return res.redirect('/login.html');
    next(httpError(401, 'يلزم تسجيل الدخول'));
  });
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));

  app.use((req, res, next) => next(httpError(404, 'غير موجود')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'خطأ في الخادم' : err.message });
  });

  return { app, store, auth, close: async () => { for (const c of clients) c.end(); await store.close(); } };
}

if (require.main === module) {
  (async () => {
    const port = Number(process.env.PORT) || 3000;
    const { app, store } = await createApp();
    if (process.env.BACKUP !== '0') {
      schedule(store, process.env.BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups'), { keep: Number(process.env.BACKUP_KEEP) || 14 });
    }
    app.listen(port, process.env.HOST || undefined, () => console.log(`تمام برو يعمل على http://localhost:${port}`));
  })().catch((e) => { console.error('تعذّر بدء التشغيل:', e); process.exit(1); });
}

module.exports = { createApp };
