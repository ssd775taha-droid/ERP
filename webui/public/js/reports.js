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

  E.pages['trial-balance'] = (el) => shell(el, 'ميزان المراجعة', 'افتتاحي + حركة الفترة = ختامي. امسح «من» لعرض الأرصدة التراكمية حتى التاريخ',
    dateF('from', 'من', E.yearStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/reports/trial-balance?' + E.qs({ from: f.from, to: f.to }));
    const t = r.totals, m = (x) => (x ? money(x) : '');
    const stat = (k, v) => '<div class="stat"><div class="muted">' + k + '</div><b>' + v + '</b></div>';
    const cards = '<div class="cards">' + (r.hasPeriod ? stat('إجمالي المدين (الحركة)', money(t.periodDebit)) + stat('إجمالي الدائن (الحركة)', money(t.periodCredit)) : stat('إجمالي المدين', money(t.debit)) + stat('إجمالي الدائن', money(t.credit))) +
      stat('الأرصدة المدينة', money(t.balanceDebit)) + stat('الأرصدة الدائنة', money(t.balanceCredit)) + stat(r.balanced ? 'الميزان متوازن ✓' : 'الميزان غير متوازن!', money(Math.abs(t.debit - t.credit))) + '</div>';
    if (!r.rows.length) return cards + '<div class="msg warn">لا حركة</div>';
    if (!r.hasPeriod) {
      return cards + '<table><thead><tr><th>الرمز</th><th>الحساب</th><th class="n">مدين</th><th class="n">دائن</th><th class="n">رصيد مدين</th><th class="n">رصيد دائن</th></tr></thead><tbody>' +
        r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td class="n">' + money(x.debit) + '</td><td class="n">' + money(x.credit) + '</td><td class="n">' + m(x.balanceDebit) + '</td><td class="n">' + m(x.balanceCredit) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="2">الإجمالي</td><td class="n">' + money(t.debit) + '</td><td class="n">' + money(t.credit) + '</td><td class="n">' + money(t.balanceDebit) + '</td><td class="n">' + money(t.balanceCredit) + '</td></tr></tfoot></table>';
    }
    return cards + (r.openBalanced ? '' : '<div class="msg warn">الرصيد الافتتاحي غير متوازن: راجع قيود ما قبل الفترة</div>') +
      '<table><thead><tr><th>الرمز</th><th>اسم الحساب</th><th class="n">افتتاحي مدين</th><th class="n">افتتاحي دائن</th><th class="n">حركة مدين</th><th class="n">حركة دائن</th><th class="n">ختامي مدين</th><th class="n">ختامي دائن</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td class="n">' + m(x.openDebit) + '</td><td class="n">' + m(x.openCredit) + '</td><td class="n">' + m(x.periodDebit) + '</td><td class="n">' + m(x.periodCredit) + '</td><td class="n">' + m(x.balanceDebit) + '</td><td class="n">' + m(x.balanceCredit) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="2">الإجمالي</td><td class="n">' + money(t.openDebit) + '</td><td class="n">' + money(t.openCredit) + '</td><td class="n">' + money(t.periodDebit) + '</td><td class="n">' + money(t.periodCredit) + '</td><td class="n">' + money(t.balanceDebit) + '</td><td class="n">' + money(t.balanceCredit) + '</td></tr></tfoot></table>';
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

  // ---------- تقارير المخزون ----------
  const q3 = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const whSel = (whs, label) => '<label>' + (label || 'المخزن') + '<select name="wh"><option value="">كل المخازن</option>' + whs.map((w) => '<option value="' + w.id + '">' + esc(w.name) + '</option>').join('') + '</select></label>';
  const MT = { PURCHASE: 'شراء', SALE: 'بيع', ADJUST: 'تسوية', TRANSFER: 'تحويل', REVERSAL: 'عكس' };

  E.pages['inv-valuation'] = async (el) => {
    const { warehouses } = await api('GET', '/warehouses');
    shell(el, 'تقييم المخزون', 'الكمية والقيمة ومتوسط التكلفة لكل صنف بتاريخ محدد (من سجل الحركات)',
      dateF('asof', 'بتاريخ', E.today()) + whSel(warehouses) + '<label><input type="checkbox" name="split" value="1"> تفصيل حسب المخزن</label>', async (f) => {
      const r = await api('GET', '/inventory/reports/valuation?' + E.qs(f));
      if (!r.rows.length) return '<div class="msg warn">لا رصيد في هذا التاريخ</div>';
      const split = f.split === '1';
      return '<div class="card"><strong>إجمالي قيمة المخزون: ' + money(r.totalValue) + '</strong> <span class="muted">(' + r.rows.length + ' سطر)</span></div>' +
        '<table><thead><tr><th>الرمز</th><th>الصنف</th>' + (split ? '<th>المخزن</th>' : '') + '<th class="n">الكمية</th><th class="n">متوسط التكلفة</th><th class="n">القيمة</th><th class="n">%</th></tr></thead><tbody>' +
        r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td>' + (split ? '<td>' + esc(x.whName) + '</td>' : '') + '<td class="n">' + q3(x.qty) + ' ' + esc(x.unit) + '</td><td class="n">' + money(x.avgCost) + '</td><td class="n">' + money(x.value) + '</td><td class="n">' + pctTxt(x.share) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="' + (split ? 5 : 4) + '">الإجمالي</td><td class="n">' + money(r.totalValue) + '</td><td></td></tr></tfoot></table>';
    });
  };

  E.pages['inv-card'] = async (el, param) => {
    const [{ items }, { warehouses }] = await Promise.all([api('GET', '/items'), api('GET', '/warehouses')]);
    const stockItems = items.filter((i) => i.trackStock !== 'N' && i.track_stock !== 'N');
    shell(el, 'كارت الصنف', 'حركة صنف واحد برصيد جارٍ للكمية والقيمة',
      '<label>الصنف<select name="item"><option value="">— اختر صنفاً —</option>' + stockItems.map((i) => '<option value="' + i.id + '">' + esc(i.code) + ' — ' + esc(i.name) + '</option>').join('') + '</select></label>' +
      whSel(warehouses) + dateF('from', 'من', E.yearStart()) + dateF('to', 'إلى', E.today()), async (f) => {
      if (!f.item) return '<div class="msg warn">اختر صنفاً</div>';
      const r = await api('GET', '/inventory/reports/item-card?' + E.qs(f));
      return '<h3>' + esc(r.item.code) + ' — ' + esc(r.item.name) + ' <span class="muted">(' + esc(r.item.unit) + ')</span></h3>' +
        '<table><thead><tr><th>التاريخ</th><th>النوع</th><th>المخزن</th><th class="n">وارد</th><th class="n">صادر</th><th class="n">القيمة</th><th class="n">رصيد الكمية</th><th class="n">رصيد القيمة</th></tr></thead><tbody>' +
        '<tr class="head"><td colspan="6">رصيد افتتاحي</td><td class="n">' + q3(r.opening.qty) + '</td><td class="n">' + money(r.opening.value) + '</td></tr>' +
        r.rows.map((x) => '<tr><td>' + esc(x.date) + '</td><td>' + (MT[x.type] || x.type) + (x.reverses ? ' <span class="tag warn">عكس ' + x.reverses + '</span>' : '') + '</td><td>' + esc(x.whName) + '</td><td class="n">' + (x.qty > 0 ? q3(x.qty) : '') + '</td><td class="n">' + (x.qty < 0 ? q3(-x.qty) : '') + '</td><td class="n">' + money(x.value) + '</td><td class="n">' + q3(x.balQty) + '</td><td class="n">' + money(x.balValue) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="6">رصيد ختامي</td><td class="n">' + q3(r.closing.qty) + '</td><td class="n">' + money(r.closing.value) + '</td></tr></tfoot></table>';
    });
    if (param) { E.$('select[name=item]', el).value = param; E.$('#f', el).requestSubmit(); }
  };

  E.pages['inv-movement'] = async (el) => {
    const { warehouses } = await api('GET', '/warehouses');
    shell(el, 'ملخص حركة المخزون', 'افتتاحي + وارد − صادر = ختامي لكل صنف في الفترة (التحويل بين المخازن يُستبعد عند اختيار «كل المخازن»)',
      dateF('from', 'من', E.monthStart()) + dateF('to', 'إلى', E.today()) + whSel(warehouses), async (f) => {
      const r = await api('GET', '/inventory/reports/movement?' + E.qs(f));
      if (!r.rows.length) return '<div class="msg warn">لا حركة في هذه الفترة</div>';
      const t = r.totals;
      return '<table><thead><tr><th>الرمز</th><th>الصنف</th><th class="n">افتتاحي (كمية)</th><th class="n">افتتاحي (قيمة)</th><th class="n">وارد (كمية)</th><th class="n">وارد (قيمة)</th><th class="n">صادر (كمية)</th><th class="n">صادر (قيمة)</th><th class="n">ختامي (كمية)</th><th class="n">ختامي (قيمة)</th></tr></thead><tbody>' +
        r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td class="n">' + q3(x.openQty) + '</td><td class="n">' + money(x.openValue) + '</td><td class="n">' + q3(x.inQty) + '</td><td class="n">' + money(x.inValue) + '</td><td class="n">' + q3(x.outQty) + '</td><td class="n">' + money(x.outValue) + '</td><td class="n">' + q3(x.closeQty) + '</td><td class="n">' + money(x.closeValue) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="3"></td><td class="n">' + money(t.openValue) + '</td><td></td><td class="n">' + money(t.inValue) + '</td><td></td><td class="n">' + money(t.outValue) + '</td><td></td><td class="n">' + money(t.closeValue) + '</td></tr></tfoot></table>';
    });
  };

  E.pages['inv-slow'] = (el) => shell(el, 'ركود المخزون', 'أصناف لها رصيد ولم تُبَع منذ المدة المحددة (الصنف الذي لم يُبَع قط يُحسب عمره من أول وارد)',
    dateF('asof', 'بتاريخ', E.today()) + '<label>لم تُبَع منذ (يوم)<input name="days" value="90" size="5" inputmode="numeric"></label>', async (f) => {
    const r = await api('GET', '/inventory/reports/slow-moving?' + E.qs(f));
    if (!r.rows.length) return '<div class="msg good">لا أصناف راكدة لأكثر من ' + r.days + ' يوماً</div>';
    return '<div class="card"><strong>قيمة المخزون الراكد: ' + money(r.totalValue) + '</strong> <span class="muted">(' + r.rows.length + ' صنف راكد ≥ ' + r.days + ' يوماً)</span></div>' +
      '<table><thead><tr><th>الرمز</th><th>الصنف</th><th class="n">الكمية</th><th class="n">القيمة</th><th>آخر بيع</th><th class="n">أيام الركود</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td class="n">' + q3(x.qty) + ' ' + esc(x.unit) + '</td><td class="n">' + money(x.value) + '</td><td>' + (x.lastSale ? esc(x.lastSale) : '<span class="tag warn">لم يُبَع قط</span>') + '</td><td class="n">' + x.idleDays + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="3">الإجمالي</td><td class="n">' + money(r.totalValue) + '</td><td colspan="2"></td></tr></tfoot></table>';
  });

  E.pages['inv-shortage'] = (el) => shell(el, 'نواقص وتغطية المخزون', 'أصناف مخزنية نشطة رصيدها أقل من أو يساوي الحد، مع معدل البيع اليومي (آخر 90 يوماً) وأيام التغطية',
    dateF('asof', 'بتاريخ', E.today()) + '<label>الرصيد ≤<input name="limit" value="0" size="6" inputmode="decimal"></label>', async (f) => {
    const r = await api('GET', '/inventory/reports/shortage?' + E.qs(f));
    if (!r.rows.length) return '<div class="msg good">لا أصناف عند هذا الحد</div>';
    return '<table><thead><tr><th>الرمز</th><th>الصنف</th><th class="n">الرصيد</th><th class="n">مباع آخر 90 يوماً</th><th class="n">المعدل اليومي</th><th class="n">تكفي لـ (يوم)</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td class="n ' + (x.qty <= 0 ? 'bad' : '') + '">' + q3(x.qty) + ' ' + esc(x.unit) + '</td><td class="n">' + q3(x.sold90) + '</td><td class="n">' + q3(x.daily) + '</td><td class="n">' + (x.coverDays == null ? '—' : x.coverDays) + '</td></tr>').join('') + '</tbody></table>' +
      '<p class="muted">الأصناف الأكثر مبيعاً أولاً؛ «—» تعني لا مبيعات في الفترة.</p>';
  });

  // ---------- تقارير الرواتب ----------
  const monthStartYear = () => E.yearStart().slice(0, 7) + '-01';
  const payDates = () => dateF('from', 'من شهر', monthStartYear()) + dateF('to', 'إلى شهر', E.today());
  const note = '<p class="muted">تُحتسب الكشوف المرحَّلة والمصروفة فقط؛ المسودات والملغاة مستبعدة. القسم هو القسم الحالي للموظف.</p>';

  E.pages['pay-dept'] = (el) => shell(el, 'الرواتب حسب القسم', 'عدد الموظفين والأساسي والاستحقاقات والاستقطاعات والصافي وتكلفة صاحب العمل لكل قسم', payDates(), async (f) => {
    const r = await api('GET', '/payroll/reports/by-department?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا كشوف مرحَّلة في هذه الفترة</div>';
    const stat = (k, v) => '<div class="stat"><div class="muted">' + k + '</div><b>' + money(v) + '</b></div>';
    return '<div class="cards">' + stat('الإجمالي', t.gross) + stat('الاستقطاعات والسلف', t.deductions + t.advance) + stat('الصافي', t.net) + stat('تكلفة صاحب العمل', t.employer) + '</div>' +
      '<table><thead><tr><th>القسم</th><th class="n">الموظفون</th><th class="n">الأساسي</th><th class="n">استحقاقات</th><th class="n">الإجمالي</th><th class="n">استقطاعات</th><th class="n">سلف</th><th class="n">الصافي</th><th class="n">حصة صاحب العمل</th><th class="n">%</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.dept) + '</td><td class="n">' + x.employees + '</td><td class="n">' + money(x.basic) + '</td><td class="n">' + money(x.earnings) + '</td><td class="n">' + money(x.gross) + '</td><td class="n">' + money(x.deductions) + '</td><td class="n">' + money(x.advance) + '</td><td class="n">' + money(x.net) + '</td><td class="n">' + money(x.employer) + '</td><td class="n">' + pctTxt(t.gross ? x.gross / t.gross * 100 : null) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>الإجمالي</td><td class="n">' + t.employees + '</td><td class="n">' + money(t.basic) + '</td><td class="n">' + money(t.earnings) + '</td><td class="n">' + money(t.gross) + '</td><td class="n">' + money(t.deductions) + '</td><td class="n">' + money(t.advance) + '</td><td class="n">' + money(t.net) + '</td><td class="n">' + money(t.employer) + '</td><td></td></tr></tfoot></table>' + note +
      '<p class="muted">عدد الموظفين في الإجمالي مجموع أعدادهم في الأقسام (موظف واحد لا يُحتسب مرتين لأن له قسماً واحداً).</p>';
  });

  E.pages['pay-employee'] = (el) => shell(el, 'كشف رواتب الموظفين بالأشهر', 'صافي راتب كل موظف في كل شهر مع إجماليات الفترة', payDates(), async (f) => {
    const r = await api('GET', '/payroll/reports/by-employee?' + E.qs(f));
    if (!r.rows.length) return '<div class="msg warn">لا كشوف مرحَّلة في هذه الفترة</div>';
    if (r.months.length > 14) return '<div class="msg warn">الفترة أطول من 14 شهراً: ضيّقها لعرض الأعمدة</div>';
    return '<table><thead><tr><th>الرمز</th><th>الموظف</th><th>القسم</th>' + r.months.map((m) => '<th class="n">' + m + '</th>').join('') + '<th class="n">الإجمالي</th><th class="n">الاستقطاعات</th><th class="n">الصافي</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.dept) + '</td>' + r.months.map((m) => '<td class="n">' + (x.months[m] ? money(x.months[m]) : '') + '</td>').join('') + '<td class="n">' + money(x.gross) + '</td><td class="n">' + money(x.deductions) + '</td><td class="n">' + money(x.net) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="3">الإجمالي</td>' + r.months.map((m) => '<td class="n">' + money(r.monthTotals[m]) + '</td>').join('') + '<td class="n">' + money(r.totals.gross) + '</td><td class="n">' + money(r.totals.deductions) + '</td><td class="n">' + money(r.totals.net) + '</td></tr></tfoot></table>' + note;
  });

  E.pages['pay-components'] = (el) => shell(el, 'الرواتب حسب المكوّن', 'إجمالي كل بدل واستقطاع وحصة صاحب عمل وسلفة في الفترة وعدد موظفيه (يفيد في مطابقة التأمينات والالتزامات)', payDates(), async (f) => {
    const r = await api('GET', '/payroll/reports/components?' + E.qs(f)), K = { BASIC: 'الأساسي', EARNING: 'استحقاق', DEDUCTION: 'استقطاع من الموظف', ADVANCE: 'أقساط سلف', EMPLOYER: 'حصة صاحب العمل' };
    if (!r.rows.length) return '<div class="msg warn">لا كشوف مرحَّلة في هذه الفترة</div>';
    const sec = (k) => { const rows = r.rows.filter((x) => x.kind === k); return rows.length ? '<h3>' + K[k] + '</h3><table><thead><tr><th>المكوّن</th><th class="n">الموظفون</th><th class="n">المبلغ</th></tr></thead><tbody>' +
      rows.map((x) => '<tr><td>' + esc(x.name) + '</td><td class="n">' + x.employees + '</td><td class="n">' + money(x.amount) + '</td></tr>').join('') + '</tbody><tfoot><tr><td colspan="2">الإجمالي</td><td class="n">' + money(rows.reduce((s, x) => s + x.amount, 0)) + '</td></tr></tfoot></table>' : ''; };
    return ['BASIC', 'EARNING', 'DEDUCTION', 'ADVANCE', 'EMPLOYER'].map(sec).join('') + note;
  });

  E.pages['pay-trend'] = (el) => shell(el, 'اتجاه تكلفة الرواتب الشهري', 'الإجمالي والاستقطاعات والصافي وحصة صاحب العمل والتكلفة الكلية لكل شهر', payDates(), async (f) => {
    const r = await api('GET', '/payroll/reports/trend?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا كشوف مرحَّلة في هذه الفترة</div>';
    const max = Math.max(1, ...r.rows.map((x) => x.totalCost));
    return '<table><thead><tr><th>الشهر</th><th>الحالة</th><th class="n">الموظفون</th><th class="n">الإجمالي</th><th class="n">الاستقطاعات</th><th class="n">الصافي</th><th class="n">حصة صاحب العمل</th><th class="n">التكلفة الكلية</th><th class="noprint"></th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + x.month + '</td><td>' + (x.status === 'PAID' ? 'مصروف' : 'مرحَّل') + '</td><td class="n">' + x.employees + '</td><td class="n">' + money(x.gross) + '</td><td class="n">' + money(x.deductions) + '</td><td class="n">' + money(x.net) + '</td><td class="n">' + money(x.employer) + '</td><td class="n">' + money(x.totalCost) + '</td><td class="noprint">' + bar(x.totalCost / max * 100) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="3">الإجمالي</td><td class="n">' + money(t.gross) + '</td><td class="n">' + money(t.deductions) + '</td><td class="n">' + money(t.net) + '</td><td class="n">' + money(t.employer) + '</td><td class="n">' + money(t.totalCost) + '</td><td class="noprint"></td></tr></tfoot></table>' + note;
  });

  // ---------- تقارير الموارد البشرية ----------
  const asofF = () => dateF('asof', 'بتاريخ', E.today());
  const rangeF = () => dateF('from', 'من', E.yearStart()) + dateF('to', 'إلى', E.today());
  const stat = (k, v) => '<div class="stat"><div class="muted">' + k + '</div><b>' + v + '</b></div>';

  E.pages['hr-headcount'] = (el) => shell(el, 'القوى العاملة حسب القسم', 'من هم على رأس العمل في التاريخ المحدد، مع الأساسي الإجمالي والمتوسط والأدنى والأعلى (الراتب الأساسي الساري في ذلك التاريخ)', asofF(), async (f) => {
    const r = await api('GET', '/hr/reports/headcount?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا موظفين على رأس العمل في هذا التاريخ</div>';
    const max = Math.max(1, ...r.rows.map((x) => x.active));
    return '<div class="cards">' + stat('على رأس العمل', t.active) + stat('إجمالي الأساسي', money(t.basic)) + stat('متوسط الأساسي', money(t.avg)) + stat('انتهت خدمتهم حتى التاريخ', t.left) + '</div>' +
      '<table><thead><tr><th>القسم</th><th class="n">الموظفون</th><th class="n">إجمالي الأساسي</th><th class="n">المتوسط</th><th class="n">الأدنى</th><th class="n">الأعلى</th><th class="noprint"></th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.dept) + '</td><td class="n">' + x.active + '</td><td class="n">' + money(x.basic) + '</td><td class="n">' + money(x.avg) + '</td><td class="n">' + money(x.min) + '</td><td class="n">' + money(x.max) + '</td><td class="noprint">' + bar(x.active / max * 100) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>الإجمالي</td><td class="n">' + t.active + '</td><td class="n">' + money(t.basic) + '</td><td class="n">' + money(t.avg) + '</td><td colspan="3"></td></tr></tfoot></table>';
  });

  E.pages['hr-tenure'] = (el) => shell(el, 'مدة الخدمة', 'مدة خدمة كل موظف على رأس العمل منذ تاريخ التعيين حتى التاريخ المحدد، وتوزيعهم على الفئات', asofF(), async (f) => {
    const r = await api('GET', '/hr/reports/tenure?' + E.qs(f));
    if (!r.rows.length) return '<div class="msg warn">لا موظفين على رأس العمل في هذا التاريخ</div>';
    return '<div class="cards">' + r.buckets.map((b) => stat(b.label, b.count)).join('') + stat('متوسط مدة الخدمة (سنة)', r.avgYears) + '</div>' +
      '<table><thead><tr><th>الرمز</th><th>الموظف</th><th>القسم</th><th>الوظيفة</th><th>التعيين</th><th class="n">مدة الخدمة</th><th class="n">الأساسي</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.dept) + '</td><td>' + esc(x.job || '') + '</td><td>' + esc(x.hireDate) + '</td><td class="n">' + x.years + ' سنة و ' + x.restMonths + ' شهر</td><td class="n">' + (x.basic ? money(x.basic) : '') + '</td></tr>').join('') + '</tbody></table>';
  });

  E.pages['hr-movements'] = (el) => shell(el, 'حركة الموظفين', 'التعيينات وإنهاءات الخدمة في الفترة، وعدد الموظفين أول الفترة وآخرها', rangeF(), async (f) => {
    const r = await api('GET', '/hr/reports/movements?' + E.qs(f)), t = r.totals;
    return '<div class="cards">' + stat('أول الفترة', t.opening) + stat('تعيينات', t.hires) + stat('إنهاءات خدمة', t.terms) + stat('آخر الفترة', t.closing) + '</div>' +
      (r.rows.length ? '<table><thead><tr><th>التاريخ</th><th>الحركة</th><th>الرمز</th><th>الموظف</th><th>القسم</th><th>الوظيفة</th></tr></thead><tbody>' +
        r.rows.map((x) => '<tr><td>' + esc(x.date) + '</td><td>' + (x.type === 'HIRE' ? '<span class="tag good">تعيين</span>' : '<span class="tag bad">إنهاء خدمة</span>') + '</td><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.dept) + '</td><td>' + esc(x.job || '') + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا حركة في هذه الفترة</div>');
  });

  E.pages['hr-salary-changes'] = (el) => shell(el, 'تغيّرات الرواتب', 'كل تعديل على الراتب الأساسي في الفترة: القديم والجديد والفرق والنسبة (راتب التعيين الأول لا يُعدّ تغييراً)', rangeF(), async (f) => {
    const r = await api('GET', '/hr/reports/salary-changes?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا تغيّرات في الرواتب في هذه الفترة</div>';
    return '<div class="cards">' + stat('عدد التعديلات', t.count) + stat('زيادات', t.raises) + stat('تخفيضات', t.cuts) + stat('صافي الفرق الشهري', money(t.net)) + '</div>' +
      '<table><thead><tr><th>سارٍ من</th><th>الرمز</th><th>الموظف</th><th>القسم</th><th class="n">القديم</th><th class="n">الجديد</th><th class="n">الفرق</th><th class="n">%</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.month) + '</td><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.dept) + '</td><td class="n">' + money(x.oldBasic) + '</td><td class="n">' + money(x.newBasic) + '</td><td class="n ' + (x.diff < 0 ? 'bad' : 'good') + '">' + money(x.diff) + '</td><td class="n">' + pctTxt(x.pct) + '</td></tr>').join('') + '</tbody></table>';
  });

  E.pages['hr-advances-report'] = (el) => shell(el, 'أرصدة سلف الموظفين', 'الموظفون الذين لهم سلف قائمة: المبلغ الممنوح والمسدّد والمتبقي', '', async () => {
    const r = await api('GET', '/hr/reports/advances'), t = r.totals;
    if (!r.rows.length) return '<div class="msg good">لا سلف قائمة</div>';
    return '<table><thead><tr><th>الرمز</th><th>الموظف</th><th class="n">عدد السلف</th><th class="n">الممنوح</th><th class="n">المسدّد</th><th class="n">المتبقي</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td class="n">' + x.count + '</td><td class="n">' + money(x.amount) + '</td><td class="n">' + money(x.repaid) + '</td><td class="n">' + money(x.remaining) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="3">الإجمالي</td><td class="n">' + money(t.amount) + '</td><td class="n">' + money(t.repaid) + '</td><td class="n">' + money(t.remaining) + '</td></tr></tfoot></table><p class="muted">المتبقي يطابق رصيد حساب سلف الموظفين (1350) ما لم تُرحَّل عليه قيود يدوية.</p>';
  });

  E.pages['hr-data-gaps'] = (el) => shell(el, 'نواقص بيانات الموظفين', 'موظفون على رأس العمل ينقصهم رقم هوية أو حساب بنكي أو قسم أو وظيفة (مهم قبل تحويل الرواتب)', '', async () => {
    const r = await api('GET', '/hr/reports/data-gaps'), t = r.totals, no = (x) => (x ? '<span class="tag bad">ناقص</span>' : '<span class="tag good">✓</span>');
    if (!r.rows.length) return '<div class="msg good">بيانات كل الموظفين (' + r.active + ') مكتملة</div>';
    return '<div class="cards">' + stat('موظفون ناقصو بيانات', r.rows.length + ' من ' + r.active) + stat('بلا هوية', t.noId) + stat('بلا حساب بنكي', t.noBank) + stat('بلا قسم', t.noDept) + stat('بلا وظيفة', t.noJob) + '</div>' +
      '<table><thead><tr><th>الرمز</th><th>الموظف</th><th>القسم</th><th>الهوية</th><th>الحساب البنكي</th><th>القسم</th><th>الوظيفة</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td><a href="#/hr/employees">' + esc(x.name) + '</a></td><td>' + esc(x.dept) + '</td><td>' + no(x.noId) + '</td><td>' + no(x.noBank) + '</td><td>' + no(x.noDept) + '</td><td>' + no(x.noJob) + '</td></tr>').join('') + '</tbody></table>';
  });

  // ---------- تقارير نقاط البيع ----------
  E.pages['pos-daily'] = (el) => shell(el, 'المبيعات اليومية (نقاط البيع)', 'العمليات والمبيعات والمرتجعات والصافي والضريبة لكل يوم، وتوزيع النقد والبطاقة (النقد بعد خصم الباقي والمردود)', dateF('from', 'من', E.monthStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/pos/reports/daily?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا عمليات في هذه الفترة</div>';
    const max = Math.max(1, ...r.rows.map((x) => Math.abs(x.total)));
    return '<div class="cards">' + stat('عدد العمليات', t.sales) + stat('صافي المبيعات (قبل الضريبة)', money(t.net)) + stat('الضريبة', money(t.vat)) + stat('الإجمالي بعد المرتجعات', money(t.total)) + stat('متوسط الفاتورة', money(t.avgTicket)) + '</div>' +
      '<table><thead><tr><th>التاريخ</th><th class="n">عمليات</th><th class="n">مرتجعات</th><th class="n">المبيعات</th><th class="n">المرتجع</th><th class="n">الصافي</th><th class="n">الضريبة</th><th class="n">الإجمالي</th><th class="n">نقد</th><th class="n">بطاقة</th><th class="noprint"></th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.date) + '</td><td class="n">' + x.sales + '</td><td class="n">' + x.returns + '</td><td class="n">' + money(x.gross) + '</td><td class="n">' + money(x.returned) + '</td><td class="n">' + money(x.net) + '</td><td class="n">' + money(x.vat) + '</td><td class="n">' + money(x.total) + '</td><td class="n">' + money(x.cash) + '</td><td class="n">' + money(x.card) + '</td><td class="noprint">' + bar(Math.abs(x.total) / max * 100) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>الإجمالي</td><td class="n">' + t.sales + '</td><td class="n">' + t.returns + '</td><td class="n">' + money(t.gross) + '</td><td class="n">' + money(t.returned) + '</td><td class="n">' + money(t.net) + '</td><td class="n">' + money(t.vat) + '</td><td class="n">' + money(t.total) + '</td><td class="n">' + money(t.cash) + '</td><td class="n">' + money(t.card) + '</td><td class="noprint"></td></tr></tfoot></table><p class="muted">نقد + بطاقة = الإجمالي بعد المرتجعات. العمليات الملغاة مستبعدة.</p>';
  });

  E.pages['pos-items'] = (el) => shell(el, 'مبيعات الأصناف (نقاط البيع)', 'الكمية والصافي والتكلفة والهامش لكل صنف بعد خصم المرتجعات', dateF('from', 'من', E.monthStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/pos/reports/items?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا مبيعات في هذه الفترة</div>';
    return '<table><thead><tr><th>#</th><th>الرمز</th><th>الصنف</th><th class="n">الكمية</th><th class="n">متوسط السعر</th><th class="n">الصافي</th><th class="n">الضريبة</th><th class="n">التكلفة</th><th class="n">الهامش</th></tr></thead><tbody>' +
      r.rows.map((x, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td class="n">' + q3(x.qty) + '</td><td class="n">' + money(x.avgPrice) + '</td><td class="n">' + money(x.net) + '</td><td class="n">' + money(x.vat) + '</td><td class="n">' + money(x.cost) + '</td><td class="n ' + (x.margin < 0 ? 'bad' : '') + '">' + money(x.margin) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="3">الإجمالي</td><td class="n">' + q3(t.qty) + '</td><td></td><td class="n">' + money(t.net) + '</td><td class="n">' + money(t.vat) + '</td><td class="n">' + money(t.cost) + '</td><td class="n">' + money(t.margin) + '</td></tr></tfoot></table>';
  });

  E.pages['pos-cashiers'] = (el) => shell(el, 'المبيعات حسب الكاشير والنقطة', 'عدد الورديات والعمليات والمبيعات والمرتجعات ومتوسط الفاتورة لكل كاشير على كل نقطة', dateF('from', 'من', E.monthStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/pos/reports/cashiers?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا عمليات في هذه الفترة</div>';
    return '<table><thead><tr><th>الكاشير</th><th>النقطة</th><th class="n">الورديات</th><th class="n">عمليات</th><th class="n">مرتجعات</th><th class="n">المبيعات</th><th class="n">الصافي</th><th class="n">الإجمالي</th><th class="n">متوسط الفاتورة</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.cashier) + '</td><td>' + esc(x.register) + '</td><td class="n">' + x.shifts + '</td><td class="n">' + x.sales + '</td><td class="n">' + x.returns + '</td><td class="n">' + money(x.gross) + '</td><td class="n">' + money(x.net) + '</td><td class="n">' + money(x.total) + '</td><td class="n">' + money(x.avgTicket) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="2">الإجمالي</td><td class="n">' + t.shifts + '</td><td class="n">' + t.sales + '</td><td class="n">' + t.returns + '</td><td class="n">' + money(t.gross) + '</td><td class="n">' + money(t.net) + '</td><td class="n">' + money(t.total) + '</td><td></td></tr></tfoot></table>';
  });

  E.pages['pos-hourly'] = (el) => shell(el, 'المبيعات بالساعة', 'توزيع عمليات البيع على ساعات اليوم لمعرفة أوقات الذروة (حسب وقت تسجيل العملية)', dateF('from', 'من', E.monthStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/pos/reports/hourly?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا عمليات في هذه الفترة</div>';
    const max = Math.max(1, ...r.rows.map((x) => x.total));
    return '<table><thead><tr><th>الساعة</th><th class="n">العمليات</th><th class="n">الصافي</th><th class="n">الإجمالي</th><th class="n">%</th><th class="noprint"></th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td dir="ltr">' + String(x.hour).padStart(2, '0') + ':00 – ' + String(x.hour).padStart(2, '0') + ':59</td><td class="n">' + x.sales + '</td><td class="n">' + money(x.net) + '</td><td class="n">' + money(x.total) + '</td><td class="n">' + pctTxt(t.total ? x.total / t.total * 100 : null) + '</td><td class="noprint">' + bar(x.total / max * 100) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>الإجمالي</td><td class="n">' + t.sales + '</td><td class="n">' + money(t.net) + '</td><td class="n">' + money(t.total) + '</td><td colspan="2"></td></tr></tfoot></table>';
  });

  E.pages['pos-shifts'] = (el) => shell(el, 'فروقات الورديات (عجز وزيادة)', 'الورديات المقفلة في الفترة: النقد المتوقع مقابل المعدود والفرق', dateF('from', 'من', E.monthStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/pos/reports/shifts?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا ورديات مقفلة في هذه الفترة</div>';
    return '<div class="cards">' + stat('ورديات مقفلة', t.shifts) + stat('زيادات', money(t.over)) + stat('عجز', money(t.short)) + stat('صافي الفروقات', money(t.net)) + '</div>' +
      '<table><thead><tr><th>الوردية</th><th>النقطة</th><th>الكاشير</th><th>أُغلقت</th><th class="n">الافتتاحي</th><th class="n">المتوقع</th><th class="n">المعدود</th><th class="n">الفرق</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td><a href="#/pos/shift/' + x.id + '">' + x.id + '</a></td><td>' + esc(x.register) + '</td><td>' + esc(x.cashier) + '</td><td dir="ltr">' + esc(x.closedAt) + '</td><td class="n">' + money(x.opening) + '</td><td class="n">' + money(x.expected) + '</td><td class="n">' + money(x.counted) + '</td><td class="n ' + (x.variance < 0 ? 'bad' : x.variance > 0 ? 'good' : '') + '">' + money(x.variance) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="5">الإجمالي</td><td class="n">' + money(t.expected) + '</td><td class="n">' + money(t.counted) + '</td><td class="n">' + money(t.net) + '</td></tr></tfoot></table>';
  });

  E.pages['pos-returns'] = (el) => shell(el, 'مرتجعات نقاط البيع', 'عمليات المرتجع في الفترة ونسبتها من المبيعات', dateF('from', 'من', E.monthStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/pos/reports/returns?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg good">لا مرتجعات في هذه الفترة</div>';
    return '<div class="cards">' + stat('عدد المرتجعات', t.count) + stat('قيمة المرتجعات (بالضريبة)', money(t.total)) + stat('نسبة المرتجعات من المبيعات', pctTxt(t.rate)) + '</div>' +
      '<table><thead><tr><th>المرتجع</th><th>التاريخ</th><th>على عملية</th><th>الكاشير</th><th class="n">الصافي</th><th class="n">الضريبة</th><th class="n">الإجمالي</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td><a href="#/pos/sale/' + x.id + '">' + esc(x.no) + '</a></td><td>' + esc(x.date) + '</td><td>' + esc(x.origNo) + '</td><td>' + esc(x.cashier) + '</td><td class="n">' + money(x.net) + '</td><td class="n">' + money(x.vat) + '</td><td class="n">' + money(x.total) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="4">الإجمالي</td><td class="n">' + money(t.net) + '</td><td class="n">' + money(t.vat) + '</td><td class="n">' + money(t.total) + '</td></tr></tfoot></table>';
  });

  // ---------- تقارير الأصول الثابتة ----------
  E.pages['asset-register'] = (el) => shell(el, 'سجل الأصول بالقيم الدفترية', 'التكلفة ومجمع الإهلاك والقيمة الدفترية لكل أصل قائم في التاريخ المحدد، وملخص الفئات (الإهلاك المحتسب حتى شهر التاريخ)', dateF('asof', 'بتاريخ', E.today()), async (f) => {
    const r = await api('GET', '/assets/reports/register?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا أصول قائمة في هذا التاريخ</div>';
    return '<div class="cards">' + stat('عدد الأصول', t.count) + stat('التكلفة', money(t.cost)) + stat('مجمع الإهلاك', money(t.accumulated)) + stat('القيمة الدفترية', money(t.bookValue)) + '</div>' +
      '<h3>حسب الفئة</h3><table><thead><tr><th>الفئة</th><th class="n">العدد</th><th class="n">التكلفة</th><th class="n">مجمع الإهلاك</th><th class="n">القيمة الدفترية</th></tr></thead><tbody>' +
      r.cats.map((c) => '<tr><td>' + esc(c.cat) + '</td><td class="n">' + c.count + '</td><td class="n">' + money(c.cost) + '</td><td class="n">' + money(c.accumulated) + '</td><td class="n">' + money(c.bookValue) + '</td></tr>').join('') + '</tbody></table>' +
      '<h3>الأصول</h3><table><thead><tr><th>الرمز</th><th>الأصل</th><th>الفئة</th><th>الاقتناء</th><th class="n">التكلفة</th><th class="n">المجمع</th><th class="n">الدفترية</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.cat) + '</td><td>' + esc(x.acqDate) + '</td><td class="n">' + money(x.cost) + '</td><td class="n">' + money(x.accumulated) + '</td><td class="n">' + money(x.bookValue) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="4">الإجمالي</td><td class="n">' + money(t.cost) + '</td><td class="n">' + money(t.accumulated) + '</td><td class="n">' + money(t.bookValue) + '</td></tr></tfoot></table>';
  });

  E.pages['asset-rollforward'] = (el) => shell(el, 'حركة الأصول والإهلاك', 'التكلفة: أول الفترة + إضافات − استبعادات = آخرها. مجمع الإهلاك: أول الفترة + إهلاك الفترة − المستبعد = آخرها', dateF('from', 'من', E.yearStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/assets/reports/rollforward?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا حركة في هذه الفترة</div>';
    const row = (c, bold) => '<tr' + (bold ? ' class="head"' : '') + '><td>' + esc(c.cat) + '</td><td class="n">' + money(c.openCost) + '</td><td class="n">' + money(c.additions) + '</td><td class="n">' + money(c.disposals) + '</td><td class="n">' + money(c.closeCost) + '</td><td class="n">' + money(c.openAcc) + '</td><td class="n">' + money(c.dep) + '</td><td class="n">' + money(c.removedAcc) + '</td><td class="n">' + money(c.closeAcc) + '</td><td class="n">' + money(c.closeBook) + '</td></tr>';
    return '<table><thead><tr><th>الفئة</th><th class="n">تكلفة أول</th><th class="n">إضافات</th><th class="n">استبعادات</th><th class="n">تكلفة آخر</th><th class="n">مجمع أول</th><th class="n">إهلاك الفترة</th><th class="n">مستبعد</th><th class="n">مجمع آخر</th><th class="n">الدفترية آخراً</th></tr></thead><tbody>' +
      r.rows.map((c) => row(c)).join('') + '</tbody><tfoot>' + row({ cat: 'الإجمالي', ...t }, true).replace('<tr class="head">', '<tr>') + '</tfoot></table>';
  });

  E.pages['asset-forecast'] = (el) => shell(el, 'الإهلاك المتوقع', 'قسط كل أصل فعّال في الأشهر القادمة بنفس معادلة التشغيل (الشهر الأخير يستوفي المتبقي)', '<label>عدد الأشهر<input name="months" value="12" size="4" inputmode="numeric"></label>', async (f) => {
    const r = await api('GET', '/assets/reports/forecast?' + E.qs(f));
    if (!r.rows.length) return '<div class="msg warn">لا أصول فعّالة</div>';
    return '<table><thead><tr><th>الأصل</th>' + r.cols.map((c) => '<th class="n">' + c + '</th>').join('') + '<th class="n">المجموع</th><th class="n">المتبقي للإهلاك</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.code + ' — ' + x.name) + '</td>' + r.cols.map((c) => '<td class="n">' + (x.months[c] ? money(x.months[c]) : '') + '</td>').join('') + '<td class="n">' + money(x.total) + '</td><td class="n">' + money(x.remaining) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>الإجمالي</td>' + r.cols.map((c) => '<td class="n">' + money(r.colTotals[c]) + '</td>').join('') + '<td class="n">' + money(r.totals.total) + '</td><td class="n">' + money(r.totals.remaining) + '</td></tr></tfoot></table><p class="muted">يبدأ العرض من أول شهر لم يُهلك بعد. أشهر سابقة لم تُشغَّل تظهر ضمن أول أعمدة.</p>';
  });

  E.pages['asset-disposals'] = (el) => shell(el, 'الأصول المستبعدة (بيع / استبعاد)', 'التكلفة ومجمع الإهلاك والقيمة الدفترية والمتحصلات والربح أو الخسارة لكل أصل', dateF('from', 'من', E.yearStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/assets/reports/disposals?' + E.qs(f)), t = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا استبعادات في هذه الفترة</div>';
    return '<table><thead><tr><th>التاريخ</th><th>الأصل</th><th>الفئة</th><th class="n">التكلفة</th><th class="n">المجمع</th><th class="n">الدفترية</th><th class="n">المتحصلات</th><th class="n">ربح / (خسارة)</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.date) + '</td><td>' + esc(x.code + ' — ' + x.name) + '</td><td>' + esc(x.cat) + '</td><td class="n">' + money(x.cost) + '</td><td class="n">' + money(x.accumulated) + '</td><td class="n">' + money(x.bookValue) + '</td><td class="n">' + money(x.proceeds) + '</td><td class="n ' + (x.gain < 0 ? 'bad' : 'good') + '">' + money(x.gain) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="3">الإجمالي</td><td class="n">' + money(t.cost) + '</td><td class="n">' + money(t.accumulated) + '</td><td class="n">' + money(t.bookValue) + '</td><td class="n">' + money(t.proceeds) + '</td><td class="n">' + money(t.gain) + '</td></tr></tfoot></table>';
  });

  E.pages['asset-life'] = (el) => shell(el, 'العمر المتبقي للأصول', 'أصول فعّالة مهلكة بالكامل أو يتبقى من عمرها المحدد عدد الأشهر المطلوب أو أقل', '<label>يتبقى ≤ (شهر)<input name="within" value="12" size="4" inputmode="numeric"></label>', async (f) => {
    const r = await api('GET', '/assets/reports/life?' + E.qs(f));
    if (!r.rows.length) return '<div class="msg good">لا أصول قاربت نهاية عمرها خلال ' + r.within + ' شهراً</div>';
    return '<table><thead><tr><th>الأصل</th><th>الفئة</th><th class="n">التكلفة</th><th class="n">العمر (شهر)</th><th class="n">المُهلَك</th><th class="n">المتبقي (شهر)</th><th class="n">الدفترية</th><th>الحالة</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td>' + esc(x.code + ' — ' + x.name) + '</td><td>' + esc(x.cat) + '</td><td class="n">' + money(x.cost) + '</td><td class="n">' + x.life + '</td><td class="n">' + x.done + '</td><td class="n">' + x.remainingMonths + '</td><td class="n">' + money(x.bookValue) + '</td><td>' + (x.full ? '<span class="tag bad">مهلك بالكامل</span>' : '<span class="tag warn">يقترب</span>') + '</td></tr>').join('') + '</tbody></table>';
  });

  // ---------- تقارير محاسبية إضافية ----------
  const yr = () => dateF('from', 'من', E.yearStart()) + dateF('to', 'إلى', E.today());

  E.pages['acc-monthly-pl'] = (el) => shell(el, 'الأرباح والخسائر الشهرية', 'كل حساب إيراد ومصروف بأعمدة الأشهر وصافي كل شهر (يستثني قيود إقفال السنة، حتى 24 شهراً)', yr(), async (f) => {
    const r = await api('GET', '/reports/monthly-pl?' + E.qs(f)), T = r.totals;
    if (!r.rows.length) return '<div class="msg warn">لا حركة إيرادات أو مصروفات في هذه الفترة</div>';
    const head = '<thead><tr><th>الرمز</th><th>الحساب</th>' + r.months.map((m) => '<th class="n">' + m + '</th>').join('') + '<th class="n">الإجمالي</th></tr></thead>';
    const body = (type) => '<tbody>' + r.rows.filter((x) => x.type === type).map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td>' + r.months.map((m) => '<td class="n">' + (x.months[m] ? money(x.months[m]) : '') + '</td>').join('') + '<td class="n">' + money(x.total) + '</td></tr>').join('') + '</tbody>';
    const foot = (label, by, total) => '<tfoot><tr><td colspan="2">' + label + '</td>' + r.months.map((m) => '<td class="n">' + money(by[m]) + '</td>').join('') + '<td class="n">' + money(total) + '</td></tr></tfoot>';
    return '<div class="cards">' + stat('الإيرادات', money(T.revenue)) + stat('المصروفات', money(T.expense)) + stat('صافي ' + (T.net >= 0 ? 'الربح' : 'الخسارة'), money(T.net)) + '</div>' +
      '<h3>الإيرادات</h3><table>' + head + body('REVENUE') + foot('إجمالي الإيرادات', r.revenue, T.revenue) + '</table>' +
      '<h3>المصروفات</h3><table>' + head + body('EXPENSE') + foot('إجمالي المصروفات', r.expense, T.expense) + '</table>' +
      '<table><tfoot><tr><td>صافي الربح / (الخسارة)</td>' + r.months.map((m) => '<td class="n ' + (r.net[m] < 0 ? 'bad' : 'good') + '">' + money(r.net[m]) + '</td>').join('') + '<td class="n">' + money(T.net) + '</td></tr></tfoot></table>';
  });

  E.pages['acc-activity'] = (el) => shell(el, 'حركة الحسابات الشهرية', 'لكل حساب: الرصيد الافتتاحي (مدين +، دائن −) وصافي حركة كل شهر والرصيد الختامي (حتى 12 شهراً)',
    yr() + '<label>النوع<select name="type"><option value="">كل الحسابات</option><option value="ASSET">أصول</option><option value="LIABILITY">خصوم</option><option value="EQUITY">حقوق ملكية</option><option value="REVENUE">إيرادات</option><option value="EXPENSE">مصروفات</option></select></label>', async (f) => {
    const r = await api('GET', '/reports/account-activity?' + E.qs(f));
    if (!r.rows.length) return '<div class="msg warn">لا حركة في هذه الفترة</div>';
    return '<table><thead><tr><th>الرمز</th><th>الحساب</th><th class="n">افتتاحي</th>' + r.months.map((m) => '<th class="n">' + m + '</th>').join('') + '<th class="n">ختامي</th></tr></thead><tbody>' +
      r.rows.map((x) => '<tr><td><a href="#/reports/ledger/' + esc(x.code) + '">' + esc(x.code) + '</a></td><td>' + esc(x.name) + '</td><td class="n">' + money(x.open) + '</td>' + r.months.map((m) => '<td class="n">' + (x.months[m] ? money(x.months[m]) : '') + '</td>').join('') + '<td class="n">' + money(x.close) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td colspan="2">الإجمالي</td><td class="n">' + money(r.totals.open) + '</td>' + r.months.map((m) => '<td class="n">' + money(r.colTotals[m]) + '</td>').join('') + '<td class="n">' + money(r.totals.close) + '</td></tr></tfoot></table><p class="muted">الإجمالي يساوي صفراً حين تتوازن كل الحسابات (عند اختيار «كل الحسابات»).</p>';
  });

  E.pages['acc-cash-book'] = (el) => shell(el, 'دفتر النقدية والبنوك', 'لكل حساب نقدي أو بنكي: رصيد أول الفترة والمقبوضات والمدفوعات ثم الرصيد، مع تفصيل يومي', dateF('from', 'من', E.monthStart()) + dateF('to', 'إلى', E.today()), async (f) => {
    const r = await api('GET', '/reports/cash-book?' + E.qs(f)), T = r.totals;
    if (!r.accounts.length) return '<div class="msg warn">لا حسابات نقدية معرَّفة</div>';
    return '<div class="cards">' + stat('رصيد أول الفترة', money(T.opening)) + stat('المقبوضات', money(T.debit)) + stat('المدفوعات', money(T.credit)) + stat('رصيد آخر الفترة', money(T.closing)) + '</div>' +
      r.accounts.map((a) => '<h3>' + esc(a.code) + ' — ' + esc(a.name) + '</h3><table><thead><tr><th>التاريخ</th><th class="n">مقبوضات</th><th class="n">مدفوعات</th><th class="n">الرصيد</th></tr></thead><tbody>' +
        '<tr class="head"><td>رصيد أول الفترة</td><td></td><td></td><td class="n">' + money(a.opening) + '</td></tr>' +
        a.days.map((d) => '<tr><td>' + esc(d.date) + '</td><td class="n">' + (d.debit ? money(d.debit) : '') + '</td><td class="n">' + (d.credit ? money(d.credit) : '') + '</td><td class="n">' + money(d.balance) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td>الإجمالي</td><td class="n">' + money(a.debit) + '</td><td class="n">' + money(a.credit) + '</td><td class="n">' + money(a.closing) + '</td></tr></tfoot></table>').join('');
  });

  E.pages['acc-ratios'] = (el) => shell(el, 'النسب المالية', 'هوامش الربح وفترات التحصيل والتخزين والسداد والسيولة السريعة اعتماداً على حسابات النظام (العملاء 1300، المخزون 1400، الموردون 2100، تكلفة المبيعات 5100)', yr(), async (f) => {
    const r = await api('GET', '/reports/ratios?' + E.qs(f)), b = r.base, x = r.ratios, na = (v, suf) => (v == null ? '<span class="muted">—</span>' : v.toLocaleString('en-US', { maximumFractionDigits: 2 }) + (suf || ''));
    const row = (k, v, hint) => '<tr><td>' + k + '</td><td class="n">' + v + '</td><td class="muted">' + hint + '</td></tr>';
    return '<h3>الأساس (الفترة ' + r.days + ' يوماً)</h3><table><tbody>' + row('الإيرادات', money(b.revenue), '') + row('تكلفة البضاعة المباعة (5100)', money(b.cogs), '') + row('مجمل الربح', money(b.grossProfit), '') + row('المصروفات', money(b.expense), '') + row('صافي الربح', money(b.net), '') +
      row('رصيد العملاء (1300) في نهاية الفترة', money(b.ar), '') + row('المخزون (1400)', money(b.inventory), '') + row('الموردون (2100)', money(b.ap), '') + row('النقدية والبنوك', money(b.cash), '') + row('إجمالي الخصوم', money(b.liabilities), '') + '</tbody></table>' +
      '<h3>النسب</h3><table><thead><tr><th>النسبة</th><th class="n">القيمة</th><th>طريقة الحساب</th></tr></thead><tbody>' +
      row('هامش مجمل الربح', na(x.grossMargin, '%'), '(الإيرادات − التكلفة) ÷ الإيرادات') + row('هامش صافي الربح', na(x.netMargin, '%'), 'صافي الربح ÷ الإيرادات') + row('نسبة المصروفات', na(x.expenseRatio, '%'), 'المصروفات ÷ الإيرادات') +
      row('فترة التحصيل (يوم)', na(x.dso), 'رصيد العملاء ÷ الإيرادات × أيام الفترة') + row('فترة التخزين (يوم)', na(x.dio), 'المخزون ÷ تكلفة المبيعات × أيام الفترة') + row('فترة السداد (يوم)', na(x.dpo), 'الموردون ÷ تكلفة المبيعات × أيام الفترة') +
      row('السيولة السريعة', na(x.quick), '(النقد + العملاء) ÷ إجمالي الخصوم') + '</tbody></table><p class="muted">«—» تعني أن المقام صفر. النسب تقريبية لأن النظام لا يصنّف الأصول المتداولة وغير المتداولة.</p>';
  });

  E.pages['acc-journal-audit'] = (el) => shell(el, 'تدقيق القيود', 'القيود المعكوسة وقيود الإقفال وعدد القيود بلا مرجع (غالباً يدوية) لكل شهر', yr(), async (f) => {
    const r = await api('GET', '/reports/journal-audit?' + E.qs(f)), T = r.totals;
    return '<div class="cards">' + stat('عدد القيود', T.entries) + stat('بلا مرجع (يدوية غالباً)', T.noRef) + stat('قيود معكوسة', T.reversals) + stat('قيود إقفال', T.closing) + '</div>' +
      '<h3>القيود حسب الشهر</h3>' + (r.monthly.length ? '<table><thead><tr><th>الشهر</th><th class="n">القيود</th><th class="n">بلا مرجع</th><th class="n">قيود عكسية</th></tr></thead><tbody>' + r.monthly.map((x) => '<tr><td>' + x.month + '</td><td class="n">' + x.entries + '</td><td class="n">' + x.noRef + '</td><td class="n">' + x.reversals + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">لا قيود</p>') +
      '<h3>القيود المعكوسة</h3>' + (r.reversals.length ? '<table><thead><tr><th>القيد</th><th>التاريخ</th><th>البيان</th><th class="n">المبلغ</th><th>القيد العكسي</th><th>تاريخ العكس</th></tr></thead><tbody>' +
        r.reversals.map((x) => '<tr><td><a href="#/entry/view/' + x.id + '">' + x.id + '</a></td><td>' + esc(x.date) + '</td><td>' + esc(x.memo || '') + '</td><td class="n">' + money(x.amount) + '</td><td><a href="#/entry/view/' + x.reversalId + '">' + x.reversalId + '</a></td><td>' + esc(x.reversalDate) + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">لا قيود معكوسة</p>') +
      '<h3>قيود الإقفال</h3>' + (r.closing.length ? '<table><thead><tr><th>القيد</th><th>التاريخ</th><th>البيان</th><th class="n">المبلغ</th></tr></thead><tbody>' + r.closing.map((x) => '<tr><td><a href="#/entry/view/' + x.id + '">' + x.id + '</a></td><td>' + esc(x.date) + '</td><td>' + esc(x.memo || '') + '</td><td class="n">' + money(x.amount) + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">لا قيود إقفال</p>');
  });
})(window.ERP);
