'use strict';
(function (E) {
  const { esc, money } = E;
  const q3 = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });

  // المبلغ بالإنجليزية (للنسخة الإنجليزية من المستند)
  const enWords = (amount) => {
    const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const b1000 = (n) => { const o = []; if (n >= 100) { o.push(ones[Math.floor(n / 100)] + ' hundred'); n %= 100; } if (n >= 20) { o.push(tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '')); } else if (n) o.push(ones[n]); return o.join(' '); };
    const words = (n) => { if (n === 0) return 'zero'; const sc = ['', ' thousand', ' million', ' billion']; const g = []; let x = n; while (x > 0) { g.push(x % 1000); x = Math.floor(x / 1000); } return g.map((v, i) => (v ? b1000(v) + sc[i] : '')).reverse().filter(Boolean).join(' '); };
    const t = Math.round(Number(amount) * 100), r = Math.floor(t / 100), h = t % 100;
    return 'Only ' + words(r) + ' Saudi Riyal' + (r === 1 ? '' : 's') + (h ? ' and ' + words(h) + ' Halala' + (h === 1 ? '' : 's') : '') + ' only';
  };

  // رأس المنشأة: عربي (يمين) + شعار (وسط) + إنجليزي (يسار)
  function companyHead() {
    const t = E.tax, l = E.lh;
    const logo = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(l.logo || '') ? '<img src="' + l.logo + '" alt="">' : '';
    const ar = '<div class="pp-co ar"><b>' + esc(t.sellerName || 'اسم المنشأة') + '</b>' + (l.crNo ? '<div>سجل تجاري: <span dir="ltr">' + esc(l.crNo) + '</span></div>' : '') +
      (t.sellerVatNo ? '<div>الرقم الضريبي: <span dir="ltr">' + esc(t.sellerVatNo) + '</span></div>' : '') + (t.sellerAddress ? '<div>العنوان الوطني: ' + esc(t.sellerAddress) + '</div>' : '') +
      (l.phone ? '<div>هاتف: <span dir="ltr">' + esc(l.phone) + '</span></div>' : '') + '</div>';
    const en = '<div class="pp-co en" dir="ltr"><b>' + esc(l.nameEn || '') + '</b>' + (l.crNo ? '<div>C.R.: ' + esc(l.crNo) + '</div>' : '') + (t.sellerVatNo ? '<div>VAT No.: ' + esc(t.sellerVatNo) + '</div>' : '') +
      (l.addrEn ? '<div>' + esc(l.addrEn) + '</div>' : '') + (l.email ? '<div>' + esc(l.email) + '</div>' : '') + '</div>';
    return '<div class="pp-head">' + ar + '<div class="pp-logo">' + logo + '</div>' + en + '</div>';
  }

  // وسم ثنائي اللغة: عربي فوق وإنجليزي أصغر تحته (في النسخة الإنجليزية الإنجليزي فقط)
  const lab = (lang, ar, en) => lang === 'en' ? esc(en) : esc(ar) + (en ? '<small>' + esc(en) + '</small>' : '');

  // يبني ورقة A4 من وصف المستند
  E.paperHtml = (sp, lang) => {
    lang = lang || 'ar';
    const L = (ar, en) => lab(lang, ar, en);
    const meta = sp.meta && sp.meta.length ? '<table class="pp-meta"><tbody>' + sp.meta.map((r) => '<tr>' + r.map((c) => '<th>' + L(c[0], c[1]) + '</th><td>' + c[2] + '</td>').join('') + '</tr>').join('') + '</tbody></table>' : '';
    const parties = sp.parties ? '<div class="pp-parties">' + sp.parties.map((p) => '<div class="pp-box"><div class="pp-box-h">' + (lang === 'en' ? esc(p.en) : esc(p.ar) + ' / ' + esc(p.en)) + '</div>' + p.rows.map((x) => '<div><span class="k">' + (lang === 'en' ? esc(x[1]) : esc(x[0])) + ':</span> ' + x[2] + '</div>').join('') + '</div>').join('') + '</div>' : '';
    const tbl = sp.table ? '<table class="pp-lines"><thead><tr>' + sp.table.cols.map((c) => '<th class="' + (c.n ? 'n' : '') + '">' + L(c.ar, c.en) + '</th>').join('') + '</tr></thead><tbody>' +
      sp.table.rows.map((r) => '<tr>' + r.map((c, i) => '<td class="' + (sp.table.cols[i].n ? 'n' : '') + '">' + c + '</td>').join('') + '</tr>').join('') + '</tbody>' +
      (sp.table.foot ? '<tfoot>' + sp.table.foot.map((r) => '<tr>' + r.map((c) => '<td' + (c.span ? ' colspan="' + c.span + '"' : '') + ' class="' + (c.n ? 'n' : '') + '">' + c.t + '</td>').join('') + '</tr>').join('') + '</tfoot>' : '') + '</table>' : '';
    const totals = sp.totals ? '<table class="pp-tot"><tbody>' + sp.totals.map((r) => '<tr class="' + (r[3] ? 'grand' : '') + '"><td class="n">' + r[2] + '</td><th>' + L(r[0], r[1]) + '</th></tr>').join('') + '</tbody></table>' : '';
    const words = sp.words != null ? '<div class="pp-words">' + (lang === 'en' ? esc(enWords(sp.words)) : esc(E.amountWords(sp.words))) + '</div>' : '';
    const bank = sp.bank && E.lh.bankInfo ? '<div class="pp-bank"><b>' + (lang === 'en' ? 'Bank transfer details' : 'بيانات التحويل البنكي') + '</b><div>' + esc(E.lh.bankInfo).replace(/\n/g, '<br>') + '</div></div>' : '';
    const stats = sp.stats && sp.stats.length ? '<table class="pp-stats"><tbody><tr>' + sp.stats.map((x) => '<td><small>' + esc(x[0]) + '</small><b>' + x[1] + '</b></td>').join('') + '</tr></tbody></table>' : '';
    const body = sp.body ? '<div class="pp-body">' + sp.body + '</div>' : '';
    const note = sp.note ? '<div class="pp-note"><b>' + (lang === 'en' ? 'Notes' : 'ملاحظات') + ':</b> ' + esc(sp.note) + '</div>' : '';
    const stamp = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(E.lh.stamp || '') ? '<img class="pp-stamp" src="' + E.lh.stamp + '" alt="">' : '';
    const sign = sp.sign ? '<div class="pp-sign">' + sp.sign.map((s) => '<div><i></i><span>' + L(s[0], s[1]) + '</span></div>').join('') + '</div>' : '';
    const title = lang === 'en' ? '<h1>' + esc(sp.titleEn) + '</h1><div class="sub">' + esc(sp.titleAr) + '</div>' : '<h1>' + esc(sp.titleAr) + '</h1><div class="sub">' + esc(sp.titleEn) + '</div>';
    const when = new Date().toLocaleDateString('en-CA');
    return '<div class="paper pp-' + lang + '" dir="' + (lang === 'en' ? 'ltr' : 'rtl') + '">' + companyHead() +
      '<div class="pp-titlebar"><div class="pp-title">' + title + '</div>' + (sp.qr ? '<div class="pp-qr">' + sp.qr + '</div>' : '') + '</div>' +
      meta + stats + body + parties + tbl + '<div class="pp-mid">' + words + totals + '</div>' + note + bank +
      '<div class="pp-seal">' + stamp + (stamp ? '<div class="pp-sealname">' + esc(E.tax.sellerName || '') + '</div>' : '') + '</div>' + sign +
      '<div class="pp-foot"><span>' + esc(E.tax.sellerName || '') + '</span><span dir="ltr">' + esc(sp.no || '') + '</span><span>' + (lang === 'en' ? 'Issued on ' : 'صدر بتاريخ ') + when + '</span></div></div>';
  };

  // نافذة المعاينة: لغة المستند، الورقة، وأزرار PDF وExcel والطباعة وواتساب وما يخص المستند
  E.openDoc = (sp) => {
    let lang = 'ar';
    const dlg = document.createElement('dialog');
    dlg.className = 'docdlg'; dlg.id = 'docdlg';
    const btns = (sp.actions || []).map((a, i) => '<button type="button" class="btn alt ' + (a.cls || '') + '" data-i="' + i + '">' + esc(a.label) + '</button>').join(' ');
    dlg.innerHTML = '<div class="dd-bar"><b>' + esc(sp.windowTitle || sp.titleAr) + '</b><button type="button" class="btn alt sm" data-x="close">✕</button></div>' +
      '<div class="dd-tools"><span>لغة المستند / Language:</span><span class="seg"><button type="button" data-l="ar" class="on">العربية</button><button type="button" data-l="en">English</button></span></div>' +
      '<div class="dd-view"><div id="dd-paper"></div></div>' +
      '<div class="dd-actions"><button type="button" class="btn gold" data-x="pdf">تنزيل PDF</button> <button type="button" class="btn alt" data-x="xlsx">تنزيل Excel</button> <button type="button" class="btn alt" data-x="print">طباعة</button> <button type="button" class="btn alt" data-x="wa">إرسال واتساب</button> ' + btns + ' <button type="button" class="btn alt" data-x="close">إغلاق</button></div>';
    document.body.appendChild(dlg);
    const paper = () => E.$('#dd-paper', dlg);
    const draw = () => { paper().innerHTML = E.paperHtml(sp, lang); };
    const close = () => { dlg.close(); dlg.remove(); };
    const doPrint = () => {
      const box = E.$('#thermal'); box.innerHTML = E.paperHtml(sp, lang);
      document.body.classList.add('thermal', 'pm');
      const done = () => { document.body.classList.remove('thermal', 'pm'); box.innerHTML = ''; window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done); window.print();
    };
    dlg.addEventListener('click', (ev) => {
      const t = ev.target.closest('button'); if (!t) return;
      if (t.dataset.l) { lang = t.dataset.l; E.$$('.seg button', dlg).forEach((b) => b.classList.toggle('on', b === t)); draw(); return; }
      if (t.dataset.i != null) { const a = sp.actions[Number(t.dataset.i)]; if (a.href) { close(); location.hash = a.href; } else if (a.fn) a.fn(close); return; }
      switch (t.dataset.x) {
        case 'close': close(); break;
        case 'print': doPrint(); break;
        case 'pdf': E.toast('في نافذة الطباعة اختر الوجهة «حفظ بتنسيق PDF»'); doPrint(); break;
        case 'xlsx': { const tb = E.$('.pp-lines', paper()); if (!tb) { E.toast('لا جدول للتصدير', true); break; } E.downloadXlsx(tb, 'erp_' + String(sp.no || 'doc').replace(/[^A-Za-z0-9]+/g, '_') + '_' + E.today(), sp.titleEn || sp.titleAr); break; }
        case 'wa': {
          let ph = String(sp.phone || '').replace(/\D/g, '');
          if (/^0\d{9}$/.test(ph)) ph = '966' + ph.slice(1);
          const msg = (sp.titleAr || '') + ' ' + (sp.no || '') + (sp.waAmount != null ? ' — ' + money(sp.waAmount) + ' ريال' : '') + '\n' + (E.tax.sellerName || '');
          window.open('https://wa.me/' + ph + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
          break;
        }
        default:
      }
    });
    dlg.addEventListener('cancel', () => { dlg.remove(); });
    draw(); dlg.showModal();
  };

  // ---------- أوصاف المستندات ----------
  const PM = { CASH: ['نقداً', 'Cash'], BANK: ['تحويل بنكي', 'Bank transfer'] };
  const num = (n) => '<span dir="ltr">' + money(n) + '</span>';
  const party = (name, taxNo, phone, ar, en) => ({ ar, en, rows: [['الاسم', 'Name', '<b>' + esc(name) + '</b>'], ...(taxNo ? [['الرقم الضريبي', 'VAT No.', '<span dir="ltr">' + esc(taxNo) + '</span>']] : []), ...(phone ? [['جوال', 'Mobile', '<span dir="ltr">' + esc(phone) + '</span>']] : [])] });
  const seller = (ar, en) => ({ ar, en, rows: [['الاسم', 'Name', '<b>' + esc(E.tax.sellerName || '') + '</b>'], ['الرقم الضريبي', 'VAT No.', '<span dir="ltr">' + esc(E.tax.sellerVatNo || '') + '</span>'], ...(E.lh.crNo ? [['السجل التجاري', 'C.R.', '<span dir="ltr">' + esc(E.lh.crNo) + '</span>']] : []), ...(E.tax.sellerAddress ? [['العنوان', 'Address', esc(E.tax.sellerAddress)]] : [])] });
  E.companyHead = companyHead;

  // ---------- الإيصال الحراري 80مم بالتصميم الموحّد (ثنائي اللغة) ----------
  E.thermalHtml = (s) => {
    const t = E.tax, l = E.lh, sale = s.kind === 'SALE';
    const row = (ar, en, val, big) => '<div class="rl' + (big ? ' big' : '') + '"><span>' + ar + (en ? ' <small>' + en + '</small>' : '') + '</span><b dir="ltr">' + val + '</b></div>';
    const logo = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(l.logo || '') ? '<img class="th-logo" src="' + l.logo + '" alt="">' : '';
    const qr = sale && s.status === 'COMPLETED' ? E.zatcaQr(s.date, s.total, s.vat) : '';
    const pay = s.payments.map((p) => row(p.method === 'CASH' ? 'نقداً' : 'بطاقة', p.method === 'CASH' ? 'Cash' : 'Card', money(p.amount))).join('');
    const dis = s.lines.some((x) => x.discountPct);
    return '<div class="th">' + logo +
      '<div class="c"><b class="nm">' + esc(t.sellerName || 'نظام ERP') + '</b>' + (l.nameEn ? '<div dir="ltr">' + esc(l.nameEn) + '</div>' : '') +
      (t.sellerVatNo ? '<div>الرقم الضريبي <span dir="ltr">' + esc(t.sellerVatNo) + '</span></div>' : '') + (l.crNo ? '<div>السجل التجاري <span dir="ltr">' + esc(l.crNo) + '</span></div>' : '') +
      (t.sellerAddress ? '<div>' + esc(t.sellerAddress) + '</div>' : '') + (l.phone ? '<div dir="ltr">' + esc(l.phone) + '</div>' : '') + '</div><hr class="dd">' +
      '<div class="c ttl">' + (sale ? 'فاتورة ضريبية مبسطة' : 'إشعار دائن (مرتجع)') + '<small>' + (sale ? 'Simplified Tax Invoice' : 'Credit Note (Return)') + '</small></div>' +
      row('رقم', 'No.', esc(s.no)) + row('التاريخ', 'Date', esc(s.date)) + (s.origSaleId ? row('مرتجع على', 'Return of', String(s.origSaleId)) : '') + '<hr class="dd">' +
      s.lines.map((x) => '<div class="it">' + esc(x.description) + '</div><div class="rl sub"><span dir="ltr">' + q3(x.qty) + ' × ' + money(x.price) + (dis && x.discountPct ? ' (−' + x.discountPct + '%)' : '') + '</span><b dir="ltr">' + money(x.net) + '</b></div>').join('') + '<hr class="dd">' +
      row('المجموع قبل الضريبة', 'Subtotal', money(s.subtotal)) + row('ضريبة القيمة المضافة', 'VAT', money(s.vat)) + '<hr>' + row('الإجمالي', 'Total SAR', money(s.total), true) + '<hr class="dd">' +
      pay + (s.changeDue ? row('الباقي', 'Change', money(s.changeDue)) : '') +
      (qr ? '<div class="qr">' + qr + '</div>' : '') + (s.status === 'VOID' ? '<div class="c ttl">*** ملغاة / VOID ***</div>' : '') +
      '<div class="c ft">' + (l.footerNote ? esc(l.footerNote).replace(/\n/g, '<br>') : 'شكراً لزيارتكم') + '<small>Thank you for your visit</small></div></div>';
  };
  // معاينة الإيصال قبل الطباعة
  E.openThermal = (s) => {
    const dlg = document.createElement('dialog'); dlg.className = 'docdlg thdlg'; dlg.id = 'docdlg';
    dlg.innerHTML = '<div class="dd-bar"><b>إيصال حراري 80مم — <span dir="ltr">' + esc(s.no) + '</span></b><button type="button" class="btn alt sm" data-x="close">✕</button></div><div class="dd-view"><div class="th-paper">' + E.thermalHtml(s) + '</div></div>' +
      '<div class="dd-actions"><button type="button" class="btn gold" data-x="print">طباعة الإيصال</button> <button type="button" class="btn alt" data-x="close">إغلاق</button></div>';
    document.body.appendChild(dlg);
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('click', (ev) => { const t = ev.target.closest('button'); if (!t) return; if (t.dataset.x === 'close') close(); else if (t.dataset.x === 'print') E.printThermal(E.thermalHtml(s)); });
    dlg.addEventListener('cancel', () => dlg.remove());
    dlg.showModal();
  };

  // معاينة تقرير: يُبنى من الصفحة الحالية (العنوان، المرشِّحات، البطاقات، الجداول) بنفس ورقة المستند
  const EN_TITLES = { 'trial-balance': 'TRIAL BALANCE', ledger: 'ACCOUNT LEDGER', 'income-statement': 'INCOME STATEMENT', 'balance-sheet': 'BALANCE SHEET', 'cash-flow': 'CASH FLOW STATEMENT', aging: 'AGING REPORT', vat: 'VAT RETURN',
    'sales-analysis': 'SALES / PURCHASES ANALYSIS', 'item-profit': 'ITEM PROFITABILITY', comparative: 'COMPARATIVE INCOME STATEMENT', valuation: 'INVENTORY VALUATION', card: 'ITEM CARD', movement: 'STOCK MOVEMENT SUMMARY', slow: 'SLOW-MOVING STOCK', shortage: 'STOCK SHORTAGE & COVER',
    stock: 'STOCK BALANCES', dept: 'PAYROLL BY DEPARTMENT', 'employee-sheet': 'EMPLOYEE PAYROLL BY MONTH', components: 'PAYROLL BY COMPONENT', trend: 'PAYROLL COST TREND', moves: 'STOCK MOVEMENTS', entries: 'JOURNAL', accounts: 'CHART OF ACCOUNTS', search: 'SEARCH RESULTS' };
  E.reportDoc = (main) => {
    const h1 = E.$('h1', main);
    if (!h1 || !E.$('table, .pp-x', main)) { window.print(); return; }
    const key = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter((x) => !/^\d+$/.test(x)).pop() || '';
    const sub = E.$('h1 + .sub', main);
    const filters = E.$$('form.noprint label, form .noprint label', main).concat(E.$$('form.row label', main)).filter((x, i, a) => a.indexOf(x) === i).map((lb) => {
      const f = E.$('input,select', lb); if (!f || f.type === 'checkbox' && !f.checked || !f.value) return null;
      const lab = lb.firstChild && lb.firstChild.textContent.trim(); if (!lab) return null;
      return [lab, '', esc(f.tagName === 'SELECT' ? f.options[f.selectedIndex].text : f.value)];
    }).filter(Boolean);
    const meta = []; for (let i = 0; i < filters.length; i += 2) meta.push(filters.slice(i, i + 2));
    const stats = E.$$('.stat', main).map((s) => [s.firstElementChild ? s.firstElementChild.textContent.trim() : '', (E.$('b', s) || {}).innerHTML || s.textContent.trim()]);
    const out = E.$('#out', main) || main;
    const c = out.cloneNode(true);
    E.$$('.noprint, button, form, input, select, .stat, .cards, p.muted:empty, nav', c).forEach((n) => n.remove());
    E.$$('h1, h1 + .sub', c).forEach((n) => n.remove());
    E.$$('table', c).forEach((t) => { t.classList.add('pp-lines'); E.$$('[style*="display: none"], [style*="display:none"]', t).forEach((r) => r.remove()); });
    E.$$('a', c).forEach((a) => a.replaceWith(document.createTextNode(a.textContent)));
    E.openDoc({ titleAr: h1.textContent.trim(), titleEn: EN_TITLES[key] || '', no: key.toUpperCase().slice(0, 24) || 'REPORT', windowTitle: h1.textContent.trim(),
      meta: [...(sub ? [[[ 'الوصف', '', esc(sub.textContent.trim()) ]]] : []), ...meta], stats, body: c.innerHTML,
      actions: [] });
  };
  const SIGN3 = [['أعدّه (المحاسب)', 'Prepared by'], ['راجعه (المدير المالي)', 'Reviewed by'], ['اعتمده (المدير العام)', 'Approved by']];

  E.docSpec = {
    // فاتورة (مبيعات ضريبية/مبسطة أو مشتريات)
    invoice(i, partyPhone) {
      const sales = i.kind === 'SALES';
      const lines = i.lines.map((l, k) => [k + 1, esc(l.description), q3(l.qty), num(l.price), l.vatRate + '%', num(l.net), num(l.vat), num(l.net + l.vat)]);
      const tt = sales ? (i.partyTaxNo ? ['فاتورة ضريبية', 'TAX INVOICE'] : ['فاتورة ضريبية مبسطة', 'SIMPLIFIED TAX INVOICE']) : ['فاتورة مشتريات', 'PURCHASE INVOICE'];
      return {
        titleAr: tt[0], titleEn: tt[1], no: i.no, windowTitle: tt[0] + ' ' + i.no, phone: partyPhone, waAmount: i.total,
        qr: sales && i.status === 'OPEN' ? E.zatcaQr(i.date, i.total, i.vat) : '',
        meta: [[['رقم الفاتورة', 'Invoice No.', '<b dir="ltr">' + esc(i.no) + '</b>'], ['تاريخ الإصدار', 'Issue Date', '<b dir="ltr">' + esc(i.date) + '</b>']],
          [['المرجع', 'Reference', esc(i.ref || '—')], ['تاريخ الاستحقاق', 'Due Date', esc(i.due || '—')]],
          [['طريقة الدفع', 'Payment', i.paid >= i.total ? PM.CASH[0] : 'آجل'], ['العملة', 'Currency', 'ريال سعودي SAR']]],
        parties: sales ? [seller('البائع', 'Seller'), party(i.partyName, i.partyTaxNo, partyPhone, 'المشتري', 'Buyer')] : [party(i.partyName, i.partyTaxNo, partyPhone, 'المورد', 'Supplier'), seller('المشتري', 'Buyer')],
        table: { cols: [{ ar: '#', en: '' }, { ar: 'البيان', en: 'Description' }, { ar: 'الكمية', en: 'Qty', n: 1 }, { ar: 'سعر الوحدة', en: 'Unit Price', n: 1 }, { ar: 'الضريبة %', en: 'VAT %', n: 1 }, { ar: 'الصافي', en: 'Net', n: 1 }, { ar: 'الضريبة', en: 'VAT', n: 1 }, { ar: 'الإجمالي', en: 'Amount', n: 1 }], rows: lines },
        totals: [['الإجمالي قبل الضريبة', 'Subtotal', num(i.subtotal)], ['ضريبة القيمة المضافة', 'VAT', num(i.vat)], ['الإجمالي المستحق', 'Total SAR', num(i.total), 1],
          ...(i.effectiveTotal !== i.total ? [['الإجمالي بعد الإشعارات', 'After notes', num(i.effectiveTotal)]] : []), ...(i.paid ? [['المسدد', 'Paid', num(i.paid)], ['المتبقي', 'Balance', num(i.remaining)]] : [])],
        words: i.total, note: i.note, bank: sales, sign: SIGN3,
        actions: [
          ...(i.status === 'OPEN' && i.remaining > 0 && E.can('trade', 'w') ? [{ label: sales ? 'تسجيل سند قبض' : 'تسجيل سند صرف', cls: 'dark', href: '#/payment/new/' + i.partyId }] : []),
          ...(sales && i.status === 'OPEN' && E.can('trade', 'w') ? [{ label: 'إشعار دائن', href: '#/note/new/' + i.id + '-CREDIT' }, { label: 'إشعار مدين', href: '#/note/new/' + i.id + '-DEBIT' }] : []),
          ...(E.me.isAdmin ? [{ label: 'سجل العمليات', href: '#/settings/audit' }] : [])],
      };
    },
    // إشعار دائن/مدين
    note(n) {
      const credit = n.type === 'CREDIT', sales = n.docKind === 'SALES';
      const tt = credit ? ['إشعار دائن', 'CREDIT NOTE'] : ['إشعار مدين', 'DEBIT NOTE'];
      return {
        titleAr: tt[0] + (sales ? ' مبيعات' : ' مشتريات'), titleEn: tt[1], no: n.no, windowTitle: tt[0] + ' ' + n.no, waAmount: n.total,
        qr: sales && n.status === 'OPEN' ? E.zatcaQr(n.date, n.total, n.vat) : '',
        meta: [[['رقم الإشعار', 'Note No.', '<b dir="ltr">' + esc(n.no) + '</b>'], ['التاريخ', 'Date', '<b dir="ltr">' + esc(n.date) + '</b>']], [['الفاتورة الأصلية', 'Original Invoice', '<span dir="ltr">' + esc(n.invoiceNo) + '</span>'], ['تاريخ الفاتورة', 'Invoice Date', esc(n.invoiceDate)]]],
        parties: sales ? [seller('البائع', 'Seller'), party(n.partyName, n.partyTaxNo, '', 'العميل', 'Customer')] : [party(n.partyName, n.partyTaxNo, '', 'المورد', 'Supplier'), seller('المشتري', 'Buyer')],
        table: { cols: [{ ar: '#', en: '' }, { ar: 'البيان', en: 'Description' }, { ar: 'الكمية', en: 'Qty', n: 1 }, { ar: 'السعر', en: 'Price', n: 1 }, { ar: 'الضريبة %', en: 'VAT %', n: 1 }, { ar: 'الصافي', en: 'Net', n: 1 }, { ar: 'الضريبة', en: 'VAT', n: 1 }],
          rows: n.lines.map((l, k) => [k + 1, esc(l.description), q3(l.qty), num(l.price), l.vatRate + '%', num(l.net), num(l.vat)]) },
        totals: [['الإجمالي قبل الضريبة', 'Subtotal', num(n.subtotal)], ['ضريبة القيمة المضافة', 'VAT', num(n.vat)], ['الإجمالي', 'Total SAR', num(n.total), 1]],
        words: n.total, note: 'السبب: ' + n.reason + (n.refund > 0 ? ' — مردود ' + (n.refundMethod === 'CASH' ? 'نقداً' : 'بنكياً') + ' ' + money(n.refund) : ''), sign: SIGN3,
        actions: E.me.isAdmin ? [{ label: 'سجل العمليات', href: '#/settings/audit' }] : [],
      };
    },
    // سند قبض / صرف
    payment(p) {
      const rec = p.kind === 'RECEIPT';
      return {
        titleAr: rec ? 'سند قبض' : 'سند صرف', titleEn: rec ? 'RECEIPT VOUCHER' : 'PAYMENT VOUCHER', no: (rec ? 'RV-' : 'PV-') + p.id, windowTitle: (rec ? 'سند قبض ' : 'سند صرف ') + p.id, waAmount: p.amount, phone: p.partyPhone,
        meta: [[['رقم السند', 'Voucher No.', '<b dir="ltr">' + (rec ? 'RV-' : 'PV-') + p.id + '</b>'], ['التاريخ', 'Date', '<b dir="ltr">' + esc(p.date) + '</b>']],
          [['طريقة الدفع', 'Payment Method', '<b>' + PM[p.method][0] + '</b>'], ['رقم القيد', 'Journal No.', p.entryId ? '<span dir="ltr">' + p.entryId + '</span>' : '—']]],
        parties: [party(p.partyName, p.partyTaxNo, p.partyPhone, rec ? 'استلمنا من السادة' : 'صرفنا إلى السادة', rec ? 'Received from' : 'Paid to')],
        totals: [['المبلغ', 'Amount SAR', num(p.amount), 1]], words: p.amount,
        note: (p.invoiceId ? 'وذلك عن: سداد الفاتورة رقم ' + p.invoiceNo : 'وذلك عن: دفعة على الحساب') + (p.note ? ' — ' + p.note : ''),
        sign: [[rec ? 'المستلم' : 'المستلم (المستفيد)', 'Receiver'], ['المحاسب', 'Accountant'], ['المدير', 'Manager']],
        actions: E.can('trade', 'w') ? [{ label: rec ? 'إلغاء السند' : 'إلغاء السند', cls: 'danger', fn: (close) => { close(); const b = document.querySelector('[data-act=c-del]'); if (b) b.click(); } }] : [],
      };
    },
    // إيصال نقطة بيع على A4 (فاتورة مبسطة أو إشعار دائن لمرتجع)
    pos(s) {
      const sale = s.kind === 'SALE', tt = sale ? ['فاتورة ضريبية مبسطة', 'SIMPLIFIED TAX INVOICE'] : ['إشعار دائن (مرتجع)', 'CREDIT NOTE (RETURN)'];
      const pay = s.payments.map((p) => (p.method === 'CASH' ? 'نقداً' : 'بطاقة') + ' ' + money(p.amount)).join(' + ');
      return {
        titleAr: tt[0], titleEn: tt[1], no: s.no, windowTitle: tt[0] + ' ' + s.no, waAmount: s.total,
        qr: sale && s.status === 'COMPLETED' ? E.zatcaQr(s.date, s.total, s.vat) : '',
        meta: [[['رقم العملية', 'Receipt No.', '<b dir="ltr">' + esc(s.no) + '</b>'], ['التاريخ', 'Date', '<b dir="ltr">' + esc(s.date) + '</b>']],
          [['طريقة الدفع', 'Payment', esc(pay || '—')], ['العملة', 'Currency', 'ريال سعودي SAR']],
          ...(s.origSaleId ? [[['مرتجع على عملية', 'Return of', '<span dir="ltr">' + s.origSaleId + '</span>'], ['الحالة', 'Status', s.status === 'VOID' ? 'ملغاة' : 'سارية']]] : [])],
        parties: [seller('البائع', 'Seller'), { ar: 'العميل', en: 'Customer', rows: [['الاسم', 'Name', 'عميل نقدي / Cash customer']] }],
        table: { cols: [{ ar: '#', en: '' }, { ar: 'البيان', en: 'Description' }, { ar: 'الكمية', en: 'Qty', n: 1 }, { ar: 'سعر الوحدة', en: 'Unit Price', n: 1 }, { ar: 'الخصم %', en: 'Disc. %', n: 1 }, { ar: 'الضريبة %', en: 'VAT %', n: 1 }, { ar: 'الصافي', en: 'Net', n: 1 }, { ar: 'الإجمالي', en: 'Amount', n: 1 }],
          rows: s.lines.map((l, k) => [k + 1, esc(l.description), q3(l.qty), num(l.price), (l.discountPct || 0) + '%', l.vatRate + '%', num(l.net), num(l.net + l.vat)]) },
        totals: [['الإجمالي قبل الضريبة', 'Subtotal', num(s.subtotal)], ['ضريبة القيمة المضافة', 'VAT', num(s.vat)], ['الإجمالي', 'Total SAR', num(s.total), 1],
          ...(sale && s.tendered ? [['المدفوع', 'Tendered', num(s.tendered)]] : []), ...(s.changeDue ? [['الباقي', 'Change', num(s.changeDue)]] : [])],
        words: s.total, note: E.lh.footerNote || '', sign: [['أمين الصندوق', 'Cashier'], ['المدير', 'Manager']],
        actions: E.me.isAdmin ? [{ label: 'سجل العمليات', href: '#/settings/audit' }] : [],
      };
    },
    // كشف رواتب شهري
    payroll(r, statusText) {
      const tot = (k) => r.lines.reduce((s, l) => s + l[k], 0);
      return {
        titleAr: 'كشف رواتب', titleEn: 'PAYROLL SHEET', no: 'PR-' + r.period.slice(0, 7), windowTitle: 'كشف رواتب ' + r.period.slice(0, 7), waAmount: r.net,
        meta: [[['الشهر', 'Period', '<b dir="ltr">' + esc(r.period.slice(0, 7)) + '</b>'], ['الحالة', 'Status', esc(statusText || r.status)]],
          [['قيد الترحيل', 'Posting Journal', r.entryId ? '<span dir="ltr">' + r.entryId + '</span>' : '—'], ['قيد الصرف', 'Payment Journal', r.payEntryId ? '<span dir="ltr">' + r.payEntryId + '</span> (' + esc(r.payDate) + ')' : '—']]],
        table: { cols: [{ ar: '#', en: '' }, { ar: 'الموظف', en: 'Employee' }, { ar: 'الأيام', en: 'Days', n: 1 }, { ar: 'الأساسي', en: 'Basic', n: 1 }, { ar: 'استحقاقات', en: 'Earnings', n: 1 }, { ar: 'الإجمالي', en: 'Gross', n: 1 }, { ar: 'استقطاعات', en: 'Deductions', n: 1 }, { ar: 'سلف', en: 'Advances', n: 1 }, { ar: 'الصافي', en: 'Net', n: 1 }],
          rows: r.lines.map((l, k) => [k + 1, esc(l.empCode + ' — ' + l.empName), l.days + '/' + l.daysInPeriod, num(l.basic), num(l.earnings), num(l.gross), num(l.deductions), num(l.advance), num(l.net)]),
          foot: [[{ t: 'الإجمالي / Total', span: 3 }, { t: num(tot('basic')), n: 1 }, { t: num(tot('earnings')), n: 1 }, { t: num(r.gross), n: 1 }, { t: num(tot('deductions')), n: 1 }, { t: num(tot('advance')), n: 1 }, { t: num(r.net), n: 1 }]] },
        words: r.net, note: 'صافي الرواتب المستحقة للصرف', sign: SIGN3,
        actions: E.me.isAdmin ? [{ label: 'سجل العمليات', href: '#/settings/audit' }] : [],
      };
    },
    // قسيمة راتب موظف
    payslip(l, r) {
      const earn = l.items.filter((i) => i.kind === 'EARNING'), ded = l.items.filter((i) => i.kind !== 'EARNING' && i.kind !== 'EMPLOYER');
      const rows = [['الراتب الأساسي (' + l.days + '/' + l.daysInPeriod + ' يوم)', num(l.basic), ''], ...earn.map((i) => [esc(i.description), num(i.amount), '']), ...ded.map((i) => [esc(i.description), '', num(i.amount)]), ...(l.advance ? [['قسط سلفة', '', num(l.advance)]] : [])];
      return {
        titleAr: 'قسيمة راتب', titleEn: 'PAYSLIP', no: 'PS-' + r.period.slice(0, 7) + '-' + l.empCode, windowTitle: 'قسيمة راتب — ' + l.empName,
        meta: [[['الموظف', 'Employee', '<b>' + esc(l.empName) + '</b>'], ['الرمز', 'Code', '<span dir="ltr">' + esc(l.empCode) + '</span>']], [['الشهر', 'Period', '<b dir="ltr">' + esc(r.period.slice(0, 7)) + '</b>'], ['أيام العمل', 'Days Worked', l.days + ' / ' + l.daysInPeriod]]],
        table: { cols: [{ ar: 'البند', en: 'Item' }, { ar: 'استحقاقات', en: 'Earnings', n: 1 }, { ar: 'استقطاعات', en: 'Deductions', n: 1 }], rows,
          foot: [[{ t: 'الإجمالي / Total' }, { t: num(l.gross), n: 1 }, { t: num(l.deductions + l.advance), n: 1 }]] },
        totals: [['إجمالي الاستحقاقات', 'Gross', num(l.gross)], ['إجمالي الاستقطاعات', 'Deductions', num(l.deductions + l.advance)], ['صافي الراتب', 'Net Pay SAR', num(l.net), 1]], words: l.net,
        sign: [['الموظف — الاستلام', 'Employee'], ['المحاسب', 'Accountant']],
      };
    },
    // سند سلفة موظف
    advance(a) {
      const inst = a.installments ? Math.round(a.amount / a.installments * 100) / 100 : 0;
      return {
        titleAr: 'سند سلفة موظف', titleEn: 'EMPLOYEE ADVANCE VOUCHER', no: 'ADV-' + a.id, windowTitle: 'سلفة ' + a.empName,
        meta: [[['رقم السلفة', 'Advance No.', '<b dir="ltr">' + a.id + '</b>'], ['التاريخ', 'Date', '<b dir="ltr">' + esc(a.date) + '</b>']], [['الموظف', 'Employee', '<b>' + esc(a.empName) + '</b>'], ['الحالة', 'Status', a.status === 'SETTLED' ? 'مسدّدة' : 'مفتوحة']]],
        table: { cols: [{ ar: 'المبلغ', en: 'Amount', n: 1 }, { ar: 'عدد الأقساط', en: 'Installments', n: 1 }, { ar: 'القسط الشهري', en: 'Monthly', n: 1 }, { ar: 'المسدّد', en: 'Repaid', n: 1 }, { ar: 'المتبقي', en: 'Remaining', n: 1 }],
          rows: [[num(a.amount), a.done + ' / ' + a.installments, num(inst), num(a.repaid), num(a.remaining)]] },
        totals: [['مبلغ السلفة', 'Advance SAR', num(a.amount), 1]], words: a.amount, note: 'يُقتطع القسط الشهري من راتب الموظف حتى السداد الكامل.',
        sign: [['الموظف — الاستلام والإقرار', 'Employee'], ['المحاسب', 'Accountant'], ['المدير', 'Manager']],
      };
    },
    // إشعار تسوية راتب (مكافأة/جزاء)
    adjustment(a) {
      const earn = a.kind === 'EARNING';
      return {
        titleAr: earn ? 'إشعار استحقاق (تسوية راتب)' : 'إشعار استقطاع (تسوية راتب)', titleEn: earn ? 'EARNING ADJUSTMENT NOTICE' : 'DEDUCTION ADJUSTMENT NOTICE', no: 'ADJ-' + a.id, windowTitle: 'تسوية — ' + a.empName,
        meta: [[['رقم التسوية', 'Ref.', '<b dir="ltr">' + a.id + '</b>'], ['شهر التطبيق', 'Applies to', '<b dir="ltr">' + esc(String(a.period).slice(0, 7)) + '</b>']], [['الموظف', 'Employee', '<b>' + esc(a.empName) + '</b>'], ['الحالة', 'Status', { PENDING: 'معلّقة', APPLIED: 'مطبّقة', VOID: 'ملغاة' }[a.status] || a.status]]],
        table: { cols: [{ ar: 'البيان', en: 'Description' }, { ar: earn ? 'استحقاق' : 'استقطاع', en: earn ? 'Earning' : 'Deduction', n: 1 }], rows: [[esc(a.description), num(a.amount)]] },
        totals: [['المبلغ', 'Amount SAR', num(a.amount), 1]], words: a.amount, sign: [['الموظف', 'Employee'], ['المحاسب', 'Accountant'], ['المدير', 'Manager']],
      };
    },
    // مستند حركة مخزون (تسوية/تحويل) من حركات المرجع نفسه
    stock(refType, refId, moves) {
      const adj = refType === 'ADJUST';
      const q = moves.reduce((s, m) => s + m.qty, 0), val = moves.reduce((s, m) => s + m.value, 0);
      return {
        titleAr: adj ? 'مستند تسوية مخزون' : 'مستند تحويل مخزون', titleEn: adj ? 'STOCK ADJUSTMENT' : 'STOCK TRANSFER', no: (adj ? 'ADJ-' : 'TRF-') + refId, windowTitle: (adj ? 'تسوية مخزون ' : 'تحويل مخزون ') + refId,
        meta: [[['رقم المستند', 'Doc No.', '<b dir="ltr">' + esc(refType) + ' ' + refId + '</b>'], ['التاريخ', 'Date', '<b dir="ltr">' + esc(moves[0].date) + '</b>']]],
        table: { cols: [{ ar: '#', en: '' }, { ar: 'الصنف', en: 'Item' }, { ar: 'المخزن', en: 'Warehouse' }, { ar: 'الكمية', en: 'Qty', n: 1 }, { ar: 'القيمة', en: 'Value', n: 1 }],
          rows: moves.map((m, k) => [k + 1, esc(m.itemCode + ' — ' + m.itemName), esc(m.whName), q3(m.qty), num(m.value)]),
          foot: adj ? [[{ t: 'الإجمالي / Total', span: 3 }, { t: q3(q), n: 1 }, { t: num(val), n: 1 }]] : null },
        sign: [['أمين المخزن', 'Storekeeper'], ['المحاسب', 'Accountant'], ['المدير', 'Manager']],
      };
    },
    // تقرير وردية نقطة بيع
    shift(s, sales) {
      const st = { OPEN: 'مفتوحة', CLOSED: 'مقفلة' }[s.status] || s.status;
      return {
        titleAr: 'تقرير وردية', titleEn: 'SHIFT REPORT', no: 'SH-' + s.id, windowTitle: 'وردية ' + s.id + ' — ' + s.regName,
        meta: [[['رقم الوردية', 'Shift No.', '<b dir="ltr">' + s.id + '</b>'], ['نقطة البيع', 'Register', esc(s.regName)]], [['الكاشير', 'Cashier', esc(s.cashier)], ['الحالة', 'Status', st]],
          [['فُتحت', 'Opened', '<span dir="ltr">' + esc(s.openedAt) + '</span>'], ['أُغلقت', 'Closed', s.closedAt ? '<span dir="ltr">' + esc(s.closedAt) + '</span>' : '—']]],
        stats: [['النقد الافتتاحي', num(s.openingCash)], ['مبيعات نقدية', num(s.cashSales)], ['مبيعات بطاقة', num(s.cardSales)], ['مرتجعات نقدية', num(s.cashRefunds)], ['إجمالي المبيعات', num(s.salesTotal)], ['المتوقع في الصندوق', num(s.status === 'OPEN' ? s.expectedCashNow : s.expectedCash)]],
        table: { cols: [{ ar: '#', en: '' }, { ar: 'العملية', en: 'Receipt' }, { ar: 'النوع', en: 'Type' }, { ar: 'التاريخ', en: 'Date' }, { ar: 'الإجمالي', en: 'Total', n: 1 }, { ar: 'الحالة', en: 'Status' }],
          rows: sales.map((x, k) => [k + 1, '<span dir="ltr">' + esc(x.no) + '</span>', x.kind === 'SALE' ? 'بيع' : 'مرتجع', esc(x.date), num(x.total), x.status === 'VOID' ? 'ملغاة' : 'مكتملة']) },
        note: s.status === 'CLOSED' ? 'المعدود ' + money(s.countedCash) + ' — الفرق ' + money(s.variance) + (s.variance ? ' (رُحّل إلى حساب فروقات الصندوق)' : ' (مطابق)') : 'وردية مفتوحة — لم يُعدّ الصندوق بعد',
        sign: [['الكاشير', 'Cashier'], ['المشرف', 'Supervisor'], ['المحاسب', 'Accountant']],
      };
    },
    // قيد إقفال السنة (من قيد الإقفال نفسه)
    yearClose(y, entry) {
      const lines = entry ? entry.lines : [];
      const td = lines.reduce((s, l) => s + l.debit, 0), tc = lines.reduce((s, l) => s + l.credit, 0);
      const reopened = y.status !== 'CLOSED';
      return {
        titleAr: 'مستند إقفال السنة المالية', titleEn: 'YEAR-END CLOSING VOUCHER', no: 'YC-' + y.yearEnd.slice(0, 4), windowTitle: 'إقفال سنة ' + y.yearEnd.slice(0, 4),
        meta: [[['نهاية السنة', 'Year End', '<b dir="ltr">' + esc(y.yearEnd) + '</b>'], ['الحالة', 'Status', reopened ? '<b>أُعيد فتحها</b>' : 'مقفلة']],
          [['صافي ' + (y.netIncome >= 0 ? 'الربح' : 'الخسارة'), 'Net ' + (y.netIncome >= 0 ? 'Profit' : 'Loss'), '<b dir="ltr">' + money(Math.abs(y.netIncome)) + '</b>'], ['قيد الإقفال', 'Closing Journal', y.entryId ? '<span dir="ltr">' + y.entryId + '</span>' : 'لا قيد (صافي صفر)']],
          [['نفّذه', 'Executed by', esc(y.changedBy || '—')], ['بتاريخ', 'On', '<span dir="ltr">' + esc(y.changedAt || '') + '</span>']]],
        table: entry ? { cols: [{ ar: '#', en: '' }, { ar: 'الحساب', en: 'Account' }, { ar: 'مدين', en: 'Debit', n: 1 }, { ar: 'دائن', en: 'Credit', n: 1 }],
          rows: lines.map((l, k) => [k + 1, esc(l.account) + ' — ' + esc(l.accountName), l.debit ? num(l.debit) : '', l.credit ? num(l.credit) : '']),
          foot: [[{ t: 'الإجمالي / Total', span: 2 }, { t: num(td), n: 1 }, { t: num(tc), n: 1 }]] } : null,
        words: Math.abs(y.netIncome), note: 'تُقفل حسابات الإيرادات والمصروفات وتُرحَّل النتيجة إلى الأرباح المبقاة.' + (reopened ? ' أُعيد فتح السنة بقيد عكسي رقم ' + (y.reopenEntryId || '—') + '.' : ''),
        sign: [['المحاسب', 'Accountant'], ['المدير المالي', 'Finance Manager'], ['المدير العام', 'General Manager']],
        actions: [...(y.entryId ? [{ label: 'فتح قيد الإقفال', href: '#/entry/view/' + y.entryId }] : []), ...(E.me.isAdmin ? [{ label: 'سجل العمليات', href: '#/settings/audit' }] : [])],
      };
    },
    // مستند إهلاك شهري للأصول
    depreciation(d) {
      const tot = d.rows.reduce((s, x) => s + x.amount, 0);
      return {
        titleAr: 'مستند إهلاك الأصول الثابتة', titleEn: 'FIXED ASSETS DEPRECIATION', no: 'DEP-' + d.period.slice(0, 7), windowTitle: 'إهلاك ' + d.period.slice(0, 7),
        meta: [[['الشهر', 'Period', '<b dir="ltr">' + esc(d.period.slice(0, 7)) + '</b>'], ['قيد الإهلاك', 'Journal No.', d.run ? '<span dir="ltr">' + d.run.entryId + '</span>' : '—']], [['عدد الأصول', 'Assets', String(d.rows.length)], ['نفّذه', 'Executed by', esc((d.run && d.run.createdBy) || '—')]]],
        table: { cols: [{ ar: '#', en: '' }, { ar: 'الأصل', en: 'Asset' }, { ar: 'الفئة', en: 'Category' }, { ar: 'التكلفة', en: 'Cost', n: 1 }, { ar: 'قسط الشهر', en: 'Month', n: 1 }, { ar: 'المجمّع', en: 'Accumulated', n: 1 }],
          rows: d.rows.map((x, k) => [k + 1, esc(x.code + ' — ' + x.name), esc(x.catName), num(x.cost), num(x.amount), num(x.accumulated)]),
          foot: [[{ t: 'الإجمالي / Total', span: 4 }, { t: num(tot), n: 1 }, { t: '', n: 1 }]] },
        totals: [['إجمالي الإهلاك', 'Total SAR', num(tot), 1]], words: tot, note: 'مدين: مصروف الإهلاك / دائن: مجمع الإهلاك.', sign: SIGN3,
        actions: [...(d.run ? [{ label: 'فتح قيد الإهلاك', href: '#/entry/view/' + d.run.entryId }] : []), ...(E.me.isAdmin ? [{ label: 'سجل العمليات', href: '#/settings/audit' }] : [])],
      };
    },
    // إشعار استلام بضاعة لأمر شراء
    receipt(o, r) {
      const rows = r.lines.map((l, k) => [k + 1, esc(l.description), q3(l.orderedQty), q3(l.qty), num(l.price), l.price !== l.poPrice ? '<span dir="ltr">' + money(l.poPrice) + '</span>' : '—', num(Math.round(l.qty * l.price * 100) / 100)]);
      const sub = Math.round(r.lines.reduce((s, l) => s + l.qty * l.price, 0) * 100) / 100;
      const vat = Math.round(r.lines.reduce((s, l) => s + l.qty * l.price * l.vatRate / 100, 0) * 100) / 100;
      return {
        titleAr: 'إشعار استلام بضاعة', titleEn: 'GOODS RECEIPT NOTE', no: 'GRN-' + r.id, windowTitle: 'إشعار استلام ' + r.id + ' — ' + o.no, phone: o.partyPhone, waAmount: sub + vat,
        meta: [[['رقم الاستلام', 'Receipt No.', '<b dir="ltr">GRN-' + r.id + '</b>'], ['تاريخ الاستلام', 'Receipt Date', '<b dir="ltr">' + esc(r.date) + '</b>']],
          [['أمر الشراء', 'PO No.', '<span dir="ltr">' + esc(o.no) + '</span>'], ['فاتورة المشتريات', 'Purchase Invoice', '<span dir="ltr">' + esc(r.invoiceNo) + '</span>']],
          [['الحالة', 'Status', r.status === 'VOID' ? '<b>ملغى</b>' : 'ساري'], ['استلمه', 'Received by', esc(r.createdBy || '—')]]],
        parties: [party(o.partyName, o.partyTaxNo, o.partyPhone, 'المورد', 'Supplier'), seller('المستلِم', 'Receiver')],
        table: { cols: [{ ar: '#', en: '' }, { ar: 'البيان', en: 'Description' }, { ar: 'كمية الأمر', en: 'Ordered', n: 1 }, { ar: 'المستلم الآن', en: 'Received', n: 1 }, { ar: 'سعر الفاتورة', en: 'Invoice Price', n: 1 }, { ar: 'سعر الأمر', en: 'PO Price', n: 1 }, { ar: 'القيمة', en: 'Value', n: 1 }], rows },
        totals: [['قيمة المستلم قبل الضريبة', 'Subtotal', num(sub)], ['الضريبة', 'VAT', num(vat)], ['الإجمالي', 'Total SAR', num(sub + vat), 1]], words: sub + vat, note: r.note,
        sign: [['أمين المخزن — الاستلام', 'Storekeeper'], ['المحاسب', 'Accountant'], ['المورد / المندوب', 'Supplier rep.']],
        actions: [{ label: 'فتح فاتورة المشتريات', href: '#/invoice/view/' + r.invoiceId }, ...(E.me.isAdmin ? [{ label: 'سجل العمليات', href: '#/settings/audit' }] : [])],
      };
    },
    // أمر شراء
    po(o, statusText) {
      return {
        titleAr: 'أمر شراء', titleEn: 'PURCHASE ORDER', no: o.no, windowTitle: 'أمر شراء ' + o.no, phone: o.partyPhone, waAmount: o.total,
        meta: [[['رقم الأمر', 'PO No.', '<b dir="ltr">' + esc(o.no) + '</b>'], ['التاريخ', 'Date', '<b dir="ltr">' + esc(o.date) + '</b>']],
          [['تاريخ التسليم المتوقع', 'Expected Delivery', esc(o.expected || '—')], ['الحالة', 'Status', esc(statusText || o.status)]],
          [['العملة', 'Currency', 'ريال سعودي SAR'], ['أنشأه / اعتمده', 'Created / Approved', esc(o.createdBy || '—') + (o.approvedBy ? ' / ' + esc(o.approvedBy) : '')]]],
        parties: [party(o.partyName, o.partyTaxNo, o.partyPhone, 'المورد', 'Supplier'), seller('المشتري', 'Buyer')],
        table: { cols: [{ ar: '#', en: '' }, { ar: 'البيان', en: 'Description' }, { ar: 'الكمية', en: 'Qty', n: 1 }, { ar: 'المستلم', en: 'Received', n: 1 }, { ar: 'السعر', en: 'Price', n: 1 }, { ar: 'الضريبة %', en: 'VAT %', n: 1 }, { ar: 'الصافي', en: 'Net', n: 1 }, { ar: 'الإجمالي', en: 'Amount', n: 1 }],
          rows: o.lines.map((l) => [l.no, esc(l.description), q3(l.qty), q3(l.received), num(l.price), l.vatRate + '%', num(l.net), num(l.net + l.vat)]) },
        totals: [['الإجمالي قبل الضريبة', 'Subtotal', num(o.subtotal)], ['ضريبة القيمة المضافة', 'VAT', num(o.vat)], ['الإجمالي', 'Total SAR', num(o.total), 1]],
        words: o.total, note: o.notes, sign: [['أعدّه', 'Prepared by'], ['اعتمده (المدير)', 'Approved by'], ['المورد — الاستلام والتوقيع', 'Supplier — Acknowledgement']],
        actions: E.me.isAdmin ? [{ label: 'سجل العمليات', href: '#/settings/audit' }] : [],
      };
    },
    // عرض سعر
    quote(q, statusText) {
      return {
        titleAr: 'عرض سعر', titleEn: 'QUOTATION', no: q.no, windowTitle: 'عرض سعر ' + q.no, phone: q.partyPhone, waAmount: q.total,
        meta: [[['رقم العرض', 'Quote No.', '<b dir="ltr">' + esc(q.no) + '</b>'], ['التاريخ', 'Date', '<b dir="ltr">' + esc(q.date) + '</b>']],
          [['صالح حتى', 'Valid Until', '<b dir="ltr">' + esc(q.validUntil) + '</b>'], ['الحالة', 'Status', esc(statusText || q.status)]],
          [['العملة', 'Currency', 'ريال سعودي SAR'], ['المرجع', 'Reference', q.revisionOf ? 'تعديل للعرض ' + q.revisionOf : '—']]],
        parties: [seller('مقدّم العرض', 'Supplier'), party(q.partyName, q.partyTaxNo, q.partyPhone, 'المقدَّم إليه', 'Customer')],
        table: { cols: [{ ar: '#', en: '' }, { ar: 'البيان', en: 'Description' }, { ar: 'الكمية', en: 'Qty', n: 1 }, { ar: 'سعر الوحدة', en: 'Unit Price', n: 1 }, { ar: 'الخصم %', en: 'Disc. %', n: 1 }, { ar: 'الضريبة %', en: 'VAT %', n: 1 }, { ar: 'الصافي', en: 'Net', n: 1 }, { ar: 'الإجمالي', en: 'Amount', n: 1 }],
          rows: q.lines.map((l) => [l.no, esc(l.description), q3(l.qty), num(l.unitNetPrice), l.discountPct + '%', l.vatRate + '%', num(l.net), num(l.net + l.vat)]) },
        totals: [['الإجمالي قبل الضريبة', 'Subtotal', num(q.subtotal)], ['ضريبة القيمة المضافة', 'VAT', num(q.vat)], ['الإجمالي', 'Total SAR', num(q.total), 1]],
        words: q.total, note: [q.notes, q.terms ? 'الشروط: ' + q.terms : ''].filter(Boolean).join(' — '), bank: true,
        sign: [['مقدّم العرض', 'Issued by'], ['اعتمده (المدير)', 'Approved by'], ['العميل — الموافقة والتوقيع', 'Customer — Acceptance']],
        actions: E.me.isAdmin ? [{ label: 'سجل العمليات', href: '#/settings/audit' }] : [],
      };
    },
    // سند قيد يومية
    entry(e) {
      const td = e.lines.reduce((s, l) => s + l.debit, 0), tc = e.lines.reduce((s, l) => s + l.credit, 0);
      return {
        titleAr: 'سند قيد يومية', titleEn: 'JOURNAL VOUCHER', no: 'JV-' + e.id, windowTitle: 'قيد ' + e.id,
        meta: [[['رقم القيد', 'Journal No.', '<b dir="ltr">' + e.id + '</b>'], ['التاريخ', 'Date', '<b dir="ltr">' + esc(e.date) + '</b>']], [['المرجع', 'Reference', esc(e.ref || '—')], ['أنشأه', 'Created by', esc(e.createdBy || '—')]]],
        table: { cols: [{ ar: '#', en: '' }, { ar: 'الحساب', en: 'Account' }, { ar: 'البيان', en: 'Note' }, { ar: 'مدين', en: 'Debit', n: 1 }, { ar: 'دائن', en: 'Credit', n: 1 }],
          rows: e.lines.map((l, k) => [k + 1, esc(l.account) + ' — ' + esc(l.accountName), esc(l.note || ''), l.debit ? num(l.debit) : '', l.credit ? num(l.credit) : '']),
          foot: [[{ t: 'الإجمالي / Total', span: 3 }, { t: num(td), n: 1 }, { t: num(tc), n: 1 }]] },
        note: e.memo, sign: SIGN3,
        actions: [...(E.can('accounting', 'w') ? [{ label: 'نسخ كقيد جديد', fn: (close) => { close(); E.prefill = { entry: { memo: e.memo, ref: e.ref, lines: e.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, note: l.note })) } }; location.hash = '#/entry/new'; } }] : []),
          ...(E.me.isAdmin ? [{ label: 'سجل العمليات', href: '#/settings/audit' }] : [])],
      };
    },
    // كشف حساب طرف
    statement(party_, rows) {
      const cust = party_.kind === 'CUSTOMER';
      const lines = rows.map((m) => {
        const desc = m.type === 'INVOICE' ? ['فاتورة ضريبية', m.no] : m.type === 'NOTE' ? ['إشعار', m.no] : [cust ? 'سند قبض' : 'سند صرف', '#' + m.no];
        return [esc(m.date), '<span dir="ltr">' + esc(desc[1]) + '</span>', desc[0], m.amount > 0 ? num(m.amount) : '', m.amount < 0 ? num(-m.amount) : '', num(m.balance)];
      });
      const first = rows.length ? rows[0].date : E.today();
      const sumD = rows.reduce((s, m) => s + (m.amount > 0 ? m.amount : 0), 0), sumC = rows.reduce((s, m) => s + (m.amount < 0 ? -m.amount : 0), 0);
      return {
        titleAr: 'كشف حساب', titleEn: cust ? 'CUSTOMER STATEMENT OF ACCOUNT' : 'SUPPLIER STATEMENT OF ACCOUNT', no: 'ST-' + party_.id, windowTitle: 'كشف حساب — ' + party_.name, phone: party_.phone, waAmount: party_.balance,
        meta: [[[cust ? 'العميل' : 'المورد', cust ? 'Customer' : 'Supplier', '<b>' + esc(party_.name) + '</b>'], ['الفترة', 'Period', 'من ' + esc(first) + ' إلى ' + E.today()]],
          [['الرصيد الافتتاحي', 'Opening Balance', '<span dir="ltr">0.00</span>'], ['الرصيد الختامي', 'Closing Balance', '<b dir="ltr">' + money(party_.balance) + '</b>']]],
        table: { cols: [{ ar: 'التاريخ', en: 'Date' }, { ar: 'المستند', en: 'Document' }, { ar: 'البيان', en: 'Description' }, { ar: 'مدين', en: 'Debit', n: 1 }, { ar: 'دائن', en: 'Credit', n: 1 }, { ar: 'الرصيد', en: 'Balance', n: 1 }],
          rows: lines, foot: [[{ t: 'الإجمالي / Total', span: 3 }, { t: num(sumD), n: 1 }, { t: num(sumC), n: 1 }, { t: num(party_.balance), n: 1 }]] },
        words: Math.abs(party_.balance), note: (party_.balance >= 0 ? (cust ? 'الرصيد المستحق عليكم' : 'الرصيد المستحق لكم') : 'رصيد دائن') + ' — تأمل مطابقة الكشف وإفادتنا بأي ملاحظات خلال (7) أيام من تاريخه، وإلا اعتُبر صحيحاً.',
        sign: [['المحاسب', 'Accountant'], ['المدير المالي', 'Finance Manager'], ['العميل — المطابقة والتوقيع', 'Customer — Confirmation']],
        actions: E.can('trade', 'w') ? [{ label: cust ? 'تسجيل سند قبض' : 'تسجيل سند صرف', cls: 'dark', href: '#/payment/new/' + party_.id }] : [],
      };
    },
  };
})(window.ERP);
