// خادم الواجهة: Express + oracledb. شغّل: npm start (بعد npm run init في أول مرة).
const path = require('node:path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { createAuth } = require('./auth');
const { authorize, auditWrites } = require('./authz');
const { ensureSchema } = require('./migrate');

function createApp(cfg) {
  const auth = createAuth(cfg);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.ERP_TRUST_PROXY === '1');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  // حماية CSRF: الطلبات المعدِّلة تقبل JSON فقط (المتصفح لا يرسله عبر نموذج من موقع آخر دون CORS)
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) {
      return next(new db.HttpError(415, 'يلزم JSON'));
    }
    next();
  });
  app.use(auth.attachUser);

  app.get('/healthz', async (req, res) => {
    try { await db.query('SELECT 1 AS "x" FROM dual'); res.json({ ok: true }); }
    catch (e) { console.error('healthz:', String(e.message).split('\n')[0]); res.status(503).json({ ok: false }); }
  });

  const VERSION = require('../package.json').version;
  app.get('/api/version', (req, res) => res.json({ version: VERSION }));
  app.post('/api/login', auth.login);
  app.post('/api/logout', auth.logout);
  app.get('/api/me', (req, res) => {
    const u = req.user;
    res.json(u ? { user: u.username, fullName: u.fullName, role: u.role, roleName: u.roleName, perms: u.perms, isAdmin: u.isAdmin } : { user: null });
  });

  app.use('/api', auth.requireUser);
  app.use('/api', auditWrites(auth));
  app.use('/api', authorize);
  app.use('/api', require('./routes/admin')(auth));
  app.use('/api', require('./routes/accounting')());
  app.use('/api', require('./routes/reports')());
  app.use('/api', require('./routes/periods')());
  app.use('/api', require('./routes/trade')());
  app.use('/api', require('./routes/inventory')());
  app.use('/api', require('./routes/assets')());
  app.use('/api', require('./routes/hr')());
  app.use('/api', require('./routes/pos')());
  app.use('/api', require('./routes/docs')());
  app.use('/api', require('./routes/tax')());
  app.use('/api', (req, res, next) => next(new db.HttpError(404, 'غير موجود')));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const e = db.toHttpError(err);
    if (e.status >= 500) console.error(err);
    res.status(e.status).json({ error: e.message });
  });
  return app;
}

async function start() {
  const cfg = config.load();
  await db.init(cfg);
  await ensureSchema();
  const app = createApp(cfg);
  const server = app.listen(cfg.port, cfg.host, () => {
    console.log(`واجهة ERP تعمل على http://localhost:${cfg.port}  (قاعدة البيانات: ${cfg.dbConnect})`);
  });
  const stop = async () => { server.close(); await db.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) {
  start().catch((e) => { console.error('تعذّر التشغيل:', e.message); process.exit(1); });
}

module.exports = { createApp, ensureSchema };
