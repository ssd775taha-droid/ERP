'use strict';
// نواة الواجهة: أدوات مشتركة. كل النصوص القادمة من الخادم تمر عبر esc قبل إدراجها في HTML.
window.ERP = (function () {
  const E = { pages: {}, onUnauth: null, accountsCache: null };

  E.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  E.money = (n) => (n == null ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  E.today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  E.monthStart = () => E.today().slice(0, 8) + '01';
  E.yearStart = () => E.today().slice(0, 5) + '01-01';
  E.$ = (sel, root) => (root || document).querySelector(sel);
  E.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  E.api = async function (method, url, body) {
    const opt = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    else if (method !== 'GET') { opt.headers['Content-Type'] = 'application/json'; opt.body = '{}'; }
    let res;
    try { res = await fetch('/api' + url, opt); } catch (e) { throw new Error('تعذر الاتصال بالخادم'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* جسم فارغ */ }
    if (res.status === 401 && E.onUnauth && url !== '/login') E.onUnauth();
    if (!res.ok) throw new Error((data && data.error) || 'خطأ غير متوقع (' + res.status + ')');
    return data;
  };
  // إعدادات الضريبة السعودية (النسبة الافتراضية وبيانات المنشأة)
  E.tax = { vatRate: 15, sellerName: '', sellerVatNo: '', sellerAddress: '' };
  E.loadTax = async () => { try { Object.assign(E.tax, await E.api('GET', '/tax/settings')); } catch (e) { /* تبقى الافتراضيات */ } };
  // رمز QR للفاتورة الضريبية المبسطة (TLV/Base64) كـ SVG، أو '' إن لم تُضبط بيانات البائع
  E.zatcaQr = (date, total, vat) => {
    if (!E.tax.sellerName || !ZATCA.validVatNo(E.tax.sellerVatNo) || typeof qrcode === 'undefined') return '';
    const qr = qrcode(0, 'M');
    qr.addData(ZATCA.payload(E.tax.sellerName, E.tax.sellerVatNo, date + 'T00:00:00Z', total, vat));
    qr.make();
    return qr.createSvgTag({ cellSize: 3, margin: 2 });
  };
  // ترويسة الفاتورة الضريبية: بيانات البائع والمشتري ورمز QR
  E.taxHeader = (title, buyerName, buyerTaxNo, date, total, vat, withQr) => {
    const t = E.tax, ok = t.sellerName && ZATCA.validVatNo(t.sellerVatNo);
    return '<div class="card taxhead"><div class="row" style="margin:0;align-items:flex-start"><div style="flex:1"><strong style="font-size:17px">' + E.esc(title) + '</strong><br>' +
      (ok ? E.esc(t.sellerName) + '<br>الرقم الضريبي: <span dir="ltr">' + E.esc(t.sellerVatNo) + '</span>' + (t.sellerAddress ? '<br>' + E.esc(t.sellerAddress) : '')
          : '<span class="bad">لم تُضبط بيانات المنشأة والرقم الضريبي — <a href="#/tax/settings">اضبطها</a> لتصدر فاتورة ضريبية صحيحة</span>') +
      (buyerName ? '<br>العميل: ' + E.esc(buyerName) + (buyerTaxNo ? ' — الرقم الضريبي: <span dir="ltr">' + E.esc(buyerTaxNo) + '</span>' : '') : '') +
      '</div><div>' + (withQr ? E.zatcaQr(date, total, vat) : '') + '</div></div></div>';
  };
  E.qs = (o) => Object.keys(o).filter((k) => o[k] !== '' && o[k] != null).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');

  E.toast = function (msg, bad) {
    const t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    E.$('#toasts').appendChild(t);
    setTimeout(() => t.remove(), bad ? 6000 : 3500);
  };

  E.loadAccounts = async function (force) {
    if (!E.accountsCache || force) E.accountsCache = (await E.api('GET', '/accounts')).accounts;
    return E.accountsCache;
  };
  // خيارات الحسابات الطرفية الفعّالة فقط
  E.accountOptions = function (accts, selected) {
    return '<option value="">— اختر حساباً —</option>' + accts
      .filter((a) => a.active === 'Y' && !a.children)
      .map((a) => '<option value="' + E.esc(a.code) + '"' + (a.code === selected ? ' selected' : '') + '>' + E.esc(a.code) + ' — ' + E.esc(a.name) + '</option>').join('');
  };
  E.typeName = { ASSET: 'أصول', LIABILITY: 'خصوم', EQUITY: 'حقوق ملكية', REVENUE: 'إيرادات', EXPENSE: 'مصروفات' };

  // تفويض الأحداث: عناصر data-act تُمرَّر إلى المعالج المسجل للصفحة الحالية
  E.bind = function (root, handlers) {
    root.addEventListener('click', async (ev) => {
      const el = ev.target.closest('[data-act]');
      if (!el || !handlers[el.dataset.act]) return;
      ev.preventDefault();
      try { await handlers[el.dataset.act](el, ev); } catch (e) { E.toast(e.message, true); }
    });
  };
  E.busy = async function (btn, fn) {
    btn.disabled = true;
    try { return await fn(); } finally { btn.disabled = false; }
  };
  E.err = (m) => '<div class="msg bad">' + E.esc(m) + '</div>';
  E.head = (title, sub) => '<h1>' + E.esc(title) + '</h1>' + (sub ? '<p class="sub">' + E.esc(sub) + '</p>' : '');
  return E;
})();
