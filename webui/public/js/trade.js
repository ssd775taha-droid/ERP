'use strict';
(function (E) {
  const { esc, money, api } = E;
  const KIND = { SALES: 'مبيعات', PURCHASE: 'مشتريات' };
  const PKIND = { CUSTOMER: 'عميل', SUPPLIER: 'مورد' };
  const stTag = (i) => i.status === 'VOID' ? '<span class="tag bad">ملغاة</span>' : i.remaining <= 0 ? '<span class="tag good">مسدّدة</span>' : i.paid > 0 ? '<span class="tag warn">مسدّدة جزئياً</span>' : '<span class="tag">مفتوحة</span>';
  const num = (s) => { const n = parseFloat(String(s).replace(/,/g, '')); return isFinite(n) ? n : 0; };

  // ---------- العملاء / الموردون ----------
  function partiesPage(pk) {
    return async function (el) {
      async function load() {
        const { parties } = await api('GET', '/parties?kind=' + pk);
        const total = Math.round(parties.reduce((s, p) => s + p.balance, 0) * 100) / 100;
        el.innerHTML = E.head(pk === 'CUSTOMER' ? 'العملاء' : 'الموردون', pk === 'CUSTOMER' ? 'الرصيد الموجب = مستحق على العميل' : 'الرصيد الموجب = مستحق للمورد') +
          '<div class="card"><h3>' + (pk === 'CUSTOMER' ? 'عميل جديد' : 'مورد جديد') + '</h3><form id="f-p" class="row"><label>الاسم<input name="name" required maxlength="120" size="28"></label>' +
          '<label>الهاتف<input name="phone" maxlength="40"></label><label>الرقم الضريبي<input name="taxNo" maxlength="40"></label><button class="btn">إضافة</button></form></div>' +
          (parties.length ? '<table><thead><tr><th>الاسم</th><th>الهاتف</th><th>الرقم الضريبي</th><th class="n">الرصيد</th><th class="noprint"></th></tr></thead><tbody>' +
            parties.map((p) => '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.phone || '') + '</td><td>' + esc(p.taxNo || '') + '</td><td class="n">' + money(p.balance) + '</td><td class="noprint"><a href="#/party/statement/' + p.id + '">كشف حساب</a></td></tr>').join('') +
            '</tbody><tfoot><tr><td colspan="3">الإجمالي</td><td class="n">' + money(total) + '</td><td></td></tr></tfoot></table>' : '<div class="msg warn">لا يوجد بعد</div>');
        E.$('#f-p', el).addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const f = new FormData(ev.target);
          try { await api('POST', '/parties', { kind: pk, name: f.get('name').trim(), phone: f.get('phone').trim(), taxNo: f.get('taxNo').trim() }); E.toast('أُضيف'); await load(); }
          catch (e) { E.toast(e.message, true); }
        });
      }
      await load();
    };
  }
  E.pages.customers = partiesPage('CUSTOMER');
  E.pages.suppliers = partiesPage('SUPPLIER');

  E.pages.partyStatement = async function (el, id) {
    const { party, rows } = await api('GET', '/parties/' + encodeURIComponent(id) + '/statement');
    el.innerHTML = E.head('كشف حساب: ' + party.name, PKIND[party.kind] + ' — الرصيد الحالي ' + money(party.balance)) +
      '<p class="noprint"><button class="btn alt" data-act="print">طباعة</button> <a href="#/payment/new/' + party.id + '">+ سند ' + (party.kind === 'CUSTOMER' ? 'قبض' : 'صرف') + '</a></p>' +
      '<table><thead><tr><th>التاريخ</th><th>البيان</th><th class="n">المبلغ</th><th class="n">الرصيد</th></tr></thead><tbody>' +
      (rows.length ? rows.map((m) => '<tr><td>' + esc(m.date) + '</td><td>' + (m.type === 'INVOICE' ? '<a href="#/invoice/view/' + m.id + '">فاتورة ' + esc(m.no) + '</a>' : 'سند رقم ' + esc(m.no)) + '</td><td class="n">' + money(m.amount) + '</td><td class="n">' + money(m.balance) + '</td></tr>').join('') : '<tr><td colspan="4" class="muted">لا حركة</td></tr>') + '</tbody></table>';
    E.bind(el, { print: () => window.print() });
  };

  // ---------- قائمة الفواتير ----------
  function invoicesPage(kind) {
    return async function (el) {
      el.innerHTML = E.head('فواتير ' + KIND[kind]) +
        '<form id="f" class="row noprint"><label>من<input type="date" name="from" value="' + E.yearStart() + '"></label><label>إلى<input type="date" name="to" value="' + E.today() + '"></label>' +
        '<label>الحالة<select name="open"><option value="">الكل</option><option value="1">غير المسدّدة</option></select></label><button class="btn">عرض</button> ' +
        '<a href="#/invoice/new/' + kind + '" style="padding:7px 16px;border:1px solid var(--brand);border-radius:8px">+ فاتورة جديدة</a></form><div id="list"></div>';
      async function load() {
        const f = new FormData(E.$('#f', el));
        const { invoices } = await api('GET', '/invoices?' + E.qs({ kind, from: f.get('from'), to: f.get('to'), open: f.get('open'), limit: 300 }));
        const live = invoices.filter((i) => i.status === 'OPEN');
        E.$('#list', el).innerHTML = invoices.length ? '<table><thead><tr><th>الرقم</th><th>التاريخ</th><th>الطرف</th><th class="n">الإجمالي</th><th class="n">المسدد</th><th class="n">المتبقي</th><th>الحالة</th></tr></thead><tbody>' +
          invoices.map((i) => '<tr><td><a href="#/invoice/view/' + i.id + '">' + esc(i.no) + '</a></td><td>' + esc(i.date) + '</td><td>' + esc(i.partyName) + '</td><td class="n">' + money(i.total) + '</td><td class="n">' + money(i.paid) + '</td><td class="n">' + (i.status === 'OPEN' ? money(i.remaining) : '') + '</td><td>' + stTag(i) + '</td></tr>').join('') +
          '</tbody><tfoot><tr><td colspan="3">إجمالي غير الملغاة</td><td class="n">' + money(live.reduce((s, i) => s + i.total, 0)) + '</td><td class="n">' + money(live.reduce((s, i) => s + i.paid, 0)) + '</td><td class="n">' + money(live.reduce((s, i) => s + i.remaining, 0)) + '</td><td></td></tr></tfoot></table>'
          : '<div class="msg warn">لا فواتير</div>';
      }
      E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); load().catch((e) => E.toast(e.message, true)); });
      await load();
    };
  }
  E.pages.sales = invoicesPage('SALES');
  E.pages.purchases = invoicesPage('PURCHASE');

  // ---------- فاتورة جديدة ----------
  E.pages.invoiceNew = async function (el, kind) {
    kind = kind === 'PURCHASE' ? 'PURCHASE' : 'SALES';
    const pk = kind === 'SALES' ? 'CUSTOMER' : 'SUPPLIER';
    const [{ parties }, { items }, { warehouses }, accts] = await Promise.all([api('GET', '/parties?kind=' + pk), api('GET', '/items'), api('GET', '/warehouses'), E.loadAccounts()]);
    if (!parties.length) { el.innerHTML = E.head('فاتورة ' + KIND[kind]) + '<div class="msg warn">أضف ' + (pk === 'CUSTOMER' ? 'عميلاً' : 'مورداً') + ' أولاً من <a href="#/' + (pk === 'CUSTOMER' ? 'customers' : 'suppliers') + '">هنا</a>.</div>'; return; }
    const iopts = '<option value="">— بند حر —</option>' + items.map((i) => '<option value="' + i.id + '">' + esc(i.code) + ' — ' + esc(i.name) + '</option>').join('');
    const wopts = warehouses.map((w) => '<option value="' + w.id + '">' + esc(w.name) + '</option>').join('');
    const aopts = '<option value="">الافتراضي</option>' + accts.filter((a) => a.active === 'Y' && !a.children).map((a) => '<option value="' + esc(a.code) + '">' + esc(a.code) + ' ' + esc(a.name) + '</option>').join('');
    const line = () => '<tr class="ln"><td><select class="it">' + iopts + '</select></td><td><input class="ds" maxlength="200" placeholder="الوصف"></td><td><select class="wh" disabled>' + wopts + '</select></td>' +
      '<td><select class="ac">' + aopts + '</select></td><td><input class="q" inputmode="decimal" value="1" size="6"></td><td><input class="pr" inputmode="decimal" size="10"></td><td><input class="vt" inputmode="decimal" value="0" size="5"></td>' +
      '<td class="n tot">0.00</td><td><button type="button" class="btn alt sm" data-act="rm">✕</button></td></tr>';
    el.innerHTML = E.head('فاتورة ' + KIND[kind] + ' جديدة', 'الأصناف المخزنية تحرّك المخزون وتُرحَّل تكلفتها تلقائياً') + '<div class="card"><div class="row">' +
      '<label>' + PKIND[pk] + '<select id="pt">' + parties.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') + '</select></label>' +
      '<label>التاريخ<input type="date" id="dt" value="' + E.today() + '"></label><label>الاستحقاق<input type="date" id="du"></label><label>المرجع<input id="rf" maxlength="60"></label>' +
      '<label style="flex:1">ملاحظة<input id="nt" maxlength="300"></label></div>' +
      '<table><thead><tr><th>الصنف</th><th>الوصف</th><th>المخزن</th><th>الحساب</th><th>الكمية</th><th>السعر</th><th>ضريبة %</th><th class="n">الصافي</th><th></th></tr></thead><tbody id="lines">' + line() + '</tbody>' +
      '<tfoot><tr><td colspan="7">المجموع قبل الضريبة</td><td class="n" id="st">0.00</td><td></td></tr><tr><td colspan="7">الضريبة</td><td class="n" id="vt2">0.00</td><td></td></tr><tr><td colspan="7">الإجمالي</td><td class="n" id="tt">0.00</td><td></td></tr></tfoot></table>' +
      '<p><button type="button" class="btn alt" data-act="add">+ بند</button> <button type="button" class="btn" data-act="save">حفظ وترحيل الفاتورة</button></p></div>';
    const tb = E.$('#lines', el);
    function recalc() {
      let sub = 0, vat = 0;
      E.$$('.ln', tb).forEach((r) => {
        const net = Math.round(num(E.$('.q', r).value) * num(E.$('.pr', r).value) * 100) / 100;
        const vt = Math.round(net * num(E.$('.vt', r).value)) / 100;
        E.$('.tot', r).textContent = money(net); sub += net; vat += vt;
      });
      E.$('#st', el).textContent = money(sub); E.$('#vt2', el).textContent = money(vat); E.$('#tt', el).textContent = money(sub + vat);
    }
    tb.addEventListener('input', recalc);
    tb.addEventListener('change', (ev) => {
      if (!ev.target.classList.contains('it')) return;
      const r = ev.target.closest('.ln'), it = items.find((i) => String(i.id) === ev.target.value);
      E.$('.wh', r).disabled = !(it && it.trackStock === 'Y');
      if (it) {
        E.$('.ds', r).value = it.name;
        if (kind === 'SALES') { E.$('.pr', r).value = it.price; E.$('.vt', r).value = it.vat; }
        E.$('.ac', r).value = ''; E.$('.ac', r).disabled = true;
      } else E.$('.ac', r).disabled = false;
      recalc();
    });
    E.bind(el, {
      add: () => tb.insertAdjacentHTML('beforeend', line()),
      rm: (b) => { if (E.$$('.ln', tb).length > 1) { b.closest('tr').remove(); recalc(); } },
      save: (b) => E.busy(b, async () => {
        const lines = E.$$('.ln', tb).map((r) => {
          const it = E.$('.it', r).value;
          return { description: E.$('.ds', r).value.trim(), qty: E.$('.q', r).value.replace(/,/g, ''), price: E.$('.pr', r).value.replace(/,/g, '') || '0', vatRate: E.$('.vt', r).value || '0',
            account: E.$('.ac', r).value || null, itemId: it ? Number(it) : null, whId: it && !E.$('.wh', r).disabled ? Number(E.$('.wh', r).value) : null };
        });
        const r = await api('POST', '/invoices', { kind, partyId: Number(E.$('#pt', el).value), date: E.$('#dt', el).value, due: E.$('#du', el).value || null, ref: E.$('#rf', el).value.trim(), note: E.$('#nt', el).value.trim(), lines });
        E.toast('رُحّلت الفاتورة ' + r.invoice.no);
        location.hash = '#/invoice/view/' + r.invoice.id;
      }),
    });
  };

  // ---------- عرض فاتورة + سداد + إلغاء ----------
  E.pages.invoiceView = async function (el, id) {
    async function load() {
      const { invoice: i } = await api('GET', '/invoices/' + encodeURIComponent(id));
      const sales = i.kind === 'SALES';
      el.innerHTML = E.head('فاتورة ' + KIND[i.kind] + ' ' + i.no, i.partyName + ' — ' + i.date) +
        '<p>' + stTag(i) + ' <span class="muted">القيد ' + i.entryId + (i.cogsEntryId ? ' · قيد التكلفة ' + i.cogsEntryId : '') + (i.voidEntryId ? ' · القيد العكسي ' + i.voidEntryId : '') + '</span></p>' +
        '<table><thead><tr><th>الوصف</th><th class="n">الكمية</th><th class="n">السعر</th><th>ضريبة %</th><th class="n">الصافي</th><th class="n">الضريبة</th></tr></thead><tbody>' +
        i.lines.map((l) => '<tr><td>' + esc(l.description) + '</td><td class="n">' + l.qty + '</td><td class="n">' + money(l.price) + '</td><td>' + l.vatRate + '</td><td class="n">' + money(l.net) + '</td><td class="n">' + money(l.vat) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="4">المجموع</td><td class="n">' + money(i.subtotal) + '</td><td class="n">' + money(i.vat) + '</td></tr><tr><td colspan="4">الإجمالي · المسدد · المتبقي</td><td class="n" colspan="2">' + money(i.total) + ' · ' + money(i.paid) + ' · ' + money(i.remaining) + '</td></tr></tfoot></table>' +
        (i.note ? '<p>' + esc(i.note) + '</p>' : '') +
        (i.payments.length ? '<h3>المدفوعات</h3><table><tbody>' + i.payments.map((p) => '<tr><td>سند ' + p.id + '</td><td>' + esc(p.date) + '</td><td>' + (p.method === 'CASH' ? 'نقداً' : 'بنك') + '</td><td class="n">' + money(p.amount) + '</td></tr>').join('') + '</tbody></table>' : '') +
        (i.status === 'OPEN' ? '<div class="card noprint" style="margin-top:14px"><h3>' + (sales ? 'تسجيل قبض' : 'تسجيل صرف') + '</h3><form id="pf" class="row"><label>التاريخ<input type="date" name="d" value="' + E.today() + '"></label>' +
          '<label>المبلغ<input name="a" inputmode="decimal" value="' + i.remaining + '"></label><label>الطريقة<select name="m"><option value="CASH">نقداً</option><option value="BANK">بنك</option></select></label><button class="btn"' + (i.remaining <= 0 ? ' disabled' : '') + '>تسجيل</button></form>' +
          (i.paid === 0 ? '<button class="btn danger sm" data-act="void">إلغاء الفاتورة (قيد عكسي)</button>' : '<span class="muted">لا يمكن إلغاء فاتورة عليها مدفوعات</span>') + '</div>' : '') +
        '<p class="noprint"><button class="btn alt" data-act="print">طباعة</button> <a href="#/' + (sales ? 'sales' : 'purchases') + '">رجوع للقائمة</a></p>';
      const pf = E.$('#pf', el);
      if (pf) pf.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = new FormData(pf);
        try { await api('POST', '/payments', { partyId: i.partyId, invoiceId: i.id, date: f.get('d'), amount: String(f.get('a')).replace(/,/g, ''), method: f.get('m') }); E.toast('سُجّل السند'); await load(); }
        catch (e) { E.toast(e.message, true); }
      });
    }
    E.bind(el, {
      print: () => window.print(),
      void: async () => { if (confirm('إلغاء الفاتورة؟ سيُنشأ قيد عكسي (وتُعاد البضاعة للمخزن إن وُجدت).')) { await api('POST', '/invoices/' + encodeURIComponent(id) + '/void'); E.toast('أُلغيت الفاتورة'); await load(); } },
    });
    await load();
  };

  // ---------- السندات ----------
  E.pages.payments = async function (el) {
    const { payments } = await api('GET', '/payments');
    el.innerHTML = E.head('سندات القبض والصرف') + '<p class="noprint"><a href="#/payment/new">+ سند جديد (دفعة على الحساب)</a></p>' +
      (payments.length ? '<table><thead><tr><th>الرقم</th><th>النوع</th><th>التاريخ</th><th>الطرف</th><th>الفاتورة</th><th>الطريقة</th><th class="n">المبلغ</th></tr></thead><tbody>' +
        payments.map((p) => '<tr><td>' + p.id + '</td><td>' + (p.kind === 'RECEIPT' ? 'قبض' : 'صرف') + '</td><td>' + esc(p.date) + '</td><td>' + esc(p.partyName) + '</td><td>' + (p.invoiceId ? '<a href="#/invoice/view/' + p.invoiceId + '">' + esc(p.invoiceNo) + '</a>' : 'على الحساب') + '</td><td>' + (p.method === 'CASH' ? 'نقداً' : 'بنك') + '</td><td class="n">' + money(p.amount) + '</td></tr>').join('') + '</tbody></table>'
        : '<div class="msg warn">لا سندات</div>');
  };

  E.pages.paymentNew = async function (el, partyId) {
    const { parties } = await api('GET', '/parties');
    el.innerHTML = E.head('سند قبض / صرف', 'العميل = قبض، المورد = صرف. اختر فاتورة أو اتركها دفعة على الحساب') +
      '<div class="card"><form id="pf" class="row"><label>الطرف<select name="p">' + parties.map((p) => '<option value="' + p.id + '"' + (String(p.id) === String(partyId) ? ' selected' : '') + '>' + esc(p.name) + ' (' + PKIND[p.kind] + ')</option>').join('') + '</select></label>' +
      '<label>الفاتورة<select name="i"></select></label><label>التاريخ<input type="date" name="d" value="' + E.today() + '"></label><label>المبلغ<input name="a" inputmode="decimal" required></label>' +
      '<label>الطريقة<select name="m"><option value="CASH">نقداً</option><option value="BANK">بنك</option></select></label><label style="flex:1">ملاحظة<input name="n" maxlength="300"></label><button class="btn">تسجيل</button></form></div>';
    const f = E.$('#pf', el);
    async function fillInv() {
      const { invoices } = await api('GET', '/invoices?' + E.qs({ party: f.p.value, open: 1, limit: 200 }));
      f.i.innerHTML = '<option value="">دفعة على الحساب</option>' + invoices.map((x) => '<option value="' + x.id + '">' + esc(x.no) + ' — متبقٍ ' + money(x.remaining) + '</option>').join('');
    }
    f.p.addEventListener('change', () => fillInv().catch((e) => E.toast(e.message, true)));
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api('POST', '/payments', { partyId: Number(f.p.value), invoiceId: f.i.value ? Number(f.i.value) : null, date: f.d.value, amount: f.a.value.replace(/,/g, ''), method: f.m.value, note: f.n.value.trim() });
        E.toast('سُجّل السند'); location.hash = '#/payments';
      } catch (e) { E.toast(e.message, true); }
    });
    await fillInv();
  };

  // ---------- أعمار الديون ----------
  E.pages.aging = async function (el, kind) {
    kind = kind === 'PURCHASE' ? 'PURCHASE' : 'SALES';
    el.innerHTML = E.head('أعمار الديون', 'المتبقي من الفواتير المفتوحة حسب التأخر عن الاستحقاق (أو تاريخ الفاتورة إن لم يُحدَّد)') +
      '<form id="f" class="row noprint"><label>النوع<select name="kind"><option value="SALES"' + (kind === 'SALES' ? ' selected' : '') + '>العملاء (مبيعات)</option><option value="PURCHASE"' + (kind === 'PURCHASE' ? ' selected' : '') + '>الموردون (مشتريات)</option></select></label>' +
      '<label>بتاريخ<input type="date" name="asof" value="' + E.today() + '"></label><button class="btn">عرض</button> <button type="button" class="btn alt" data-act="print">طباعة</button></form><div id="out"></div>';
    async function go() {
      const f = new FormData(E.$('#f', el));
      const r = await api('GET', '/reports/aging?' + E.qs({ kind: f.get('kind'), asof: f.get('asof') }));
      const c = ['current', 'd30', 'd60', 'd90', 'd90plus', 'total'];
      E.$('#out', el).innerHTML = r.rows.length ? '<table><thead><tr><th>الطرف</th><th class="n">غير مستحق</th><th class="n">1-30</th><th class="n">31-60</th><th class="n">61-90</th><th class="n">+90</th><th class="n">الإجمالي</th></tr></thead><tbody>' +
        r.rows.map((x) => '<tr><td>' + esc(x.partyName) + '</td>' + c.map((k) => '<td class="n">' + (x[k] ? money(x[k]) : '') + '</td>').join('') + '</tr>').join('') +
        '</tbody><tfoot><tr><td>الإجمالي</td>' + c.map((k) => '<td class="n">' + money(r.totals[k]) + '</td>').join('') + '</tr></tfoot></table>' : '<div class="msg good">لا مستحقات مفتوحة</div>';
    }
    E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); go().catch((e) => E.toast(e.message, true)); });
    E.bind(el, { print: () => window.print() });
    await go();
  };
})(window.ERP);
