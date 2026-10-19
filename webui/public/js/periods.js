'use strict';
(function (E) {
  const { esc, money, api } = E;
  E.pages.periods = async function (el) {
    async function load() {
      const { months, years } = await api('GET', '/periods');
      el.innerHTML = E.head('الفترات المحاسبية', 'إقفال الشهر يمنع القيود بتاريخ فيه؛ إقفال السنة يرحّل صافي الأرباح إلى الأرباح المحتجزة') +
        '<div id="issues"></div><div class="card"><h3>إقفال شهر</h3><div class="row"><label>أي يوم في الشهر<input type="date" id="m" value="' + E.today() + '"></label>' +
        '<button class="btn alt" data-act="check">فحص الملاحظات</button><button class="btn" data-act="close">إقفال الشهر</button></div></div>' +
        '<h2>الأشهر</h2>' + (months.length ? '<table><thead><tr><th>الشهر</th><th>الحالة</th><th>القيود</th><th class="noprint"></th></tr></thead><tbody>' +
          months.map((m) => '<tr><td>' + esc(m.month.slice(0, 7)) + '</td><td>' + (m.status === 'CLOSED' ? '<span class="tag bad">مقفل</span>' : '<span class="tag good">مفتوح</span>') + '</td><td>' + esc(m.entries) + '</td><td class="noprint">' +
          (m.status === 'CLOSED' ? '<button class="btn alt sm" data-act="reopen" data-m="' + esc(m.month) + '">إعادة فتح</button>' : '') + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا توجد فترات مسجلة بعد</div>') +
        '<div class="card" style="margin-top:14px"><h3>إقفال سنة</h3><div class="row"><label>تاريخ نهاية السنة<input type="date" id="y" value="' + E.today().slice(0, 4) + '-12-31"></label><button class="btn" data-act="closeYear">إقفال السنة</button></div></div>' +
        '<h2>السنوات المقفلة</h2>' + (years.length ? '<table><thead><tr><th>نهاية السنة</th><th>صافي الدخل</th><th>الحالة</th><th class="noprint"></th></tr></thead><tbody>' +
          years.map((y) => '<tr><td>' + esc(y.yearEnd) + '</td><td class="n">' + money(y.netIncome) + '</td><td>' + esc(y.status === 'CLOSED' ? 'مقفلة' : y.status) + '</td><td class="noprint">' +
          (y.status === 'CLOSED' ? '<button class="btn alt sm" data-act="reopenYear" data-y="' + esc(y.yearEnd) + '">إعادة فتح</button>' : '') + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">لا سنوات مقفلة</p>');
    }
    const issues = (list) => { E.$('#issues', el).innerHTML = list.length ? '<div class="msg warn"><strong>ملاحظات قبل الإقفال:</strong><ul>' + list.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '<div class="msg good">لا ملاحظات</div>'; };
    E.bind(el, {
      check: async () => issues((await api('GET', '/periods/issues?' + E.qs({ month: E.$('#m', el).value }))).issues),
      close: async () => {
        const d = E.$('#m', el).value;
        const { issues: list } = await api('GET', '/periods/issues?' + E.qs({ month: d }));
        if (list.length && !confirm('توجد ملاحظات:\n- ' + list.join('\n- ') + '\n\nأتريد المتابعة؟')) return;
        await api('POST', '/periods/close', { month: d }); E.toast('أُقفل الشهر'); await load();
      },
      reopen: async (b) => { if (confirm('إعادة فتح الشهر؟')) { await api('POST', '/periods/reopen', { month: b.dataset.m }); E.toast('أُعيد فتح الشهر'); await load(); } },
      closeYear: async () => {
        const d = E.$('#y', el).value;
        if (!confirm('إقفال السنة المنتهية في ' + d + '؟ سيُنشأ قيد إقفال.')) return;
        const r = await api('POST', '/years/close', { yearEnd: d }); E.toast('أُقفلت السنة، قيد رقم ' + r.entryId); await load();
      },
      reopenYear: async (b) => { if (confirm('إعادة فتح السنة؟ سيُعكس قيد الإقفال.')) { await api('POST', '/years/reopen', { yearEnd: b.dataset.y }); E.toast('أُعيد فتح السنة'); await load(); } },
    });
    await load();
  };
})(window.ERP);
