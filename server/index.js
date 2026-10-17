const path = require('node:path');
const express = require('express');
const { Store, httpError } = require('./store');
const { Auth } = require('./auth');
const { schedule } = require('./backup');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OPEN = [/^\/healthz$/, /^\/favicon\.(svg|ico)$/, /^\/login\.(html|js)$/, /^\/vendor\/fonts(\.css|\/)/, /^\/api\/auth\//];

function cookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

function createApp({ dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'erp.sqlite'), secureCookie = process.env.COOKIE_SECURE === '1' } = {}) {
  if (dbFile !== ':memory:') require('node:fs').mkdirSync(path.dirname(dbFile), { recursive: true });
  const store = new Store(dbFile);
  const auth = new Auth(store);
  const app = express();
  const clients = new Set();
  const notify = (p) => { for (const c of clients) c.write(`data: ${JSON.stringify({ path: p })}\n\n`); };

  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === '1');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' });
    next();
  });
  app.use(express.json({ limit: '25mb' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) return next(httpError(415, 'يلزم JSON'));
    req.token = cookie(req, 'sid');
    req.user = auth.fromToken(req.token);
    next();
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const needUser = (req, res, next) => (req.user ? next() : next(httpError(401, 'يلزم تسجيل الدخول')));
  const needOwner = (req, res, next) => (req.user && req.user.role === 'owner' ? next() : next(httpError(403, 'للمالك فقط')));
  const setCookie = (res, token, maxAge) =>
    res.set('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`);

  app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

  app.get('/healthz', (req, res) => {
    store.db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });

  // ---- المصادقة ----
  app.get('/api/auth/state', (req, res) => res.json({ needsSetup: auth.userCount() === 0, user: req.user }));
  app.post('/api/auth/setup', wrap(async (req, res) => {
    if (auth.userCount()) throw httpError(403, 'تم الإعداد مسبقاً');
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
  app.post('/api/auth/logout', (req, res) => {
    if (req.token) auth.logout(req.token);
    setCookie(res, '', 0);
    res.json({ ok: true });
  });

  // ---- إدارة المستخدمين (للمالك) ----
  app.get('/api/admin/users', needOwner, (req, res) => res.json({ users: auth.list() }));
  app.post('/api/admin/users', needOwner, wrap(async (req, res) => {
    res.json({ id: await auth.createUser({ ...req.body, role: req.body.role || 'member' }) });
  }));
  app.patch('/api/admin/users/:id', needOwner, wrap(async (req, res) => {
    await auth.patch(req.params.id, req.body);
    res.json({ ok: true });
  }));

  // ---- قاعدة البيانات ----
  app.post('/api/db', needUser, (req, res) => {
    const { op, path: p, data, where, orderBy, limit } = req.body || {};
    switch (op) {
      case 'get': { const d = store.getDoc(p); return res.json({ exists: !!d, data: d }); }
      case 'set': notify(store.setDoc(p, data).path); return res.json({ ok: true });
      case 'update': notify(store.updateDoc(p, data).path); return res.json({ ok: true });
      case 'delete': notify(store.deleteDoc(p).path); return res.json({ ok: true });
      case 'add': { const d = store.addDoc(p, data); notify(d.path); return res.json({ id: d.id, path: d.path }); }
      case 'query': return res.json({ docs: store.query(p, { where, orderBy, limit }) });
      default: throw httpError(400, 'عملية غير معروفة');
    }
  });
  app.post('/api/profiles', needUser, (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 500).map(String) : [];
    const out = {};
    for (const u of auth.list()) if (ids.includes(u.id)) out[u.id] = { name: u.name, avatarUrl: '' };
    res.json({ profiles: out });
  });
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

  return { app, store, auth, close: () => { for (const c of clients) c.end(); store.close(); } };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { app, store } = createApp();
  const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'erp.sqlite');
  if (process.env.BACKUP !== '0') {
    schedule(store, process.env.BACKUP_DIR || path.join(path.dirname(file), 'backups'), { keep: Number(process.env.BACKUP_KEEP) || 14 });
  }
  app.listen(port, () => console.log(`تمام برو يعمل على http://localhost:${port}`));
}

module.exports = { createApp };
