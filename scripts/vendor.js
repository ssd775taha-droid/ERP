// ينسخ المكتبات والخطوط من node_modules إلى public/vendor ليعمل الموقع دون إنترنت.
// الاستخدام: npm run vendor
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const nm = (p) => path.join(root, 'node_modules', p);
const out = path.join(root, 'public', 'vendor');

const LIBS = {
  'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js',
  'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js',
  'html2canvas.min.js': 'html2canvas/dist/html2canvas.min.js',
  'jszip.min.js': 'jszip/dist/jszip.min.js',
  'qrcode.js': 'qrcode-generator/qrcode.js',
  'docx.umd.js': 'docx/build/index.umd.js',
  'exceljs.min.js': 'exceljs/dist/exceljs.min.js',
  'pdf.min.js': 'pdfjs-dist/build/pdf.min.js',
  'pdf.worker.min.js': 'pdfjs-dist/build/pdf.worker.min.js',
};

const FONTS = {
  'ibm-plex-sans-arabic': [400, 500, 600, 700],
  'readex-pro': [500, 600, 700],
  alexandria: [500, 600, 700],
  cairo: [400, 600],
  tajawal: [400, 700],
  almarai: [400, 700],
  'noto-naskh-arabic': [400, 600, 700],
  amiri: [400, 700],
  'noto-kufi-arabic': [600, 700],
};
const SUBSETS = ['arabic', 'latin'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

for (const [name, src] of Object.entries(LIBS)) {
  fs.copyFileSync(nm(src), path.join(out, name));
}

let css = '/* مولَّد بواسطة scripts/vendor.js */\n';
for (const [pkg, weights] of Object.entries(FONTS)) {
  for (const w of weights) {
    for (const sub of SUBSETS) {
      const base = `${pkg}-${sub}-${w}-normal`;
      const file = nm(`@fontsource/${pkg}/files/${base}.woff2`);
      if (!fs.existsSync(file)) continue;
      fs.copyFileSync(file, path.join(out, 'fonts', `${base}.woff2`));
      const rules = fs.readFileSync(nm(`@fontsource/${pkg}/${sub}-${w}.css`), 'utf8');
      css += rules
        .replace(/src:[^;]*;/g, `src: url(/vendor/fonts/${base}.woff2) format('woff2');`)
        .replace(/\n\s*\n/g, '\n') + '\n';
    }
  }
}
fs.writeFileSync(path.join(out, 'fonts.css'), css);

// إعادة كتابة روابط CDN وGoogle Fonts في صفحات الموقع
const CDN = [
  [/https:\/\/cdn\.jsdelivr\.net\/npm\/qrcode-generator@[\d.]+\/qrcode\.js/g, '/vendor/qrcode.js'],
  [/https:\/\/cdn\.jsdelivr\.net\/npm\/docx@[\d.]+\/build\/index\.umd\.js/g, '/vendor/docx.umd.js'],
  [/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/[\d.]+\//g, '/vendor/'],
  [/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/[a-z0-9.]+\/[\d.]+\/([\w.]+)/g, '/vendor/$1'],
  [/<link[^>]*rel="preconnect"[^>]*fonts\.g[a-z]+\.com[^>]*>\s*/g, ''],
  [/<link[^>]*href="https:\/\/fonts\.googleapis\.com\/css2[^"]*"[^>]*>/g, '<link rel="stylesheet" href="/vendor/fonts.css">'],
];
for (const f of fs.readdirSync(path.join(root, 'public')).filter((n) => n.endsWith('.html'))) {
  const p = path.join(root, 'public', f);
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  for (const [re, to] of CDN) s = s.replace(re, to);
  if (s !== before) fs.writeFileSync(p, s);
}
console.log('تم تجهيز public/vendor');
