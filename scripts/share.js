// تشغيل محلي مع رابط عام مجاني عبر Cloudflare Tunnel: npm run share
// يتطلب تثبيت cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const port = process.env.PORT || '3000';
const env = { ...process.env, PORT: port, COOKIE_SECURE: '1', TRUST_PROXY: '1' };
const root = path.join(__dirname, '..');

const probe = spawnSync('cloudflared', ['--version'], { stdio: 'ignore' });
if (probe.error || probe.status !== 0) {
  console.error('cloudflared غير مثبّت. ثبّته أولًا (winget install Cloudflare.cloudflared على ويندوز، أو brew install cloudflared على ماك)، ثم أعد التشغيل.');
  process.exit(1);
}

const app = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: 'inherit' });
const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'ignore', 'pipe'] });

let shown = false;
tunnel.stderr.on('data', (d) => {
  const m = !shown && String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m) { shown = true; console.log(`\nالرابط العام: ${m[0]}\n(يتغيّر في كل تشغيل، ويعمل ما دام هذا الجهاز وهذه النافذة شغّالين)\n`); }
});

const stop = () => { app.kill(); tunnel.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
app.on('exit', stop);
tunnel.on('exit', stop);
