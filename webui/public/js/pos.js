'use strict';
(function (E) {
  const { esc, money, api } = E;
  const SK = { SALE: 'بيع', RETURN: 'مرتجع' };
  const stTag = (s) => s.status === 'VOID' ? '<span class="tag bad">ملغى</span>' : '<span class="tag good">مكتمل</span>';
  const q3 = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const num = (s) => { const n = parseFloat(String(s).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const r2 = (n) => Math.round(n * 100) / 100;

  // ---------- شاشة الكاشير ----------
  E.pages.posSell = async function (el, regParam) {
    const { registers } = await api('GET', '/pos/registers');
    const active = registers.filter((r) => r.active === 'Y');
    if (!active.length) { el.innerHTML = E.head('نقطة البيع') + '<div class="msg warn">لا نقاط بيع. أضف نقطة من <a href="#/pos/registers">هنا</a>.</div>'; return; }
    const reg = active.find((r) => String(r.id) === String(regParam)) || active.find((r) => r.openShiftId) || active[0];
    const head = '<div class="row noprint"><label>نقطة البيع<select id="reg">' + active.map((r) => '<option value="' + r.id + '"' + (r.id === reg.id ? ' selected' : '') + '>' + esc(r.name) + (r.openShiftId ? ' (وردية مفتوحة)' : '') + '</option>').join('') + '</select></label></div>';
    const wire = () => E.$('#reg', el).addEventListener('change', (ev) => { location.hash = '#/pos/sell/' + ev.target.value; });
    if (!reg.openShiftId) {
      el.innerHTML = E.head('نقطة البيع — ' + reg.name) + head + '<div class="card"><h3>لا توجد وردية مفتوحة</h3><form id="fo" class="row"><label>النقد الافتتاحي في الصندوق<input name="c" inputmode="decimal" value="0" size="10"></label><button class="btn">فتح وردية</button></form></div>';
      wire();
      E.$('#fo', el).addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api('POST', '/pos/shifts/open', { regId: reg.id, openingCash: new FormData(ev.target).get('c').replace(/,/g, '') }); E.toast('فُتحت الوردية'); E.pages.posSell(el, reg.id); } catch (e) { E.toast(e.message, true); } });
      return;
    }
    const cart = [];
    const incl = reg.pricesIncludeVat === 'Y';
    el.innerHTML = E.head('نقطة البيع — ' + reg.name, 'وردية رقم ' + reg.openShiftId + (incl ? ' · الأسعار شاملة الضريبة' : ' · الأسعار قبل الضريبة')) + head +
      '<div id="done"></div><div class="card"><div class="row"><label style="flex:1">الباركود أو الرمز (Enter)<input id="bc" autocomplete="off" autofocus></label>' +
      '<label>أو بحث بالاسم<input id="q" size="16" placeholder="اكتب ثم اختر"></label><label>الصنف<select id="pick"><option value="">—</option></select></label></div>' +
      '<table><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>خصم %</th><th class="n">الإجمالي</th><th></th></tr></thead><tbody id="cart"></tbody>' +
      '<tfoot><tr><td colspan="4">الإجمالي التقريبي (النهائي من الخادم)</td><td class="n" id="tot">0.00</td><td></td></tr></tfoot></table></div>' +
      '<div class="card"><h3>الدفع</h3><div class="row"><label>نقداً<input id="cash" inputmode="decimal" size="10"></label><label>بطاقة<input id="card" inputmode="decimal" size="10"></label>' +
      '<label>الباقي<input id="chg" size="10" readonly></label><button class="btn" id="go" data-act="sell">إتمام البيع</button> <button class="btn alt" data-act="clear">تفريغ السلة</button></div></div>';
    wire();
    const body = E.$('#cart', el);
    const lineTotal = (l) => { const net = l.qty * l.price * (1 - l.disc / 100); return r2(incl ? net : net * (1 + l.vat / 100)); };
    function render() {
      body.innerHTML = cart.map((l, i) => '<tr data-i="' + i + '"><td>' + esc(l.name) + (l.trackStock === 'Y' && l.onHand != null ? ' <span class="muted">(متاح ' + q3(l.onHand) + ')</span>' : '') + '</td>' +
        '<td><input class="cq" value="' + l.qty + '" size="5" inputmode="decimal"></td><td class="n">' + money(l.price) + '</td><td><input class="cd" value="' + l.disc + '" size="4" inputmode="decimal"></td>' +
        '<td class="n">' + money(lineTotal(l)) + '</td><td><button type="button" class="btn alt sm" data-act="rm" data-i="' + i + '">✕</button></td></tr>').join('') || '<tr><td colspan="6" class="muted">السلة فارغة — امسح باركود صنف</td></tr>';
      const t = r2(cart.reduce((s, l) => s + lineTotal(l), 0));
      E.$('#tot', el).textContent = money(t); calcChange();
    }
    const total = () => r2(cart.reduce((s, l) => s + lineTotal(l), 0));
    function calcChange() { const paid = num(E.$('#cash', el).value) + num(E.$('#card', el).value); E.$('#chg', el).value = paid > total() ? money(paid - total()) : ''; }
    function add(item) {
      const ex = cart.find((l) => l.id === item.id);
      if (ex) ex.qty = r2(ex.qty + 1); else cart.push({ id: item.id, name: item.name, price: item.price, vat: item.vat, qty: 1, disc: 0, trackStock: item.trackStock, onHand: item.onHand });
      render();
    }
    E.$('#bc', el).addEventListener('keydown', async (ev) => {
      if (ev.key !== 'Enter') return; ev.preventDefault();
      const code = ev.target.value.trim(); if (!code) return;
      try { add((await api('GET', '/pos/lookup?' + E.qs({ code, reg: reg.id }))).item); ev.target.value = ''; } catch (e) { E.toast(e.message, true); ev.target.select(); }
    });
    let timer;
    E.$('#q', el).addEventListener('input', (ev) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try { const { items } = await api('GET', '/pos/items?' + E.qs({ q: ev.target.value.trim() })); E.items = items;
          E.$('#pick', el).innerHTML = '<option value="">—</option>' + items.map((i) => '<option value="' + i.id + '">' + esc(i.code) + ' — ' + esc(i.name) + ' (' + money(i.price) + ')</option>').join(''); } catch (e) { E.toast(e.message, true); }
      }, 250);
    });
    E.$('#pick', el).addEventListener('change', async (ev) => {
      const it = (E.items || []).find((i) => String(i.id) === ev.target.value); if (!it) return;
      try { add((await api('GET', '/pos/lookup?' + E.qs({ code: it.barcode || it.code, reg: reg.id }))).item); } catch (e) { E.toast(e.message, true); }
      ev.target.value = '';
    });
    body.addEventListener('change', (ev) => {
      const i = Number(ev.target.closest('tr').dataset.i);
      if (ev.target.classList.contains('cq')) { const q = num(ev.target.value); if (q > 0) cart[i].qty = q; }
      if (ev.target.classList.contains('cd')) { const d = num(ev.target.value); cart[i].disc = d >= 0 && d <= 100 ? d : 0; }
      render();
    });
    el.addEventListener('input', (ev) => { if (ev.target.id === 'cash' || ev.target.id === 'card') calcChange(); });
    E.bind(el, {
      rm: (b) => { cart.splice(Number(b.dataset.i), 1); render(); },
      clear: () => { cart.length = 0; render(); },
      sell: (b) => E.busy(b, async () => {
        const payments = [];
        const cash = num(E.$('#cash', el).value), card = num(E.$('#card', el).value);
        if (cash > 0) payments.push({ method: 'CASH', amount: String(cash) });
        if (card > 0) payments.push({ method: 'CARD', amount: String(card) });
        const r = await api('POST', '/pos/sales', { shiftId: reg.openShiftId, date: E.today(), lines: cart.map((l) => ({ itemId: l.id, qty: l.qty, discountPct: l.disc || null })), payments });
        E.toast('تمت العملية ' + r.sale.no);
        cart.length = 0; E.$('#cash', el).value = ''; E.$('#card', el).value = ''; render();
        E.$('#done', el).innerHTML = '<div class="msg good">تم ' + esc(r.sale.no) + ' — الإجمالي <strong>' + money(r.sale.total) + '</strong>' + (r.sale.changeDue ? ' — الباقي للعميل <strong>' + money(r.sale.changeDue) + '</strong>' : '') + ' · <a href="#/pos/sale/' + r.sale.id + '">الإيصال</a></div>';
        E.$('#bc', el).focus();
      }),
    });
    render();
  };

  // ---------- الورديات ----------
  E.pages.posShifts = async function (el) {
    const { shifts } = await api('GET', '/pos/shifts');
    el.innerHTML = E.head('ورديات الصندوق') + '<p><a href="#/pos/sell">شاشة البيع (لفتح وردية)</a></p>' +
      (shifts.length ? '<table><thead><tr><th>#</th><th>النقطة</th><th>فُتحت</th><th class="n">المبيعات</th><th class="n">المرتجعات</th><th class="n">الفرق</th><th>الحالة</th></tr></thead><tbody>' +
        shifts.map((s) => '<tr><td><a href="#/pos/shift/' + s.id + '">' + s.id + '</a></td><td>' + esc(s.regName) + '</td><td>' + esc(s.openedAt) + '</td><td class="n">' + money(s.salesTotal) + ' (' + s.salesCount + ')</td><td class="n">' + money(s.returnsTotal) + '</td><td class="n">' + (s.variance == null ? '' : money(s.variance)) + '</td><td>' + (s.status === 'OPEN' ? '<span class="tag warn">مفتوحة</span>' : '<span class="tag">مغلقة</span>') + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا ورديات</div>');
  };

  E.pages.posShift = async function (el, id) {
    async function load() {
      const [{ shift: s }, { sales }] = await Promise.all([api('GET', '/pos/shifts/' + encodeURIComponent(id)), api('GET', '/pos/sales?shift=' + encodeURIComponent(id))]);
      const stat = (k, v) => '<div class="stat"><div class="k">' + k + '</div><div class="v">' + money(v) + '</div></div>';
      el.innerHTML = E.head('وردية ' + s.id + ' — ' + s.regName, 'الكاشير ' + s.cashier + ' · فُتحت ' + s.openedAt + (s.closedAt ? ' · أُغلقت ' + s.closedAt : '')) +
        '<div class="cards">' + stat('النقد الافتتاحي', s.openingCash) + stat('مبيعات نقدية (صافي الباقي)', s.cashSales) + stat('مبيعات بطاقة', s.cardSales) + stat('مرتجعات نقدية', s.cashRefunds) + stat('إجمالي المبيعات', s.salesTotal) + stat('ضريبة المبيعات', s.salesVat) + stat('المتوقع في الصندوق', s.status === 'OPEN' ? s.expectedCashNow : s.expectedCash) + '</div>' +
        (s.status === 'CLOSED' ? '<div class="msg ' + (s.variance === 0 ? 'good' : 'warn') + '">المعدود ' + money(s.countedCash) + ' — الفرق ' + money(s.variance) + (s.variance ? ' (رُحّل إلى 5800)' : '') + '</div>' :
          '<div class="card noprint"><h3>إقفال الوردية</h3><form id="fc" class="row"><label>النقد المعدود في الصندوق<input name="c" inputmode="decimal" required size="12"></label><button class="btn danger">إقفال الوردية</button></form><p class="muted">الفرق عن المتوقع يُرحَّل تلقائياً إلى فروقات الصندوق.</p></div>') +
        '<h3>العمليات</h3>' + salesTable(sales) + '<p class="noprint"><a href="#/pos/shifts">رجوع</a></p>';
      const fc = E.$('#fc', el);
      if (fc) fc.addEventListener('submit', async (ev) => { ev.preventDefault(); if (!confirm('إقفال الوردية؟ لا يمكن التراجع.')) return; try { const r = await api('POST', '/pos/shifts/' + id + '/close', { counted: new FormData(fc).get('c').replace(/,/g, '') }); E.toast('أُقفلت الوردية، الفرق ' + money(r.variance)); await load(); } catch (e) { E.toast(e.message, true); } });
    }
    await load();
  };

  function salesTable(sales) {
    return sales.length ? '<table><thead><tr><th>الرقم</th><th>النوع</th><th>التاريخ</th><th class="n">الإجمالي</th><th>الحالة</th></tr></thead><tbody>' +
      sales.map((x) => '<tr><td><a href="#/pos/sale/' + x.id + '">' + esc(x.no) + '</a></td><td>' + SK[x.kind] + '</td><td>' + esc(x.date) + '</td><td class="n">' + money(x.total) + '</td><td>' + stTag(x) + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا عمليات</div>';
  }

  E.pages.posSales = async function (el) {
    el.innerHTML = E.head('عمليات نقاط البيع') + '<form id="f" class="row noprint"><label>من<input type="date" name="f" value="' + E.today() + '"></label><label>إلى<input type="date" name="t" value="' + E.today() + '"></label><button class="btn">عرض</button></form><div id="out"></div>';
    async function go() { const f = new FormData(E.$('#f', el)); E.$('#out', el).innerHTML = salesTable((await api('GET', '/pos/sales?' + E.qs({ from: f.get('f'), to: f.get('t') }))).sales); }
    E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); go().catch((e) => E.toast(e.message, true)); });
    await go();
  };

  // ---------- الإيصال + إلغاء + مرتجع ----------
  E.pages.posSale = async function (el, id) {
    async function load() {
      const { sale: s } = await api('GET', '/pos/sales/' + encodeURIComponent(id));
      const { shifts } = await api('GET', '/pos/shifts?status=OPEN');
      const canReturn = s.kind === 'SALE' && s.status === 'COMPLETED' && s.lines.some((l) => l.returnable > 0);
      el.innerHTML = E.head('إيصال ' + s.no, SK[s.kind] + ' — ' + s.date) + E.taxHeader(s.kind === 'SALE' ? 'فاتورة ضريبية مبسطة' : 'إشعار دائن (مرتجع)', null, null, s.date, s.total, s.vat, s.kind === 'SALE' && s.status === 'COMPLETED') +
        '<p>' + stTag(s) + ' <span class="muted">قيد ' + s.entryId + (s.cogsEntryId ? ' · قيد التكلفة ' + s.cogsEntryId : '') + (s.origSaleId ? ' · مرتجع على <a href="#/pos/sale/' + s.origSaleId + '">عملية ' + s.origSaleId + '</a>' : '') + '</span></p>' +
        '<table><thead><tr><th>الصنف</th><th class="n">الكمية</th><th class="n">السعر</th><th>خصم %</th><th class="n">الصافي</th><th class="n">الضريبة</th>' + (canReturn ? '<th class="noprint">إرجاع</th>' : '') + '</tr></thead><tbody>' +
        s.lines.map((l) => '<tr><td>' + esc(l.description) + '</td><td class="n">' + q3(l.qty) + '</td><td class="n">' + money(l.price) + '</td><td>' + l.discountPct + '</td><td class="n">' + money(l.net) + '</td><td class="n">' + money(l.vat) + '</td>' +
          (canReturn ? '<td class="noprint">' + (l.returnable > 0 ? '<input class="rq" data-l="' + l.id + '" size="4" inputmode="decimal" placeholder="0" title="المتاح ' + q3(l.returnable) + '"> <span class="muted">/' + q3(l.returnable) + '</span>' : '<span class="muted">—</span>') + '</td>' : '') + '</tr>').join('') +
        '</tbody><tfoot><tr><td colspan="4">المجموع قبل الضريبة · الضريبة</td><td class="n">' + money(s.subtotal) + '</td><td class="n">' + money(s.vat) + '</td>' + (canReturn ? '<td></td>' : '') + '</tr><tr><td colspan="4">الإجمالي</td><td class="n" colspan="2">' + money(s.total) + '</td>' + (canReturn ? '<td></td>' : '') + '</tr></tfoot></table>' +
        '<p>' + s.payments.map((p) => (p.method === 'CASH' ? 'نقداً' : 'بطاقة') + ' ' + money(p.amount)).join(' · ') + (s.changeDue ? ' · الباقي ' + money(s.changeDue) : '') + '</p>' +
        (canReturn ? '<div class="card noprint"><h3>مرتجع</h3>' + (shifts.length ? '<form id="fr" class="row"><label>على وردية<select name="sh">' + shifts.map((x) => '<option value="' + x.id + '">' + x.id + ' — ' + esc(x.regName) + '</option>').join('') + '</select></label><label>رد المبلغ<select name="m"><option value="CASH">نقداً</option><option value="CARD">بطاقة</option></select></label><button class="btn">تنفيذ المرتجع</button></form><p class="muted">اكتب الكميات في عمود «إرجاع» أعلاه.</p>' : '<div class="msg warn">افتح وردية أولاً لتنفيذ مرتجع</div>') + '</div>' : '') +
        '<p class="noprint"><button class="btn alt" data-act="print">طباعة</button> ' + (s.status === 'COMPLETED' ? '<button class="btn danger sm" data-act="void">إلغاء العملية</button>' : '') + ' <a href="#/pos/sales">رجوع</a></p>';
      const fr = E.$('#fr', el);
      if (fr) fr.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = new FormData(fr);
        const lines = E.$$('.rq', el).map((i) => ({ lineId: Number(i.dataset.l), qty: i.value.replace(/,/g, '').trim() })).filter((l) => num(l.qty) > 0);
        try { const r = await api('POST', '/pos/sales/' + id + '/return', { shiftId: Number(f.get('sh')), date: E.today(), method: f.get('m'), lines }); E.toast('تم المرتجع ' + r.sale.no); location.hash = '#/pos/sale/' + r.sale.id; }
        catch (e) { E.toast(e.message, true); }
      });
    }
    E.bind(el, {
      print: () => window.print(),
      void: async () => { if (confirm('إلغاء العملية؟ مسموح فقط في وردية مفتوحة وبلا مرتجعات سارية.')) { await api('POST', '/pos/sales/' + encodeURIComponent(id) + '/void'); E.toast('أُلغيت العملية'); await load(); } },
    });
    await load();
  };

  // ---------- نقاط البيع ----------
  E.pages.posRegisters = async function (el) {
    const [{ registers }, { warehouses }, accts] = await Promise.all([api('GET', '/pos/registers'), api('GET', '/warehouses'), E.loadAccounts()]);
    el.innerHTML = E.head('نقاط البيع', 'كل نقطة مرتبطة بمخزن وبحساب صندوق، وبوردية مفتوحة واحدة كحد أقصى') +
      '<div class="card"><form id="f" class="row"><label>الرمز<input name="c" required maxlength="12" size="8"></label><label>الاسم<input name="n" required maxlength="120" size="18"></label>' +
      '<label>المخزن<select name="w">' + warehouses.map((w) => '<option value="' + w.id + '">' + esc(w.name) + '</option>').join('') + '</select></label>' +
      '<label>حساب الصندوق<select name="a">' + accts.filter((a) => a.active === 'Y' && !a.children).map((a) => '<option value="' + esc(a.code) + '"' + (a.code === '1100' ? ' selected' : '') + '>' + esc(a.code) + ' ' + esc(a.name) + '</option>').join('') + '</select></label>' +
      '<label>الأسعار شاملة الضريبة<select name="v"><option value="">لا</option><option value="1">نعم</option></select></label><button class="btn">إضافة</button></form></div>' +
      '<table><thead><tr><th>الرمز</th><th>الاسم</th><th>المخزن</th><th>الصندوق</th><th>الأسعار</th><th>الوردية</th></tr></thead><tbody>' +
      registers.map((r) => '<tr><td>' + esc(r.code) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.whName) + '</td><td>' + esc(r.cashAccount) + '</td><td>' + (r.pricesIncludeVat === 'Y' ? 'شاملة الضريبة' : 'قبل الضريبة') + '</td><td>' + (r.openShiftId ? '<a href="#/pos/shift/' + r.openShiftId + '">مفتوحة ' + r.openShiftId + '</a>' : '—') + '</td></tr>').join('') + '</tbody></table>';
    E.$('#f', el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try { await api('POST', '/pos/registers', { code: f.get('c').trim(), name: f.get('n').trim(), whId: Number(f.get('w')), cashAccount: f.get('a'), pricesIncludeVat: !!f.get('v') }); E.toast('أُضيفت النقطة'); E.pages.posRegisters(el); }
      catch (e) { E.toast(e.message, true); }
    });
  };
})(window.ERP);
