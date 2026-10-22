'use strict';
(function (E) {
  const { esc, money, api } = E;

  // ---------- لوحة المعلومات ----------
  // بطاقة التنبيهات التشغيلية (ما يحتاج متابعة) تحت عنوان اللوحة، وتُخفى إن لم يوجد شيء
  async function showAlerts(el) {
    try {
      const { alerts } = await api('GET', '/alerts');
      if (!alerts.length) return;
      const box = document.createElement('div'); box.className = 'card alerts';
      box.innerHTML = '<h3>تنبيهات تحتاج متابعة</h3><ul class="alist">' + alerts.map((a) => '<li class="' + a.level + '"><a href="' + a.href + '">' + a.count + ' ' + esc(a.text) + (a.amount != null ? ' — ' + money(a.amount) : '') + '</a></li>').join('') + '</ul>';
      const h = E.$('h1 + .sub', el) || E.$('h1', el);
      if (h) h.insertAdjacentElement('afterend', box);
    } catch (e) { /* التنبيهات اختيارية */ }
  }
  E.pages.dashboard = async function (el) {
    if (!E.can('reports', 'r') && !E.can('accounting', 'r')) {
      el.innerHTML = E.head('أهلاً ' + (E.me.fullName || E.me.user), 'دورك: ' + (E.me.roleName || '')) + '<div class="card">اختر من القائمة الجانبية. ' + (E.can('pos', 'w') ? '<a href="#/pos/sell">افتح شاشة البيع</a>' : '') + '</div>';
      showAlerts(el);
      return;
    }
    el.innerHTML = E.head('لوحة المعلومات', 'نظرة سريعة على الحالة المحاسبية');
    const s = await api('GET', '/summary');
    el.innerHTML = E.head('لوحة المعلومات', 'نظرة سريعة على الحالة المحاسبية') +
      (s.unbalanced > 0 ? '<div class="msg bad">يوجد ' + s.unbalanced + ' قيد غير متوازن! راجع المحاسب فوراً.</div>' : '') +
      '<div class="cards">' +
      stat('الحسابات', s.accounts) + stat('القيود', s.entries) + stat('رصيد النقدية والبنوك', money(s.cash)) +
      stat('أرباح لم تُقفل', money(s.unclosedEarnings)) + stat('أشهر مقفلة', s.closedMonths) + '</div>' +
      '<div id="dash"></div>' +
      '<div class="card">' + (E.can('accounting', 'w') ? '<a href="#/entry/new">+ قيد يومية جديد</a> · ' : '') + (E.can('reports', 'r') ? '<a href="#/reports/trial-balance">ميزان المراجعة</a> · <a href="#/reports/balance-sheet">الميزانية</a>' : '') + '</div>';
    showAlerts(el);
    // مؤشرات إضافية: مستحقات ومتأخرات ورسم المبيعات والمشتريات لآخر 6 أشهر وأكبر العملاء (تظهر لمن يملك صلاحية التقارير)
    if (E.can('reports', 'r')) {
      api('GET', '/reports/dashboard').then((d) => {
        const mx = Math.max(1, ...d.months.map((m) => Math.max(m.sales, m.purchases)));
        const W = 58, H = 120;
        const bars = d.months.map((m, i) => {
          const hs = Math.round(m.sales / mx * H), hp = Math.round(m.purchases / mx * H), x = i * (W + 14) + 10;
          return '<rect class="bs" x="' + x + '" y="' + (H - hs) + '" width="22" height="' + hs + '"><title>مبيعات ' + esc(m.month) + ': ' + money(m.sales) + '</title></rect>' +
                 '<rect class="bp" x="' + (x + 26) + '" y="' + (H - hp) + '" width="22" height="' + hp + '"><title>مشتريات ' + esc(m.month) + ': ' + money(m.purchases) + '</title></rect>' +
                 '<text class="bl" x="' + (x + 24) + '" y="' + (H + 16) + '" text-anchor="middle">' + esc(m.month.slice(2)) + '</text>';
        }).join('');
        const el2 = E.$('#dash', el); if (!el2) return;
        el2.innerHTML = '<div class="cards">' + stat('مستحق على العملاء', money(d.receivable)) + stat('منها متأخر (' + d.receivableOverdueCount + ' فاتورة)', money(d.receivableOverdue)) +
          stat('مستحق للموردين', money(d.payable)) + stat('منها متأخر للموردين', money(d.payableOverdue)) + '</div>' +
          '<div class="card"><h3>المبيعات والمشتريات (آخر 6 أشهر، قبل الضريبة)</h3><svg class="chart" viewBox="0 0 ' + (d.months.length * (W + 14) + 10) + ' ' + (H + 24) + '" role="img" aria-label="رسم المبيعات والمشتريات">' + bars + '</svg>' +
          '<div class="muted"><span class="lg bs"></span> مبيعات (فواتير + نقاط البيع) <span class="lg bp"></span> مشتريات</div></div>' +
          (d.topCustomers.length ? '<div class="card"><h3>أكبر العملاء هذه السنة</h3><table><tbody>' + d.topCustomers.map((c) => '<tr><td>' + esc(c.name) + '</td><td class="n">' + money(c.sales) + '</td></tr>').join('') + '</tbody></table></div>' : '');
      }).catch(() => {});
    }
    function stat(k, v) { return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>'; }
  };

  // ---------- دليل الحسابات ----------
  E.pages.accounts = async function (el) {
    const accts = await E.loadAccounts(true);
    const depth = (a) => { let d = 0, p = a.parent; while (p) { d++; const x = accts.find((y) => y.code === p); p = x && x.parent; } return d; };
    const rows = accts.map((a) => '<tr' + (a.children ? ' class="head"' : '') + '><td class="indent' + Math.min(depth(a), 3) + '">' + esc(a.code) + '</td><td>' + esc(a.name) +
      '</td><td>' + esc(E.typeName[a.type] || a.type) + '</td><td>' + (a.active === 'Y' ? '<span class="tag good">فعّال</span>' : '<span class="tag bad">موقوف</span>') +
      '</td><td class="noprint"><button class="btn alt sm" data-act="rename" data-code="' + esc(a.code) + '" data-name="' + esc(a.name) + '">تعديل الاسم</button> ' +
      '<button class="btn alt sm" data-act="toggle" data-code="' + esc(a.code) + '" data-active="' + esc(a.active) + '">' + (a.active === 'Y' ? 'إيقاف' : 'تفعيل') + '</button> ' + E.crudBtns('account', { id: a.code, name: a.name }) + '</td></tr>').join('');
    E.crudBind(el, () => E.pages.accounts(el));
    el.innerHTML = E.head('دليل الحسابات', 'الحسابات التجميعية لا تقبل الترحيل؛ الحساب الذي عليه حركة لا يصبح أباً لحساب جديد') +
      '<div class="card"><h3>حساب جديد</h3><form id="f-acc" class="row">' +
      '<label>الرمز<input name="code" required maxlength="12" size="8"></label>' +
      '<label>الاسم<input name="name" required maxlength="120" size="26"></label>' +
      '<label>النوع<select name="type">' + Object.keys(E.typeName).map((k) => '<option value="' + k + '">' + E.typeName[k] + '</option>').join('') + '</select></label>' +
      '<label>الحساب الأب<select name="parent"><option value="">— بلا —</option>' + accts.map((a) => '<option value="' + esc(a.code) + '">' + esc(a.code) + ' ' + esc(a.name) + '</option>').join('') + '</select></label>' +
      '<button class="btn">إضافة</button></form></div>' +
      '<table><thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>الحالة</th><th class="noprint"></th></tr></thead><tbody>' + rows + '</tbody></table>';
    E.$('#f-acc', el).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        await api('POST', '/accounts', { code: f.get('code').trim(), name: f.get('name').trim(), type: f.get('type'), parent: f.get('parent') || null });
        E.toast('أُضيف الحساب'); E.pages.accounts(el);
      } catch (e) { E.toast(e.message, true); }
    });
    if (!el._bound) {
      el._bound = true;
      E.bind(el, {
        rename: async (b) => {
          const n = prompt('الاسم الجديد للحساب ' + b.dataset.code, b.dataset.name);
          if (n && n.trim()) { await api('PATCH', '/accounts/' + encodeURIComponent(b.dataset.code), { name: n.trim() }); E.toast('تم التعديل'); E.pages.accounts(el); }
        },
        toggle: async (b) => {
          await api('PATCH', '/accounts/' + encodeURIComponent(b.dataset.code), { active: b.dataset.active !== 'Y' });
          E.toast('تم التحديث'); E.pages.accounts(el);
        },
      });
    }
  };

  // ---------- قيد يومية جديد ----------
  E.pages.entryNew = async function (el) {
    const accts = await E.loadAccounts();
    const opts = E.accountOptions(accts);
    let centers = []; try { centers = (await api('GET', '/cost-centers')).centers.filter((c) => c.active === 'Y'); } catch (e) { /* بلا صلاحية */ }
    const ccOpts = '<option value="">—</option>' + centers.map((c) => '<option value="' + c.id + '">' + esc(c.code + ' ' + c.name) + '</option>').join('');
    const ccCell = () => (centers.length ? '<td><select class="cc">' + ccOpts + '</select></td>' : '');
    const line = () => '<tr class="ln"><td><select class="ac">' + opts + '</select></td>' + ccCell() + '<td><input class="dr" inputmode="decimal" size="12"></td>' +
      '<td><input class="cr" inputmode="decimal" size="12"></td><td><input class="nt" maxlength="200"></td><td><button type="button" class="btn alt sm" data-act="rm">×</button></td></tr>';
    el.innerHTML = E.head('قيد يومية جديد', 'يجب أن يتساوى مجموع المدين والدائن') +
      '<div id="out"></div><div class="card"><div class="row">' +
      '<label>التاريخ<input type="date" id="e-date" value="' + E.today() + '"></label>' +
      '<label>المرجع<input id="e-ref" maxlength="60"></label>' +
      '<label style="flex:1">البيان<input id="e-memo" maxlength="300"></label></div>' +
      '<table><thead><tr><th>الحساب</th>' + (centers.length ? '<th>مركز التكلفة</th>' : '') + '<th>مدين</th><th>دائن</th><th>ملاحظة</th><th></th></tr></thead><tbody id="lines">' + line() + line() + '</tbody>' +
      '<tfoot><tr><td' + (centers.length ? ' colspan="2"' : '') + '>الإجمالي <span id="bal"></span></td><td class="n" id="t-dr">0.00</td><td class="n" id="t-cr">0.00</td><td colspan="2"></td></tr></tfoot></table>' +
      '<p><button type="button" class="btn alt" data-act="add">+ سطر</button> <button type="button" class="btn" id="save" data-act="save">ترحيل القيد</button></p></div>';
    const tb = E.$('#lines', el);
    const num = (s) => { const n = parseFloat(String(s).replace(/,/g, '')); return isFinite(n) ? n : 0; };
    function recalc() {
      let d = 0, c = 0;
      E.$$('.ln', tb).forEach((r) => { d += num(E.$('.dr', r).value); c += num(E.$('.cr', r).value); });
      d = Math.round(d * 100); c = Math.round(c * 100);
      E.$('#t-dr', el).textContent = money(d / 100); E.$('#t-cr', el).textContent = money(c / 100);
      const b = E.$('#bal', el);
      if (d === 0 && c === 0) b.innerHTML = '';
      else if (d === c) b.innerHTML = '<span class="tag good">متوازن</span>';
      else b.innerHTML = '<span class="tag bad">الفرق ' + money(Math.abs(d - c) / 100) + '</span>';
    }
    tb.addEventListener('input', (ev) => {
      // سطر إما مدين وإما دائن: عند الكتابة في أحدهما يُفرَّغ الآخر
      const r = ev.target.closest('.ln');
      if (r && ev.target.classList.contains('dr') && ev.target.value) E.$('.cr', r).value = '';
      if (r && ev.target.classList.contains('cr') && ev.target.value) E.$('.dr', r).value = '';
      recalc();
    });
    // نسخ قيد سابق (للتصحيح): تُملأ الأسطر ويراجعها المستخدم قبل الترحيل
    if (E.prefill && E.prefill.entry) {
      const pf = E.prefill.entry; E.prefill = null;
      E.$('#e-memo', el).value = pf.memo || ''; E.$('#e-ref', el).value = pf.ref || '';
      tb.innerHTML = '';
      pf.lines.forEach((l) => {
        tb.insertAdjacentHTML('beforeend', line());
        const r = tb.lastElementChild;
        E.$('.ac', r).value = l.account; E.$('.dr', r).value = l.debit || ''; E.$('.cr', r).value = l.credit || ''; E.$('.nt', r).value = l.note || '';
      });
      recalc(); E.toast('نُسخ القيد — راجعه ثم رحّله');
    }
    E.bind(el, {
      add: () => tb.insertAdjacentHTML('beforeend', line()),
      rm: (b) => { if (E.$$('.ln', tb).length > 2) { b.closest('tr').remove(); recalc(); } },
      save: (b) => E.busy(b, async () => {
        const lines = E.$$('.ln', tb).map((r) => ({ account: E.$('.ac', r).value, debit: E.$('.dr', r).value.replace(/,/g, '').trim() || '0', credit: E.$('.cr', r).value.replace(/,/g, '').trim() || '0', note: E.$('.nt', r).value.trim(), cc: (E.$('.cc', r) || {}).value || null }))
          .filter((l) => l.account || num(l.debit) || num(l.credit));
        const r = await api('POST', '/entries', { date: E.$('#e-date', el).value, memo: E.$('#e-memo', el).value.trim(), ref: E.$('#e-ref', el).value.trim(), lines });
        E.toast('رُحّل القيد رقم ' + r.entry.id);
        location.hash = '#/entries';
      }),
    });
  };

  // ---------- دفتر اليومية ----------
  // ---------- سند قيد يومية (للعرض والطباعة منفرداً) ----------
  E.pages.entryView = async function (el, id) {
    const { entry: e } = await api('GET', '/entries/' + encodeURIComponent(id));
    const td = e.lines.reduce((s, l) => s + l.debit, 0), tc = e.lines.reduce((s, l) => s + l.credit, 0);
    el.innerHTML = E.head('سند قيد رقم ' + e.id, esc(e.date) + (e.ref ? ' — المرجع ' + e.ref : '')) +
      '<p>' + (e.voidOf ? '<span class="tag warn">عكس القيد ' + e.voidOf + '</span> ' : '') + (e.reversedBy ? '<span class="tag bad">معكوس بالقيد ' + e.reversedBy + '</span> ' : '') + (e.kind === 'CLOSING' ? '<span class="tag">إقفال سنة</span> ' : '') +
      '<span class="muted">أنشأه: ' + esc(e.createdBy || '—') + '</span></p>' +
      (e.memo ? '<div class="card"><b>البيان:</b> ' + esc(e.memo) + '</div>' : '') +
      '<table><thead><tr><th>الحساب</th><th class="n">مدين</th><th class="n">دائن</th><th>ملاحظة</th></tr></thead><tbody>' +
      e.lines.map((l) => '<tr><td>' + esc(l.account) + ' — ' + esc(l.accountName) + (l.costCenter ? ' <span class="muted">[' + esc(l.costCenter) + ']</span>' : '') + '</td><td class="n">' + (l.debit ? money(l.debit) : '') + '</td><td class="n">' + (l.credit ? money(l.credit) : '') + '</td><td>' + esc(l.note || '') + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>الإجمالي</td><td class="n">' + money(td) + '</td><td class="n">' + money(tc) + '</td><td></td></tr></tfoot></table>' + E.signBlock(['أعدّه', 'راجعه', 'اعتمده']) +
      '<p class="noprint"><button class="btn" data-act="doc">معاينة وطباعة السند</button> <button class="btn alt" data-act="print">طباعة الشاشة</button> <button class="btn alt" data-act="copy">نسخ كقيد جديد (للتصحيح)</button> <a href="#/entries">رجوع لدفتر اليومية</a></p>';
    el._openDoc = () => E.openDoc(E.docSpec.entry(e));
    E.bind(el, { print: () => window.print(), doc: () => E.openDoc(E.docSpec.entry(e)), copy: () => { E.prefill = { entry: { memo: e.memo, ref: e.ref, lines: e.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, note: l.note })) } }; location.hash = '#/entry/new'; } });
  };

  E.pages.entries = async function (el) {
    const accts = await E.loadAccounts();
    const q = { from: E.monthStart(), to: E.today(), account: '' };
    el.innerHTML = E.head('دفتر اليومية', 'القيد المرحَّل لا يُعدَّل ولا يُحذف؛ التصحيح بقيد عكسي') +
      '<form id="f" class="row noprint"><label>من<input type="date" name="from" value="' + q.from + '"></label><label>إلى<input type="date" name="to" value="' + q.to + '"></label>' +
      '<label>الحساب<select name="account"><option value="">الكل</option>' + accts.map((a) => '<option value="' + esc(a.code) + '">' + esc(a.code) + ' ' + esc(a.name) + '</option>').join('') + '</select></label>' +
      '<label>بحث في النتائج<input type="search" name="s" id="es" placeholder="رقم، بيان، حساب…" size="16"></label><button class="btn">عرض</button> <button type="button" class="btn alt" data-act="print">طباعة</button> <a class="btn alt" style="padding:7px 16px;border:1px solid var(--brand);border-radius:8px" href="#/entry/new">+ قيد جديد</a></form><div id="list"></div>';
    async function load() {
      const f = new FormData(E.$('#f', el));
      const box = E.$('#list', el);
      box.innerHTML = '<p class="muted">جارٍ التحميل…</p>';
      try {
        const { entries } = await api('GET', '/entries?' + E.qs({ from: f.get('from'), to: f.get('to'), account: f.get('account'), limit: 200 }));
        if (!entries.length) { box.innerHTML = '<div class="msg warn">لا قيود في هذه الفترة</div>'; return; }
        box.innerHTML = entries.map((e) => {
          let tag = '';
          if (e.voidOf) tag += ' <span class="tag warn">عكس القيد ' + e.voidOf + '</span>';
          if (e.reversedBy) tag += ' <span class="tag bad">معكوس بالقيد ' + e.reversedBy + '</span>';
          if (e.kind === 'CLOSING') tag += ' <span class="tag">إقفال سنة</span>';
          const td = e.lines.reduce((s, l) => s + l.debit, 0);
          return '<div class="card"><div class="row" style="margin:0 0 8px"><strong>قيد ' + e.id + '</strong><span>' + esc(e.date) + '</span><span class="muted">' + esc(e.ref || '') + '</span>' + tag +
            '<span style="flex:1">' + esc(e.memo || '') + '</span>' +
            '<a class="noprint" href="#/entry/view/' + e.id + '?print=1">طباعة السند</a> ' + (!e.voidOf && !e.reversedBy ? '<button class="btn alt sm noprint" data-act="reverse" data-id="' + e.id + '">عكس</button>' : '') + '</div>' +
            '<table><thead><tr><th>الحساب</th><th class="n">مدين</th><th class="n">دائن</th><th>ملاحظة</th></tr></thead><tbody>' +
            e.lines.map((l) => '<tr><td>' + esc(l.account) + ' — ' + esc(l.accountName) + (l.costCenter ? ' <span class="muted">[' + esc(l.costCenter) + ']</span>' : '') + '</td><td class="n">' + (l.debit ? money(l.debit) : '') + '</td><td class="n">' + (l.credit ? money(l.credit) : '') + '</td><td>' + esc(l.note || '') + '</td></tr>').join('') +
            '</tbody><tfoot><tr><td>الإجمالي</td><td class="n">' + money(td) + '</td><td class="n">' + money(td) + '</td><td></td></tr></tfoot></table></div>';
        }).join('');
        E.$('#es', el).dispatchEvent(new Event('input'));
      } catch (e) { box.innerHTML = E.err(e.message); }
    }
    E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); load(); });
    E.$('#es', el).addEventListener('input', (ev) => {
      const q = E.norm(ev.target.value).split(' ').filter(Boolean);
      E.$$('#list > .card', el).forEach((c) => { const h = E.norm(c.textContent); c.style.display = q.every((w) => h.includes(w)) ? '' : 'none'; });
    });
    E.bind(el, {
      print: () => window.print(),
      reverse: async (b) => {
        const d = prompt('تاريخ القيد العكسي (YYYY-MM-DD) — اتركه فارغاً لتاريخ القيد الأصلي', '');
        if (d === null) return;
        if (!confirm('عكس القيد رقم ' + b.dataset.id + '؟ سيُنشأ قيد عكسي ولا يُحذف الأصلي.')) return;
        const r = await api('POST', '/entries/' + b.dataset.id + '/reverse', d.trim() ? { date: d.trim() } : {});
        E.toast('أُنشئ القيد العكسي رقم ' + r.entryId); load();
      },
    });
    load();
  };
})(window.ERP);
