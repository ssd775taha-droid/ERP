'use strict';
(function (E) {
  const app = E.$('#app');
  let me = null;

  const NAV = [
    ['', 'الرئيسية'],
    ['المحاسبة'],
    ['accounts', 'دليل الحسابات'], ['entry/new', 'قيد يومية جديد'], ['entries', 'دفتر اليومية'],
    ['المبيعات والمشتريات'],
    ['customers', 'العملاء'], ['sales', 'فواتير المبيعات'], ['suppliers', 'الموردون'], ['purchases', 'فواتير المشتريات'], ['payments', 'سندات القبض والصرف'],
    ['المخزون'],
    ['inventory/items', 'الأصناف'], ['inventory/warehouses', 'المخازن'], ['inventory/stock', 'أرصدة المخزون'], ['inventory/moves', 'حركات المخزون'], ['inventory/adjust', 'تسوية وتحويل'],
    ['الأصول الثابتة'],
    ['assets', 'سجل الأصول'], ['assets/new', 'أصل جديد'], ['assets/depreciation', 'الإهلاك الشهري'],
    ['الرواتب والموارد البشرية'],
    ['hr/employees', 'الموظفون'], ['hr/components', 'مكوّنات الراتب'], ['hr/adjustments', 'التسويات'], ['hr/advances', 'السلف'], ['payroll', 'كشوف الرواتب'],
    ['نقاط البيع'],
    ['pos/sell', 'شاشة البيع'], ['pos/sales', 'العمليات'], ['pos/shifts', 'الورديات'], ['pos/registers', 'النقاط'],
    ['الطلبات والعروض'],
    ['po', 'أوامر الشراء'], ['po/new', 'أمر شراء جديد'], ['quotes', 'عروض الأسعار'], ['quote/new', 'عرض سعر جديد'], ['settings', 'إعدادات الضوابط'], ['tax/settings', 'الضريبة السعودية'],
    ['التقارير'],
    ['reports/trial-balance', 'ميزان المراجعة'], ['reports/ledger', 'كشف حساب'], ['reports/income-statement', 'قائمة الدخل'],
    ['reports/aging', 'أعمار الديون'], ['reports/vat', 'إقرار الضريبة'], ['reports/balance-sheet', 'الميزانية'], ['reports/cash-flow', 'التدفقات النقدية'],
    ['الإقفال'],
    ['periods', 'الفترات والإقفال'],
  ];
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
      try { const r = await E.api('POST', '/login', { username: f.get('username'), password: f.get('password') }); me = r.user || f.get('username'); await E.loadTax(); layout(); route(); }
      catch (e) { loginView(e.message); }
    });
  }

  function layout() {
    app.innerHTML = '<div class="layout"><nav class="side"><div class="brand">نظام ERP</div>' +
      NAV.map((n) => n.length === 1 ? '<div class="grp">' + E.esc(n[0]) + '</div>' : '<a href="#/' + n[0] + '" data-r="' + n[0] + '">' + E.esc(n[1]) + '</a>').join('') +
      '<div class="who">' + E.esc(me) + ' · <button class="link" id="lo">خروج</button></div></nav><main id="main"></main></div>';
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
    try { const r = await E.api('GET', '/me'); if (r.user) { me = r.user; await E.loadTax(); layout(); route(); } else loginView(); }
    catch (e) { loginView(); }
  })();
})(window.ERP);
