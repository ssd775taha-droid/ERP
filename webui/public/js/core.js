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
  // صلاحيات المستخدم الحالي (من /api/me): E.can('trade', 'w')
  E.me = { perms: {}, isAdmin: false };
  E.can = (mod, level) => E.me.isAdmin || ({ n: 0, r: 1, w: 2 }[E.me.perms[mod] || 'n'] >= { r: 1, w: 2 }[level || 'r']);
  // تصدير أي جدول إلى CSV (UTF-8 مع BOM ليفتحه Excel بالعربية). الأرقام المنسّقة (1,234.50) تُحوَّل إلى أرقام خام
  E.tableToCsv = (table) => {
    const cell = (c) => {
      let t = c.innerText.replace(/\s+/g, ' ').trim();
      if (/^-?[\d,]+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
      return '"' + t.replace(/"/g, '""') + '"';
    };
    return '\ufeff' + E.$$('tr', table).filter((r) => !r.classList.contains('noprint')).map((r) =>
      E.$$('th,td', r).filter((c) => !c.classList.contains('noprint')).map(cell).join(',')).join('\r\n');
  };
  E.downloadCsv = (table, name) => {
    const blob = new Blob([E.tableToCsv(table)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  // وضع القراءة فقط: يخفي نماذج الإضافة وأزرار الإجراء وروابط الإنشاء/التعديل وحقول الجداول؛ يُبقي الطباعة والتصدير ونماذج العرض (المرشِّحات)
  E.readOnly = (main, label) => {
    const hide = (n) => { n.hidden = true; n.style.display = 'none'; };
    const apply = () => {
      E.$$('form', main).forEach((f) => {
        const isFilter = E.$$('button', f).some((b) => /^(عرض|بحث)$/.test(b.textContent.trim()));
        if (!isFilter) hide(f.closest('.card') || f);
      });
      E.$$('[data-act]', main).forEach((b) => { if (b.dataset.act !== 'print') hide(b); });
      E.$$('a', main).forEach((a) => { if (/#\/[^\s]*\b(new|edit)(\/|-|$)/.test(a.getAttribute('href') || '') || /^#\/(note|invoice|quote|po)\/new/.test(a.getAttribute('href') || '')) hide(a.closest('p') && a.closest('p').children.length === 1 ? a.closest('p') : a); });
      E.$$('table input, table select', main).forEach(hide);
      E.$$('select[data-act-change]', main).forEach((s) => { s.disabled = true; });
      // بطاقات صارت فارغة بعد الإخفاء
      E.$$('.card', main).forEach((c) => { if (!c.hidden && !c.innerText.trim()) hide(c); });
    };
    // الشريط عبر ::before في CSS كي لا يُمحى حين تكتب الصفحة محتواها في main
    main.classList.add('ro');
    main.dataset.ro = 'عرض فقط: صلاحيتك على «' + label + '» قراءة، فلا تظهر أدوات الإضافة والتعديل.';
    new MutationObserver(apply).observe(main, { childList: true, subtree: true });
    apply();
  };

  // يضيف زر «تصدير» تلقائياً قبل كل جدول فيه أكثر من صف في الصفحة الحالية (يراقب ما يُحمَّل لاحقاً)
  E.autoExport = (main) => {
    // اسم الملف بحروف لاتينية من مسار الصفحة (بعض المتصفحات تُسقط الأسماء العربية فيصير الملف download)
    const title = () => 'erp_' + (location.hash.replace(/^#\/?/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'export');
    const scan = () => E.$$('table', main).forEach((t) => {
      if (t.dataset.x || E.$$('tbody tr', t).length < 2) return;
      t.dataset.x = '1';
      const b = document.createElement('p');
      b.className = 'noprint'; b.style.margin = '0 0 6px';
      b.innerHTML = '<button type="button" class="btn alt sm">⬇ تصدير Excel/CSV</button>';
      b.firstChild.addEventListener('click', () => E.downloadCsv(t, title() + '_' + E.today()));
      t.parentNode.insertBefore(b, t);
    });
    new MutationObserver(scan).observe(main, { childList: true, subtree: true });
    scan();
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
