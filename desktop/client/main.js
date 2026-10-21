// برنامج سطح المكتب للعميل ونقطة البيع: نافذة تطبيق تعرض واجهة السيرفر (لا قاعدة بيانات محلية).
// product.json يحدد النمط: client (النظام كاملاً حسب الصلاحيات) أو pos (شاشة البيع فقط).
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const product = require('./product.json');

app.setName(product.id);
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const exeDir = path.dirname(process.execPath);
let cfg = { server: '', silent: false, fromInstaller: '' };
let win = null;

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
function save() { try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(cfg)); } catch (e) { /* قرص للقراءة فقط */ } }

// يقبل 192.168.1.10 أو 192.168.1.10:3001 أو http://… ويعيد http://host:port
function normalize(a) {
  a = String(a || '').replace(/\s/g, '').replace(/\/+$/, '');
  if (!a) return '';
  if (!/^https?:\/\//i.test(a)) a = 'http://' + a;
  if (!/:\d+$/.test(a)) a += ':3001';
  try { return new URL(a).origin; } catch (e) { return ''; }
}

function loadConfig() {
  Object.assign(cfg, readJson(cfgFile()) || {});
  // عنوان كتبه المثبّت (server.txt بجوار البرنامج) يتقدم إن تغيّر عن آخر عنوان أخذناه منه
  let inst = '';
  try { inst = normalize(fs.readFileSync(path.join(exeDir, 'server.txt'), 'utf8')); } catch (e) { /* لا ملف */ }
  if (inst && inst !== cfg.fromInstaller) { cfg.server = inst; cfg.fromInstaller = inst; save(); }
  cfg.server = normalize(cfg.server);
}

const startUrl = () => cfg.server + (product.mode === 'pos' ? '/?mode=pos#/pos/sell' : '/?mode=full');
const here = (f, q) => ({ file: path.join(__dirname, f), q });

function show() {
  if (!cfg.server) return win.loadFile(path.join(__dirname, 'setup.html'));
  return win.loadURL(startUrl());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, show: false, autoHideMenuBar: true, title: product.title,
    icon: path.join(__dirname, 'icon.png'), backgroundColor: '#efede8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;     // -3 = إلغاء تنقّل
    win.loadFile(path.join(__dirname, 'error.html'), { query: { url: cfg.server, why: desc } });
  });
  // طباعة النظام تمر بـ window.print(): نحوّلها إلى طباعة التطبيق (صامتة اختيارياً في نقطة البيع)
  const patch = () => win.webContents.executeJavaScript(
    "if (window.erpDesktop && !window.__erpPrintPatched) { window.__erpPrintPatched = true; window.print = () => { window.erpDesktop.print().finally(() => window.dispatchEvent(new Event('afterprint'))); }; }").catch(() => {});
  win.webContents.on('dom-ready', patch);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(cfg.server)) shell.openExternal(url);   // واتساب وغيره في المتصفح
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || url.startsWith(cfg.server)) return;
    e.preventDefault();
  });
  show();
}

function menu() {
  const t = [
    { label: 'ملف', submenu: [
      { label: 'تغيير عنوان السيرفر', accelerator: 'CmdOrCtrl+Shift+S', click: () => win && win.loadFile(path.join(__dirname, 'setup.html'), { query: { cur: cfg.server } }) },
      { label: 'إعادة تحميل', accelerator: 'F5', click: () => win && show() },
      { label: 'طباعة', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.executeJavaScript('window.print()') },
      ...(product.mode === 'pos' ? [{ label: 'الطباعة الصامتة للإيصال (الطابعة الافتراضية)', type: 'checkbox', checked: !!cfg.silent, click: (i) => { cfg.silent = i.checked; save(); } }] : []),
      { type: 'separator' }, { label: 'خروج', role: 'quit' } ] },
    { label: 'عرض', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

ipcMain.handle('cfg', () => ({ server: cfg.server, silent: !!cfg.silent, mode: product.mode }));
ipcMain.handle('set-server', async (_e, a) => {
  const s = normalize(a);
  if (!s) return { ok: false, error: 'العنوان غير صالح' };
  cfg.server = s; save();
  show();
  return { ok: true };
});
ipcMain.handle('retry', () => { show(); });
ipcMain.handle('change', () => win.loadFile(path.join(__dirname, 'setup.html'), { query: { cur: cfg.server } }));
ipcMain.handle('print', (e) => new Promise((res) => {
  e.sender.print({ silent: product.mode === 'pos' && !!cfg.silent, printBackground: true }, (ok) => res(ok));
}));

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { loadConfig(); menu(); createWindow(); });
app.on('window-all-closed', () => app.quit());
