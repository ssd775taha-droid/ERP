// خادم الواجهة: Express + oracledb. شغّل: npm start (بعد npm run init في أول مرة).
const path = require('node:path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { createAuth } = require('./auth');

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
    catch { res.status(503).json({ ok: false }); }
  });

  app.post('/api/login', auth.login);
  app.post('/api/logout', auth.logout);
  app.get('/api/me', (req, res) => res.json({ user: req.user || null }));

  app.use('/api', auth.requireUser);
  app.use('/api', require('./routes/accounting')());
  app.use('/api', require('./routes/reports')());
  app.use('/api', require('./routes/periods')());
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

module.exports = { createApp };
