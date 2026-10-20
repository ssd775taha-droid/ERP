'use strict';
(function (E) {
  const app = E.$('#app');
  let me = null;

  // الأقسام: كل قسم قابل للطي وفيه مجموعات فرعية. عنصر = [المسار، العنوان، الوحدة المطلوبة (قراءة) أو 'admin']؛ يُخفى العنصر بلا صلاحية، وتُخفى المجموعة والقسم إن فرغا
  const SECTIONS = [
    { id: 'acc', title: 'المحاسبة', groups: [
      { t: 'الدفاتر', items: [['accounts', 'دليل الحسابات', 'accounting'], ['entry/new', 'قيد يومية جديد', 'accounting'], ['entries', 'دفتر اليومية', 'accounting']] },
      { t: 'التقارير المالية', items: [['reports/trial-balance', 'ميزان المراجعة', 'reports'], ['reports/ledger', 'كشف حساب', 'reports'], ['reports/income-statement', 'قائمة الدخل', 'reports'], ['reports/comparative', 'قائمة الدخل المقارنة', 'reports'], ['reports/balance-sheet', 'الميزانية', 'reports'], ['reports/cash-flow', 'التدفقات النقدية', 'reports']] },
      { t: 'الإقفال', items: [['periods', 'الفترات والإقفال', 'periods']] } ] },
    { id: 'trade', title: 'المبيعات والمشتريات', groups: [
      { t: 'المبيعات', items: [['customers', 'العملاء', 'trade'], ['sales', 'فواتير المبيعات', 'trade'], ['quotes', 'عروض الأسعار', 'orders'], ['quote/new', 'عرض سعر جديد', 'orders']] },
      { t: 'المشتريات', items: [['suppliers', 'الموردون', 'trade'], ['purchases', 'فواتير المشتريات', 'trade'], ['po', 'أوامر الشراء', 'orders'], ['po/new', 'أمر شراء جديد', 'orders']] },
      { t: 'السندات والإشعارات', items: [['payments', 'سندات القبض والصرف', 'trade'], ['notes', 'إشعارات الدائن والمدين', 'trade']] },
      { t: 'التقارير', items: [['reports/sales-analysis', 'تحليل المبيعات والمشتريات', 'reports'], ['reports/item-profit', 'ربحية الأصناف', 'reports'], ['reports/aging', 'أعمار الديون', 'reports'], ['reports/vat', 'إقرار الضريبة', 'reports']] } ] },
    { id: 'inv', title: 'المخزون', groups: [
      { t: 'البيانات والعمليات', items: [['inventory/items', 'الأصناف', 'inventory'], ['inventory/warehouses', 'المخازن', 'inventory'], ['inventory/adjust', 'تسوية وتحويل', 'inventory']] },
      { t: 'الأرصدة والحركات', items: [['inventory/stock', 'أرصدة المخزون', 'inventory'], ['inventory/moves', 'حركات المخزون', 'inventory']] },
      { t: 'التقارير', items: [['inventory/valuation', 'تقييم المخزون', 'inventory'], ['inventory/card', 'كارت الصنف', 'inventory'], ['inventory/movement', 'ملخص حركة المخزون', 'inventory'], ['inventory/slow', 'ركود المخزون', 'inventory'], ['inventory/shortage', 'نواقص وتغطية', 'inventory']] } ] },
    { id: 'pos', title: 'نقاط البيع', groups: [
      { t: 'العمل اليومي', items: [['pos/sell', 'شاشة البيع', 'pos'], ['pos/sales', 'العمليات', 'pos'], ['pos/shifts', 'الورديات', 'pos'], ['pos/registers', 'النقاط', 'pos']] },
      { t: 'التقارير', items: [['pos/rep-daily', 'المبيعات اليومية', 'pos'], ['pos/rep-items', 'مبيعات الأصناف', 'pos'], ['pos/rep-cashiers', 'حسب الكاشير والنقطة', 'pos'], ['pos/rep-hourly', 'المبيعات بالساعة', 'pos'], ['pos/rep-shifts', 'فروقات الورديات', 'pos'], ['pos/rep-returns', 'المرتجعات', 'pos']] } ] },
    { id: 'assets', title: 'الأصول الثابتة', groups: [
      { t: '', items: [['assets', 'سجل الأصول', 'assets'], ['assets/new', 'أصل جديد', 'assets'], ['assets/depreciation', 'الإهلاك الشهري', 'assets']] } ] },
    { id: 'hr', title: 'الموارد البشرية والرواتب', groups: [
      { t: 'الموظفون', items: [['hr/employees', 'الموظفون', 'hr'], ['hr/components', 'مكوّنات الراتب', 'hr'], ['hr/adjustments', 'التسويات', 'hr'], ['hr/advances', 'السلف', 'hr']] },
      { t: 'الرواتب', items: [['payroll', 'كشوف الرواتب', 'payroll']] },
      { t: 'تقارير الموارد البشرية', items: [['hr/headcount', 'القوى العاملة حسب القسم', 'hr'], ['hr/tenure', 'مدة الخدمة', 'hr'], ['hr/movements', 'حركة الموظفين', 'hr'], ['hr/salary-changes', 'تغيّرات الرواتب', 'hr'], ['hr/advances-report', 'أرصدة السلف', 'hr'], ['hr/data-gaps', 'نواقص بيانات الموظفين', 'hr']] },
      { t: 'تقارير الرواتب', items: [['payroll/dept', 'الرواتب حسب القسم', 'payroll'], ['payroll/employee-sheet', 'رواتب الموظفين بالأشهر', 'payroll'], ['payroll/components', 'الرواتب حسب المكوّن', 'payroll'], ['payroll/trend', 'اتجاه تكلفة الرواتب', 'payroll']] } ] },
    { id: 'set', title: 'الإعدادات والإدارة', groups: [
      { t: 'المنشأة', items: [['tax/settings', 'المنشأة والضريبة السعودية', 'settings'], ['settings', 'ضوابط الاعتماد والخصم', 'settings']] },
      { t: 'النظام', items: [['settings/users', 'المستخدمون', 'admin'], ['settings/roles', 'الأدوار والصلاحيات', 'admin'], ['settings/audit', 'سجل العمليات', 'admin'], ['settings/backup', 'النسخ الاحتياطي', 'admin'], ['settings/password', 'كلمة سري']] } ] },
  ];
  // الوحدة والمستوى اللازمان لكل صفحة (مفتاح المسار). صفحات الإنشاء/التنفيذ تتطلب كتابة. ما لا يُذكر هنا مفتوح لكل مستخدم مسجَّل
  const R = 'r', W = 'w';
  const PAGE = {
    accounts: ['accounting', R], 'entry/view': ['accounting', R], 'payment/view': ['trade', R], 'entry/new': ['accounting', W], entries: ['accounting', R],
    customers: ['trade', R], sales: ['trade', R], suppliers: ['trade', R], purchases: ['trade', R], payments: ['trade', R], notes: ['trade', R],
    'invoice/new': ['trade', W], 'invoice/view': ['trade', R], 'party/statement': ['trade', R], 'payment/new': ['trade', W], 'note/new': ['trade', W], 'note/view': ['trade', R],
    'inventory/valuation': ['inventory', R], 'inventory/card': ['inventory', R], 'inventory/movement': ['inventory', R], 'inventory/slow': ['inventory', R], 'inventory/shortage': ['inventory', R], 'inventory/items': ['inventory', R], 'inventory/warehouses': ['inventory', R], 'inventory/stock': ['inventory', R], 'inventory/moves': ['inventory', R], 'inventory/adjust': ['inventory', W],
    assets: ['assets', R], 'assets/new': ['assets', W], 'assets/view': ['assets', R], 'assets/depreciation': ['assets', W],
    'hr/employees': ['hr', R], 'employee/view': ['hr', R], 'hr/components': ['hr', R], 'hr/adjustments': ['hr', R], 'hr/advances': ['hr', R], 'hr/headcount': ['hr', R], 'hr/tenure': ['hr', R], 'hr/movements': ['hr', R], 'hr/salary-changes': ['hr', R], 'hr/advances-report': ['hr', R], 'hr/data-gaps': ['hr', R], payroll: ['payroll', R], 'payroll/view': ['payroll', R], 'payroll/dept': ['payroll', R], 'payroll/employee-sheet': ['payroll', R], 'payroll/components': ['payroll', R], 'payroll/trend': ['payroll', R],
    'pos/sell': ['pos', W], 'pos/sales': ['pos', R], 'pos/sale': ['pos', R], 'pos/shifts': ['pos', R], 'pos/shift': ['pos', R], 'pos/registers': ['pos', R], 'pos/rep-daily': ['pos', R], 'pos/rep-items': ['pos', R], 'pos/rep-cashiers': ['pos', R], 'pos/rep-hourly': ['pos', R], 'pos/rep-shifts': ['pos', R], 'pos/rep-returns': ['pos', R],
    po: ['orders', R], 'po/new': ['orders', W], 'po/view': ['orders', R], 'po/edit': ['orders', W], quotes: ['orders', R], 'quote/new': ['orders', W], 'quote/view': ['orders', R], 'quote/edit': ['orders', W],
    'reports/trial-balance': ['reports', R], 'reports/ledger': ['reports', R], 'reports/income-statement': ['reports', R], 'reports/aging': ['reports', R], 'reports/vat': ['reports', R],
    'reports/balance-sheet': ['reports', R], 'reports/cash-flow': ['reports', R], 'reports/sales-analysis': ['reports', R], 'reports/item-profit': ['reports', R], 'reports/comparative': ['reports', R], periods: ['periods', R],
    settings: ['settings', R], 'tax/settings': ['settings', R],
    'settings/users': ['admin'], 'settings/roles': ['admin'], 'settings/audit': ['admin'], 'settings/backup': ['admin'],
  };
  const MODULE_LABEL = { accounting: 'المحاسبة', periods: 'إقفال الفترات', reports: 'التقارير', trade: 'المبيعات والمشتريات', inventory: 'المخزون', assets: 'الأصول الثابتة',
    hr: 'الموارد البشرية', payroll: 'الرواتب', pos: 'نقاط البيع', orders: 'الطلبات والعروض', settings: 'الإعدادات', admin: 'إدارة النظام' };
  const permits = (key, level) => { const p = PAGE[key]; if (!p) return true; return p[0] === 'admin' ? !!E.me.isAdmin : E.can(p[0], level || p[1]); };
  const allowed = (n) => !n[2] || permits(n[0]);
  const ROUTES = {
    '': 'dashboard', search: 'search', 'entry/view': 'entryView', 'payment/view': 'paymentView', accounts: 'accounts', 'entry/new': 'entryNew', entries: 'entries', periods: 'periods',
    'reports/trial-balance': 'trial-balance', 'reports/ledger': 'ledger', 'reports/income-statement': 'income-statement',
    'inventory/valuation': 'inv-valuation', 'inventory/card': 'inv-card', 'inventory/movement': 'inv-movement', 'inventory/slow': 'inv-slow', 'inventory/shortage': 'inv-shortage', 'inventory/items': 'invItems', 'inventory/warehouses': 'invWarehouses', 'inventory/stock': 'invStock', 'inventory/moves': 'invMoves', 'inventory/adjust': 'invAdjust',
    assets: 'assets', 'assets/new': 'assetNew', 'assets/view': 'assetView', 'assets/depreciation': 'depreciation',
    'hr/employees': 'hrEmployees', 'employee/view': 'hrEmployee', 'hr/components': 'hrComponents', 'hr/adjustments': 'hrAdjustments', 'hr/advances': 'hrAdvances', 'hr/headcount': 'hr-headcount', 'hr/tenure': 'hr-tenure', 'hr/movements': 'hr-movements', 'hr/salary-changes': 'hr-salary-changes', 'hr/advances-report': 'hr-advances-report', 'hr/data-gaps': 'hr-data-gaps',
    payroll: 'payroll', 'payroll/view': 'payrollView', 'payroll/dept': 'pay-dept', 'payroll/employee-sheet': 'pay-employee', 'payroll/components': 'pay-components', 'payroll/trend': 'pay-trend',
    'pos/sell': 'posSell', 'pos/sales': 'posSales', 'pos/sale': 'posSale', 'pos/shifts': 'posShifts', 'pos/shift': 'posShift', 'pos/registers': 'posRegisters', 'pos/rep-daily': 'pos-daily', 'pos/rep-items': 'pos-items', 'pos/rep-cashiers': 'pos-cashiers', 'pos/rep-hourly': 'pos-hourly', 'pos/rep-shifts': 'pos-shifts', 'pos/rep-returns': 'pos-returns',
    'po/edit': 'poEdit', 'quote/edit': 'quoteEdit', po: 'poList', 'po/new': 'poNew', 'po/view': 'poView', quotes: 'quoteList', 'quote/new': 'quoteNew', 'quote/view': 'quoteView', settings: 'settings',
    'tax/settings': 'taxSettings', 'reports/vat': 'vat-return',
    'settings/home': 'settingsHome', 'settings/users': 'adminUsers', 'settings/roles': 'adminRoles', 'settings/audit': 'adminAudit', 'settings/backup': 'adminBackup', 'settings/password': 'myPassword',
    notes: 'notes', 'note/new': 'noteNew', 'note/view': 'noteView',
    customers: 'customers', suppliers: 'suppliers', sales: 'sales', purchases: 'purchases', payments: 'payments',
    'invoice/new': 'invoiceNew', 'invoice/view': 'invoiceView', 'party/statement': 'partyStatement', 'payment/new': 'paymentNew', 'reports/aging': 'aging',
    'reports/balance-sheet': 'balance-sheet', 'reports/cash-flow': 'cash-flow', 'reports/sales-analysis': 'sales-analysis', 'reports/item-profit': 'item-profit', 'reports/comparative': 'comparative',
  };

  function loginView(msg) {
    me = null;
    app.innerHTML = '<div class="login card"><h1>نظام ERP</h1><p class="sub">تسجيل الدخول</p>' + (msg ? E.err(msg) : '') +
      '<form id="lf"><input name="username" placeholder="اسم المستخدم" autocomplete="username" required autofocus>' +
      '<input name="password" type="password" placeholder="كلمة المرور" autocomplete="current-password" required><button class="btn" style="width:100%">دخول</button></form></div>';
    E.$('#lf').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try { await E.api('POST', '/login', { username: f.get('username'), password: f.get('password') }); await enter(); }
      catch (e) { loginView(e.message); }
    });
  }

  // بعد الدخول: اقرأ الملف الشخصي والصلاحيات وإعدادات الضريبة ثم ارسم الواجهة
  async function enter() {
    const p = await E.api('GET', '/me');
    if (!p.user) { loginView(); return; }
    E.me = p; me = p.user;
    await E.loadTax();
    layout(); route();
  }

  const NAV_PARENT = { 'invoice/view': 'sales', 'invoice/new': 'sales', 'party/statement': 'customers', 'payment/view': 'payments', 'payment/new': 'payments', 'note/view': 'notes', 'note/new': 'notes', 'entry/view': 'entries',
    'po/view': 'po', 'po/edit': 'po', 'quote/view': 'quotes', 'quote/edit': 'quotes', 'assets/view': 'assets', 'employee/view': 'hr/employees', 'payroll/view': 'payroll', 'pos/sale': 'pos/sales', 'pos/shift': 'pos/shifts' };
  // حالة طيّ الأقسام تُحفظ في المتصفح؛ القسم الذي فيه الصفحة الحالية يُفتح دائماً
  const openSet = () => { try { return new Set(JSON.parse(localStorage.getItem('erp_nav_open') || '[]')); } catch (e) { return new Set(); } };
  const saveOpen = (set) => { try { localStorage.setItem('erp_nav_open', JSON.stringify([...set])); } catch (e) { /* التخزين غير متاح */ } };
  function revealActive(key) {
    const a = E.$('nav.side a.on'); const d = a && a.closest('details.sec');
    if (d && !d.open) d.open = true;
  }

  function layout() {
    const open = openSet();
    const link = (n) => '<a href="#/' + n[0] + '" data-r="' + n[0] + '">' + E.esc(n[1]) + '</a>';
    const html = '<a href="#/" data-r="">الرئيسية</a><a href="#/search" data-r="search">الاستعلام</a>' + SECTIONS.map((sec) => {
      const groups = sec.groups.map((g) => ({ t: g.t, items: g.items.filter((n) => allowed(n)) })).filter((g) => g.items.length);
      if (!groups.length) return '';
      const count = groups.reduce((s, g) => s + g.items.length, 0);
      return '<details class="sec" data-s="' + sec.id + '"' + (open.has(sec.id) ? ' open' : '') + '><summary>' + E.esc(sec.title) + ' <span class="cnt">' + count + '</span></summary>' +
        groups.map((g) => (g.t ? '<div class="grp">' + E.esc(g.t) + '</div>' : '') + g.items.map(link).join('')).join('') + '</details>';
    }).join('');
    app.innerHTML = '<div class="layout"><nav class="side"><div class="brand">نظام ERP</div><a href="#/settings/home" data-r="settings/home" style="background:rgba(255,255,255,.1)">⚙ الإعدادات والمستخدمون والصلاحيات</a>' + html +
      '<div class="who">' + E.esc(E.me.fullName || me) + '<br><span style="opacity:.7">' + E.esc(E.me.roleName || '') + '</span> · <button class="link" id="lo">خروج</button><div style="opacity:.55;font-size:11px;margin-top:6px" id="ver"></div></div></nav><div class="print-only" id="phead"></div><main id="main"></main><div class="print-only" id="pfoot"></div><button class="fab noprint" id="pbtn" title="طباعة هذه الشاشة" aria-label="طباعة">🖨 طباعة</button></div>';
    E.$('nav.side').addEventListener('toggle', (ev) => {
      const d = ev.target; if (!d || !d.matches || !d.matches('details.sec')) return;
      const set = openSet(); if (d.open) set.add(d.dataset.s); else set.delete(d.dataset.s); saveOpen(set);
    }, true);
    E.api('GET', '/version').then((v) => { const el = E.$('#ver'); if (el) el.textContent = 'الإصدار ' + v.version; }).catch(() => {});
    E.$('#pbtn').addEventListener('click', () => { const m = E.$('#main'); if (m && m._openDoc) m._openDoc(); else E.reportDoc(m); });
    E.$('#lo').addEventListener('click', async () => { try { await E.api('POST', '/logout'); } catch (e) { /* نتجاهل */ } loginView(); });
  }

  async function route() {
    if (!me) return;
    const full = location.hash.replace(/^#\/?/, '');
    const qi = full.indexOf('?');
    const h = qi < 0 ? full : full.slice(0, qi);
    const wantPrint = qi >= 0 && /(^|&)print=1(&|$)/.test(full.slice(qi + 1));      // «…?print=1» يفتح العملية ويطبعها مباشرة
    const parts = h.split('/');
    let key = h, param = null;
    if (!(key in ROUTES) && parts.length >= 2) { key = parts.slice(0, 2).join('/'); param = parts[2]; }
    const name = ROUTES[key];
    // صفحات العرض والإنشاء تُضيء بند قائمتها الأم في الشريط الجانبي
    const act = NAV_PARENT[key] || key;
    E.$$('nav.side a').forEach((a) => a.classList.toggle('on', a.dataset.r === act));
    revealActive(act);
    const old = E.$('#main');
    const main = document.createElement('main'); // عنصر جديد لكل صفحة حتى لا تتراكم المستمعات
    main.id = 'main';
    old.replaceWith(main);
    E.autoExport(main);
    E.autoSearch(main);
    // زر «طباعة» في صفحات التقارير والقوائم يفتح معاينة الورقة الموحّدة؛ صفحات المستندات تفتح معاينتها الخاصة عبر _openDoc
    main.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act=print]');
      if (b && !main._openDoc && E.$('h1', main) && E.$('table', main)) { ev.stopPropagation(); ev.preventDefault(); E.reportDoc(main); }
    }, true);
    if (!name || !E.pages[name]) { main.innerHTML = E.err('الصفحة غير موجودة'); return; }
    // لا صلاحية: صفحة واضحة دون استدعاء أي واجهة برمجية
    if (!permits(key)) {
      const p = PAGE[key];
      main.innerHTML = E.head('لا صلاحية', 'هذه الصفحة غير متاحة لدورك (' + (E.me.roleName || '') + ')') +
        '<div class="msg warn">تحتاج صلاحية ' + (p[0] === 'admin' ? 'مدير النظام' : (p[1] === 'w' ? 'الكتابة' : 'القراءة') + ' على «' + (MODULE_LABEL[p[0]] || p[0]) + '»') + '. اطلب من مدير النظام تعديل دورك.</div><p><a href="#/">الرئيسية</a></p>';
      return;
    }
    // صلاحية قراءة فقط على وحدة الصفحة: تُخفى أدوات الإضافة والتعديل والإلغاء
    const pm = PAGE[key];
    if (pm && pm[0] !== 'admin' && !E.can(pm[0], 'w')) E.readOnly(main, MODULE_LABEL[pm[0]] || pm[0]);
    try { await E.pages[name](main, param); } catch (e) { main.innerHTML = E.err(e.message); return; }
    if (wantPrint) setTimeout(() => { if (E.$('#main') !== main) return; history.replaceState(null, '', '#/' + h); (main._openDoc || (() => E.reportDoc(main)))(); }, 500);
  }

  E.onUnauth = () => loginView('انتهت الجلسة، سجّل الدخول من جديد');
  window.addEventListener('hashchange', route);
  (async function init() {
    try { await enter(); } catch (e) { loginView(); }
  })();
})(window.ERP);
