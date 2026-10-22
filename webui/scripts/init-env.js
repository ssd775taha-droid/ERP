// ينشئ webui/.env: كلمة سر القاعدة من oracle/local/.env (التثبيت المحلي) أو من المتغير ERP_DB_PASSWORD،
// ويولّد كلمة سر الدخول وسر توقيع الجلسة. لا يستبدل ملفاً موجوداً إلا مع --force.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && !process.argv.includes('--force')) {
  console.log('الملف .env موجود. استخدم --force لإعادة إنشائه (يغيّر كلمة سر الدخول).');
  process.exit(0);
}

function readDbPassword() {
  if (process.env.ERP_DB_PASSWORD) return process.env.ERP_DB_PASSWORD;
  for (const f of ['../../oracle/local/.env', '../../oracle/local/.env-xe']) {
    try {
      const t = fs.readFileSync(path.join(__dirname, f), 'utf8');
      const m = /^ERP_DB_PASSWORD=(.+)$/m.exec(t);
      if (m) return m[1].trim();
    } catch { /* غير موجود */ }
  }
  return '';
}

const dbPassword = readDbPassword();
const webPassword = crypto.randomBytes(9).toString('base64url');
const secret = crypto.randomBytes(32).toString('hex');
const connect = process.env.ERP_DB_CONNECT || 'localhost:1521/XEPDB1';

const lines = [
  '# إعدادات واجهة ERP (لا ترفع هذا الملف إلى git)',
  'ERP_DB_USER=erp_owner',
  `ERP_DB_PASSWORD=${dbPassword}`,
  `ERP_DB_CONNECT=${connect}`,
  'ERP_WEB_PORT=3001',
  'ERP_WEB_USER=admin',
  `ERP_WEB_PASSWORD=${webPassword}`,
  `ERP_WEB_SECRET=${secret}`,
  '',
];
fs.writeFileSync(envFile, lines.join('\n'), { mode: 0o600 });
console.log('أُنشئ الملف webui/.env');
console.log(`  رابط الواجهة : http://localhost:3001`);
console.log(`  المستخدم     : admin`);
console.log(`  كلمة السر    : ${webPassword}`);
if (!dbPassword) {
  console.log('\nتنبيه: لم أجد كلمة سر قاعدة البيانات. ضعها في webui/.env في السطر ERP_DB_PASSWORD=');
}
