'use strict';
(function (E) {
  const { esc, money, api } = E;
  const TYPE = { PURCHASE: 'شراء', SALE: 'بيع', ADJUST: 'تسوية', TRANSFER: 'تحويل', REVERSAL: 'عكس' };
  const q3 = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const opt = (rows, sel) => rows.map((x) => '<option value="' + x.id + '"' + (String(x.id) === String(sel) ? ' selected' : '') + '>' + esc(x.code) + ' — ' + esc(x.name) + '</option>').join('');

  // ---------- الأصناف ----------
  E.pages.invItems = async function (el) {
    const [{ items }, accts] = await Promise.all([api('GET', '/inventory/items'), E.loadAccounts()]);
    const ao = (def) => accts.filter((a) => a.active === 'Y' && !a.children).map((a) => '<option value="' + esc(a.code) + '"' + (a.code === def ? ' selected' : '') + '>' + esc(a.code) + ' ' + esc(a.name) + '</option>').join('');
    el.innerHTML = E.head('الأصناف', 'الصنف الذي عليه حركة لا تتغير حساباته؛ يمكن تعديل السعر والضريبة وإيقافه') +
      '<div class="card"><h3>صنف جديد</h3><form id="f" class="row"><label>الرمز<input name="code" required maxlength="30" size="10"></label><label>الاسم<input name="name" required maxlength="120" size="22"></label>' +
      '<label>الوحدة<input name="unit" maxlength="20" size="8" placeholder="قطعة"></label><label>سعر البيع<input name="price" inputmode="decimal" size="9" value="0"></label><label>ضريبة %<input name="vat" inputmode="decimal" size="5" value="' + E.tax.vatRate + '"></label>' +
      '<label>الباركود<input name="barcode" maxlength="40" size="12"></label><label>مخزني؟<select name="track"><option value="Y">نعم</option><option value="N">خدمة (بلا مخزون)</option></select></label>' +
      '<label>حساب المخزون<select name="inv">' + ao('1400') + '</select></label><label>حساب التكلفة<select name="cogs">' + ao('5100') + '</select></label><label>حساب الإيراد<select name="rev">' + ao('4100') + '</select></label>' +
      '<button class="btn">إضافة</button></form></div>' +
      (items.length ? '<table><thead><tr><th>الرمز</th><th>الاسم</th><th>الوحدة</th><th class="n">السعر</th><th>ضريبة %</th><th class="n">الكمية</th><th class="n">القيمة</th><th>الحالة</th><th class="noprint"></th></tr></thead><tbody>' +
        items.map((i) => '<tr><td>' + esc(i.code) + '</td><td>' + esc(i.name) + (i.trackStock === 'N' ? ' <span class="tag">خدمة</span>' : '') + '</td><td>' + esc(i.unit) + '</td><td class="n">' + money(i.price) + '</td><td>' + i.vat + '</td><td class="n">' + (i.trackStock === 'Y' ? q3(i.qty) : '') + '</td><td class="n">' + (i.trackStock === 'Y' ? money(i.value) : '') + '</td>' +
          '<td>' + (i.active === 'Y' ? '<span class="tag good">فعّال</span>' : '<span class="tag bad">موقوف</span>') + '</td><td class="noprint"><button class="btn alt sm" data-act="price" data-id="' + i.id + '" data-price="' + i.price + '" data-vat="' + i.vat + '">السعر</button> ' +
          '<button class="btn alt sm" data-act="toggle" data-id="' + i.id + '" data-active="' + i.active + '">' + (i.active === 'Y' ? 'إيقاف' : 'تفعيل') + '</button> ' + E.crudBtns('item', { id: i.id, name: i.name, price: i.price, vat: i.vat }) + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا أصناف بعد</div>');
    E.$('#f', el).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        await api('POST', '/inventory/items', { code: f.get('code').trim(), name: f.get('name').trim(), unit: f.get('unit').trim(), price: f.get('price').replace(/,/g, ''), vat: f.get('vat'),
          barcode: f.get('barcode').trim(), trackStock: f.get('track') === 'Y', invAccount: f.get('inv'), cogsAccount: f.get('cogs'), revAccount: f.get('rev') });
        E.toast('أُضيف الصنف'); E.pages.invItems(el);
      } catch (e) { E.toast(e.message, true); }
    });
    E.crudBind(el, () => E.pages.invItems(el));
    if (!el._b) {
      el._b = true;
      E.bind(el, {
        price: async (b) => {
          const p = prompt('سعر البيع الجديد', b.dataset.price); if (p === null) return;
          const t = prompt('نسبة الضريبة %', b.dataset.vat); if (t === null) return;
          await api('PATCH', '/inventory/items/' + b.dataset.id, { price: p.replace(/,/g, ''), vat: t }); E.toast('تم التعديل'); E.pages.invItems(el);
        },
        toggle: async (b) => { await api('PATCH', '/inventory/items/' + b.dataset.id, { active: b.dataset.active !== 'Y' }); E.toast('تم التحديث'); E.pages.invItems(el); },
      });
    }
  };

  // ---------- المخازن ----------
  E.pages.invWarehouses = async function (el) {
    const { warehouses } = await api('GET', '/inventory/warehouses');
    el.innerHTML = E.head('المخازن') + '<div class="card"><h3>مخزن جديد</h3><form id="f" class="row"><label>الرمز<input name="code" required maxlength="12" size="8"></label><label>الاسم<input name="name" required maxlength="120" size="24"></label><button class="btn">إضافة</button></form></div>' +
      '<table><thead><tr><th>الرمز</th><th>الاسم</th><th class="n">قيمة المخزون</th><th>الحالة</th><th class="noprint"></th></tr></thead><tbody>' +
      warehouses.map((w) => '<tr><td>' + esc(w.code) + '</td><td>' + esc(w.name) + '</td><td class="n">' + money(w.value) + '</td><td>' + (w.active === 'Y' ? '<span class="tag good">فعّال</span>' : '<span class="tag bad">موقوف</span>') +
        '</td><td class="noprint"><button class="btn alt sm" data-act="toggle" data-id="' + w.id + '" data-active="' + w.active + '">' + (w.active === 'Y' ? 'إيقاف' : 'تفعيل') + '</button> ' + E.crudBtns('warehouse', { id: w.id, name: w.name }) + '</td></tr>').join('') + '</tbody></table>';
    E.$('#f', el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try { await api('POST', '/inventory/warehouses', { code: f.get('code').trim(), name: f.get('name').trim() }); E.toast('أُضيف المخزن'); E.pages.invWarehouses(el); } catch (e) { E.toast(e.message, true); }
    });
    E.crudBind(el, () => E.pages.invWarehouses(el));
    E.bind(el, { toggle: async (b) => { await api('PATCH', '/inventory/warehouses/' + b.dataset.id, { active: b.dataset.active !== 'Y' }); E.toast('تم التحديث'); E.pages.invWarehouses(el); } });
  };

  // ---------- الأرصدة ----------
  E.pages.invStock = async function (el) {
    const [{ items }, { warehouses }] = await Promise.all([api('GET', '/inventory/items'), api('GET', '/inventory/warehouses')]);
    el.innerHTML = E.head('أرصدة المخزون', 'التقييم بالمتوسط المرجّح لكل صنف في كل مخزن') +
      '<form id="f" class="row noprint"><label>المخزن<select name="wh"><option value="">الكل</option>' + opt(warehouses) + '</select></label><label>الصنف<select name="item"><option value="">الكل</option>' + opt(items) + '</select></label>' +
      '<button class="btn">عرض</button> <button type="button" class="btn alt" data-act="print">طباعة</button></form><div id="chk"></div><div id="out"></div>';
    async function go() {
      const f = new FormData(E.$('#f', el));
      const [s, c] = await Promise.all([api('GET', '/inventory/stock?' + E.qs({ wh: f.get('wh'), item: f.get('item') })), api('GET', '/inventory/check')]);
      E.$('#chk', el).innerHTML = c.ok ? '<div class="msg good">قيمة المخزون تطابق الأستاذ</div>' : '<div class="msg bad">فرق بين المخزون والأستاذ: ' + c.rows.filter((x) => x.difference).map((x) => esc(x.account) + ' (' + money(x.difference) + ')').join('، ') + ' — غالباً قيد يدوي على حساب المخزون</div>';
      E.$('#out', el).innerHTML = s.rows.length ? '<table><thead><tr><th>الصنف</th><th>المخزن</th><th class="n">الكمية</th><th class="n">متوسط التكلفة</th><th class="n">القيمة</th></tr></thead><tbody>' +
        s.rows.map((x) => '<tr><td><a href="#/inventory/card/' + x.itemId + '" title="كارت الصنف">' + esc(x.itemCode) + ' — ' + esc(x.itemName) + '</a></td><td>' + esc(x.whName) + '</td><td class="n">' + q3(x.qty) + ' ' + esc(x.unit) + '</td><td class="n">' + money(x.avgCost) + '</td><td class="n">' + money(x.value) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="4">إجمالي القيمة</td><td class="n">' + money(s.totalValue) + '</td></tr></tfoot></table>' : '<div class="msg warn">لا أرصدة</div>';
    }
    E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); go().catch((e) => E.toast(e.message, true)); });
    E.bind(el, { print: () => window.print() });
    await go();
  };

  // ---------- الحركات ----------
  E.pages.invMoves = async function (el) {
    const [{ items }, { warehouses }] = await Promise.all([api('GET', '/inventory/items'), api('GET', '/inventory/warehouses')]);
    el.innerHTML = E.head('حركات المخزون') + '<form id="f" class="row noprint"><label>من<input type="date" name="from" value="' + E.monthStart() + '"></label><label>إلى<input type="date" name="to" value="' + E.today() + '"></label>' +
      '<label>المخزن<select name="wh"><option value="">الكل</option>' + opt(warehouses) + '</select></label><label>الصنف<select name="item"><option value="">الكل</option>' + opt(items) + '</select></label><button class="btn">عرض</button></form><div id="out"></div>';
    async function go() {
      const f = new FormData(E.$('#f', el));
      const { moves } = await api('GET', '/inventory/moves?' + E.qs({ from: f.get('from'), to: f.get('to'), wh: f.get('wh'), item: f.get('item') }));
      el._moves = moves;
      E.$('#out', el).innerHTML = moves.length ? '<table><thead><tr><th>#</th><th>التاريخ</th><th>الصنف</th><th>المخزن</th><th>النوع</th><th class="n">الكمية</th><th class="n">القيمة</th><th>المستند</th></tr></thead><tbody>' +
        moves.map((m) => '<tr><td>' + m.id + '</td><td>' + esc(m.date) + '</td><td>' + esc(m.itemCode) + ' ' + esc(m.itemName) + '</td><td>' + esc(m.whName) + '</td><td>' + (TYPE[m.type] || m.type) + (m.reverses ? ' <span class="tag warn">عكس ' + m.reverses + '</span>' : '') +
          '</td><td class="n">' + q3(m.qty) + '</td><td class="n">' + money(m.value) + '</td><td>' + (m.refType === 'INVOICE' ? '<a href="#/invoice/view/' + m.refId + '">فاتورة ' + m.refId + '</a> <a class="noprint" href="#/invoice/view/' + m.refId + '?print=1">طباعة</a>' : esc(m.refType) + ' ' + m.refId + ' <button class="btn alt sm noprint" data-act="stockdoc" data-t="' + esc(m.refType) + '" data-r="' + m.refId + '">طباعة المستند</button>') + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا حركات</div>';
    }
    E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); go().catch((e) => E.toast(e.message, true)); });
    E.bind(el, { stockdoc: (b) => { const g = (el._moves || []).filter((m) => m.refType === b.dataset.t && String(m.refId) === b.dataset.r); if (g.length) E.openDoc(E.docSpec.stock(b.dataset.t, b.dataset.r, g)); } });
    await go();
  };

  // ---------- تسوية جرد / رصيد افتتاحي / تحويل ----------
  E.pages.invAdjust = async function (el) {
    const [{ items }, { warehouses }, accts] = await Promise.all([api('GET', '/inventory/items'), api('GET', '/inventory/warehouses'), E.loadAccounts()]);
    const stocked = items.filter((i) => i.trackStock === 'Y' && i.active === 'Y');
    const wact = warehouses.filter((w) => w.active === 'Y');
    const ao = accts.filter((a) => a.active === 'Y' && !a.children).map((a) => '<option value="' + esc(a.code) + '">' + esc(a.code) + ' ' + esc(a.name) + '</option>').join('');
    el.innerHTML = E.head('تسوية جرد وتحويل', 'التسوية تُرحّل قيداً؛ التحويل بين المخازن بتكلفة المصدر بلا أثر محاسبي') +
      '<div class="card"><h3>تسوية جرد / رصيد افتتاحي</h3><form id="fa" class="row"><label>الصنف<select name="i">' + opt(stocked) + '</select></label><label>المخزن<select name="w">' + opt(wact) + '</select></label>' +
      '<label>التاريخ<input type="date" name="d" value="' + E.today() + '"></label><label>الفرق في الكمية (+ زيادة / − نقص)<input name="q" inputmode="decimal" required size="10"></label>' +
      '<label>تكلفة الوحدة (للزيادة)<input name="c" inputmode="decimal" size="10"></label><label>الحساب المقابل<select name="o"><option value="5500">5500 فروقات المخزون (الافتراضي)</option>' + ao + '</select></label>' +
      '<label style="flex:1">ملاحظة<input name="n" maxlength="300"></label><button class="btn">ترحيل التسوية</button></form><p class="muted">لإدخال رصيد افتتاحي اختر الحساب المقابل 3100 رأس المال.</p></div>' +
      '<div id="lastdoc"></div><div class="card"><h3>تحويل بين مخزنين</h3><form id="ft" class="row"><label>الصنف<select name="i">' + opt(stocked) + '</select></label><label>من<select name="f">' + opt(wact) + '</select></label>' +
      '<label>إلى<select name="t">' + opt(wact, wact[1] && wact[1].id) + '</select></label><label>التاريخ<input type="date" name="d" value="' + E.today() + '"></label><label>الكمية<input name="q" inputmode="decimal" required size="10"></label><button class="btn">تحويل</button></form></div>';
    // بعد كل تسوية أو تحويل: زر لطباعة مستنده (يُجلب من آخر حركات الصنف في ذلك التاريخ)
    async function offerDoc(itemId, date) {
      const { moves } = await api('GET', '/inventory/moves?' + E.qs({ item: itemId, from: date, to: date }));
      const m = moves.filter((x) => x.refType === 'ADJUST' || x.refType === 'TRANSFER').sort((x, y) => y.id - x.id)[0];
      if (!m) return;
      const grp = moves.filter((x) => x.refType === m.refType && x.refId === m.refId);
      el._lastDoc = E.docSpec.stock(m.refType, m.refId, grp);
      E.$('#lastdoc', el).innerHTML = '<div class="msg good">سُجّل المستند ' + esc(m.refType) + ' ' + m.refId + ' <button type="button" class="btn alt sm" data-act="lastdoc">طباعة المستند</button></div>';
    }
    E.bind(el, { lastdoc: () => E.openDoc(el._lastDoc) });
    E.$('#fa', el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try {
        const r = await api('POST', '/inventory/adjust', { itemId: Number(f.get('i')), whId: Number(f.get('w')), date: f.get('d'), qtyDelta: f.get('q').replace(/,/g, ''), unitCost: f.get('c').replace(/,/g, ''), offsetAccount: f.get('o'), note: f.get('n').trim() });
        E.toast(r.entryId ? 'رُحّلت التسوية، قيد ' + r.entryId : 'سُجّلت التسوية'); ev.target.q.value = ''; await offerDoc(Number(f.get('i')), f.get('d'));
      } catch (e) { E.toast(e.message, true); }
    });
    E.$('#ft', el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try {
        const r = await api('POST', '/inventory/transfer', { itemId: Number(f.get('i')), fromWh: Number(f.get('f')), toWh: Number(f.get('t')), date: f.get('d'), qty: f.get('q').replace(/,/g, '') });
        E.toast('حُوّلت بضاعة بقيمة ' + money(r.value)); ev.target.q.value = ''; await offerDoc(Number(f.get('i')), f.get('d'));
      } catch (e) { E.toast(e.message, true); }
    });
  };
})(window.ERP);
