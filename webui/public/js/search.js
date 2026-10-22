'use strict';
(function (E) {
  const { esc, money, api } = E;

  // ---------- الاستعلام الموحَّد: بحث عبر كل أنواع العمليات، ومنها فتح العملية أو طباعتها منفردةً ----------
  const TYPES = { ENTRY: ['قيد يومية', '#/entry/view/'], SALES: ['فاتورة مبيعات', '#/invoice/view/'], PURCHASE: ['فاتورة مشتريات', '#/invoice/view/'], PAYMENT: ['سند قبض/صرف', '#/payment/view/'],
    NOTE: ['إشعار دائن/مدين', '#/note/view/'], POS: ['نقطة بيع', '#/pos/sale/'], PO: ['أمر شراء', '#/po/view/'], QUOTE: ['عرض سعر', '#/quote/view/'] };
  const ST = { OPEN: 'ساري', VOID: 'ملغى', REVERSAL: 'قيد عكسي', RECEIPT: 'قبض', PAYMENT: 'صرف', DRAFT: 'مسودة', APPROVED: 'معتمد', PARTIAL: 'مستلم جزئياً', RECEIVED: 'مستلم', CLOSED: 'مغلق', CANCELLED: 'ملغى',
    SENT: 'مرسل', ACCEPTED: 'مقبول', REJECTED: 'مرفوض', EXPIRED: 'منتهي', CONVERTED: 'محوَّل لفاتورة', SUPERSEDED: 'معدَّل', COMPLETED: 'مكتمل' };
  const BAD = { VOID: 1, CANCELLED: 1, REJECTED: 1, EXPIRED: 1 };

  E.pages.search = async function (el) {
    el.innerHTML = E.head('الاستعلام', 'ابحث في كل العمليات برقم أو اسم أو بيان أو مبلغ، ثم افتح أي عملية أو اطبعها وحدها') +
      '<div class="card noprint"><form id="f" class="qf">' +
      '<label>بحث<input name="q" maxlength="60" placeholder="رقم، اسم عميل، بيان، مبلغ…" autofocus></label>' +
      '<label>من<input type="date" name="from"></label><label>إلى<input type="date" name="to"></label>' +
      '<label>مبلغ من<input name="min" size="9" inputmode="decimal"></label><label>إلى<input name="max" size="9" inputmode="decimal"></label>' +
      '<button class="btn">بحث</button> <button type="button" class="btn alt" id="rs">مسح</button></form>' +
      '<div class="chips" id="chips"></div></div><div id="out"><p class="muted">جارٍ التحميل…</p></div>';
    const form = E.$('#f', el), out = E.$('#out', el);
    let chipsBuilt = false;
    const picked = () => E.$$('#chips input:checked', el).map((c) => c.value);
    function buildChips(types) {
      E.$('#chips', el).innerHTML = types.map((t) => '<label><input type="checkbox" value="' + t + '" checked> ' + esc(TYPES[t][0]) + '</label>').join('');
      chipsBuilt = true;
    }
    async function run() {
      const f = new FormData(form);
      const sel = chipsBuilt ? picked() : [];
      const total = E.$$('#chips input', el).length;
      out.innerHTML = '<p class="muted">جارٍ البحث…</p>';
      try {
        const r = await api('GET', '/search?' + E.qs({ q: f.get('q').trim(), from: f.get('from'), to: f.get('to'), min: f.get('min'), max: f.get('max'), type: sel.length && sel.length < total ? sel.join(',') : '', limit: 300 }));
        if (!chipsBuilt) buildChips(r.types);
        if (!r.rows.length) { out.innerHTML = '<div class="msg warn">لا نتائج مطابقة</div>'; return; }
        const sum = r.rows.reduce((s, x) => s + x.amount, 0);
        out.innerHTML = '<p class="muted">' + r.rows.length + ' عملية' + (r.rows.length >= 300 ? ' (أول 300؛ ضيّق البحث)' : '') + ' — مجموع المبالغ ' + money(sum) + '</p>' +
          '<table><thead><tr><th>النوع</th><th>الرقم</th><th>التاريخ</th><th>الطرف</th><th>البيان</th><th class="n">المبلغ</th><th>الحالة</th><th class="noprint"></th></tr></thead><tbody>' +
          r.rows.map((x) => { const href = TYPES[x.type][1] + x.id;
            return '<tr><td>' + esc(TYPES[x.type][0]) + '</td><td><a href="' + href + '">' + esc(x.no) + '</a></td><td>' + esc(x.date) + '</td><td>' + esc(x.party || '') + '</td><td>' + esc(x.descr || '') + '</td><td class="n">' + money(x.amount) + '</td>' +
              '<td>' + (ST[x.status] ? '<span class="tag' + (BAD[x.status] ? ' bad' : '') + '">' + esc(ST[x.status]) + '</span>' : '') + '</td>' +
              '<td class="noprint"><a href="' + href + '">عرض</a> · <a href="' + href + '?print=1">طباعة</a></td></tr>'; }).join('') + '</tbody></table>' +
          '<p class="noprint"><button class="btn alt" data-act="print">طباعة قائمة النتائج</button></p>';
      } catch (e) { out.innerHTML = E.err(e.message); }
    }
    form.addEventListener('submit', (ev) => { ev.preventDefault(); run(); });
    E.$('#chips', el).addEventListener('change', run);
    E.$('#rs', el).addEventListener('click', () => { form.reset(); E.$$('#chips input', el).forEach((c) => { c.checked = true; }); run(); });
    E.bind(el, { print: () => window.print() });
    await run();
  };
})(window.ERP);
