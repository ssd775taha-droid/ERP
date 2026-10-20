'use strict';
(function (E) {
  const { esc, money, api } = E;
  const printBtn = '<button type="button" class="btn alt noprint" data-act="print">طباعة</button>';
  function shell(el, title, sub, fields, run) {
    el.innerHTML = E.head(title, sub) + '<form id="f" class="row noprint">' + fields + '<button class="btn">عرض</button> ' + printBtn + '</form><div id="out"></div>';
    const go = async () => {
      const out = E.$('#out', el);
      out.innerHTML = '<p class="muted">جارٍ التحميل…</p>';
      try { out.innerHTML = await run(Object.fromEntries(new FormData(E.$('#f', el)))); } catch (e) { out.innerHTML = E.err(e.message); }
    };
    E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); go(); });
    E.bind(el, { print: () => window.print() });
    go();
  }
  const dateF = (n, label, v) => '<label>' + label + '<input type="date" name="' + n + '" value="' + v + '"></label>';
  const sec = (title, rows, total, totalLabel) => '<h3>' + title + '</h3><table><tbody>' +
    (rows.length ? rows.map((r) => '<tr><td>' + esc(r.code) + '</td><td>' + esc(r.name) + '</td><td class="n">' + money(r.amount) + '</td></tr>').join('') : '<tr><td colspan="3" class="muted">لا شيء</td></tr>') +
    '</tbody><tfoot><tr><td colspan="2">' + totalLabel + '</td><td class="n">' + money(total) + '</td></tr></tfoot></table>';

  E.pages['trial-balance'] = (el) => shell(el, 'ميزان المراجعة', 'أرصدة كل الحسابات حتى التاريخ', dateF('to', 'حتى تاريخ', E.today()), async (f) => {
    const r = await api('GET', '/reports/trial-balance?' + E.qs({ to: f.to }));
    return (r.balanced ? '<div class="msg good">الميزان متوازن</div>' : '<div class="msg bad">الميزان غير متوازن!</div>') +
      '<table><thead><tr><th>الرمز</th><th>الحساب</th><th class="n">مدين</th><th class="n">دائن</th><th class="n">رصيد مدين</th><th class="n">رصيد دائن</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td class="n">' + money(x.debit) + '</td><td class="n">' + money(x.credit) + '</td><td class="n">' + (x.balanceDebit ? money(x.balanceDebit) : '') + '</td><td class="n">' + (x.balanceCredit ? money(x.balanceCredit) : '') + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="2">الإجمالي</td><td class="n">' + money(r.totals.debit) + '</td><td class="n">' + money(r.totals.credit) + '</td><td class="n">' + money(r.totals.balanceDebit) + '</td><td class="n">' + money(r.totals.balanceCredit) + '</td></tr></tfoot></table>';
  });

  E.pages.ledger = async function (el, param) {
    const accts = await E.loadAccounts();
    const fields = '<label>الحساب<select name="code">' + E.accountOptions(accts, param) + '</select></label>' + dateF('from', 'من', E.yearStart()) + dateF('to', 'إلى', E.today());
    shell(el, 'كشف حساب', 'حركة الحساب برصيد جارٍ', fields, async (f) => {
      if (!f.code) return '<div class="msg warn">اختر حساباً</div>';
      const r = await api('GET', '/reports/ledger/' + encodeURIComponent(f.code) + '?' + E.qs({ from: f.from, to: f.to }));
      return '<h3>' + esc(r.account.code) + ' — ' + esc(r.account.name) + '</h3><table><thead><tr><th>القيد</th><th>التاريخ</th><th>البيان</th><th class="n">مدين</th><th class="n">دائن</th><th class="n">الرصيد</th></tr></thead><tbody>' +
        '<tr class="head"><td colspan="5">رصيد افتتاحي</td><td class="n">' + money(r.opening) + '</td></tr>' +
        r.rows.map((x) => '<tr><td>' + x.entryId + '</td><td>' + esc(x.date) + '</td><td>' + esc(x.memo || '') + ' <span class="muted">' + esc(x.ref || '') + '</span></td><td class="n">' + (x.debit ? money(x.debit) : '') + '</td><td class="n">' + (x.credit ? money(x.credit) : '') + '</td><td class="n">' + money(x.balance) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="5">رصيد ختامي (مدين +، دائن −)</td><td class="n">' + money(r.closing) + '</td></tr></tfoot></table>';
    });
    if (param) E.$('select[name=code]', el).value = param;
  };

  E.pages['income-statement'] = (el) => shell(el, 'قائمة الدخل', 'تستثني قيود إقفال السنة', dateF('from', 'من', E.yearStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/reports/income-statement?' + E.qs(f));
    return sec('الإيرادات', r.revenue, r.totalRevenue, 'إجمالي الإيرادات') + sec('المصروفات', r.expense, r.totalExpense, 'إجمالي المصروفات') +
      '<div class="card"><strong>صافي ' + (r.netIncome >= 0 ? 'الربح' : 'الخسارة') + ': <span class="' + (r.netIncome >= 0 ? 'good' : 'bad') + '">' + money(r.netIncome) + '</span></strong></div>';
  });

  E.pages['balance-sheet'] = (el) => shell(el, 'الميزانية العمومية', 'المركز المالي بتاريخ', dateF('asof', 'بتاريخ', E.today()), async (f) => {
    const r = await api('GET', '/reports/balance-sheet?' + E.qs(f));
    const eq = r.equity.concat(r.unclosedEarnings ? [{ code: '', name: 'أرباح الفترة غير المقفلة', amount: r.unclosedEarnings }] : []);
    return (r.balanced ? '<div class="msg good">الميزانية متوازنة</div>' : '<div class="msg bad">الميزانية غير متوازنة!</div>') +
      sec('الأصول', r.assets, r.totalAssets, 'إجمالي الأصول') + sec('الخصوم', r.liabilities, r.totalLiabilities, 'إجمالي الخصوم') + sec('حقوق الملكية', eq, r.totalEquity, 'إجمالي حقوق الملكية');
  });

  E.pages['cash-flow'] = (el) => shell(el, 'التدفقات النقدية', 'الطريقة المباشرة', dateF('from', 'من', E.yearStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/reports/cash-flow?' + E.qs(f));
    const row = (k, v) => '<tr><td>' + k + '</td><td class="n">' + money(v) + '</td></tr>';
    return (r.reconciled ? '<div class="msg good">الأرصدة متطابقة</div>' : '<div class="msg bad">الأرصدة غير متطابقة!</div>') +
      '<table><tbody>' + row('رصيد النقدية أول الفترة', r.opening) + row('أنشطة تشغيلية', r.operating) + row('أنشطة استثمارية', r.investing) + row('أنشطة تمويلية', r.financing) +
      '</tbody><tfoot>' + row('رصيد النقدية آخر الفترة', r.closing) + '</tfoot></table>';
  });

  // ---------- تقارير متقدمة ----------
  const pctTxt = (x) => (x == null ? '—' : x.toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%');
  const bar = (share) => '<span class="mbar"><i style="width:' + Math.max(0, Math.min(100, share)) + '%"></i></span>';
  const sel = (n, label, opts, cur) => '<label>' + label + '<select name="' + n + '">' + opts.map((o) => '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>';

  E.pages['sales-analysis'] = (el) => shell(el, 'تحليل المبيعات والمشتريات', 'قبل الضريبة، بعد خصم الإشعارات الدائنة (ومعها نقاط البيع في المبيعات)',
    sel('kind', 'النوع', [['SALES', 'مبيعات'], ['PURCHASE', 'مشتريات']], 'SALES') + sel('by', 'حسب', [['party', 'الطرف'], ['item', 'الصنف'], ['month', 'الشهر']], 'party') +
    dateF('from', 'من', E.yearStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/reports/sales-analysis?' + E.qs(f));
    const lbl = { party: r.kind === 'SALES' ? 'العميل' : 'المورد', item: 'الصنف', month: 'الشهر' }[r.by];
    const max = Math.max(1, ...r.rows.map((x) => Math.abs(x.net)));
    if (!r.rows.length) return '<div class="msg warn">لا حركة في هذه الفترة</div>';
    return '<div class="card"><strong>إجمالي ' + (r.kind === 'SALES' ? 'المبيعات' : 'المشتريات') + ' الصافي: ' + money(r.total) + '</strong> <span class="muted">(' + r.rows.length + ' ' + (r.by === 'month' ? 'شهر' : r.by === 'item' ? 'صنف' : 'طرف') + ')</span></div>' +
      '<table><thead><tr><th>#</th><th>' + lbl + '</th><th class="n">المستندات</th><th class="n">الصافي</th><th class="n">النسبة</th><th class="noprint"></th></tr></thead><tbody>' +
      r.rows.map((x, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(x.label) + '</td><td class="n">' + x.docs + '</td><td class="n">' + money(x.net) + '</td><td class="n">' + pctTxt(r.total ? x.net / r.total * 100 : null) + '</td><td class="noprint">' + bar(x.net / max * 100) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="3">الإجمالي</td><td class="n">' + money(r.total) + '</td><td colspan="2"></td></tr></tfoot></table>';
  });

  E.pages['item-profit'] = (el) => shell(el, 'ربحية الأصناف', 'الإيراد − التكلفة لكل صنف (فواتير مبيعات − إشعارات دائنة + نقاط البيع). الخدمات بلا صنف مخزني لا تظهر هنا',
    dateF('from', 'من', E.yearStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/reports/item-profit?' + E.qs(f));
    if (!r.rows.length) return '<div class="msg warn">لا مبيعات أصناف في هذه الفترة</div>';
    const t = r.totals;
    return '<div class="cards"><div class="stat"><div class="muted">الإيراد</div><b>' + money(t.revenue) + '</b></div><div class="stat"><div class="muted">التكلفة</div><b>' + money(t.cost) + '</b></div>' +
      '<div class="stat"><div class="muted">إجمالي الهامش</div><b class="' + (t.margin >= 0 ? 'good' : 'bad') + '">' + money(t.margin) + '</b></div><div class="stat"><div class="muted">نسبة الهامش</div><b>' + pctTxt(t.marginPct) + '</b></div></div>' +
      '<table><thead><tr><th>الرمز</th><th>الصنف</th><th class="n">الكمية</th><th class="n">الإيراد</th><th class="n">التكلفة</th><th class="n">الهامش</th><th class="n">%</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td class="n">' + x.qty + '</td><td class="n">' + money(x.revenue) + '</td><td class="n">' + money(x.cost) + '</td><td class="n ' + (x.margin < 0 ? 'bad' : '') + '">' + money(x.margin) + '</td><td class="n">' + pctTxt(x.marginPct) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="3">الإجمالي</td><td class="n">' + money(t.revenue) + '</td><td class="n">' + money(t.cost) + '</td><td class="n">' + money(t.margin) + '</td><td class="n">' + pctTxt(t.marginPct) + '</td></tr></tfoot></table>';
  });

  E.pages.comparative = (el) => {
    const y = new Date().getFullYear();
    shell(el, 'قائمة الدخل المقارنة', 'فترتان جنباً إلى جنب بالفرق ونسبة التغير (تستثني قيود إقفال السنة)',
      dateF('f1', 'الحالية من', y + '-01-01') + dateF('t1', 'إلى', E.today()) + dateF('f2', 'المقارنة من', (y - 1) + '-01-01') + dateF('t2', 'إلى', (y - 1) + E.today().slice(4)), async (f) => {
      const r = await api('GET', '/reports/comparative?' + E.qs(f));
      if (!r.rows.length) return '<div class="msg warn">لا حركة إيرادات أو مصروفات في الفترتين</div>';
      const row = (x, bad) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td class="n">' + money(x.current) + '</td><td class="n">' + money(x.previous) + '</td><td class="n ' + ((x.diff > 0) === bad ? 'bad' : 'good') + '">' + money(x.diff) + '</td><td class="n">' + pctTxt(x.pct) + '</td></tr>';
      const head = '<thead><tr><th>الرمز</th><th>الحساب</th><th class="n">الحالية</th><th class="n">المقارنة</th><th class="n">الفرق</th><th class="n">%</th></tr></thead>';
      const tot = (label, t, bad) => { const d = Math.round((t.current - t.previous) * 100) / 100; return '<tr><td colspan="2">' + label + '</td><td class="n">' + money(t.current) + '</td><td class="n">' + money(t.previous) + '</td><td class="n ' + ((d > 0) === bad ? 'bad' : 'good') + '">' + money(d) + '</td><td class="n">' + pctTxt(t.previous ? d / Math.abs(t.previous) * 100 : null) + '</td></tr>'; };
      const T = r.totals;
      return '<h3>الإيرادات</h3><table>' + head + '<tbody>' + r.rows.filter((x) => x.type === 'REVENUE').map((x) => row(x, false)).join('') + '</tbody><tfoot>' + tot('إجمالي الإيرادات', T.revenue, false) + '</tfoot></table>' +
        '<h3>المصروفات</h3><table>' + head + '<tbody>' + r.rows.filter((x) => x.type === 'EXPENSE').map((x) => row(x, true)).join('') + '</tbody><tfoot>' + tot('إجمالي المصروفات', T.expense, true) + '</tfoot></table>' +
        '<table><tfoot>' + tot('صافي الربح / (الخسارة)', T.net, false) + '</tfoot></table>';
    });
  };
})(window.ERP);
