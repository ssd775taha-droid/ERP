'use strict';
(function (E) {
  const { esc, money, api } = E;
  const num = (s) => { const n = parseFloat(String(s).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const r2 = (n) => Math.round(n * 100) / 100;
  const q3 = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const TYPE = { CREDIT: 'إشعار دائن', DEBIT: 'إشعار مدين' };
  const KIND = { SALES: 'مبيعات', PURCHASE: 'مشتريات' };
  const stTag = (n) => n.status === 'VOID' ? '<span class="tag bad">ملغى</span>' : '<span class="tag good">ساري</span>';
  const typeTag = (t) => '<span class="tag ' + (t === 'CREDIT' ? 'warn' : '') + '">' + TYPE[t] + '</span>';

  // ---------- قائمة الإشعارات ----------
  E.pages.notes = async function (el) {
    el.innerHTML = E.head('إشعارات الدائن والمدين', 'تُنشأ من صفحة الفاتورة (زر «إشعار دائن/مدين»). الإشعار يخفّض أو يزيد ما على العميل/للمورد دون تعديل الفاتورة الأصلية') +
      '<form id="f" class="row noprint"><label>من<input type="date" name="f" value="' + E.yearStart() + '"></label><label>إلى<input type="date" name="t" value="' + E.today() + '"></label>' +
      '<label>النوع<select name="k"><option value="">الكل</option><option value="SALES">مبيعات</option><option value="PURCHASE">مشتريات</option></select></label>' +
      '<label>الإشعار<select name="y"><option value="">دائن ومدين</option><option value="CREDIT">دائن</option><option value="DEBIT">مدين</option></select></label><button class="btn">عرض</button></form><div id="out"></div>';
    async function go() {
      const f = new FormData(E.$('#f', el));
      const { notes } = await api('GET', '/notes?' + E.qs({ from: f.get('f'), to: f.get('t'), kind: f.get('k'), type: f.get('y') }));
      E.$('#out', el).innerHTML = notes.length ? '<table><thead><tr><th>الرقم</th><th>النوع</th><th>التاريخ</th><th>الطرف</th><th>الفاتورة</th><th>السبب</th><th class="n">الإجمالي</th><th>الحالة</th></tr></thead><tbody>' +
        notes.map((n) => '<tr><td><a href="#/note/view/' + n.id + '">' + esc(n.no) + '</a></td><td>' + typeTag(n.type) + ' ' + KIND[n.docKind] + '</td><td>' + esc(n.date) + '</td><td>' + esc(n.partyName) + '</td><td><a href="#/invoice/view/' + n.invoiceId + '">' + esc(n.invoiceNo) + '</a></td><td>' + esc(n.reason) + '</td><td class="n">' +
          (n.type === 'CREDIT' ? '−' : '') + money(n.total) + '</td><td>' + stTag(n) + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا إشعارات</div>';
    }
    E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); go().catch((e) => E.toast(e.message, true)); });
    await go();
  };

  // ---------- إشعار جديد: المسار note/new/<رقم الفاتورة>-<CREDIT|DEBIT> ----------
  E.pages.noteNew = async function (el, param) {
    const [idStr, typeRaw] = String(param || '').split('-');
    const type = typeRaw === 'DEBIT' ? 'DEBIT' : 'CREDIT';
    const [{ invoice: inv }, accts] = await Promise.all([api('GET', '/invoices/' + encodeURIComponent(idStr)), E.loadAccounts()]);
    if (inv.status !== 'OPEN') { el.innerHTML = E.head('إشعار') + E.err('الفاتورة ملغاة'); return; }
    const sales = inv.kind === 'SALES', credit = type === 'CREDIT';
    const label = (credit ? 'إشعار دائن ' : 'إشعار مدين ') + (sales ? 'مبيعات' : 'مشتريات');
    const accOpts = '<option value="">الافتراضي</option>' + accts.filter((a) => a.active === 'Y' && !a.children && (sales ? a.type === 'REVENUE' : ['EXPENSE', 'ASSET'].includes(a.type)))
      .map((a) => '<option value="' + esc(a.code) + '">' + esc(a.code) + ' ' + esc(a.name) + '</option>').join('');
    const origRows = credit ? inv.lines.map((l) => {
      const avail = Math.round((l.qty - l.creditedQty) * 1000) / 1000;
      return '<tr class="ol" data-id="' + l.id + '" data-avail="' + avail + '" data-price="' + l.price + '"><td>' + esc(l.description) + '</td><td class="n">' + q3(l.qty) + '</td><td class="n">' + q3(avail) + '</td>' +
        '<td><input class="oq" value="0" size="6" inputmode="decimal"' + (avail <= 0 ? ' disabled' : '') + '></td><td><input class="op" value="' + l.price + '" size="9" inputmode="decimal" title="لا يزيد عن ' + l.price + '"></td>' +
        '<td><input class="ov" value="' + l.vatRate + '" size="4" inputmode="decimal"></td><td>' + (l.itemId ? '<label><input type="checkbox" class="or" checked> ' + (sales ? 'يعود للمخزن' : 'يخرج من المخزن') + '</label>' : '<span class="muted">—</span>') +
        '</td><td class="n ot">0.00</td></tr>';
    }).join('') : '';
    const free = () => '<tr class="fl"><td><input class="fd" maxlength="200" placeholder="الوصف (خصم، رسوم، تعديل سعر…)"></td><td><input class="fq" value="1" size="5" inputmode="decimal"></td><td><input class="fp" size="9" inputmode="decimal"></td>' +
      '<td><input class="fv" value="' + E.tax.vatRate + '" size="4" inputmode="decimal"></td><td><select class="fa">' + accOpts + '</select></td><td class="n ft">0.00</td><td><button type="button" class="btn alt sm" data-act="rmf">×</button></td></tr>';
    el.innerHTML = E.head(label, 'على الفاتورة ' + inv.no + ' (' + inv.date + ') — ' + inv.partyName + ' — المتبقي الفعلي ' + money(inv.remaining)) +
      '<div class="card"><div class="row"><label>التاريخ<input type="date" id="dt" value="' + E.today() + '"></label><label style="flex:1">سبب الإشعار (إلزامي)<input id="rs" maxlength="300" placeholder="' + (credit ? 'مثال: مرتجع بضاعة تالفة / خصم كمية' : 'مثال: رسوم تأخير / فرق سعر') + '"></label></div>' +
      (credit ? '<h3>بنود الفاتورة (اكتب الكمية المرتجعة أو المخفَّضة)</h3><table><thead><tr><th>البند</th><th class="n">الكمية الأصلية</th><th class="n">المتاح</th><th>الكمية</th><th>السعر</th><th>ضريبة %</th><th>المخزون</th><th class="n">الإجمالي</th></tr></thead><tbody id="ol">' + origRows + '</tbody></table>' +
        '<p class="muted">السعر في الإشعار هو <b>المبلغ المُخفَّض عن الوحدة</b> (لا يزيد عن سعرها الأصلي)، والكمية عدد الوحدات. للمرتجع اترك السعر الأصلي؛ لتخفيض سعر دون إرجاع بضاعة ألغِ «يعود للمخزن» وأدخل مقدار التخفيض للوحدة. مجموع الإشعارات على البند لا يتجاوز قيمته في الفاتورة.</p>' : '') +
      '<h3>' + (credit ? 'بنود حرة (خصم أو تعويض)' : 'بنود الإشعار') + '</h3><table><thead><tr><th>الوصف</th><th>الكمية</th><th>السعر</th><th>ضريبة %</th><th>الحساب</th><th class="n">الإجمالي</th><th></th></tr></thead><tbody id="fl">' + (credit ? '' : free()) + '</tbody></table>' +
      '<p><button type="button" class="btn alt" data-act="addf">+ بند حر</button></p>' +
      '<div id="refund"></div><div class="msg good" id="tot" style="font-weight:700">الإجمالي: 0.00</div>' +
      '<p><button type="button" class="btn" data-act="save">ترحيل الإشعار</button> <a href="#/invoice/view/' + inv.id + '">رجوع للفاتورة</a></p></div>';
    const calc = () => {
      let total = 0, lines = [];
      E.$$('.ol', el).forEach((r) => {
        const q = num(E.$('.oq', r).value), p = num(E.$('.op', r).value), v = num(E.$('.ov', r).value);
        const net = r2(q * p), t = r2(net + net * v / 100); E.$('.ot', r).textContent = money(t);
        if (q > 0) { total += t; lines.push(r); }
      });
      E.$$('.fl', el).forEach((r) => {
        const net = r2(num(E.$('.fq', r).value) * num(E.$('.fp', r).value)), t = r2(net + net * num(E.$('.fv', r).value) / 100);
        E.$('.ft', r).textContent = money(t); total += t;
      });
      total = r2(total);
      E.$('#tot', el).textContent = 'الإجمالي: ' + money(total) + (credit ? ' (يُخفَّض من مستحقات الفاتورة)' : ' (يُضاف إلى مستحقات الفاتورة)');
      // الدفع الزائد بعد الإشعار الدائن يستلزم رداً
      const box = E.$('#refund', el);
      const after = r2(inv.remaining - total);
      if (credit && after < 0) {
        const cur = E.$('#rf', el);
        box.innerHTML = '<div class="msg warn">الفاتورة مسدَّدة بأكثر من قيمتها بعد الإشعار بمقدار <b>' + money(-after) + '</b>: ' + (sales ? 'يُرَدّ للعميل' : 'يُستردّ من المورد') + '.</div>' +
          '<div class="row"><label>المبلغ المردود<input id="rf" inputmode="decimal" size="10" value="' + (cur ? cur.value : -after) + '"></label><label>الطريقة<select id="rm"><option value="CASH">نقداً</option><option value="BANK">بنك</option></select></label></div>';
      } else box.innerHTML = '';
    };
    el.addEventListener('input', calc);
    el.addEventListener('change', calc);
    E.bind(el, {
      addf: () => { E.$('#fl', el).insertAdjacentHTML('beforeend', free()); },
      rmf: (b) => { b.closest('tr').remove(); calc(); },
      save: (b) => E.busy(b, async () => {
        const lines = [];
        E.$$('.ol', el).forEach((r) => {
          const q = num(E.$('.oq', r).value); if (q <= 0) return;
          const rs = E.$('.or', r);
          lines.push({ origLineId: Number(r.dataset.id), description: E.$('td', r).textContent.trim(), qty: q, price: E.$('.op', r).value.replace(/,/g, ''), vatRate: E.$('.ov', r).value || '0', restock: rs ? rs.checked : false });
        });
        E.$$('.fl', el).forEach((r) => {
          if (!E.$('.fd', r).value.trim() && !num(E.$('.fp', r).value)) return;
          lines.push({ description: E.$('.fd', r).value.trim() || null, qty: E.$('.fq', r).value.replace(/,/g, ''), price: E.$('.fp', r).value.replace(/,/g, '') || '0', vatRate: E.$('.fv', r).value || '0', account: E.$('.fa', r).value || null });
        });
        const rf = E.$('#rf', el);
        const r = await api('POST', '/notes', { invoiceId: inv.id, type, date: E.$('#dt', el).value, reason: E.$('#rs', el).value.trim(), lines, refund: rf ? rf.value.replace(/,/g, '') : 0, refundMethod: rf ? E.$('#rm', el).value : null });
        E.toast('رُحّل ' + r.note.no); location.hash = '#/note/view/' + r.note.id;
      }),
    });
    calc();
  };

  // ---------- عرض إشعار ----------
  E.pages.noteView = async function (el, id) {
    let cur = null;
    async function load() {
      const { note: n } = await api('GET', '/notes/' + encodeURIComponent(id));
      cur = n; el._openDoc = () => E.openDoc(E.docSpec.note(n));
      const sales = n.docKind === 'SALES', credit = n.type === 'CREDIT';
      el.innerHTML = E.head(TYPE[n.type] + ' ' + KIND[n.docKind] + ' ' + n.no, n.partyName + ' — ' + n.date) +
        E.taxHeader(TYPE[n.type] + (n.partyTaxNo ? '' : ' مبسط'), n.partyName, n.partyTaxNo, n.date, n.total, n.vat, sales && n.status === 'OPEN') +
        '<p>' + stTag(n) + ' <span class="muted">يخص الفاتورة <a href="#/invoice/view/' + n.invoiceId + '">' + esc(n.invoiceNo) + '</a> بتاريخ ' + esc(n.invoiceDate) + ' · قيد ' + n.entryId + (n.stockEntryId ? ' · قيد التكلفة ' + n.stockEntryId : '') + (n.voidEntryId ? ' · القيد العكسي ' + n.voidEntryId : '') + '</span></p>' +
        '<div class="card"><b>السبب:</b> ' + esc(n.reason) + '</div>' +
        '<table><thead><tr><th>الوصف</th><th class="n">الكمية</th><th class="n">السعر</th><th>ضريبة %</th><th class="n">الصافي</th><th class="n">الضريبة</th></tr></thead><tbody>' +
        n.lines.map((l) => '<tr><td>' + esc(l.description) + (l.itemId ? ' <span class="tag">مخزني</span>' : '') + '</td><td class="n">' + q3(l.qty) + '</td><td class="n">' + money(l.price) + '</td><td>' + l.vatRate + '</td><td class="n">' + money(l.net) + '</td><td class="n">' + money(l.vat) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="4">المجموع · الضريبة</td><td class="n">' + money(n.subtotal) + '</td><td class="n">' + money(n.vat) + '</td></tr><tr><td colspan="4">الإجمالي</td><td class="n" colspan="2">' + (credit ? '−' : '') + money(n.total) + '</td></tr></tfoot></table>' +
        (n.refund > 0 ? '<p>مردود ' + (n.refundMethod === 'CASH' ? 'نقداً' : 'بنكياً') + ': <b>' + money(n.refund) + '</b></p>' : '') +
        '<p class="noprint"><button class="btn" data-act="doc">معاينة وطباعة المستند</button> <button class="btn alt" data-act="print">طباعة الشاشة</button> ' + (n.status === 'OPEN' ? '<button class="btn danger sm" data-act="void">إلغاء الإشعار (قيد عكسي)</button>' : '') + ' <a href="#/notes">رجوع للإشعارات</a></p>';
    }
    E.bind(el, {
      print: () => window.print(),
      doc: () => E.openDoc(E.docSpec.note(cur)),
      void: async () => { if (confirm('إلغاء الإشعار بقيود عكسية؟ (يُرفض إن صار المدفوع أكبر من قيمة الفاتورة بعد إلغائه)')) { await api('POST', '/notes/' + encodeURIComponent(id) + '/void'); E.toast('أُلغي الإشعار'); await load(); } },
    });
    await load();
  };
})(window.ERP);
