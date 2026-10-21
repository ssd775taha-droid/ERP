// لوحة تحكم السيرفر (برنامج سطح مكتب): حالة قاعدة البيانات والواجهة، التشغيل والإيقاف، العناوين لأجهزة العميل، كلمة السر، النسخ الاحتياطي.
// الخدمات نفسها تعمل في Docker (حاويتا erp-oracle وerp-web) ولا تتوقف بإغلاق اللوحة.
const { app, BrowserWindow, ipcMain, clipboard, shell, dialog } = require('electron');
const { execFile, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');

app.setName('erp-server');
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

// مجلد التثبيت: اللوحة في «panel» داخله بجوار oracle وwebui والسكربتات
const root = process.env.ERP_ROOT || path.resolve(path.dirname(process.execPath), '..');
const DB = 'erp-oracle', WEB = 'erp-web', PORT = 3001, RULE = 'ERP Server 3001';
let win = null;

const run = (cmd, args, ms = 15000) => new Promise((res) => execFile(cmd, args, { timeout: ms, windowsHide: true }, (err, out) => res({ ok: !err, out: String(out || '').trim() })));
const health = () => new Promise((res) => {
  const r = http.get({ host: '127.0.0.1', port: PORT, path: '/healthz', timeout: 3000 }, (x) => { x.resume(); res(x.statusCode === 200); });
  r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); });
});
const running = async (name) => (await run('docker', ['inspect', '-f', '{{.State.Running}}', name])).out === 'true';
// بطاقات الشبكة الافتراضية (Docker وWSL وHyper-V…) لا تصلح عنواناً للأجهزة الأخرى فتُستبعد
const VIRTUAL = /vEthernet|WSL|Docker|docker|veth|br-|virbr|VirtualBox|VMware|Hyper-V|Loopback/;
const addresses = () => Object.entries(os.networkInterfaces()).filter(([n]) => !VIRTUAL.test(n)).flatMap(([, l]) => l)
  .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')).map((i) => `http://${i.address}:${PORT}`);
const envVal = (k) => { try { const l = fs.readFileSync(path.join(root, 'webui', '.env-docker'), 'utf8').split(/\r?\n/).find((x) => x.startsWith(k + '=')); return l ? l.slice(k.length + 1).trim() : ''; } catch (e) { return ''; } };
const script = (f) => path.join(root, f);
// يفتح سكربت PowerShell في نافذة ظاهرة (للتثبيت والنسخ الاحتياطي ليرى المستخدم التقدم)
const console_ = (f) => spawn('cmd.exe', ['/c', 'start', '', 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script(f)], { detached: true, stdio: 'ignore', windowsHide: false }).unref();

ipcMain.handle('status', async () => {
  const docker = (await run('docker', ['version', '--format', '{{.Server.Version}}'])).ok;
  const [db, web, ok, fw] = await Promise.all([docker ? running(DB) : false, docker ? running(WEB) : false, health(),
    process.platform === 'win32' ? run('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${RULE}`]).then((r) => r.ok && /Enabled:\s+Yes/i.test(r.out)) : Promise.resolve(null)]);
  return { docker, db, web, healthy: ok, firewall: fw, addresses: addresses(), installed: fs.existsSync(path.join(root, 'webui', '.env-docker')), user: envVal('ERP_WEB_USER') || 'admin' };
});
ipcMain.handle('start', async () => { await run('docker', ['start', DB], 60000); await run('docker', ['start', WEB], 60000); return true; });
ipcMain.handle('stop', async () => {
  const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['إيقاف', 'إلغاء'], defaultId: 1, cancelId: 1, message: 'إيقاف النظام؟', detail: 'ستنقطع أجهزة العميل ونقاط البيع حتى تشغّله من جديد. البيانات محفوظة.' });
  if (r.response !== 0) return false;
  await run('docker', ['stop', WEB], 60000); await run('docker', ['stop', DB], 120000); return true;
});
ipcMain.handle('install', () => { console_('setup-all.ps1'); return true; });
ipcMain.handle('backup', () => { console_('backup-erp.ps1'); return true; });
ipcMain.handle('restore', () => { console_('restore-erp.ps1'); return true; });
ipcMain.handle('schedule', () => { console_('schedule-backup.ps1'); return true; });
ipcMain.handle('password', () => { const p = envVal('ERP_WEB_PASSWORD'); if (p) clipboard.writeText(p); return { user: envVal('ERP_WEB_USER') || 'admin', password: p }; });
ipcMain.handle('firewall', async () => {
  const cmd = `New-NetFirewallRule -DisplayName '${RULE}' -Direction Inbound -Protocol TCP -LocalPort ${PORT} -Action Allow -Profile Private,Domain | Out-Null`;
  await run('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -Command "${cmd.replace(/"/g, '\\"')}"'`], 120000);
  return true;
});
ipcMain.handle('copy', (_e, t) => { clipboard.writeText(String(t)); return true; });
ipcMain.handle('open-web', () => {
  const w = new BrowserWindow({ width: 1280, height: 800, autoHideMenuBar: true, title: 'ERP', icon: path.join(__dirname, 'icon.png'), webPreferences: { contextIsolation: true, sandbox: true } });
  w.maximize(); w.loadURL(`http://localhost:${PORT}/?mode=full`);
  return true;
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  win = new BrowserWindow({ width: 760, height: 720, autoHideMenuBar: true, title: 'ERP Server', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#efede8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
