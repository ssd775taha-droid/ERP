// تشغيل محلي مع رابط عام عبر Cloudflare Tunnel: npm run share
// بلا إعداد: رابط مؤقت trycloudflare.com يتغيّر كل تشغيل.
// برابط ثابت (نطاقك): ضع رمز النفق في data/tunnel-token.txt أو في المتغير TUNNEL_TOKEN، ويُضبط اسم المضيف في لوحة Cloudflare.
// يتطلب تثبيت cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
// مشاركة عبر شبكة الواي فاي المحلية فقط (بلا إنترنت): أنشئ ملف data/lan.txt (أي محتوى) أو اضبط LAN=1.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const port = process.env.PORT || '3000';
const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');
const LOCAL_DB_URL = 'postgres://erp:erp@127.0.0.1:5432/erp';
// وضع الواي فاي: نربط الخادم بكل واجهات الشبكة بدل localhost فقط، ليصله أي جهاز على نفس الشبكة
const lanMode = process.env.LAN === '1' || fs.existsSync(path.join(dataDir, 'lan.txt'));
// بدون cloudflared (أو LOCAL_ONLY=1) تعمل المنصة على هذا الجهاز فقط عبر http://localhost
// وضع الواي فاي يوقف النفق العام: النفق يفرض كوكي مشفّرة (Secure) لا تعمل على رابط http العادي لعنوان الشبكة المحلية
const hasTunnel = !lanMode && process.env.LOCAL_ONLY !== '1' && !spawnSync('cloudflared', ['--version'], { stdio: 'ignore' }).error;

if (!hasTunnel && !lanMode) console.log('وضع محلي: المنصة على http://localhost:' + port + ' (للرابط العام ثبّت cloudflared)');
if (lanMode) {
  var lanIps = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) lanIps.push(a.address);
  }
  console.log('\nوضع مشاركة الواي فاي: أي جهاز على نفس شبكة الواي فاي يفتح أحد هذه الروابط:');
  if (lanIps.length) lanIps.forEach((ip) => console.log('  http://' + ip + ':' + port)); else console.log('  (تعذّر العثور على عنوان الشبكة؛ تأكد من اتصالك بالواي فاي)');
  console.log('يعمل فقط لمن هو على نفس شبكة الواي فاي، ويتوقف إن أغلقت هذا الجهاز.\n');
}

// بدون DATABASE_URL نشغّل قاعدة بيانات PostgreSQL محلية عبر Docker (تتطلب تثبيت Docker Desktop)
function dockerComposeCmd(args) {
  let r = spawnSync('docker', ['compose', ...args], { cwd: root, stdio: 'inherit' });
  if (r.error) r = spawnSync('docker-compose', args, { cwd: root, stdio: 'inherit' });
  return r;
}
function waitForDb(tries = 30) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const c = net.connect({ port: 5432, host: '127.0.0.1' });
      c.once('connect', () => { c.destroy(); resolve(); });
      c.once('error', () => {
        c.destroy();
        if (n <= 0) return reject(new Error('تعذّر الاتصال بقاعدة البيانات المحلية بعد المحاولات'));
        setTimeout(() => attempt(n - 1), 1000);
      });
    };
    attempt(tries);
  });
}
async function ensureLocalDatabase() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  console.log('لا يوجد DATABASE_URL: يتم تشغيل قاعدة بيانات PostgreSQL محلية عبر Docker...');
  const r = dockerComposeCmd(['up', '-d', 'db']);
  if (r.error || r.status !== 0) {
    console.error('تعذّر تشغيل قاعدة البيانات المحلية. ثبّت Docker Desktop (https://www.docker.com/products/docker-desktop/) وشغّله، ثم أعد المحاولة.');
    process.exit(4);
  }
  await waitForDb();
  return LOCAL_DB_URL;
}

const env = { ...process.env, PORT: port, COOKIE_SECURE: hasTunnel ? '1' : '0', TRUST_PROXY: hasTunnel ? '1' : '0', HOST: lanMode ? '0.0.0.0' : '127.0.0.1' };

// نتأكد أن المنفذ فارغ: نسخة قديمة عالقة تعني أن المتصفح والنفق قد يصلان إلى قاعدتي بيانات مختلفتين
function portBusy(host) {
  return new Promise((resolve) => {
    const c = net.connect({ port: Number(port), host });
    c.once('connect', () => { c.destroy(); resolve(true); });
    c.once('error', () => resolve(false));
  });
}

let token = (process.env.TUNNEL_TOKEN || '').trim();
if (!token) {
  try { token = fs.readFileSync(path.join(dataDir, 'tunnel-token.txt'), 'utf8').trim(); } catch { /* لا رمز: نفق مؤقت */ }
}

async function main() {
if ((await portBusy('127.0.0.1')) || (await portBusy('::1'))) {
  console.error(`المنفذ ${port} مشغول بنسخة أخرى من المنصة. أغلقها أولًا (taskkill /f /im node.exe /im cloudflared.exe) ثم أعد التشغيل.`);
  process.exit(3);
}
env.DATABASE_URL = await ensureLocalDatabase();
let stopping = false;
const app = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: 'inherit' });

function startTunnel() {
  const args = token
    ? ['tunnel', '--no-autoupdate', '--protocol', 'http2', 'run', '--token', token]
    : ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`];
  const t = spawn('cloudflared', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let shown = false;
  t.stderr.on('data', (d) => {
    const s = String(d);
    // نطبع أخطاء النفق ليظهر سببها في data\\server.log
    if (/\bERR\b|error|failed/i.test(s)) console.error('[cloudflared] ' + s.trim().split('\n').slice(-2).join(' | '));
    if (token) {
      if (!shown && /Registered tunnel connection/.test(s)) { shown = true; console.log('\nالنفق متصل: الموقع متاح على النطاق الذي ضبطته في Cloudflare.\n'); }
      return;
    }
    const m = !shown && s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) {
      shown = true;
      console.log(`\nالرابط العام: ${m[0]}\n(يتغيّر في كل تشغيل، ويعمل ما دام هذا الجهاز وهذه النافذة شغّالين)\n`);
      try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(path.join(dataDir, 'public-url.txt'), m[0] + '\n'); } catch { /* غير حرج */ }
    }
  });
  // إن انقطع النفق (إنترنت أو سكون) نعيد تشغيله بدل إنهاء الخدمة
  t.on('exit', () => { if (!stopping) setTimeout(startTunnel, 5000); });
  return t;
}

let tunnel = hasTunnel ? startTunnel() : null;
const stop = () => { stopping = true; app.kill(); if (tunnel) tunnel.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
app.on('exit', stop);
}
main();
