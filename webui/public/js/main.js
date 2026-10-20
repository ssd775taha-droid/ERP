'use strict';
(function (E) {
  const app = E.$('#app');
  let me = null;

  // الأقسام: كل قسم قابل للطي وفيه مجموعات فرعية. عنصر = [المسار، العنوان، الوحدة المطلوبة (قراءة) أو 'admin']؛ يُخفى العنصر بلا صلاحية، وتُخفى المجموعة والقسم إن فرغا
  const SECTIONS = [
    { id: 'acc', title: 'المحاسبة', groups: [
      { t: 'الدفاتر', items: [['accounts', 'دليل الحسابات', 'accounting'], ['entry/new', 'قيد يومية جديد', 'accounting'], ['entries', 'دفتر اليومية', 'accounting']] },
      { t: 'التقارير المالية', items: [['reports/trial-balance', 'ميزان المراجعة', 'reports'], ['reports/ledger', 'كشف حساب', 'reports'], ['reports/income-statement', 'قائمة الدخل', 'reports'], ['reports/comparative', 'قائمة الدخل المقارنة', 'reports'], ['reports/balance-sheet', 'الميزانية', 'reports'], ['reports/cash-flow', 'التدفقات النقدية', 'reports'], ['reports/monthly-pl', 'الأرباح والخسائر الشهرية', 'reports'], ['reports/activity', 'حركة الحسابات الشهرية', 'reports'], ['reports/cash-book', 'دفتر النقدية والبنوك', 'reports'], ['reports/ratios', 'النسب المالية', 'reports'], ['reports/journal-audit', 'تدقيق القيود', 'reports'], ['reports/general-journal', 'اليومية العامة', 'reports'], ['reports/general-ledger', 'الأستاذ العام', 'reports'], ['reports/tb-compare', 'مقارنة ميزان المراجعة', 'reports'], ['reports/bs-compare', 'مقارنة الميزانية', 'reports'], ['reports/account-groups', 'تجميع الحسابات', 'reports']] },
      { t: 'الإقفال', items: [['periods', 'الفترات والإقفال', 'periods']] } ] },
    { id: 'trade', title: 'المبيعات والمشتريات', groups: [
      { t: 'المبيعات', items: [['customers', 'العملاء', 'trade'], ['sales', 'فواتير المبيعات', 'trade'], ['quotes', 'عروض الأسعار', 'orders'], ['quote/new', 'عرض سعر جديد', 'orders']] },
      { t: 'المشتريات', items: [['suppliers', 'الموردون', 'trade'], ['purchases', 'فواتير المشتريات', 'trade'], ['po', 'أوامر الشراء', 'orders'], ['po/new', 'أمر شراء جديد', 'orders']] },
      { t: 'السندات والإشعارات', items: [['payments', 'سندات القبض والصرف', 'trade'], ['notes', 'إشعارات الدائن والمدين', 'trade']] },
      { t: 'التقارير', items: [['reports/sales-analysis', 'تحليل المبيعات والمشتريات', 'reports'], ['reports/item-profit', 'ربحية الأصناف', 'reports'], ['reports/aging', 'أعمار الديون', 'reports'], ['reports/open-invoices', 'الفواتير المستحقة والمتأخرة', 'reports'], ['reports/party-balances', 'أرصدة العملاء والموردين', 'reports'], ['reports/payments-summary', 'المقبوضات والمدفوعات', 'reports'], ['reports/sales-comparison', 'مقارنة مبيعات فترتين', 'reports'], ['reports/notes-summary', 'ملخص الإشعارات', 'reports'], ['reports/vat', 'إقرار الضريبة', 'reports']] } ] },
    { id: 'inv', title: 'المخزون', groups: [
      { t: 'البيانات والعمليات', items: [['inventory/items', 'الأصناف', 'inventory'], ['inventory/warehouses', 'المخازن', 'inventory'], ['inventory/adjust', 'تسوية وتحويل', 'inventory']] },
      { t: 'الأرصدة والحركات', items: [['inventory/stock', 'أرصدة المخزون', 'inventory'], ['inventory/moves', 'حركات المخزون', 'inventory']] },
      { t: 'التقارير', items: [['inventory/valuation', 'تقييم المخزون', 'inventory'], ['inventory/card', 'كارت الصنف', 'inventory'], ['inventory/movement', 'ملخص حركة المخزون', 'inventory'], ['inventory/slow', 'ركود المخزون', 'inventory'], ['inventory/shortage', 'نواقص وتغطية', 'inventory']] } ] },
    { id: 'pos', title: 'نقاط البيع', groups: [
      { t: 'العمل اليومي', items: [['pos/sell', 'شاشة البيع', 'pos'], ['pos/sales', 'العمليات', 'pos'], ['pos/shifts', 'الورديات', 'pos'], ['pos/registers', 'النقاط', 'pos']] },
      { t: 'التقارير', items: [['pos/rep-daily', 'المبيعات اليومية', 'pos'], ['pos/rep-items', 'مبيعات الأصناف', 'pos'], ['pos/rep-cashiers', 'حسب الكاشير والنقطة', 'pos'], ['pos/rep-hourly', 'المبيعات بالساعة', 'pos'], ['pos/rep-shifts', 'فروقات الورديات', 'pos'], ['pos/rep-returns', 'المرتجعات', 'pos']] } ] },
    { id: 'assets', title: 'الأصول الثابتة', groups: [
      { t: 'الأصول', items: [['assets', 'سجل الأصول', 'assets'], ['assets/new', 'أصل جديد', 'assets'], ['assets/depreciation', 'الإهلاك الشهري', 'assets']] },
      { t: 'التقارير', items: [['assets/rep-register', 'سجل الأصول بالقيم الدفترية', 'assets'], ['assets/rep-rollforward', 'حركة الأصول والإهلاك', 'assets'], ['assets/rep-forecast', 'الإهلاك المتوقع', 'assets'], ['assets/rep-disposals', 'الأصول المستبعدة', 'assets'], ['assets/rep-life', 'العمر المتبقي', 'assets']] } ] },
    { id: 'hr', title: 'الموارد البشرية والرواتب', groups: [
      { t: 'الموظفون', items: [['hr/employees', 'الموظفون', 'hr'], ['hr/components', 'مكوّنات الراتب', 'hr'], ['hr/adjustments', 'التسويات', 'hr'], ['hr/advances', 'السلف', 'hr']] },
      { t: 'الرواتب', items: [['payroll', 'كشوف الرواتب', 'payroll']] },
      { t: 'تقارير الموارد البشرية', items: [['hr/headcount', 'القوى العاملة حسب القسم', 'hr'], ['hr/tenure', 'مدة الخدمة', 'hr'], ['hr/movements', 'حركة الموظفين', 'hr'], ['hr/salary-changes', 'تغيّرات الرواتب', 'hr'], ['hr/advances-report', 'أرصدة السلف', 'hr'], ['hr/data-gaps', 'نواقص بيانات الموظفين', 'hr']] },
      { t: 'تقارير الرواتب', items: [['payroll/dept', 'الرواتب حسب القسم', 'payroll'], ['payroll/employee-sheet', 'رواتب الموظفين بالأشهر', 'payroll'], ['payroll/components', 'الرواتب حسب المكوّن', 'payroll'], ['payroll/trend', 'اتجاه تكلفة الرواتب', 'payroll']] } ] },
    { id: 'set', title: 'الإعدادات والإدارة', groups: [
      { t: 'المنشأة', items: [['tax/settings', 'المنشأة والضريبة السعودية', 'settings'], ['settings', 'ضوابط الاعتماد والخصم', 'settings']] },
      { t: 'النظام', items: [['settings/import', 'استيراد البيانات'], ['settings/users', 'المستخدمون', 'admin'], ['settings/roles', 'الأدوار والصلاحيات', 'admin'], ['settings/access', 'صلاحيات المستخدمين الفعلية', 'admin'], ['settings/audit', 'سجل العمليات', 'admin'], ['settings/backup', 'النسخ الاحتياطي', 'admin'], ['settings/password', 'كلمة سري']] } ] },
  ];
  // الوحدة والمستوى اللازمان لكل صفحة (مفتاح المسار). صفحات الإنشاء/التنفيذ تتطلب كتابة. ما لا يُذكر هنا مفتوح لكل مستخدم مسجَّل
  const R = 'r', W = 'w';
  const PAGE = {
    accounts: ['accounting', R], 'entry/view': ['accounting', R], 'payment/view': ['trade', R], 'entry/new': ['accounting', W], entries: ['accounting', R],
    customers: ['trade', R], sales: ['trade', R], suppliers: ['trade', R], purchases: ['trade', R], payments: ['trade', R], notes: ['trade', R],
    'invoice/new': ['trade', W], 'invoice/view': ['trade', R], 'party/statement': ['trade', R], 'payment/new': ['trade', W], 'note/new': ['trade', W], 'note/view': ['trade', R],
    'inventory/valuation': ['inventory', R], 'inventory/card': ['inventory', R], 'inventory/movement': ['inventory', R], 'inventory/slow': ['inventory', R], 'inventory/shortage': ['inventory', R], 'inventory/items': ['inventory', R], 'inventory/warehouses': ['inventory', R], 'inventory/stock': ['inventory', R], 'inventory/moves': ['inventory', R], 'inventory/adjust': ['inventory', W],
    assets: ['assets', R], 'assets/new': ['assets', W], 'assets/view': ['assets', R], 'assets/depreciation': ['assets', W], 'assets/rep-register': ['assets', R], 'assets/rep-rollforward': ['assets', R], 'assets/rep-forecast': ['assets', R], 'assets/rep-disposals': ['assets', R], 'assets/rep-life': ['assets', R],
    'hr/employees': ['hr', R], 'employee/view': ['hr', R], 'hr/components': ['hr', R], 'hr/adjustments': ['hr', R], 'hr/advances': ['hr', R], 'hr/headcount': ['hr', R], 'hr/tenure': ['hr', R], 'hr/movements': ['hr', R], 'hr/salary-changes': ['hr', R], 'hr/advances-report': ['hr', R], 'hr/data-gaps': ['hr', R], payroll: ['payroll', R], 'payroll/view': ['payroll', R], 'payroll/dept': ['payroll', R], 'payroll/employee-sheet': ['payroll', R], 'payroll/components': ['payroll', R], 'payroll/trend': ['payroll', R],
    'pos/sell': ['pos', W], 'pos/sales': ['pos', R], 'pos/sale': ['pos', R], 'pos/shifts': ['pos', R], 'pos/shift': ['pos', R], 'pos/registers': ['pos', R], 'pos/rep-daily': ['pos', R], 'pos/rep-items': ['pos', R], 'pos/rep-cashiers': ['pos', R], 'pos/rep-hourly': ['pos', R], 'pos/rep-shifts': ['pos', R], 'pos/rep-returns': ['pos', R],
    po: ['orders', R], 'po/new': ['orders', W], 'po/view': ['orders', R], 'po/edit': ['orders', W], quotes: ['orders', R], 'quote/new': ['orders', W], 'quote/view': ['orders', R], 'quote/edit': ['orders', W],
    'reports/trial-balance': ['reports', R], 'reports/ledger': ['reports', R], 'reports/income-statement': ['reports', R], 'reports/aging': ['reports', R], 'reports/vat': ['reports', R],
    'reports/balance-sheet': ['reports', R], 'reports/cash-flow': ['reports', R], 'reports/open-invoices': ['reports', R], 'reports/party-balances': ['reports', R], 'reports/payments-summary': ['reports', R], 'reports/sales-comparison': ['reports', R], 'reports/notes-summary': ['reports', R], 'reports/monthly-pl': ['reports', R], 'reports/activity': ['reports', R], 'reports/cash-book': ['reports', R], 'reports/ratios': ['reports', R], 'reports/journal-audit': ['reports', R], 'reports/general-journal': ['reports', R], 'reports/general-ledger': ['reports', R], 'reports/tb-compare': ['reports', R], 'reports/bs-compare': ['reports', R], 'reports/account-groups': ['reports', R], 'reports/sales-analysis': ['reports', R], 'reports/item-profit': ['reports', R], 'reports/comparative': ['reports', R], periods: ['periods', R],
    settings: ['settings', R], 'tax/settings': ['settings', R],
    'settings/users': ['admin'], 'settings/roles': ['admin'], 'settings/access': ['admin'], 'settings/audit': ['admin'], 'settings/backup': ['admin'],
  };
  const MODULE_LABEL = { accounting: 'المحاسبة', periods: 'إقفال الفترات', reports: 'التقارير', trade: 'المبيعات والمشتريات', inventory: 'المخزون', assets: 'الأصول الثابتة',
    hr: 'الموارد البشرية', payroll: 'الرواتب', pos: 'نقاط البيع', orders: 'الطلبات والعروض', settings: 'الإعدادات', admin: 'إدارة النظام' };
  const permits = (key, level) => { const p = PAGE[key]; if (!p) return true; return p[0] === 'admin' ? !!E.me.isAdmin : E.can(p[0], level || p[1]); };
  const allowed = (n) => !n[2] || permits(n[0]);
  const ROUTES = {
    '': 'dashboard', search: 'search', 'entry/view': 'entryView', 'payment/view': 'paymentView', accounts: 'accounts', 'entry/new': 'entryNew', entries: 'entries', periods: 'periods',
    'reports/trial-balance': 'trial-balance', 'reports/ledger': 'ledger', 'reports/income-statement': 'income-statement',
    'inventory/valuation': 'inv-valuation', 'inventory/card': 'inv-card', 'inventory/movement': 'inv-movement', 'inventory/slow': 'inv-slow', 'inventory/shortage': 'inv-shortage', 'inventory/items': 'invItems', 'inventory/warehouses': 'invWarehouses', 'inventory/stock': 'invStock', 'inventory/moves': 'invMoves', 'inventory/adjust': 'invAdjust',
    assets: 'assets', 'assets/new': 'assetNew', 'assets/view': 'assetView', 'assets/depreciation': 'depreciation', 'assets/rep-register': 'asset-register', 'assets/rep-rollforward': 'asset-rollforward', 'assets/rep-forecast': 'asset-forecast', 'assets/rep-disposals': 'asset-disposals', 'assets/rep-life': 'asset-life',
    'hr/employees': 'hrEmployees', 'employee/view': 'hrEmployee', 'hr/components': 'hrComponents', 'hr/adjustments': 'hrAdjustments', 'hr/advances': 'hrAdvances', 'hr/headcount': 'hr-headcount', 'hr/tenure': 'hr-tenure', 'hr/movements': 'hr-movements', 'hr/salary-changes': 'hr-salary-changes', 'hr/advances-report': 'hr-advances-report', 'hr/data-gaps': 'hr-data-gaps',
    payroll: 'payroll', 'payroll/view': 'payrollView', 'payroll/dept': 'pay-dept', 'payroll/employee-sheet': 'pay-employee', 'payroll/components': 'pay-components', 'payroll/trend': 'pay-trend',
    'pos/sell': 'posSell', 'pos/sales': 'posSales', 'pos/sale': 'posSale', 'pos/shifts': 'posShifts', 'pos/shift': 'posShift', 'pos/registers': 'posRegisters', 'pos/rep-daily': 'pos-daily', 'pos/rep-items': 'pos-items', 'pos/rep-cashiers': 'pos-cashiers', 'pos/rep-hourly': 'pos-hourly', 'pos/rep-shifts': 'pos-shifts', 'pos/rep-returns': 'pos-returns',
    'po/edit': 'poEdit', 'quote/edit': 'quoteEdit', po: 'poList', 'po/new': 'poNew', 'po/view': 'poView', quotes: 'quoteList', 'quote/new': 'quoteNew', 'quote/view': 'quoteView', settings: 'settings',
    'tax/settings': 'taxSettings', 'reports/vat': 'vat-return',
    'settings/home': 'settingsHome', 'settings/import': 'importData', 'settings/users': 'adminUsers', 'settings/roles': 'adminRoles', 'settings/access': 'adminAccess', 'settings/audit': 'adminAudit', 'settings/backup': 'adminBackup', 'settings/password': 'myPassword',
    notes: 'notes', 'note/new': 'noteNew', 'note/view': 'noteView',
    customers: 'customers', suppliers: 'suppliers', sales: 'sales', purchases: 'purchases', payments: 'payments',
    'invoice/new': 'invoiceNew', 'invoice/view': 'invoiceView', 'party/statement': 'partyStatement', 'payment/new': 'paymentNew', 'reports/aging': 'aging',
    'reports/balance-sheet': 'balance-sheet', 'reports/cash-flow': 'cash-flow', 'reports/open-invoices': 'trade-open', 'reports/party-balances': 'trade-balances', 'reports/payments-summary': 'trade-payments', 'reports/sales-comparison': 'trade-comparison', 'reports/notes-summary': 'trade-notes', 'reports/monthly-pl': 'acc-monthly-pl', 'reports/activity': 'acc-activity', 'reports/cash-book': 'acc-cash-book', 'reports/ratios': 'acc-ratios', 'reports/journal-audit': 'acc-journal-audit', 'reports/general-journal': 'acc-journal', 'reports/general-ledger': 'acc-gl', 'reports/tb-compare': 'acc-tb-compare', 'reports/bs-compare': 'acc-bs-compare', 'reports/account-groups': 'acc-groups', 'reports/sales-analysis': 'sales-analysis', 'reports/item-profit': 'item-profit', 'reports/comparative': 'comparative',
  };

  function loginView(msg) {
    me = null;
    app.innerHTML = '<div class="login-wrap"><div class="login-brand"><i>E</i><h1>نظام ERP</h1><p>المحاسبة والمبيعات والمشتريات والمخزون والرواتب</p></div>' +
      '<div class="login-form"><form id="lf"><h2>تسجيل الدخول</h2>' + (msg ? E.err(msg) : '') +
      '<input name="username" placeholder="اسم المستخدم" autocomplete="username" required autofocus>' +
      '<input name="password" type="password" placeholder="كلمة المرور" autocomplete="current-password" required><button class="btn">دخول</button></form></div></div>';
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
  // أيقونات خطية للأقسام (SVG مضمّن، بلا مكتبات خارجية)
  const ic = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const ICONS = {
    acc: ic('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/>'),
    trade: ic('<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>'),
    inv: ic('<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>'),
    pos: ic('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8"/><path d="M8 11h2m4 0h2M8 15h2m4 0h2"/>'),
    assets: ic('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>'),
    hr: ic('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.5a3 3 0 0 1 0 5.8M18 14.3c1.8.8 3 2.6 3 4.7"/>'),
    set: ic('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 6l2.2 1.5M17.6 16.5l2.2 1.5M2 12h3M19 12h3M4.2 18l2.2-1.5M17.6 7.5L19.8 6"/>'),
  };
  // مسار الصفحة فوق العنوان، وزر «؟» يُظهر وصف الصفحة بدل ترك سطر شرح ثابت تحت كل عنوان
  function crumbFor(key) {
    for (const sec of SECTIONS) for (const g of sec.groups) if (g.items.some((n) => n[0] === key)) return sec.title + (g.t ? ' › ' + g.t : '');
    return '';
  }
  // يخفي أزرار الإلغاء/الحذف والاعتماد/الإقفال عمّن لا يملك علمها في دوره (الخادم يرفضها أيضاً)
  const VOID_ACTS = new Set(['void', 'reverse', 'c-del', 'cancel', 'unconvert', 'unpay', 'vr', 'rev', 'unassign', 'del']);
  const APPROVE_ACTS = new Set(['approve', 'post', 'closeYear', 'reopen', 'reopenYear']);
  function hideRestricted(main, key) {
    const noVoid = !E.canDo('_void'), noAppr = !E.canDo('_approve');
    if (!noVoid && !noAppr) return;
    const run = () => E.$$('[data-act]', main).forEach((b) => {
      const a = b.dataset.act;
      if ((noVoid && VOID_ACTS.has(a)) || (noAppr && (APPROVE_ACTS.has(a) || (a === 'close' && key === 'periods')))) { b.hidden = true; b.style.display = 'none'; }
    });
    run(); new MutationObserver(run).observe(main, { childList: true, subtree: true });
  }
  function decoratePage(main, key) {
    const run = () => {
      const h = E.$('h1', main);
      if (!h || h.dataset.dec) return;
      h.dataset.dec = '1';
      const c = crumbFor(key);
      if (c) { const d = document.createElement('div'); d.className = 'crumb noprint'; d.textContent = c; h.insertAdjacentElement('beforebegin', d); }
      const sub = h.nextElementSibling;
      if (sub && sub.classList.contains('sub')) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'hq noprint'; b.title = 'وصف الصفحة'; b.textContent = '؟';
        b.addEventListener('click', () => sub.classList.toggle('show')); h.appendChild(b);
      }
    };
    run();
    new MutationObserver(run).observe(main, { childList: true, subtree: true });
  }

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
      return '<details class="sec" data-s="' + sec.id + '"' + (open.has(sec.id) ? ' open' : '') + '><summary>' + (ICONS[sec.id] || '') + E.esc(sec.title) + '</summary>' +
        groups.map((g) => (g.t ? '<div class="grp">' + E.esc(g.t) + '</div>' : '') + g.items.map(link).join('')).join('') + '</details>';
    }).join('');
    app.innerHTML = '<div class="layout"><nav class="side"><div class="brand"><i>E</i>نظام ERP</div>' + html +
      '<div class="who">' + E.esc(E.me.fullName || me) + '<br><span style="opacity:.7">' + E.esc(E.me.roleName || '') + '</span> · <button class="link" id="lo">خروج</button><div style="opacity:.55;font-size:11px;margin-top:6px" id="ver"></div></div></nav><div class="print-only" id="phead"></div><main id="main"></main><div class="print-only" id="pfoot"></div><button class="fab noprint" id="pbtn" title="طباعة هذه الشاشة" aria-label="طباعة"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/></svg>طباعة</button></div>';
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
    decoratePage(main, act);
    hideRestricted(main, key);
    try { await E.pages[name](main, param); } catch (e) { main.innerHTML = E.err(e.message); return; }
    if (wantPrint) setTimeout(() => { if (E.$('#main') !== main) return; history.replaceState(null, '', '#/' + h); (main._openDoc || (() => E.reportDoc(main)))(); }, 500);
  }

  E.onUnauth = () => loginView('انتهت الجلسة، سجّل الدخول من جديد');
  window.addEventListener('hashchange', route);
  (async function init() {
    try { await enter(); } catch (e) { loginView(); }
  })();
})(window.ERP);
