// الإعدادات من متغيرات البيئة، ويُحمَّل ملف webui/.env إن وُجد (دون استبدال متغير مضبوط مسبقاً).
const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function load(envFile = path.join(__dirname, '..', '.env')) {
  loadEnvFile(envFile);
  const e = process.env;
  return {
    dbUser: e.ERP_DB_USER || 'erp_owner',
    dbPassword: e.ERP_DB_PASSWORD || '',
    dbConnect: e.ERP_DB_CONNECT || 'localhost:1521/XEPDB1',
    port: Number(e.ERP_WEB_PORT) || 3001,
    host: e.ERP_WEB_HOST || '127.0.0.1',
    webUser: e.ERP_WEB_USER || 'admin',
    webPassword: e.ERP_WEB_PASSWORD || '',
    secret: e.ERP_WEB_SECRET || '',
    cookieSecure: e.ERP_COOKIE_SECURE === '1',
    poolMax: Number(e.ERP_POOL_MAX) || 4,
  };
}

module.exports = { load };
