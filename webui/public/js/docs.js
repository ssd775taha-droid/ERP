'use strict';
(function (E) {
  const { esc, money, api } = E;
  const num = (s) => { const n = parseFloat(String(s).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const q3 = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const PO_ST = { DRAFT: ['مسودة', 'warn'], APPROVED: ['معتمد', ''], PARTIAL: ['مستلم جزئياً', 'warn'], RECEIVED: ['مستلم', 'good'], CLOSED: ['مغلق', ''], CANCELLED: ['ملغى', 'bad'] };
  const Q_ST = { DRAFT: ['مسودة', 'warn'], SENT: ['مرسل', ''], ACCEPTED: ['مقبول', 'good'], REJECTED: ['مرفوض', 'bad'], EXPIRED: ['منتهي', 'bad'], CONVERTED: ['محوَّل لفاتورة', 'good'], CANCELLED: ['ملغى', 'bad'], SUPERSEDED: ['حلّ محله عرض معدَّل', ''] };
  const tag = (map, s) => '<span class="tag ' + (map[s] ? map[s][1] : '') + '">' + esc(map[s] ? map[s][0] : s) + '</span>';
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

  // محرر بنود مشترك. kind: 'PO' (سعر شراء، بلا خصم) أو 'Q' (عرض: خصم وسعر بيع افتراضي)
  function lineEditor(el, kind, items, warehouses, accts) {
    const iopts = '<option value="">— بند حر —</option>' + items.map((i) => '<option value="' + i.id + '">' + esc(i.code) + ' — ' + esc(i.name) + '</option>').join('');
    const wopts = warehouses.map((w) => '<option value="' + w.id + '">' + esc(w.name) + '</option>').join('');
    const aopts = '<option value="">—</option>' + accts.filter((a) => a.active === 'Y' && !a.children).map((a) => '<option value="' + esc(a.code) + '">' + esc(a.code) + ' ' + esc(a.name) + '</option>').join('');
    const line = () => '<tr class="ln"><td><select class="it">' + iopts + '</select></td><td><input class="ds" maxlength="200" placeholder="الوصف"></td><td><select class="wh" disabled>' + wopts + '</select></td>' +
      '<td><select class="ac">' + aopts + '</select></td><td><input class="q" value="1" size="5" inputmode="decimal"></td><td><input class="pr" size="9" inputmode="decimal"></td>' +
      (kind === 'Q' ? '<td><input class="dc" value="0" size="4" inputmode="decimal"></td>' : '') + '<td><input class="vt" value="' + E.tax.vatRate + '" size="4" inputmode="decimal"></td><td class="n tot">0.00</td><td><button type="button" class="btn alt sm" data-act="rm">×</button></td></tr>';
    const html = '<table><thead><tr><th>الصنف</th><th>الوصف</th><th>المخزن</th><th>' + (kind === 'Q' ? 'حساب الإيراد' : 'حساب المصروف') + '</th><th>الكمية</th><th>السعر</th>' + (kind === 'Q' ? '<th>خصم %</th>' : '') + '<th>ضريبة %</th><th class="n">الصافي</th><th></th></tr></thead><tbody id="lines">' + line() + '</tbody>' +
      '<tfoot><tr><td colspan="' + (kind === 'Q' ? 8 : 7) + '">الإجمالي التقريبي بعد الضريبة</td><td class="n" id="gt">0.00</td><td></td></tr></tfoot></table>' +
      '<p><button type="button" class="btn alt" data-act="add">+ بند</button></p>';
    return {
      html,
      wire() {
        const tb = E.$('#lines', el);
        const recalc = () => { let t = 0; E.$$('.ln', tb).forEach((r) => {
          const d = kind === 'Q' ? num(E.$('.dc', r).value) : 0; const net = Math.round(num(E.$('.q', r).value) * num(E.$('.pr', r).value) * (1 - d / 100) * 100) / 100;
          E.$('.tot', r).textContent = money(net); t += net * (1 + num(E.$('.vt', r).value) / 100); }); E.$('#gt', el).textContent = money(Math.round(t * 100) / 100); };
        tb.addEventListener('input', recalc);
        tb.addEventListener('change', (ev) => {
          if (!ev.target.classList.contains('it')) return;
          const r = ev.target.closest('.ln'), it = items.find((i) => String(i.id) === ev.target.value);
          E.$('.wh', r).disabled = !(it && it.trackStock === 'Y');
          if (it) { E.$('.ds', r).value = it.name; if (kind === 'Q') E.$('.pr', r).value = it.price; E.$('.vt', r).value = it.vat; E.$('.ac', r).value = ''; E.$('.ac', r).disabled = true; } else E.$('.ac', r).disabled = false;
          recalc();
        });
        const handlers = { add: () => tb.insertAdjacentHTML('beforeend', line()), rm: (b) => { if (E.$$('.ln', tb).length > 1) { b.closest('tr').remove(); recalc(); } } };
        // تعبئة البنود من أمر/عرض محفوظ (للتعديل)
        handlers.fill = (lines) => {
          tb.innerHTML = '';
          lines.forEach((l) => {
            tb.insertAdjacentHTML('beforeend', line());
            const r = tb.lastElementChild, it = items.find((i) => i.id === l.itemId);
            E.$('.it', r).value = l.itemId || '';
            E.$('.ds', r).value = l.description || '';
            if (it && it.trackStock === 'Y') { E.$('.wh', r).disabled = false; if (l.whId) E.$('.wh', r).value = l.whId; }
            if (it) E.$('.ac', r).disabled = true; else E.$('.ac', r).value = l.account || '';
            E.$('.q', r).value = l.qty; E.$('.pr', r).value = l.price; E.$('.vt', r).value = l.vatRate;
            if (kind === 'Q') E.$('.dc', r).value = l.discountPct || 0;
          });
          recalc();
        };
        return handlers;
      },
      read() {
        return E.$$('.ln', E.$('#lines', el)).map((r) => {
          const it = E.$('.it', r).value;
          const o = { itemId: it ? Number(it) : null, whId: it && !E.$('.wh', r).disabled ? Number(E.$('.wh', r).value) : null, description: E.$('.ds', r).value.trim() || null,
            qty: E.$('.q', r).value.replace(/,/g, ''), price: E.$('.pr', r).value.replace(/,/g, '') || null, vatRate: E.$('.vt', r).value || '0', account: E.$('.ac', r).value || null };
          if (kind === 'Q') o.discountPct = E.$('.dc', r).value || '0';
          return o;
        });
      },
    };
  }

  const loadRefs = async () => { const [i, w, a] = await Promise.all([api('GET', '/items'), api('GET', '/warehouses'), E.loadAccounts()]); return [i.items, w.warehouses, a]; };

  // ======================= أوامر الشراء =======================
  E.pages.poList = async function (el) {
    el.innerHTML = E.head('أوامر الشراء', 'التزام مع المورد بلا قيد؛ الاستلام ينشئ فاتورة مشتريات ويُدخل المخزون') +
      '<form id="f" class="row noprint"><label>الحالة<select name="s"><option value="">الكل</option>' + Object.keys(PO_ST).map((k) => '<option value="' + k + '">' + PO_ST[k][0] + '</option>').join('') + '</select></label><button class="btn">عرض</button> <a href="#/po/new" style="padding:7px 16px;border:1px solid var(--brand);border-radius:8px">+ أمر شراء</a></form><div id="out"></div>';
    async function go() {
      const { orders } = await api('GET', '/po?' + E.qs({ status: new FormData(E.$('#f', el)).get('s') }));
      E.$('#out', el).innerHTML = orders.length ? '<table><thead><tr><th>الرقم</th><th>المورد</th><th>التاريخ</th><th>التوريد المتوقع</th><th class="n">الإجمالي</th><th>الحالة</th></tr></thead><tbody>' +
        orders.map((o) => '<tr><td><a href="#/po/view/' + o.id + '">' + esc(o.no) + '</a></td><td>' + esc(o.partyName) + '</td><td>' + esc(o.date) + '</td><td>' + esc(o.expected || '') + (o.overdue === 'Y' ? ' <span class="tag bad">متأخر</span>' : '') + '</td><td class="n">' + money(o.total) + '</td><td>' + tag(PO_ST, o.status) + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا أوامر</div>';
    }
    E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); go().catch((e) => E.toast(e.message, true)); });
    await go();
  };

  E.pages.poNew = async function (el) {
    const [{ parties }, refs] = await Promise.all([api('GET', '/parties?kind=SUPPLIER'), loadRefs()]);
    if (!parties.length) { el.innerHTML = E.head('أمر شراء جديد') + '<div class="msg warn">أضف مورداً أولاً من <a href="#/suppliers">هنا</a>.</div>'; return; }
    const ed = lineEditor(el, 'PO', ...refs);
    el.innerHTML = E.head('أمر شراء جديد', 'يُنشأ مسودة؛ يلزم اعتماده قبل الاستلام') + '<div class="card"><div class="row"><label>المورد<select id="pt">' + parties.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') + '</select></label>' +
      '<label>التاريخ<input type="date" id="dt" value="' + E.today() + '"></label><label>التوريد المتوقع<input type="date" id="ex" value="' + addDays(E.today(), 14) + '"></label><label style="flex:1">ملاحظات<input id="nt" maxlength="300"></label></div>' + ed.html +
      '<p><button type="button" class="btn" data-act="save">حفظ كمسودة</button></p></div>';
    const h = ed.wire();
    E.bind(el, { ...h, save: (b) => E.busy(b, async () => {
      const r = await api('POST', '/po', { partyId: Number(E.$('#pt', el).value), date: E.$('#dt', el).value, expected: E.$('#ex', el).value || null, notes: E.$('#nt', el).value.trim(), lines: ed.read() });
      E.toast('أُنشئ ' + r.order.no); location.hash = '#/po/view/' + r.order.id;
    }) });
  };

  E.pages.poView = async function (el, id) {
    let cur = null;
    async function load() {
      const { order: o } = await api('GET', '/po/' + encodeURIComponent(id));
      const open = o.lines.filter((l) => l.received < l.qty);
      const canRecv = ['APPROVED', 'PARTIAL'].includes(o.status) && open.length;
      el.innerHTML = E.head('أمر شراء ' + o.no, o.partyName + ' — ' + o.date) + '<p>' + tag(PO_ST, o.status) + ' <span class="muted">أنشأه ' + esc(o.createdBy) + (o.approvedBy ? ' · اعتمده ' + esc(o.approvedBy) : '') + (o.expected ? ' · التوريد ' + esc(o.expected) : '') + '</span></p>' +
        '<table><thead><tr><th>#</th><th>الوصف</th><th class="n">الكمية</th><th class="n">المستلم</th><th class="n">السعر</th><th>ضريبة %</th><th class="n">الصافي</th><th class="n">الضريبة</th>' + (canRecv ? '<th class="noprint">استلام الآن</th><th class="noprint">سعر الفاتورة</th>' : '') + '</tr></thead><tbody>' +
        o.lines.map((l) => '<tr><td>' + l.no + '</td><td>' + esc(l.description) + '</td><td class="n">' + q3(l.qty) + '</td><td class="n">' + q3(l.received) + '</td><td class="n">' + money(l.price) + '</td><td>' + l.vatRate + '</td><td class="n">' + money(l.net) + '</td><td class="n">' + money(l.vat) + '</td>' +
          (canRecv ? (l.received < l.qty ? '<td class="noprint"><input class="rq" data-l="' + l.id + '" size="5" inputmode="decimal" placeholder="0"> <span class="muted">/' + q3(l.qty - l.received) + '</span></td><td class="noprint"><input class="rp" data-l="' + l.id + '" size="8" inputmode="decimal" placeholder="' + l.price + '"></td>' : '<td class="noprint">—</td><td class="noprint"></td>') : '') + '</tr>').join('') +
        '</tbody><tfoot><tr><td colspan="6">الإجمالي</td><td class="n">' + money(o.subtotal) + '</td><td class="n">' + money(o.vat) + '</td>' + (canRecv ? '<td colspan="2"></td>' : '') + '</tr><tr><td colspan="6">الإجمالي شامل الضريبة</td><td class="n" colspan="2">' + money(o.total) + '</td>' + (canRecv ? '<td colspan="2"></td>' : '') + '</tr></tfoot></table>' +
        (o.notes ? '<p>' + esc(o.notes) + '</p>' : '') +
        (canRecv ? '<div class="card noprint" style="margin-top:12px"><h3>استلام</h3><form id="fr" class="row"><label>تاريخ الاستلام<input type="date" name="d" value="' + E.today() + '"></label><label>رقم فاتورة المورد<input name="r" maxlength="60"></label><label style="flex:1">ملاحظة<input name="n" maxlength="300"></label><button class="btn">استلام وإنشاء الفاتورة</button></form><p class="muted">اكتب الكميات المستلمة في الجدول أعلاه؛ اترك سعر الفاتورة فارغاً لاستخدام سعر الأمر.</p></div>' : '') +
        (o.receipts.length ? '<h3>الاستلامات</h3><table><tbody>' + o.receipts.map((r) => '<tr><td>استلام ' + r.id + '</td><td>' + esc(r.date) + '</td><td><a href="#/invoice/view/' + r.invoiceId + '">فاتورة ' + r.invoiceId + '</a></td><td>' + (r.status === 'VOID' ? '<span class="tag bad">ملغى</span>' : '<span class="tag good">فعّال</span>') + '</td><td class="noprint"><button class="btn alt sm" data-act="grn" data-r="' + r.id + '">طباعة إشعار الاستلام</button> ' + (r.status === 'ACTIVE' ? '<button class="btn alt sm" data-act="vr" data-r="' + r.id + '">إلغاء الاستلام</button>' : '') + '</td></tr>').join('') + '</tbody></table>' : '') +
        '<div class="card noprint" style="margin-top:12px">' + (o.status === 'DRAFT' ? '<a class="btn alt" style="padding:7px 16px;border:1px solid var(--brand);border-radius:8px" href="#/po/edit/' + o.id + '">تعديل البنود</a> <button class="btn" data-act="approve">اعتماد</button> ' : '') + (['DRAFT', 'APPROVED'].includes(o.status) && !o.receipts.some((r) => r.status === 'ACTIVE') ? '<button class="btn danger sm" data-act="cancel">إلغاء الأمر</button> ' : '') +
        (o.status === 'PARTIAL' ? '<button class="btn alt" data-act="close">إغلاق ما تبقى</button> ' : '') + '<button class="btn" data-act="doc">معاينة وطباعة المستند</button> <button class="btn alt" data-act="print">طباعة الشاشة</button> <a href="#/po">رجوع</a></div>';
      cur = o; el._openDoc = () => E.openDoc(E.docSpec.po(o, PO_ST[o.status] && PO_ST[o.status][0]));
      const fr = E.$('#fr', el);
      if (fr) fr.addEventListener('submit', async (ev) => {
        ev.preventDefault(); const f = new FormData(fr);
        const lines = E.$$('.rq', el).filter((i) => num(i.value) > 0).map((i) => { const p = E.$('.rp[data-l="' + i.dataset.l + '"]', el).value.replace(/,/g, '').trim(); return { lineId: Number(i.dataset.l), qty: i.value.replace(/,/g, '').trim(), price: p || null }; });
        try { await api('POST', '/po/' + id + '/receive', { date: f.get('d'), ref: f.get('r').trim(), note: f.get('n').trim(), lines }); E.toast('تم الاستلام وأُنشئت الفاتورة'); await load(); } catch (e) { E.toast(e.message, true); }
      });
    }
    const act = (p, m, ask) => async () => { if (ask && !confirm(ask)) return; await api('POST', '/po/' + encodeURIComponent(id) + '/' + p); E.toast(m); await load(); };
    E.bind(el, { print: () => window.print(), doc: () => E.openDoc(E.docSpec.po(cur, PO_ST[cur.status] && PO_ST[cur.status][0])), approve: act('approve', 'اعتُمد الأمر'), cancel: act('cancel', 'أُلغي الأمر', 'إلغاء الأمر؟'), close: act('close', 'أُغلق الأمر', 'إغلاق ما تبقى من الأمر؟'),
      grn: (b) => E.openDoc(E.docSpec.receipt(cur, cur.receipts.find((x) => String(x.id) === b.dataset.r))),
      vr: async (b) => { if (confirm('إلغاء الاستلام؟ تُلغى فاتورته وتعود الكميات.')) { await api('POST', '/po/receipts/' + b.dataset.r + '/void'); E.toast('أُلغي الاستلام'); await load(); } } });
    await load();
  };

  E.pages.poEdit = async function (el, id) {
    const [{ order: o }, refs] = await Promise.all([api('GET', '/po/' + encodeURIComponent(id)), loadRefs()]);
    if (o.status !== 'DRAFT') { el.innerHTML = E.head('تعديل ' + o.no) + E.err('لا يُعدَّل إلا الأمر في حالة مسودة'); return; }
    const ed = lineEditor(el, 'PO', ...refs);
    el.innerHTML = E.head('تعديل بنود أمر الشراء ' + o.no, o.partyName + ' — المورد والتاريخ لا يتغيران؛ للتغيير ألغِ المسودة وأنشئ أمراً جديداً') + '<div class="card">' + ed.html +
      '<p><button type="button" class="btn" data-act="save">حفظ البنود</button> <a href="#/po/view/' + o.id + '">رجوع دون حفظ</a></p></div>';
    const h = ed.wire(); h.fill(o.lines);
    E.bind(el, { add: h.add, rm: h.rm, save: (b) => E.busy(b, async () => { await api('PUT', '/po/' + o.id + '/lines', { lines: ed.read() }); E.toast('حُفظت البنود'); location.hash = '#/po/view/' + o.id; }) });
  };

  // ======================= عروض الأسعار =======================
  E.pages.quoteList = async function (el) {
    el.innerHTML = E.head('عروض الأسعار', 'مسودة ← مرسل ← مقبول ← فاتورة. التعديل بعد الإرسال بعرض معدَّل جديد') +
      '<div id="pipe"></div><form id="f" class="row noprint"><label>الحالة<select name="s"><option value="">الكل</option>' + Object.keys(Q_ST).map((k) => '<option value="' + k + '">' + Q_ST[k][0] + '</option>').join('') + '</select></label><button class="btn">عرض</button> ' +
      '<a href="#/quote/new" style="padding:7px 16px;border:1px solid var(--brand);border-radius:8px">+ عرض سعر</a> <button type="button" class="btn alt" data-act="expire">إنهاء العروض المنتهية</button></form><div id="out"></div>';
    async function go() {
      const [{ quotes }, { rows }] = await Promise.all([api('GET', '/quotes?' + E.qs({ status: new FormData(E.$('#f', el)).get('s') })), api('GET', '/quotes/pipeline')]);
      const tot = rows.reduce((s, x) => s + x.quotes, 0), conv = (rows.find((x) => x.status === 'CONVERTED') || { quotes: 0 }).quotes;
      E.$('#pipe', el).innerHTML = rows.length ? '<div class="cards">' + rows.map((x) => '<div class="stat"><div class="k">' + esc((Q_ST[x.status] || [x.status])[0]) + '</div><div class="v">' + x.quotes + '</div><div class="muted">' + money(x.totalValue) + '</div></div>').join('') + '<div class="stat"><div class="k">نسبة التحويل</div><div class="v">' + (tot ? Math.round(conv * 100 / tot) : 0) + '%</div></div></div>' : '';
      E.$('#out', el).innerHTML = quotes.length ? '<table><thead><tr><th>الرقم</th><th>العميل</th><th>التاريخ</th><th>صالح حتى</th><th class="n">الإجمالي</th><th>الحالة</th></tr></thead><tbody>' +
        quotes.map((q) => '<tr><td><a href="#/quote/view/' + q.id + '">' + esc(q.no) + '</a></td><td>' + esc(q.partyName) + '</td><td>' + esc(q.date) + '</td><td>' + esc(q.validUntil) + (q.expiredFlag === 'Y' ? ' <span class="tag bad">انتهت صلاحيته</span>' : '') + '</td><td class="n">' + money(q.total) + '</td><td>' + tag(Q_ST, q.status) + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا عروض</div>';
    }
    E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); go().catch((e) => E.toast(e.message, true)); });
    E.bind(el, { expire: async () => { const r = await api('POST', '/quotes/expire', {}); E.toast('انتهى ' + r.expired + ' عرض'); await go(); } });
    await go();
  };

  E.pages.quoteNew = async function (el) {
    const [{ parties }, refs, st] = await Promise.all([api('GET', '/parties?kind=CUSTOMER'), loadRefs(), api('GET', '/settings')]);
    if (!parties.length) { el.innerHTML = E.head('عرض سعر جديد') + '<div class="msg warn">أضف عميلاً أولاً من <a href="#/customers">هنا</a>.</div>'; return; }
    const ed = lineEditor(el, 'Q', ...refs);
    el.innerHTML = E.head('عرض سعر جديد', st.quoteMaxDiscount ? 'أعلى خصم مسموح عند الإرسال: ' + st.quoteMaxDiscount + '%' : 'يُنشأ مسودة ثم يُرسل للعميل') + '<div class="card"><div class="row"><label>العميل<select id="pt">' + parties.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') + '</select></label>' +
      '<label>التاريخ<input type="date" id="dt" value="' + E.today() + '"></label><label>صالح حتى<input type="date" id="vu" value="' + addDays(E.today(), 30) + '"></label></div><div class="row"><label style="flex:1">ملاحظات<input id="nt" maxlength="300"></label><label style="flex:1">الشروط<input id="tm" maxlength="500"></label></div>' + ed.html +
      '<p><button type="button" class="btn" data-act="save">حفظ كمسودة</button></p></div>';
    const h = ed.wire();
    E.bind(el, { ...h, save: (b) => E.busy(b, async () => {
      const r = await api('POST', '/quotes', { partyId: Number(E.$('#pt', el).value), date: E.$('#dt', el).value, validUntil: E.$('#vu', el).value, notes: E.$('#nt', el).value.trim(), terms: E.$('#tm', el).value.trim(), lines: ed.read() });
      E.toast('أُنشئ ' + r.quote.no); location.hash = '#/quote/view/' + r.quote.id;
    }) });
  };

  E.pages.quoteEdit = async function (el, id) {
    const [{ quote: q }, refs] = await Promise.all([api('GET', '/quotes/' + encodeURIComponent(id)), loadRefs()]);
    if (q.status !== 'DRAFT') { el.innerHTML = E.head('تعديل ' + q.no) + E.err('لا يُعدَّل إلا العرض في حالة مسودة (بعد الإرسال: عرض معدَّل)'); return; }
    const ed = lineEditor(el, 'Q', ...refs);
    el.innerHTML = E.head('تعديل بنود عرض السعر ' + q.no, q.partyName) + '<div class="card">' + ed.html +
      '<p><button type="button" class="btn" data-act="save">حفظ البنود</button> <a href="#/quote/view/' + q.id + '">رجوع دون حفظ</a></p></div>';
    const h = ed.wire();
    // العرض المحفوظ يخزّن السعر بعد الخصم؛ نستعيد السعر قبل الخصم (قد يختلف هللة عن الأصلي)
    h.fill(q.lines.map((l) => ({ ...l, price: l.discountPct > 0 ? Math.round(l.unitNetPrice / (1 - l.discountPct / 100) * 100) / 100 : l.unitNetPrice })));
    if (q.lines.some((l) => l.discountPct > 0)) E.toast('السعر قبل الخصم أُعيد حسابه من المحفوظ؛ راجعه قبل الحفظ');
    E.bind(el, { add: h.add, rm: h.rm, save: (b) => E.busy(b, async () => { await api('PUT', '/quotes/' + q.id + '/lines', { lines: ed.read() }); E.toast('حُفظت البنود'); location.hash = '#/quote/view/' + q.id; }) });
  };

  E.pages.quoteView = async function (el, id) {
    let cur = null;
    async function load() {
      const { quote: q } = await api('GET', '/quotes/' + encodeURIComponent(id));
      cur = q; el._openDoc = () => E.openDoc(E.docSpec.quote(q, Q_ST[q.status] && Q_ST[q.status][0]));
      const s = q.status;
      el.innerHTML = E.head('عرض سعر ' + q.no, q.partyName + ' — ' + q.date + ' — صالح حتى ' + q.validUntil) + '<p>' + tag(Q_ST, s) + (q.expiredFlag === 'Y' ? ' <span class="tag bad">انتهت صلاحيته</span>' : '') + ' <span class="muted">' +
        (q.revisionOf ? 'تعديل للعرض <a href="#/quote/view/' + q.revisionOf + '">' + q.revisionOf + '</a> ' : '') + (q.revisedBy ? '· عُدّل بالعرض <a href="#/quote/view/' + q.revisedBy + '">' + q.revisedBy + '</a> ' : '') + (q.invoiceId ? '· <a href="#/invoice/view/' + q.invoiceId + '">فاتورة ' + q.invoiceId + '</a>' : '') + '</span></p>' +
        '<table><thead><tr><th>#</th><th>الوصف</th><th class="n">الكمية</th><th class="n">السعر بعد الخصم</th><th>خصم %</th><th>ضريبة %</th><th class="n">الصافي</th><th class="n">الضريبة</th></tr></thead><tbody>' +
        q.lines.map((l) => '<tr><td>' + l.no + '</td><td>' + esc(l.description) + '</td><td class="n">' + q3(l.qty) + '</td><td class="n">' + money(l.unitNetPrice) + '</td><td>' + l.discountPct + '</td><td>' + l.vatRate + '</td><td class="n">' + money(l.net) + '</td><td class="n">' + money(l.vat) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="6">المجموع · الضريبة</td><td class="n">' + money(q.subtotal) + '</td><td class="n">' + money(q.vat) + '</td></tr><tr><td colspan="6">الإجمالي</td><td class="n" colspan="2">' + money(q.total) + '</td></tr></tfoot></table>' +
        (q.notes ? '<p>' + esc(q.notes) + '</p>' : '') + (q.terms ? '<p class="muted">الشروط: ' + esc(q.terms) + '</p>' : '') +
        (s === 'ACCEPTED' ? '<div class="card noprint" style="margin-top:12px"><h3>تحويل إلى فاتورة مبيعات</h3><form id="fc" class="row"><label>تاريخ الفاتورة<input type="date" name="d" value="' + E.today() + '"></label><label>الاستحقاق<input type="date" name="du"></label><button class="btn">تحويل</button></form><p class="muted">تخرج البضاعة من المخزن وتُرحَّل التكلفة تلقائياً.</p></div>' : '') +
        '<div class="card noprint" style="margin-top:12px">' + (s === 'DRAFT' ? '<a class="btn alt" style="padding:7px 16px;border:1px solid var(--brand);border-radius:8px" href="#/quote/edit/' + q.id + '">تعديل البنود</a> <button class="btn" data-act="send">إرسال للعميل</button> ' : '') + (s === 'SENT' ? '<button class="btn" data-act="accept">قبول</button> <button class="btn alt" data-act="reject">رفض</button> ' : '') +
        (['SENT', 'REJECTED'].includes(s) ? '<button class="btn alt" data-act="revise">عرض معدَّل</button> ' : '') + (['DRAFT', 'SENT'].includes(s) ? '<button class="btn danger sm" data-act="cancel">إلغاء</button> ' : '') +
        (s === 'CONVERTED' ? '<button class="btn danger sm" data-act="unconvert">إلغاء التحويل (يلغي الفاتورة)</button> ' : '') + '<button class="btn" data-act="doc">معاينة وطباعة المستند</button> <button class="btn alt" data-act="print">طباعة الشاشة</button> <a href="#/quotes">رجوع</a></div>';
      const fc = E.$('#fc', el);
      if (fc) fc.addEventListener('submit', async (ev) => { ev.preventDefault(); const f = new FormData(fc); try { const r = await api('POST', '/quotes/' + id + '/convert', { date: f.get('d'), due: f.get('du') || null }); E.toast('أُنشئت الفاتورة'); location.hash = '#/invoice/view/' + r.invoiceId; } catch (e) { E.toast(e.message, true); } });
    }
    const act = (p, m, ask) => async () => { if (ask && !confirm(ask)) return; await api('POST', '/quotes/' + encodeURIComponent(id) + '/' + p); E.toast(m); await load(); };
    E.bind(el, { print: () => window.print(), doc: () => E.openDoc(E.docSpec.quote(cur, Q_ST[cur.status] && Q_ST[cur.status][0])), send: act('send', 'أُرسل العرض', 'إرسال العرض؟ تُقفل بنوده بعده.'), accept: act('accept', 'قُبل العرض'), reject: act('reject', 'رُفض العرض'),
      cancel: act('cancel', 'أُلغي العرض', 'إلغاء العرض؟'), unconvert: act('unconvert', 'أُلغي التحويل', 'إلغاء الفاتورة وإعادة العرض مقبولاً؟'),
      revise: async () => { const r = await api('POST', '/quotes/' + encodeURIComponent(id) + '/revise', {}); E.toast('أُنشئ عرض معدَّل'); location.hash = '#/quote/view/' + r.quote.id; } });
    await load();
  };

  // ======================= الإعدادات =======================
  E.pages.settings = async function (el) {
    const s = await api('GET', '/settings');
    el.innerHTML = E.head('إعدادات الضوابط', 'ضوابط اختيارية؛ اترك الحقل فارغاً لإلغاء الضابط') +
      '<div class="card"><form id="f1" class="row"><label>حد اعتماد أمر الشراء (أوامر بإجمالي ≥ الحد لا يعتمدها من أنشأها)<input name="v" inputmode="decimal" value="' + esc(s.poLimit || '') + '" size="12"></label><button class="btn">حفظ</button></form>' +
      '<p class="muted">ملاحظة: مستخدم الويب والقاعدة واحد حالياً، لذلك لا يمكن لأحد اعتماد أمر ذي إجمالي ≥ الحد؛ فعّل هذا الضابط فقط حين تتعدد المستخدمون.</p></div>' +
      '<div class="card"><form id="f2" class="row"><label>أعلى خصم % مسموح عند إرسال عرض سعر<input name="v" inputmode="decimal" value="' + esc(s.quoteMaxDiscount || '') + '" size="8"></label><button class="btn">حفظ</button></form></div>';
    const save = (sel, name) => E.$(sel, el).addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api('POST', '/settings', { name, value: new FormData(ev.target).get('v').replace(/,/g, '').trim() || null }); E.toast('حُفظ'); } catch (e) { E.toast(e.message, true); } });
    save('#f1', 'PO_APPROVAL_LIMIT'); save('#f2', 'QUOTE_MAX_DISCOUNT_PCT');
  };
})(window.ERP);
