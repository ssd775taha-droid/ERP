'use strict';
(function (E) {
  const { esc, money, api } = E;

  // ---------- إعدادات الضريبة وبيانات المنشأة ----------
  E.pages.taxSettings = async function (el) {
    await E.loadTax();
    const t = E.tax;
    el.innerHTML = E.head('إعدادات الضريبة (السعودية)', 'ضريبة القيمة المضافة 15%. هذه البيانات تظهر على الفواتير الضريبية وتدخل في رمز QR') +
      '<div class="card"><form id="f" class="row">' +
      '<label>النسبة الافتراضية %<input name="rate" inputmode="decimal" size="6" value="' + esc(t.vatRate) + '"></label>' +
      '<label>اسم المنشأة (كما في السجل التجاري)<input name="name" maxlength="120" size="30" value="' + esc(t.sellerName) + '"></label>' +
      '<label>الرقم الضريبي (15 رقماً)<input name="vat" maxlength="15" size="18" dir="ltr" value="' + esc(t.sellerVatNo) + '"></label>' +
      '<label style="flex:1">العنوان<input name="addr" maxlength="200" value="' + esc(t.sellerAddress) + '"></label><button class="btn">حفظ</button></form>' +
      '<p class="muted">الرقم الضريبي السعودي يبدأ بـ 3 وينتهي بـ 3. النسبة الافتراضية تُملأ تلقائياً في بنود الفواتير والعروض والأوامر والأصناف الجديدة، ويمكن تغييرها لكل بند (مثلاً 0% للصادرات).</p></div>' +
      '<div class="card"><h3>ما يغطيه النظام وما لا يغطيه</h3><ul>' +
      '<li>يغطي: حساب الضريبة على كل بند وترحيلها (ح/2200)، فاتورة ضريبية/مبسطة بترويسة البائع ورمز QR (المرحلة الأولى)، وتقرير إقرار ضريبة القيمة المضافة.</li>' +
      '<li class="bad">لا يغطي: الربط والإرسال إلى منصة فاتورة (المرحلة الثانية)، ولا الإعفاء/صفر الضريبة كتصنيفات منفصلة في الإقرار (تظهر حسب النسبة)، ولا إشعارات الدائن/المدين كمستندات مستقلة (الإلغاء بقيد عكسي).</li></ul></div>';
    E.$('#f', el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try { await api('POST', '/tax/settings', { vatRate: f.get('rate'), sellerName: f.get('name').trim(), sellerVatNo: f.get('vat').trim(), sellerAddress: f.get('addr').trim() }); await E.loadTax(); E.toast('حُفظت الإعدادات'); }
      catch (e) { E.toast(e.message, true); }
    });
  };

  // ---------- إقرار ضريبة القيمة المضافة ----------
  E.pages['vat-return'] = async function (el) {
    el.innerHTML = E.head('إقرار ضريبة القيمة المضافة', 'ضريبة المخرجات (المبيعات ونقاط البيع صافي المرتجعات) مقابل ضريبة المدخلات (المشتريات)') +
      '<form id="f" class="row noprint"><label>من<input type="date" name="f" value="' + E.monthStart() + '"></label><label>إلى<input type="date" name="t" value="' + E.today() + '"></label><button class="btn">عرض</button> <button type="button" class="btn alt" data-act="print">طباعة</button></form><div id="out"></div>';
    const sect = (title, rows) => '<h3>' + title + '</h3>' + (rows.length ? '<table><thead><tr><th>النسبة</th><th>عدد المستندات</th><th class="n">المبلغ الخاضع</th><th class="n">الضريبة</th></tr></thead><tbody>' +
      rows.map((x) => '<tr><td>' + x.rate + '%' + (x.rate === 0 ? ' (صفرية/معفاة)' : '') + '</td><td>' + x.docs + '</td><td class="n">' + money(x.net) + '</td><td class="n">' + money(x.vat) + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">لا حركة</p>');
    async function go() {
      const f = new FormData(E.$('#f', el));
      const r = await api('GET', '/reports/vat-return?' + E.qs({ from: f.get('f'), to: f.get('t') }));
      const t = r.totals;
      E.$('#out', el).innerHTML = sect('مبيعات (فواتير)', r.sales) + sect('مبيعات نقاط البيع (صافي المرتجعات)', r.pos) + sect('مشتريات (فواتير)', r.purchases) +
        '<h3>الملخص</h3><table><tbody><tr><td>ضريبة المخرجات (المبيعات)</td><td class="n">' + money(t.outputVat) + '</td></tr><tr><td>ضريبة المدخلات (المشتريات)</td><td class="n">' + money(t.inputVat) + '</td></tr></tbody>' +
        '<tfoot><tr><td>' + (t.netPayable >= 0 ? 'صافي الضريبة المستحقة للهيئة' : 'صافي الضريبة المستردة') + '</td><td class="n ' + (t.netPayable >= 0 ? 'bad' : 'good') + '">' + money(Math.abs(t.netPayable)) + '</td></tr></tfoot></table>' +
        '<p class="muted">تُحتسب الفواتير السارية فقط (الملغاة مستبعدة). هذا تقرير مساعد لإعداد الإقرار وليس بديلاً عن مراجعة المحاسب.</p>';
    }
    E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); go().catch((e) => E.toast(e.message, true)); });
    E.bind(el, { print: () => window.print() });
    await go();
  };
})(window.ERP);
