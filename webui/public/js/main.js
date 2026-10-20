'use strict';
(function (E) {
  const app = E.$('#app');
  let me = null;

  // [المسار، العنوان، الوحدة المطلوبة (قراءة) أو 'admin']؛ العنوان وحده = رأس مجموعة تُخفى إن لم يبق تحتها شيء
  const NAV = [
    ['', 'الرئيسية'],
    ['المحاسبة'],
    ['accounts', 'دليل الحسابات', 'accounting'], ['entry/new', 'قيد يومية جديد', 'accounting'], ['entries', 'دفتر اليومية', 'accounting'],
    ['المبيعات والمشتريات'],
    ['customers', 'العملاء', 'trade'], ['sales', 'فواتير المبيعات', 'trade'], ['suppliers', 'الموردون', 'trade'], ['purchases', 'فواتير المشتريات', 'trade'], ['payments', 'سندات القبض والصرف', 'trade'],
    ['المخزون'],
    ['inventory/items', 'الأصناف', 'inventory'], ['inventory/warehouses', 'المخازن', 'inventory'], ['inventory/stock', 'أرصدة المخزون', 'inventory'], ['inventory/moves', 'حركات المخزون', 'inventory'], ['inventory/adjust', 'تسوية وتحويل', 'inventory'],
    ['الأصول الثابتة'],
    ['assets', 'سجل الأصول', 'assets'], ['assets/new', 'أصل جديد', 'assets'], ['assets/depreciation', 'الإهلاك الشهري', 'assets'],
    ['الرواتب والموارد البشرية'],
    ['hr/employees', 'الموظفون', 'hr'], ['hr/components', 'مكوّنات الراتب', 'hr'], ['hr/adjustments', 'التسويات', 'hr'], ['hr/advances', 'السلف', 'hr'], ['payroll', 'كشوف الرواتب', 'payroll'],
    ['نقاط البيع'],
    ['pos/sell', 'شاشة البيع', 'pos'], ['pos/sales', 'العمليات', 'pos'], ['pos/shifts', 'الورديات', 'pos'], ['pos/registers', 'النقاط', 'pos'],
    ['الطلبات والعروض'],
    ['po', 'أوامر الشراء', 'orders'], ['po/new', 'أمر شراء جديد', 'orders'], ['quotes', 'عروض الأسعار', 'orders'], ['quote/new', 'عرض سعر جديد', 'orders'],
    ['التقارير'],
    ['reports/trial-balance', 'ميزان المراجعة', 'reports'], ['reports/ledger', 'كشف حساب', 'reports'], ['reports/income-statement', 'قائمة الدخل', 'reports'],
    ['reports/aging', 'أعمار الديون', 'reports'], ['reports/vat', 'إقرار الضريبة', 'reports'], ['reports/balance-sheet', 'الميزانية', 'reports'], ['reports/cash-flow', 'التدفقات النقدية', 'reports'],
    ['الإقفال'],
    ['periods', 'الفترات والإقفال', 'periods'],
    ['الإعدادات'],
    ['tax/settings', 'المنشأة والضريبة السعودية', 'settings'], ['settings', 'ضوابط الاعتماد والخصم', 'settings'],
    ['settings/users', 'المستخدمون', 'admin'], ['settings/roles', 'الأدوار والصلاحيات', 'admin'], ['settings/audit', 'سجل العمليات', 'admin'], ['settings/password', 'كلمة سري'],
  ];
  const allowed = (n) => !n[2] || (n[2] === 'admin' ? E.me.isAdmin : E.can(n[2], 'r'));
  const ROUTES = {
    '': 'dashboard', accounts: 'accounts', 'entry/new': 'entryNew', entries: 'entries', periods: 'periods',
    'reports/trial-balance': 'trial-balance', 'reports/ledger': 'ledger', 'reports/income-statement': 'income-statement',
    'inventory/items': 'invItems', 'inventory/warehouses': 'invWarehouses', 'inventory/stock': 'invStock', 'inventory/moves': 'invMoves', 'inventory/adjust': 'invAdjust',
    assets: 'assets', 'assets/new': 'assetNew', 'assets/view': 'assetView', 'assets/depreciation': 'depreciation',
    'hr/employees': 'hrEmployees', 'employee/view': 'hrEmployee', 'hr/components': 'hrComponents', 'hr/adjustments': 'hrAdjustments', 'hr/advances': 'hrAdvances',
    payroll: 'payroll', 'payroll/view': 'payrollView',
    'pos/sell': 'posSell', 'pos/sales': 'posSales', 'pos/sale': 'posSale', 'pos/shifts': 'posShifts', 'pos/shift': 'posShift', 'pos/registers': 'posRegisters',
    po: 'poList', 'po/new': 'poNew', 'po/view': 'poView', quotes: 'quoteList', 'quote/new': 'quoteNew', 'quote/view': 'quoteView', settings: 'settings',
    'tax/settings': 'taxSettings', 'reports/vat': 'vat-return',
    'settings/home': 'settingsHome', 'settings/users': 'adminUsers', 'settings/roles': 'adminRoles', 'settings/audit': 'adminAudit', 'settings/password': 'myPassword',
    customers: 'customers', suppliers: 'suppliers', sales: 'sales', purchases: 'purchases', payments: 'payments',
    'invoice/new': 'invoiceNew', 'invoice/view': 'invoiceView', 'party/statement': 'partyStatement', 'payment/new': 'paymentNew', 'reports/aging': 'aging',
    'reports/balance-sheet': 'balance-sheet', 'reports/cash-flow': 'cash-flow',
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

  function layout() {
    const items = [];
    NAV.forEach((n) => {
      if (n.length === 1) items.push({ grp: n[0], kids: 0 });
      else if (n.length === 2 || allowed(n)) { items.push({ n }); const g = items.filter((x) => x.grp).pop(); if (g) g.kids++; }
    });
    const html = items.filter((x) => !x.grp || x.kids > 0)
      .map((x) => x.grp ? '<div class="grp">' + E.esc(x.grp) + '</div>' : '<a href="#/' + x.n[0] + '" data-r="' + x.n[0] + '">' + E.esc(x.n[1]) + '</a>').join('');
    app.innerHTML = '<div class="layout"><nav class="side"><div class="brand">نظام ERP</div><a href="#/settings/home" data-r="settings/home" style="background:rgba(255,255,255,.1)">⚙ الإعدادات والمستخدمون والصلاحيات</a>' + html +
      '<div class="who">' + E.esc(E.me.fullName || me) + '<br><span style="opacity:.7">' + E.esc(E.me.roleName || '') + '</span> · <button class="link" id="lo">خروج</button><div style="opacity:.55;font-size:11px;margin-top:6px" id="ver"></div></div></nav><main id="main"></main></div>';
    E.api('GET', '/version').then((v) => { const el = E.$('#ver'); if (el) el.textContent = 'الإصدار ' + v.version; }).catch(() => {});
    E.$('#lo').addEventListener('click', async () => { try { await E.api('POST', '/logout'); } catch (e) { /* نتجاهل */ } loginView(); });
  }

  async function route() {
    if (!me) return;
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('/');
    let key = h, param = null;
    if (!(key in ROUTES) && parts.length >= 2) { key = parts.slice(0, 2).join('/'); param = parts[2]; }
    const name = ROUTES[key];
    E.$$('nav.side a').forEach((a) => a.classList.toggle('on', a.dataset.r === key));
    const old = E.$('#main');
    const main = document.createElement('main'); // عنصر جديد لكل صفحة حتى لا تتراكم المستمعات
    main.id = 'main';
    old.replaceWith(main);
    if (!name || !E.pages[name]) { main.innerHTML = E.err('الصفحة غير موجودة'); return; }
    try { await E.pages[name](main, param); } catch (e) { main.innerHTML = E.err(e.message); }
  }

  E.onUnauth = () => loginView('انتهت الجلسة، سجّل الدخول من جديد');
  window.addEventListener('hashchange', route);
  (async function init() {
    try { await enter(); } catch (e) { loginView(); }
  })();
})(window.ERP);
