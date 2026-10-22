'use strict';
(function (E) {
  const { esc, money, api } = E;
  const num = (s) => { const n = parseFloat(String(s).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const r2 = (n) => Math.round(n * 100) / 100;
  const regKey = 'erp_cafe_reg';
  async function regs() {
    const { registers } = await api('GET', '/pos/registers');
    return registers.filter((r) => r.active === 'Y');
  }
  function pickReg(list) {
    const saved = Number(localStorage.getItem(regKey));
    return list.find((r) => r.id === saved) || list[0];
  }
  const regSelHtml = (list, cur) => list.length > 1 ? '<select id="regsel" class="noprint">' + list.map((r) => '<option value="' + r.id + '"' + (r.id === cur.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select>' : '';
  const autoPrintKitchen = () => { try { return localStorage.getItem('erp_cafe_autoprint_kitchen') !== '0'; } catch (e) { return true; } };   // مفعّلة افتراضياً

  const STATUS_LBL = { NEW: 'جديد', SENT: 'أُرسل للمطبخ', SERVED: 'قُدِّم', CANCELLED: 'أُلغي' };
  const lineHtml = (l) => '<div class="card cf-line" data-id="' + l.id + '">' +
    '<div class="row" style="justify-content:space-between;align-items:center">' +
    '<div><b>' + esc(E.q3 ? E.q3(l.qty) : l.qty) + '×</b> ' + esc(l.itemName) + (l.modText ? '<div class="muted" style="font-size:12px">' + esc(l.modText) + '</div>' : '') +
    (l.note ? '<div class="muted" style="font-size:12px">ملاحظة: ' + esc(l.note) + '</div>' : '') + '</div>' +
    '<div style="text-align:left"><div>' + money(l.qty * l.price) + '</div><span class="tag ' + (l.status === 'NEW' ? '' : l.status === 'SERVED' ? 'good' : l.status === 'CANCELLED' ? 'bad' : 'warn') + '">' + STATUS_LBL[l.status] + '</span></div></div>' +
    (l.status === 'NEW' || l.status === 'SENT' ? '<div class="noprint" style="margin-top:6px"><button class="btn alt sm" data-act="cf-rm" data-id="' + l.id + '">' + (l.status === 'NEW' ? 'حذف' : 'إلغاء') + '</button></div>' : '') + '</div>';

  // ---------- شاشة الطاولات ----------
  E.pages.cafeTables = async function (el) {
    const list = await regs();
    if (!list.length) { el.innerHTML = E.head('المقاهي — الطاولات', '') + E.err('لا نقاط بيع فعّالة. أضف نقطة من «نقاط البيع ‹ النقاط»'); return; }
    const reg = pickReg(list);
    async function load() {
      const [{ tables }, { orders: open }] = await Promise.all([api('GET', '/cafe/tables?regId=' + reg.id), api('GET', '/cafe/orders?status=OPEN&regId=' + reg.id)]);
      const takeaway = open.filter((o) => !o.tableId);
      const areas = [...new Set(tables.map((t) => t.areaName || 'بلا قسم'))];
      el.innerHTML = E.head('المقاهي — الطاولات', 'الأخضر فارغة، الكهرماني عليها طلب مفتوح') +
        '<div class="row noprint" style="margin-bottom:10px">' + regSelHtml(list, reg) + '<button class="btn" data-act="cf-new-take">طلب سفري جديد</button></div>' +
        (tables.length ? areas.map((a) => '<h3 class="sec">' + esc(a) + '</h3><div class="cf-grid">' +
          tables.filter((t) => (t.areaName || 'بلا قسم') === a).map((t) => '<button class="cf-table ' + (t.openOrderId ? 'busy' : 'free') + ' noprint" data-act="cf-open" data-table="' + t.id + '" data-order="' + (t.openOrderId || '') + '">' +
            '<b>' + esc(t.code) + '</b><div>' + esc(t.name) + '</div>' + (t.openOrderId ? '<div class="muted">' + money(t.runningTotal) + ' · ' + esc(t.openSince || '').slice(11) + '</div>' : '<div class="muted">' + t.seats + ' مقاعد</div>') + '</button>').join('') + '</div>').join('')
          : '<div class="msg warn">لا طاولات بعد. أضفها من «إعداد المقهى ‹ الأقسام والطاولات»</div>') +
        (takeaway.length ? '<h3 class="sec">طلبات سفرية مفتوحة</h3><div class="cf-grid">' +
          takeaway.map((o) => '<button class="cf-table busy noprint" data-act="cf-goto" data-order="' + o.id + '"><b>سفري #' + o.id + '</b><div>' + esc(o.openedAt || '').slice(11) + '</div></button>').join('') + '</div>' : '');
      E.bind(el, {
        'cf-new-take': (b) => E.busy(b, async () => { const r = await api('POST', '/cafe/orders/open', { regId: reg.id }); location.hash = '#/cafe/order/' + r.order.id; }),
        'cf-goto': (b) => { location.hash = '#/cafe/order/' + b.dataset.order; },
        'cf-open': async (b) => {
          if (b.dataset.order) { location.hash = '#/cafe/order/' + b.dataset.order; return; }
          try { const r = await api('POST', '/cafe/orders/open', { regId: reg.id, tableId: Number(b.dataset.table) }); location.hash = '#/cafe/order/' + r.order.id; }
          catch (e) { E.toast(e.message, true); }
        },
      });
      const sel = E.$('#regsel', el);
      if (sel) sel.addEventListener('change', () => { localStorage.setItem(regKey, sel.value); load(); });
    }
    await load();
  };

  // ---------- شاشة الطلب ----------
  E.pages.cafeOrder = async function (el, id) {
    id = Number(id);
    let menu = null;
    async function load() {
      const [order, m] = await Promise.all([api('GET', '/cafe/orders/' + id).then((r) => r.order), menu || api('GET', '/cafe/menu').then((r) => r.items)]);
      menu = Array.isArray(m) ? m : m;
      const title = order.tableName ? 'طاولة ' + order.tableCode + ' — ' + order.tableName : 'طلب سفري #' + order.id;
      const closed = order.status !== 'OPEN';
      el.innerHTML = E.head(title, (order.waiter ? 'النادل: ' + esc(order.waiter) + ' · ' : '') + (order.guests ? order.guests + ' ضيوف · ' : '') + 'فُتح ' + esc(order.openedAt)) +
        (closed ? '<div class="msg ' + (order.status === 'CANCELLED' ? 'bad' : 'good') + '">هذا الطلب ' + (order.status === 'CANCELLED' ? 'مُلغى' : ('مُغلق' + (order.saleId ? ' — عملية بيع رقم ' + order.saleId : ''))) + '</div>' : '') +
        (closed ? '' : '<div class="row noprint"><label style="flex:1">إضافة صنف<input id="cf-q" placeholder="اكتب اسم الصنف..." autocomplete="off"></label></div><div id="cf-pick"></div>') +
        '<div class="cards" style="margin:10px 0">' + '<div class="stat"><div class="muted">قبل الضريبة</div><b>' + money(order.subtotal) + '</b></div>' +
        '<div class="stat"><div class="muted">الضريبة</div><b>' + money(order.vat) + '</b></div>' + '<div class="stat"><div class="muted">الإجمالي (المطلوب تحصيله)</div><b>' + money(order.total) + '</b></div>' + '</div>' +
        (order.lines.length ? order.lines.map(lineHtml).join('') : '<div class="msg warn">لا بنود بعد</div>') +
        (closed ? '<div class="row noprint"><button class="btn alt" data-act="cf-print">طباعة الفاتورة</button></div>' :
          '<label class="chk noprint" style="display:block;margin-bottom:6px"><input type="checkbox" id="cf-ap"' + (autoPrintKitchen() ? ' checked' : '') + '> طباعة تذكرة المطبخ/البار تلقائياً عند الإرسال</label>' +
          '<div class="row noprint" style="margin-top:4px">' +
          '<button class="btn" data-act="cf-send">إرسال الجديد للمطبخ</button>' +
          '<button class="btn alt" data-act="cf-print">طباعة الفاتورة</button>' +
          '<button class="btn good" data-act="cf-pay">إغلاق ودفع</button>' +
          (order.tableId ? '<button class="btn alt" data-act="cf-transfer">نقل الطاولة</button>' : '') +
          '<button class="btn alt" data-act="cf-split">تقسيم الفاتورة</button>' +
          '<button class="btn alt" data-act="cf-merge">دمج مع طلب آخر</button>' +
          '<button class="btn danger" data-act="cf-cancel">إلغاء الطلب</button></div>');

      if (!closed) {
        const qi = E.$('#cf-q', el);
        qi.addEventListener('input', () => {
          const q = qi.value.trim().toLowerCase();
          const matches = q ? menu.filter((it) => it.name.toLowerCase().includes(q) || it.code.toLowerCase().includes(q)).slice(0, 12) : [];
          E.$('#cf-pick', el).innerHTML = matches.length ? '<div class="cf-grid">' + matches.map((it) => '<button class="cf-item noprint" data-act="cf-add" data-id="' + it.id + '"><b>' + esc(it.code) + '</b><div>' + esc(it.name) + '</div><div class="muted">' + money(it.price) + '</div></button>').join('') + '</div>' : '';
        });
        E.$('#cf-ap', el).addEventListener('change', (ev) => { try { localStorage.setItem('erp_cafe_autoprint_kitchen', ev.target.checked ? '1' : '0'); } catch (e) { /* التخزين غير متاح */ } });
      }
      E.bind(el, {
        'cf-add': async (b) => {
          const it = menu.find((x) => x.id === Number(b.dataset.id));
          if (!it) return;
          let optionIds = [], qty = 1, note = '';
          if (it.modifierGroups.length) {
            const r = await pickModifiers(it);
            if (!r) return;
            optionIds = r.optionIds; qty = r.qty; note = r.note;
          }
          try { await api('POST', '/cafe/orders/' + id + '/lines', { itemId: it.id, qty, optionIds, note: note || undefined }); E.$('#cf-q', el).value = ''; E.$('#cf-pick', el).innerHTML = ''; load(); }
          catch (e) { E.toast(e.message, true); }
        },
        'cf-rm': async (b) => { try { await api('DELETE', '/cafe/orders/lines/' + b.dataset.id); load(); } catch (e) { E.toast(e.message, true); } },
        'cf-send': (b) => E.busy(b, async () => {
          const newLines = order.lines.filter((l) => l.status === 'NEW');
          if (!newLines.length) { E.toast('لا بنود جديدة لإرسالها', true); return; }
          await api('POST', '/cafe/orders/' + id + '/send', {});
          E.toast('أُرسل للمطبخ');
          if (autoPrintKitchen()) E.printThermal(E.kitchenTicketHtml({
            table: order.tableName ? order.tableCode + ' — ' + order.tableName : null, orderId: order.id, at: E.today() + ' ' + new Date().toLocaleTimeString('ar'),
            items: newLines.map((l) => ({ qty: l.qty, name: l.itemName, mod: l.modText, note: l.note, station: l.station })),
          }));
          load();
        }),
        'cf-print': (b) => E.busy(b, async () => {
          if (order.status === 'CLOSED' && order.saleId) {
            const sale = (await api('GET', '/pos/sales/' + order.saleId)).sale;
            sale.cafeTable = order.tableName ? order.tableCode + ' — ' + order.tableName : null;
            E.openThermal(sale);
          } else {
            E.printThermal(E.cafePreBillHtml(order));
          }
        }),
        'cf-pay': () => payDialog(id, order.total, load),
        'cf-transfer': () => transferDialog(id, load),
        'cf-split': () => splitDialog(order, load),
        'cf-merge': () => mergeDialog(order, load),
        'cf-cancel': async () => { if (!confirm('إلغاء الطلب كاملاً؟')) return; try { await api('POST', '/cafe/orders/' + id + '/cancel', {}); location.hash = '#/cafe/tables'; } catch (e) { E.toast(e.message, true); } },
      });
    }
    await load();
  };

  // اختيار المقاسات/الإضافات قبل إضافة صنف له خيارات
  function pickModifiers(item) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog'); d.className = 'dlg';
      d.innerHTML = '<form method="dialog"><h3>' + esc(item.name) + '</h3>' +
        item.modifierGroups.map((g) => '<div class="dlg-f"><b>' + esc(g.name) + (g.required === 'Y' ? ' *' : '') + '</b>' +
          g.options.map((o) => '<label class="chk" style="display:block"><input type="' + (g.multi === 'Y' ? 'checkbox' : 'radio') + '" name="g' + g.id + '" value="' + o.id + '"> ' + esc(o.name) + (o.priceDelta ? ' (+' + money(o.priceDelta) + ')' : '') + '</label>').join('') + '</div>').join('') +
        '<label class="dlg-f">الكمية<input name="qty" type="number" value="1" min="1" step="1"></label>' +
        '<label class="dlg-f">ملاحظة<input name="note" maxlength="200"></label>' +
        '<div class="row" style="margin-top:12px"><button class="btn" value="ok">إضافة</button> <button type="button" class="btn alt" data-x>إلغاء</button></div></form>';
      document.body.appendChild(d);
      const done = (v) => { d.close(); d.remove(); resolve(v); };
      d.addEventListener('cancel', () => done(null));
      E.$('[data-x]', d).addEventListener('click', () => done(null));
      E.$('form', d).addEventListener('submit', (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        const optionIds = [];
        for (const g of item.modifierGroups) for (const v of fd.getAll('g' + g.id)) optionIds.push(Number(v));
        const missing = item.modifierGroups.find((g) => g.required === 'Y' && !fd.getAll('g' + g.id).length);
        if (missing) { alert('اختر ' + missing.name); return; }
        done({ optionIds, qty: Number(fd.get('qty')) || 1, note: (fd.get('note') || '').trim() });
      });
      d.showModal();
    });
  }

  function payDialog(orderId, due, reload) {
    const d = document.createElement('dialog'); d.className = 'dlg';
    d.innerHTML = '<form method="dialog"><h3>إغلاق الطلب ودفعه</h3>' +
      '<p class="muted">المطلوب تحصيله: ' + money(due) + '</p><label class="dlg-f">نقداً<input name="cash" inputmode="decimal" value="' + due + '"></label>' +
      '<label class="dlg-f">بطاقة<input name="card" inputmode="decimal"></label>' +
      '<div class="row" style="margin-top:12px"><button class="btn good" value="ok">تم الدفع</button> <button type="button" class="btn alt" data-x>إلغاء</button></div></form>';
    document.body.appendChild(d);
    const close = () => { d.close(); d.remove(); };
    E.$('[data-x]', d).addEventListener('click', close);
    d.addEventListener('cancel', close);
    E.$('form', d).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const cash = num(fd.get('cash')), card = num(fd.get('card'));
      const payments = [];
      if (cash > 0) payments.push({ method: 'CASH', amount: cash });
      if (card > 0) payments.push({ method: 'CARD', amount: card });
      if (!payments.length) { alert('أدخل مبلغاً'); return; }
      try { const r = await api('POST', '/cafe/orders/' + orderId + '/close', { payments }); E.toast('أُغلق الطلب — عملية بيع رقم ' + r.saleId); close(); reload(); }
      catch (e) { alert(e.message); }
    });
    d.showModal();
  }

  async function transferDialog(orderId, reload) {
    const order = await api('GET', '/cafe/orders/' + orderId).then((r) => r.order);
    const { tables } = await api('GET', '/cafe/tables?regId=' + order.regId);
    const free = tables.filter((t) => t.active === 'Y' && !t.openOrderId && t.id !== order.tableId);
    if (!free.length) { alert('لا طاولات فارغة الآن'); return; }
    const opts = free.map((t) => [t.id, t.code + ' — ' + t.name]);
    const v = await E.dialog('نقل الطاولة', [{ name: 'tableId', label: 'إلى طاولة', options: opts }], 'نقل');
    if (!v) return;
    try { await api('POST', '/cafe/orders/' + orderId + '/transfer', { tableId: Number(v.tableId) }); E.toast('نُقل الطلب'); reload(); } catch (e) { E.toast(e.message, true); }
  }

  async function splitDialog(order, reload) {
    const movable = order.lines.filter((l) => l.status !== 'CANCELLED');
    if (movable.length < 2) { alert('لا بنود كافية للتقسيم'); return; }
    const d = document.createElement('dialog'); d.className = 'dlg';
    d.innerHTML = '<form method="dialog"><h3>تقسيم الفاتورة</h3><p class="muted">حدّد البنود التي تنتقل إلى فاتورة جديدة</p>' +
      movable.map((l) => '<label class="chk" style="display:block"><input type="checkbox" name="l" value="' + l.id + '"> ' + esc(l.qty + '× ' + l.itemName) + ' — ' + money(l.qty * l.price) + '</label>').join('') +
      '<div class="row" style="margin-top:12px"><button class="btn" value="ok">تقسيم</button> <button type="button" class="btn alt" data-x>إلغاء</button></div></form>';
    document.body.appendChild(d);
    const close = () => { d.close(); d.remove(); };
    E.$('[data-x]', d).addEventListener('click', close); d.addEventListener('cancel', close);
    E.$('form', d).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const ids = [...new FormData(ev.target).getAll('l')].map(Number);
      if (!ids.length) { alert('حدّد بنداً واحداً على الأقل'); return; }
      try { const r = await api('POST', '/cafe/orders/' + order.id + '/split', { lineIds: ids }); E.toast('فُصلت فاتورة جديدة رقم ' + r.newOrder.id); close(); reload(); }
      catch (e) { alert(e.message); }
    });
    d.showModal();
  }

  async function mergeDialog(order, reload) {
    const { orders } = await api('GET', '/cafe/orders?status=OPEN&regId=' + order.regId);
    const others = orders.filter((o) => o.id !== order.id);
    if (!others.length) { alert('لا طلبات مفتوحة أخرى'); return; }
    const opts = others.map((o) => [o.id, o.tableName ? 'طاولة ' + o.tableCode : 'سفري #' + o.id]);
    const v = await E.dialog('دمج مع طلب آخر', [{ name: 'into', label: 'دمج هذا الطلب في', options: opts }], 'دمج');
    if (!v) return;
    try { await api('POST', '/cafe/orders/' + order.id + '/merge', { intoOrderId: Number(v.into) }); E.toast('دُمج الطلب'); location.hash = '#/cafe/order/' + v.into; }
    catch (e) { E.toast(e.message, true); }
  }

  // ---------- شاشة المطبخ/البار ----------
  E.pages.cafeKitchen = async function (el) {
    let station = localStorage.getItem('erp_cafe_station') || 'KITCHEN';
    let timer = null;
    async function load() {
      const { lines } = await api('GET', '/cafe/kitchen?station=' + station);
      el.innerHTML = '<div class="row noprint" style="margin-bottom:10px">' +
        '<button class="btn ' + (station === 'KITCHEN' ? '' : 'alt') + '" data-act="cf-st" data-s="KITCHEN">المطبخ</button>' +
        '<button class="btn ' + (station === 'BAR' ? '' : 'alt') + '" data-act="cf-st" data-s="BAR">البار</button></div>' +
        (lines.length ? '<div class="cf-grid cf-tickets">' + lines.map((l) => '<div class="card cf-ticket ' + (l.minutesAgo >= 10 ? 'late' : '') + '">' +
          '<b>' + esc(l.tableName ? l.tableCode + ' ' + l.tableName : 'سفري #' + l.orderId) + '</b>' +
          '<div style="font-size:18px;margin:6px 0">' + esc(l.qty + '× ' + l.itemName) + '</div>' +
          (l.modText ? '<div class="muted">' + esc(l.modText) + '</div>' : '') + (l.note ? '<div class="muted">ملاحظة: ' + esc(l.note) + '</div>' : '') +
          '<div class="muted" style="margin:6px 0">منذ ' + l.minutesAgo + ' د</div>' +
          '<button class="btn good noprint" data-act="cf-serve" data-id="' + l.id + '">جاهز</button></div>').join('') + '</div>'
          : '<div class="msg good">لا طلبات معلّقة</div>');
      E.bind(el, {
        'cf-st': (b) => { station = b.dataset.s; localStorage.setItem('erp_cafe_station', station); load(); },
        'cf-serve': async (b) => { try { await api('POST', '/cafe/lines/serve', { lineIds: [Number(b.dataset.id)] }); load(); } catch (e) { E.toast(e.message, true); } },
      });
    }
    await load();
    timer = setInterval(() => { if (el.isConnected) load(); else clearInterval(timer); }, 6000);
  };

  // ---------- إعداد المقهى: الأقسام والطاولات ----------
  E.pages.cafeFloor = async function (el) {
    const list = await regs();
    if (!list.length) { el.innerHTML = E.err('أضف نقطة بيع أولاً'); return; }
    const reg = pickReg(list);
    async function load() {
      const [{ areas }, { tables }] = await Promise.all([api('GET', '/cafe/areas?regId=' + reg.id), api('GET', '/cafe/tables?regId=' + reg.id)]);
      el.innerHTML = E.head('الأقسام والطاولات', 'نقطة البيع: ' + esc(reg.name)) + regSelHtml(list, reg) +
        '<div class="card"><h3>قسم جديد</h3><form id="fa" class="row"><label>الاسم<input name="name" required maxlength="60"></label><button class="btn">إضافة</button></form></div>' +
        '<h3 class="sec">الأقسام</h3>' + (areas.length ? '<table><tbody>' + areas.map((a) => '<tr><td>' + esc(a.name) + '</td><td class="noprint"><button class="btn alt sm" data-act="da" data-id="' + a.id + '">حذف</button></td></tr>').join('') + '</tbody></table>' : '<div class="muted">لا أقسام بعد</div>') +
        '<div class="card"><h3>طاولة جديدة</h3><form id="ft" class="row"><label>الرمز<input name="code" required maxlength="12" size="8"></label><label>الاسم<input name="name" required maxlength="80"></label>' +
        '<label>المقاعد<input name="seats" type="number" value="4" min="1" size="4"></label><label>القسم<select name="areaId"><option value="">—</option>' + areas.map((a) => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('') + '</select></label><button class="btn">إضافة</button></form></div>' +
        '<h3 class="sec">الطاولات</h3>' + (tables.length ? '<table><thead><tr><th>الرمز</th><th>الاسم</th><th>القسم</th><th>المقاعد</th><th>الحالة</th><th class="noprint"></th></tr></thead><tbody>' +
          tables.map((t) => '<tr><td>' + esc(t.code) + '</td><td>' + esc(t.name) + '</td><td>' + esc(t.areaName || '—') + '</td><td>' + t.seats + '</td><td>' + (t.active === 'Y' ? 'فعّالة' : 'معطّلة') + '</td>' +
            '<td class="noprint"><button class="btn alt sm" data-act="tg" data-id="' + t.id + '" data-a="' + (t.active === 'Y' ? 'N' : 'Y') + '">' + (t.active === 'Y' ? 'تعطيل' : 'تفعيل') + '</button> <button class="btn danger sm" data-act="dt" data-id="' + t.id + '">حذف</button></td></tr>').join('') + '</tbody></table>' : '<div class="muted">لا طاولات بعد</div>');
      E.$('#fa', el).addEventListener('submit', async (ev) => { ev.preventDefault(); const f = new FormData(ev.target); try { await api('POST', '/cafe/areas', { regId: reg.id, name: f.get('name').trim() }); load(); } catch (e) { E.toast(e.message, true); } });
      E.$('#ft', el).addEventListener('submit', async (ev) => { ev.preventDefault(); const f = new FormData(ev.target); try { await api('POST', '/cafe/tables', { regId: reg.id, code: f.get('code').trim(), name: f.get('name').trim(), seats: f.get('seats'), areaId: f.get('areaId') || null }); load(); } catch (e) { E.toast(e.message, true); } });
      E.bind(el, {
        da: async (b) => { if (!confirm('حذف القسم؟')) return; try { await api('DELETE', '/cafe/areas/' + b.dataset.id); load(); } catch (e) { E.toast(e.message, true); } },
        dt: async (b) => { if (!confirm('حذف الطاولة؟')) return; try { await api('DELETE', '/cafe/tables/' + b.dataset.id); load(); } catch (e) { E.toast(e.message, true); } },
        tg: async (b) => { await api('PATCH', '/cafe/tables/' + b.dataset.id, { active: b.dataset.a === 'Y' }); load(); },
      });
      const sel = E.$('#regsel', el); if (sel) sel.addEventListener('change', () => { localStorage.setItem(regKey, sel.value); load(); });
    }
    await load();
  };

  // ---------- إعداد المقهى: خيارات الأصناف (مقاسات وإضافات) ----------
  E.pages.cafeModifiers = async function (el) {
    async function load() {
      const [{ groups }, { items }] = await Promise.all([api('GET', '/cafe/modifier-groups'), api('GET', '/inventory/items')]);
      el.innerHTML = E.head('خيارات الأصناف', 'مجموعات مثل «المقاس» (اختيار واحد إلزامي) أو «إضافات» (اختيار متعدد اختياري) بسعر إضافي لكل خيار') +
        '<div class="card"><h3>مجموعة جديدة</h3><form id="fg" class="row"><label>الاسم<input name="name" required maxlength="80" placeholder="مثال: المقاس"></label>' +
        '<label class="chk"><input type="checkbox" name="required"> إلزامية</label><label class="chk"><input type="checkbox" name="multi"> اختيار متعدد</label><button class="btn">إضافة</button></form></div>' +
        groups.map((g) => '<div class="card"><h3>' + esc(g.name) + (g.required === 'Y' ? ' <span class="tag warn">إلزامية</span>' : '') + (g.multi === 'Y' ? ' <span class="tag">متعدد</span>' : '') + ' <span class="noprint"><button class="btn alt sm" data-act="dg" data-id="' + g.id + '">حذف المجموعة</button></span></h3>' +
          (g.options.length ? '<table><tbody>' + g.options.map((o) => '<tr><td>' + esc(o.name) + '</td><td>+' + money(o.priceDelta) + '</td><td class="noprint"><button class="btn alt sm" data-act="do" data-id="' + o.id + '">حذف</button></td></tr>').join('') + '</tbody></table>' : '<div class="muted">لا خيارات بعد</div>') +
          '<form class="row noprint" data-gid="' + g.id + '"><label>خيار جديد<input name="name" required maxlength="80" size="12"></label><label>سعر إضافي<input name="priceDelta" inputmode="decimal" size="6" value="0"></label><button class="btn alt sm">إضافة</button></form></div>').join('') +
        '<div class="card"><h3>ربط الخيارات بالأصناف</h3><label>الصنف<select id="cf-item"><option value="">اختر صنفاً…</option>' + items.map((it) => '<option value="' + it.id + '">' + esc(it.code) + ' — ' + esc(it.name) + '</option>').join('') + '</select></label><div id="cf-link"></div></div>';
      E.$('#fg', el).addEventListener('submit', async (ev) => { ev.preventDefault(); const f = new FormData(ev.target); try { await api('POST', '/cafe/modifier-groups', { name: f.get('name').trim(), required: !!f.get('required'), multi: !!f.get('multi') }); load(); } catch (e) { E.toast(e.message, true); } });
      E.$$('form[data-gid]', el).forEach((f) => f.addEventListener('submit', async (ev) => { ev.preventDefault(); const fd = new FormData(ev.target); try { await api('POST', '/cafe/modifier-groups/' + f.dataset.gid + '/options', { name: fd.get('name').trim(), priceDelta: fd.get('priceDelta') }); load(); } catch (e) { E.toast(e.message, true); } }));
      E.bind(el, {
        dg: async (b) => { if (!confirm('حذف المجموعة بخياراتها؟')) return; await api('DELETE', '/cafe/modifier-groups/' + b.dataset.id); load(); },
        do: async (b) => { await api('DELETE', '/cafe/modifier-options/' + b.dataset.id); load(); },
      });
      E.$('#cf-item', el).addEventListener('change', async (ev) => {
        const id = ev.target.value, box = E.$('#cf-link', el);
        if (!id) { box.innerHTML = ''; return; }
        const linked = new Set((await api('GET', '/cafe/items/' + id + '/modifier-groups')).groupIds);
        box.innerHTML = '<form id="fl">' + groups.map((g) => '<label class="chk" style="display:block"><input type="checkbox" name="g" value="' + g.id + '"' + (linked.has(g.id) ? ' checked' : '') + '> ' + esc(g.name) + '</label>').join('') + '<button class="btn sm" style="margin-top:8px">حفظ</button></form>';
        E.$('#fl', box).addEventListener('submit', async (ev2) => { ev2.preventDefault(); const ids = [...new FormData(ev2.target).getAll('g')].map(Number); await api('PUT', '/cafe/items/' + id + '/modifier-groups', { groupIds: ids }); E.toast('حُفظ'); });
      });
    }
    await load();
  };
})(window.ERP);
