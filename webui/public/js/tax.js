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
      '<div class="card"><h3>ترويسة المستندات</h3><p class="muted">تظهر على كل المطبوعات (تقارير، فواتير، إشعارات، عروض، أوامر) وعلى الفاتورة الضريبية. الشعار PNG أو JPEG ويُصغَّر تلقائياً.</p>' +
      '<form id="lf" class="row">' +
      '<label>الاسم بالإنجليزية<input name="nameEn" maxlength="120" size="28" dir="ltr" value="' + esc(E.lh.nameEn) + '"></label>' +
      '<label>السجل التجاري<input name="crNo" maxlength="30" size="14" dir="ltr" value="' + esc(E.lh.crNo) + '"></label>' +
      '<label>الهاتف<input name="phone" maxlength="40" size="14" dir="ltr" value="' + esc(E.lh.phone) + '"></label>' +
      '<label>البريد<input name="email" maxlength="120" size="22" dir="ltr" value="' + esc(E.lh.email) + '"></label>' +
      '<label>الموقع<input name="website" maxlength="120" size="20" dir="ltr" value="' + esc(E.lh.website) + '"></label>' +
      '<label>العنوان بالإنجليزية<input name="addrEn" maxlength="200" size="34" dir="ltr" value="' + esc(E.lh.addrEn) + '"></label>' +
      '<label style="flex:1;min-width:260px">بيانات التحويل البنكي (تظهر في صندوق على الفاتورة)<textarea name="bankInfo" maxlength="500" rows="2" style="width:100%">' + esc(E.lh.bankInfo) + '</textarea></label>' +
      '<label style="flex:1;min-width:260px">تذييل المطبوعات (حساب بنكي، شروط…)<textarea name="footerNote" maxlength="500" rows="2" style="width:100%">' + esc(E.lh.footerNote) + '</textarea></label>' +
      '<div><div>الشعار</div><div id="lp"></div><input type="file" id="lfile" accept="image/png,image/jpeg"> <button type="button" class="btn alt sm" id="lrm">إزالة الشعار</button></div>' +
      '<div><div>الختم / التوقيع</div><div id="sp"></div><input type="file" id="sfile" accept="image/png,image/jpeg"> <button type="button" class="btn alt sm" id="srm">إزالة الختم</button></div>' +
      '<button class="btn">حفظ الترويسة</button></form>' +
      '<h4>معاينة</h4><div id="lprev" class="card"></div></div>' +
      '<div class="card"><h3>ما يغطيه النظام وما لا يغطيه</h3><ul>' +
      '<li>يغطي: حساب الضريبة على كل بند وترحيلها (ح/2200)، فاتورة ضريبية/مبسطة بترويسة البائع ورمز QR (المرحلة الأولى)، وتقرير إقرار ضريبة القيمة المضافة.</li>' +
      '<li class="bad">لا يغطي: الربط والإرسال إلى منصة فاتورة (المرحلة الثانية)، ولا الإعفاء/صفر الضريبة كتصنيفات منفصلة في الإقرار (تظهر حسب النسبة)، ولا إشعارات الدائن/المدين كمستندات مستقلة (الإلغاء بقيد عكسي).</li></ul></div>';
    E.$('#f', el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try { await api('POST', '/tax/settings', { vatRate: f.get('rate'), sellerName: f.get('name').trim(), sellerVatNo: f.get('vat').trim(), sellerAddress: f.get('addr').trim() }); await E.loadTax(); E.toast('حُفظت الإعدادات'); }
      catch (e) { E.toast(e.message, true); }
    });
    // الترويسة: الشعار يُصغَّر في المتصفح (حد أقصى 400×200) ثم يُرسل data URL
    const img = { logo: E.lh.logo || '', stamp: E.lh.stamp || '' };
    const lf = E.$('#lf', el);
    const g = (n) => lf.elements[n].value.trim();
    const preview = () => {
      E.$('#lp', el).innerHTML = img.logo ? '<img class="logo-prev" alt="" src="' + img.logo + '">' : '<span class="muted">لا شعار</span>';
      E.$('#sp', el).innerHTML = img.stamp ? '<img class="logo-prev" alt="" src="' + img.stamp + '">' : '<span class="muted">لا ختم</span>';
      const keep = Object.assign({}, E.lh);
      Object.assign(E.lh, { nameEn: g('nameEn'), crNo: g('crNo'), phone: g('phone'), email: g('email'), website: g('website'), logo: img.logo });
      E.$('#lprev', el).innerHTML = E.companyBlock({ fallback: 'اسم المنشأة' });
      Object.assign(E.lh, keep);
    };
    preview();
    lf.addEventListener('input', preview);
    // الصورة تُصغَّر في المتصفح (حد أقصى 400×200) ثم تُرسل data URL
    const bindImage = (key, fileId, rmId) => {
      E.$('#' + rmId, el).addEventListener('click', () => { img[key] = ''; E.$('#' + fileId, el).value = ''; preview(); });
      E.$('#' + fileId, el).addEventListener('change', (ev) => {
        const file = ev.target.files[0]; if (!file) return;
        if (file.size > 5e6) { E.toast('الصورة كبيرة جداً', true); return; }
        const im = new Image(), url = URL.createObjectURL(file);
        im.onload = () => {
          const k = Math.min(1, 400 / im.width, 200 / im.height), c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          let out = c.toDataURL('image/png');
          if (out.length > 280000) out = c.toDataURL('image/jpeg', 0.85);
          if (out.length > 280000) { E.toast('الصورة معقّدة جداً، اختر صورة أبسط', true); return; }
          img[key] = out; preview();
        };
        im.onerror = () => { URL.revokeObjectURL(url); E.toast('تعذّرت قراءة الصورة', true); };
        im.src = url;
      });
    };
    bindImage('logo', 'lfile', 'lrm'); bindImage('stamp', 'sfile', 'srm');
    lf.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { await api('POST', '/letterhead', { nameEn: g('nameEn'), crNo: g('crNo'), phone: g('phone'), email: g('email'), website: g('website'), addrEn: g('addrEn'), bankInfo: g('bankInfo'), footerNote: g('footerNote'), logo: img.logo, stamp: img.stamp }); await E.loadTax(); E.toast('حُفظت الترويسة'); }
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
      E.$('#out', el).innerHTML = sect('مبيعات (فواتير)', r.sales) + sect('إشعارات مبيعات (دائن بالسالب، مدين بالموجب)', r.salesNotes) + sect('مبيعات نقاط البيع (صافي المرتجعات)', r.pos) + sect('مشتريات (فواتير)', r.purchases) + sect('إشعارات مشتريات (دائن بالسالب، مدين بالموجب)', r.purchaseNotes) +
        '<h3>الملخص</h3><table><tbody><tr><td>ضريبة المخرجات (المبيعات ونقاط البيع بعد الإشعارات)</td><td class="n">' + money(t.outputVat) + '</td></tr><tr><td>ضريبة المدخلات (المشتريات بعد الإشعارات)</td><td class="n">' + money(t.inputVat) + '</td></tr></tbody>' +
        '<tfoot><tr><td>' + (t.netPayable >= 0 ? 'صافي الضريبة المستحقة للهيئة' : 'صافي الضريبة المستردة') + '</td><td class="n ' + (t.netPayable >= 0 ? 'bad' : 'good') + '">' + money(Math.abs(t.netPayable)) + '</td></tr></tfoot></table>' +
        '<p class="muted">تُحتسب الفواتير السارية فقط (الملغاة مستبعدة). هذا تقرير مساعد لإعداد الإقرار وليس بديلاً عن مراجعة المحاسب.</p>';
    }
    E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); go().catch((e) => E.toast(e.message, true)); });
    E.bind(el, { print: () => window.print() });
    await go();
  };
})(window.ERP);
