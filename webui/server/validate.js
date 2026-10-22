// تحقق من المدخلات قبل الوصول إلى قاعدة البيانات (الحزم تتحقق أيضاً: هذه رسائل أسرع وأوضح).
const { HttpError } = require('./db');

function bad(msg) { throw new HttpError(400, msg); }

function date(v, label, { optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    bad(`${label} مطلوب`);
  }
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) bad(`${label} غير صالح (الصيغة YYYY-MM-DD)`);
  return s;
}

function int(v, label, { optional = false, min = 1 } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    bad(`${label} مطلوب`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) bad(`${label} غير صالح`);
  return n;
}

function str(v, label, { max = 200, optional = false } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (optional) return null;
    bad(`${label} مطلوب`);
  }
  const s = String(v).trim();
  if (s.length > max) bad(`${label} أطول من ${max} حرفاً`);
  return s;
}

// مبلغ بمنزلتين عشريتين كحد أقصى، غير سالب
function money(v, label) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) bad(`${label}: مبلغ غير صالح`);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) bad(`${label}: أكثر من منزلتين عشريتين`);
  return Math.round(n * 100) / 100;
}

module.exports = { date, int, str, money, bad };
