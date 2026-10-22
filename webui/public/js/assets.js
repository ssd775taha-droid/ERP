'use strict';
(function (E) {
  const { esc, money, api } = E;
  const ST = { ACTIVE: '<span class="tag good">فعّال</span>', DISPOSED: '<span class="tag warn">مباع / مستبعد</span>' };

  // ---------- سجل الأصول ----------
  E.pages.assets = async function (el) {
    const [{ assets, totals }, chk] = await Promise.all([api('GET', '/assets'), api('GET', '/assets/check')]);
    el.innerHTML = E.head('سجل الأصول الثابتة', 'القسط الثابت الشهري: (التكلفة − الخردة) ÷ العمر') +
      (chk.ok ? '<div class="msg good">السجل يطابق الأستاذ (الأصول والمجمع)</div>' : '<div class="msg bad">فرق بين السجل والأستاذ: ' + chk.rows.filter((x) => x.difference).map((x) => esc(x.account) + ' (' + money(x.difference) + ')').join('، ') + '</div>') +
      '<p class="noprint"><a href="#/assets/new">+ أصل جديد</a> · <a href="#/assets/depreciation">تشغيل الإهلاك</a> · <button class="btn alt sm" data-act="print">طباعة</button></p>' +
      (assets.length ? '<table><thead><tr><th>الرمز</th><th>الأصل</th><th>الفئة</th><th>الاقتناء</th><th class="n">التكلفة</th><th class="n">المجمع</th><th class="n">القيمة الدفترية</th><th>آخر إهلاك</th><th>الحالة</th></tr></thead><tbody>' +
        assets.map((a) => '<tr><td><a href="#/assets/view/' + a.id + '">' + esc(a.code) + '</a></td><td>' + esc(a.name) + '</td><td>' + esc(a.catName) + '</td><td>' + esc(a.acqDate) + '</td><td class="n">' + money(a.cost) + '</td><td class="n">' + money(a.accumulated) + '</td><td class="n">' + money(a.bookValue) + '</td><td>' + esc(a.lastPeriod || '—') + (a.fullyDepreciated === 'Y' ? ' <span class="tag">مُهلك بالكامل</span>' : '') + '</td><td>' + (ST[a.status] || a.status) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="4">إجمالي الأصول الفعّالة</td><td class="n">' + money(totals.cost) + '</td><td class="n">' + money(totals.accumulated) + '</td><td class="n">' + money(totals.bookValue) + '</td><td colspan="2"></td></tr></tfoot></table>' : '<div class="msg warn">لا أصول مسجلة</div>');
    E.bind(el, { print: () => window.print() });
  };

  // ---------- أصل جديد (+ الفئات) ----------
  E.pages.assetNew = async function (el) {
    const [{ categories }, accts] = await Promise.all([api('GET', '/assets/categories'), E.loadAccounts()]);
    const ao = (def) => accts.filter((a) => a.active === 'Y' && !a.children).map((a) => '<option value="' + esc(a.code) + '"' + (a.code === def ? ' selected' : '') + '>' + esc(a.code) + ' ' + esc(a.name) + '</option>').join('');
    const act = categories.filter((c) => c.active === 'Y');
    E.crudBind(el, () => E.pages.assetNew(el));
    el.innerHTML = E.head('أصل ثابت جديد', 'يُرحَّل قيد: مدين حساب الأصل / دائن الحساب المقابل (للرصيد الافتتاحي اختر 3100 رأس المال)') +
      '<div class="card"><form id="f" class="row"><label>الرمز<input name="code" required maxlength="30" size="10"></label><label>الاسم<input name="name" required maxlength="120" size="24"></label>' +
      '<label>الفئة<select name="cat">' + act.map((c) => '<option value="' + c.id + '">' + esc(c.name) + ' (' + c.lifeMonths + ' شهراً)</option>').join('') + '</select></label>' +
      '<label>تاريخ الاقتناء<input type="date" name="acq" value="' + E.today() + '"></label><label>التكلفة<input name="cost" inputmode="decimal" required size="12"></label>' +
      '<label>الخردة<input name="salv" inputmode="decimal" value="0" size="10"></label><label>العمر (أشهر) — اختياري<input name="life" inputmode="numeric" size="6"></label>' +
      '<label>بدء الإهلاك (أول الشهر) — اختياري<input type="date" name="ds"></label><label>الحساب المقابل<select name="off">' + ao('1200') + '</select></label>' +
      '<label>رقم فاتورة الشراء — اختياري<input name="inv" inputmode="numeric" size="8"></label><label style="flex:1">ملاحظة<input name="note" maxlength="300"></label><button class="btn">تسجيل الأصل</button></form></div>' +
      '<h2>فئات الأصول</h2><table><thead><tr><th>الرمز</th><th>الاسم</th><th>العمر</th><th>حساب الأصل</th><th>المجمع</th><th>المصروف</th><th class="noprint"></th></tr></thead><tbody>' +
      categories.map((c) => '<tr><td>' + esc(c.code) + '</td><td>' + esc(c.name) + '</td><td>' + c.lifeMonths + ' شهراً</td><td>' + esc(c.assetAccount) + '</td><td>' + esc(c.accumAccount) + '</td><td>' + esc(c.expenseAccount) + '</td><td class="noprint">' + E.crudBtns('category', { id: c.id, name: c.name }) + '</td></tr>').join('') + '</tbody></table>' +
      '<div class="card" style="margin-top:14px"><h3>فئة جديدة</h3><form id="fc" class="row"><label>الرمز<input name="code" required maxlength="12" size="8"></label><label>الاسم<input name="name" required maxlength="120" size="20"></label><label>العمر (أشهر)<input name="life" required inputmode="numeric" size="6"></label>' +
      '<label>حساب الأصل<select name="a">' + ao('1500') + '</select></label><label>المجمع<select name="m">' + ao('1510') + '</select></label><label>المصروف<select name="e">' + ao('5600') + '</select></label><button class="btn">إضافة فئة</button></form></div>';
    E.$('#f', el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try {
        const r = await api('POST', '/assets', { code: f.get('code').trim(), name: f.get('name').trim(), catId: Number(f.get('cat')), acqDate: f.get('acq'), cost: f.get('cost').replace(/,/g, ''), salvage: f.get('salv').replace(/,/g, ''),
          lifeMonths: f.get('life') || null, depStart: f.get('ds') || null, offsetAccount: f.get('off'), invoiceId: f.get('inv') || null, note: f.get('note').trim() });
        E.toast('سُجّل الأصل'); location.hash = '#/assets/view/' + r.id;
      } catch (e) { E.toast(e.message, true); }
    });
    E.$('#fc', el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try { await api('POST', '/assets/categories', { code: f.get('code').trim(), name: f.get('name').trim(), lifeMonths: f.get('life'), assetAccount: f.get('a'), accumAccount: f.get('m'), expenseAccount: f.get('e') }); E.toast('أُضيفت الفئة'); E.pages.assetNew(el); }
      catch (e) { E.toast(e.message, true); }
    });
  };

  // ---------- عرض أصل: جدول الإهلاك، بيع، إلغاء ----------
  E.pages.assetView = async function (el, id) {
    async function load() {
      const { asset: a } = await api('GET', '/assets/' + encodeURIComponent(id));
      const accts = await E.loadAccounts();
      const ao = accts.filter((x) => x.active === 'Y' && !x.children).map((x) => '<option value="' + esc(x.code) + '"' + (x.code === '1200' ? ' selected' : '') + '>' + esc(x.code) + ' ' + esc(x.name) + '</option>').join('');
      const ok = a.depreciation.filter((d) => d.status === 'OK');
      el.innerHTML = E.head(a.code + ' — ' + a.name, a.catName) + '<p>' + (ST[a.status] || a.status) + ' <span class="muted">قيد الاقتناء ' + (a.entryId || (a.invoiceId ? 'عبر فاتورة ' + a.invoiceId : '—')) + (a.disposalEntryId ? ' · قيد البيع ' + a.disposalEntryId : '') + '</span></p>' +
        '<div class="cards"><div class="stat"><div class="k">التكلفة</div><div class="v">' + money(a.cost) + '</div></div><div class="stat"><div class="k">مجمع الإهلاك</div><div class="v">' + money(a.accumulated) + '</div></div><div class="stat"><div class="k">القيمة الدفترية</div><div class="v">' + money(a.bookValue) + '</div></div><div class="stat"><div class="k">الخردة · العمر</div><div class="v">' + money(a.salvage) + ' · ' + a.lifeMonths + ' شهراً</div></div></div>' +
        (a.status === 'DISPOSED' ? '<div class="msg warn">بيع بتاريخ ' + esc(a.disposalDate) + ' بمتحصلات ' + money(a.proceeds) + '</div>' : '') +
        '<h3>جدول الإهلاك المسجّل</h3>' + (ok.length ? '<table><thead><tr><th>الشهر</th><th class="n">القسط</th></tr></thead><tbody>' + ok.map((d) => '<tr><td>' + esc(d.period) + '</td><td class="n">' + money(d.amount) + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">لم يُسجَّل إهلاك بعد</p>') +
        (a.status === 'ACTIVE' ? '<div class="card noprint" style="margin-top:14px"><h3>بيع / استبعاد</h3><form id="fd" class="row"><label>التاريخ<input type="date" name="d" value="' + E.today() + '"></label><label>المتحصلات<input name="p" inputmode="decimal" value="0" size="12"></label>' +
          '<label>حساب المتحصلات<select name="a">' + ao + '</select></label><button class="btn danger">بيع الأصل</button></form><p class="muted">يجب تشغيل الإهلاك حتى الشهر السابق للبيع أولاً، ثم يُثبَّت الربح أو الخسارة تلقائياً.</p>' +
          (!ok.length ? '<button class="btn alt sm" data-act="void">إلغاء تسجيل الأصل (لم يُهلك)</button>' : '') + '</div>' : '') +
        '<p class="noprint"><button class="btn alt" data-act="print">طباعة</button> <a href="#/assets">رجوع للسجل</a></p>';
      const fd = E.$('#fd', el);
      if (fd) fd.addEventListener('submit', async (ev) => {
        ev.preventDefault(); const f = new FormData(fd);
        if (!confirm('بيع الأصل ' + a.code + '؟ لا يمكن التراجع من الواجهة.')) return;
        try { await api('POST', '/assets/' + a.id + '/dispose', { date: f.get('d'), proceeds: f.get('p').replace(/,/g, ''), proceedsAccount: f.get('a') }); E.toast('سُجّل البيع'); await load(); }
        catch (e) { E.toast(e.message, true); }
      });
    }
    E.bind(el, {
      print: () => window.print(),
      void: async () => { if (confirm('إلغاء تسجيل الأصل؟ سيُعكس قيد الاقتناء إن وُجد.')) { await api('POST', '/assets/' + encodeURIComponent(id) + '/void'); E.toast('أُلغي الأصل'); location.hash = '#/assets'; } },
    });
    await load();
  };

  // ---------- تشغيل الإهلاك ----------
  E.pages.depreciation = async function (el) {
    async function load() {
      const { months } = await api('GET', '/depreciation/months');
      el.innerHTML = E.head('الإهلاك الشهري', 'قيد واحد لكل شهر؛ التشغيل آمن للتكرار ويعوّض الأشهر الفائتة بالترتيب') +
        '<p class="noprint"><button class="btn gold sm" data-act="print">معاينة وطباعة</button></p><div class="card"><form id="f" class="row"><label>حتى شهر (أي يوم فيه)<input type="date" name="u" value="' + E.today() + '"></label><button class="btn">تشغيل الإهلاك</button></form></div>' +
        '<h2>الأشهر المُهلَكة</h2>' + (months.length ? '<table><thead><tr><th>الشهر</th><th>عدد الأصول</th><th class="n">الإجمالي</th><th class="noprint"></th></tr></thead><tbody>' +
          months.map((m, i) => '<tr><td>' + esc(m.period.slice(0, 7)) + '</td><td>' + m.assets + '</td><td class="n">' + money(m.amount) + '</td><td class="noprint">' + '<button class="btn alt sm" data-act="depdoc" data-p="' + esc(m.period) + '">طباعة المستند</button> ' + (i === 0 ? '<button class="btn alt sm" data-act="rev" data-p="' + esc(m.period) + '">عكس هذا الشهر</button>' : '') + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا إهلاك مسجّل</div>');
      E.$('#f', el).addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          const r = await api('POST', '/depreciation/run', { upto: new FormData(ev.target).get('u') });
          E.toast(r.total ? 'رُحّل إهلاك بقيمة ' + money(r.total) : 'لا إهلاك جديد'); await load();
        } catch (e) { E.toast(e.message, true); }
      });
    }
    E.bind(el, { depdoc: async (b) => E.openDoc(E.docSpec.depreciation(await api('GET', '/depreciation/months/' + encodeURIComponent(b.dataset.p)))),
      rev: async (b) => { if (confirm('عكس إهلاك شهر ' + b.dataset.p.slice(0, 7) + '؟')) { await api('POST', '/depreciation/reverse', { period: b.dataset.p }); E.toast('عُكس الإهلاك'); await load(); } } });
    await load();
  };
})(window.ERP);
