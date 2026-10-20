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
  E.lh = { nameEn: '', crNo: '', phone: '', email: '', website: '', footerNote: '', logo: '', addrEn: '', bankInfo: '', stamp: '' };   // ترويسة المستندات (الشعار وبيانات الاتصال والتذييل)
  E.loadTax = async () => {
    try { Object.assign(E.tax, await E.api('GET', '/tax/settings')); } catch (e) { /* تبقى الافتراضيات */ }
    try { Object.assign(E.lh, await E.api('GET', '/letterhead')); } catch (e) { /* تبقى الافتراضيات */ }
  };
  // كتلة هوية المنشأة: شعار + الاسم (عربي/إنجليزي) + الرقم الضريبي والسجل + العنوان وبيانات الاتصال. تُستعمل في ترويسة الطباعة وترويسة الفاتورة
  E.companyBlock = (opt) => {
    const t = E.tax, l = E.lh, o = opt || {};
    const logo = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(l.logo || '') ? '<img class="lh-logo" alt="" src="' + l.logo + '">' : '';
    const ids = [t.sellerVatNo ? 'الرقم الضريبي: <span dir="ltr">' + E.esc(t.sellerVatNo) + '</span>' : '', l.crNo ? 'السجل التجاري: <span dir="ltr">' + E.esc(l.crNo) + '</span>' : ''].filter(Boolean).join(' · ');
    const contact = [l.phone ? '☎ <span dir="ltr">' + E.esc(l.phone) + '</span>' : '', l.email ? '<span dir="ltr">' + E.esc(l.email) + '</span>' : '', l.website ? '<span dir="ltr">' + E.esc(l.website) + '</span>' : ''].filter(Boolean).join(' · ');
    return '<div class="lh">' + logo + '<div class="lh-txt"><b class="lh-name">' + E.esc(t.sellerName || o.fallback || 'نظام ERP') + '</b>' +
      (l.nameEn ? '<div class="lh-en" dir="ltr">' + E.esc(l.nameEn) + '</div>' : '') +
      (ids ? '<div>' + ids + '</div>' : '') + (t.sellerAddress ? '<div>' + E.esc(t.sellerAddress) + '</div>' : '') + (contact ? '<div>' + contact + '</div>' : '') + '</div></div>';
  };
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
    return '<div class="card taxhead"><div class="row" style="margin:0;align-items:flex-start"><div style="flex:1"><strong style="font-size:17px">' + E.esc(title) + '</strong>' +
      (ok ? E.companyBlock()
          : '<br><span class="bad">لم تُضبط بيانات المنشأة والرقم الضريبي — <a href="#/tax/settings">اضبطها</a> لتصدر فاتورة ضريبية صحيحة</span>') +
      (buyerName ? '<div class="lh-buyer">العميل: ' + E.esc(buyerName) + (buyerTaxNo ? ' — الرقم الضريبي: <span dir="ltr">' + E.esc(buyerTaxNo) + '</span>' : '') + '</div>' : '') +
      '</div><div>' + (withQr ? E.zatcaQr(date, total, vat) : '') + '</div></div></div>';
  };
  // المبلغ كتابةً بالريال السعودي (تفقيط): 1250.50 → «ألف ومائتان وخمسون ريالاً وخمسون هللة فقط لا غير»
  E.amountWords = (amount) => {
    const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
    const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
    const HUND = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
    const below1000 = (n) => {
      const parts = [], h = Math.floor(n / 100), r = n % 100;
      if (h) parts.push(HUND[h]);
      if (r) parts.push(r < 20 ? ONES[r] : (r % 10 ? ONES[r % 10] + ' و' : '') + TENS[Math.floor(r / 10)]);
      return parts.join(' و');
    };
    const SCALES = [['ألف', 'ألفان', 'آلاف', 'ألفاً'], ['مليون', 'مليونان', 'ملايين', 'مليوناً'], ['مليار', 'ملياران', 'مليارات', 'ملياراً']];
    const words = (n) => {
      if (n === 0) return 'صفر';
      const groups = []; let x = n;
      while (x > 0) { groups.push(x % 1000); x = Math.floor(x / 1000); }
      const out = [];
      for (let i = groups.length - 1; i >= 0; i--) {
        const g = groups[i]; if (!g) continue;
        if (i === 0) out.push(below1000(g));
        else { const sc = SCALES[i - 1]; out.push(g === 1 ? sc[0] : g === 2 ? sc[1] : below1000(g) + ' ' + (g <= 10 ? sc[2] : sc[3])); }
      }
      return out.join(' و');
    };
    const unit = (n, one, two, few, many) => n === 2 ? two : (n % 100 >= 3 && n % 100 <= 10) ? few : (n % 100 >= 11 || n === 0) ? many : one;
    const total = Math.round(Number(amount) * 100);
    if (!Number.isFinite(total) || total < 0 || total > 9e14) return '';
    const riyal = Math.floor(total / 100), hal = total % 100;
    const parts = [];
    const phrase = (n, one, oneW, two, few, many) => n === 1 ? oneW : n === 2 ? two : words(n) + ' ' + unit(n, one, two, few, many);
    if (riyal || !hal) parts.push(riyal === 0 ? 'صفر ريال' : phrase(riyal, 'ريال', 'ريال واحد', 'ريالان', 'ريالات', 'ريالاً'));
    if (hal) parts.push(phrase(hal, 'هللة', 'هللة واحدة', 'هللتان', 'هللات', 'هللة'));
    return parts.join(' و') + ' فقط لا غير';
  };
  // سطر توقيعات للسندات المطبوعة
  E.signBlock = (labels) => '<div class="sign">' + labels.map((l) => '<div><span>' + E.esc(l) + '</span><i></i></div>').join('') + '</div>';
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
    return '\ufeff' + E.$$('tr', table).filter((r) => !r.classList.contains('noprint') && r.style.display !== 'none').map((r) =>
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

  // توحيد النص العربي للبحث: يُسقط التشكيل والتطويل ويوحّد الألف والتاء المربوطة والياء والأرقام الهندية
  E.norm = (x) => String(x == null ? '' : x).toLowerCase().replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\s+/g, ' ').trim();
  // مربع بحث فوري لكل جدول بيانات (الصفوف المحمَّلة في الشاشة): يخفي غير المطابق، ويحترمه التصدير والطباعة
  E.attachTableFilter = (t, bar) => {
    const body = E.$$('tbody tr', t);
    if (body.length < 5 || E.$$('input, select, textarea', t).length || t.closest('form')) return;   // جداول الإدخال لا تُفلتر
    const inp = document.createElement('input');
    inp.type = 'search'; inp.className = 'tf'; inp.placeholder = 'بحث في هذا الجدول…'; inp.setAttribute('aria-label', 'بحث في الجدول');
    const cnt = document.createElement('span'); cnt.className = 'muted tf-n';
    inp.addEventListener('input', () => {
      const q = E.norm(inp.value).split(' ').filter(Boolean); let shown = 0;
      E.$$('tbody tr', t).forEach((r) => {
        const hay = r.dataset.hay || (r.dataset.hay = E.norm(r.textContent));
        const ok = q.every((w) => hay.includes(w)); r.style.display = ok ? '' : 'none'; if (ok) shown++;
      });
      cnt.textContent = q.length ? shown + ' من ' + E.$$('tbody tr', t).length : '';
    });
    bar.insertBefore(cnt, bar.firstChild); bar.insertBefore(inp, bar.firstChild);
  };
  // قوائم الاختيار الطويلة (حسابات، أصناف، أطراف…): مربع كتابة يقلّص الخيارات أثناء الإدخال
  E.attachSelectSearch = (sel) => {
    if (sel.dataset.ss || sel.multiple || sel.options.length < 12 || sel.disabled) return;
    sel.dataset.ss = '1';
    const inp = document.createElement('input');
    inp.type = 'search'; inp.className = 'ss'; inp.placeholder = 'اكتب للتصفية…'; inp.setAttribute('aria-label', 'تصفية الخيارات');
    inp.addEventListener('input', () => {
      const q = E.norm(inp.value).split(' ').filter(Boolean);
      Array.from(sel.options).forEach((o) => { const ok = o.selected || o.value === '' || q.every((w) => E.norm(o.textContent).includes(w)); o.hidden = !ok; });
      const hit = Array.from(sel.options).filter((o) => !o.hidden && o.value !== '' && !o.selected);
      if (q.length && hit.length && sel.selectedOptions[0] && !q.every((w) => E.norm(sel.selectedOptions[0].textContent).includes(w))) { sel.value = hit[0].value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.preventDefault(); });
    sel.parentNode.insertBefore(inp, sel);
  };
  E.autoSearch = (main) => {
    const scan = () => E.$$('select', main).forEach((s) => { if (!s.closest('.noss')) E.attachSelectSearch(s); });
    new MutationObserver(scan).observe(main, { childList: true, subtree: true });
    scan();
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
      b.innerHTML = '<button type="button" class="btn alt sm" data-x="xlsx">⬇ Excel</button> <button type="button" class="btn alt sm" data-x="csv">⬇ CSV</button>';
      E.attachTableFilter(t, b);
      b.addEventListener('click', (ev) => {
        const k = ev.target.dataset && ev.target.dataset.x; if (!k) return;
        if (k === 'xlsx' && E.downloadXlsx) E.downloadXlsx(t, title() + '_' + E.today(), E.$('h1', main) ? E.$('h1', main).textContent.trim() : 'ERP');
        else E.downloadCsv(t, title() + '_' + E.today());
      });
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
