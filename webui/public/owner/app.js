'use strict';
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const today = () => new Date().toISOString().slice(0, 10);

  async function api(method, path, body) {
    const r = await fetch('/api' + path, { method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch (e) { /* بلا محتوى */ }
    if (!r.ok) throw new Error((data && data.error) || ('خطأ ' + r.status));
    return data;
  }

  let me = null;

  // ---------- تسجيل الدخول ----------
  async function boot() {
    try { const d = await api('GET', '/me'); if (d.user) { me = d; return showApp(); } } catch (e) { /* غير مسجَّل */ }
    $('#login').style.display = 'flex';
  }
  $('#lf').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('#err').textContent = '';
    try {
      await api('POST', '/login', { username: $('#lu').value, password: $('#lp').value });
      me = await api('GET', '/me');
      showApp();
    } catch (e) { $('#err').textContent = e.message; }
  });
  $('#logout').addEventListener('click', async () => {
    try { await api('POST', '/logout', {}); } catch (e) { /* نتجاهل */ }
    location.reload();
  });

  function showApp() {
    $('#login').style.display = 'none';
    $('#app').style.display = 'flex';
    $('#who').textContent = (me.fullName || me.user) + (me.roleName ? ' · ' + me.roleName : '');
    $$('nav.tabs button[data-t]').forEach((b) => b.addEventListener('click', () => go(b.dataset.t)));
    go('today');
    refreshPendingBadge();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/owner/sw.js').catch(() => {});
  }

  function go(t) {
    $$('nav.tabs button[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    $$('section.page').forEach((s) => s.classList.remove('on'));
    $('#pg-' + t).classList.add('on');
    if (t === 'today') loadToday(); else if (t === 'pending') loadPending(); else if (t === 'reports') showReportsMenu();
  }

  async function refreshPendingBadge() {
    try { const { items } = await api('GET', '/owner/pending'); const b = $('#pend-badge');
      if (items.length) { b.hidden = false; b.textContent = items.length; } else b.hidden = true;
    } catch (e) { /* صامت: مؤشر غير أساسي */ }
  }

  // ---------- اليوم ----------
  async function loadToday() {
    const el = $('#pg-today');
    el.innerHTML = '<div class="spin">جارٍ التحميل…</div>';
    try {
      const s = await api('GET', '/owner/summary');
      let h = '';
      if (s.sales) h += '<div class="cards">' +
        '<div class="stat"><div class="k">مبيعات اليوم</div><div class="v">' + money(s.sales.today) + '</div></div>' +
        '<div class="stat"><div class="k">مبيعات الشهر</div><div class="v">' + money(s.sales.mtd) + '</div></div></div>';
      if (s.finance) h += '<div class="cards">' +
        '<div class="stat"><div class="k">النقدية والبنوك</div><div class="v">' + money(s.finance.cash) + '</div></div>' +
        '<div class="stat"><div class="k">صافي الربح (الشهر)</div><div class="v">' + money(s.finance.mtdNet) + '</div></div>' +
        '<div class="stat"><div class="k">مستحق على العملاء</div><div class="v">' + money(s.finance.ar) + '</div></div>' +
        '<div class="stat"><div class="k">مستحق للموردين</div><div class="v">' + money(s.finance.ap) + '</div></div></div>';
      if (!s.sales && !s.finance) h = '<div class="msg warn">لا صلاحية لعرض أي ملخص لهذا الحساب</div>';
      el.innerHTML = h + '<p class="muted" style="margin-top:10px">آخر تحديث: ' + new Date().toLocaleTimeString('ar') + '</p>';
    } catch (e) { el.innerHTML = '<div class="msg warn">' + esc(e.message) + '</div>'; }
  }

  // ---------- المعلّقة ----------
  const KIND_HINT = { po: 'أمر شراء', 'payroll-post': 'رواتب', 'payroll-pay': 'رواتب', 'period-close': 'إقفال' };
  async function loadPending() {
    const el = $('#pg-pending');
    el.innerHTML = '<div class="spin">جارٍ التحميل…</div>';
    try {
      const { items } = await api('GET', '/owner/pending');
      refreshPendingBadge();
      if (!items.length) { el.innerHTML = '<div class="msg good">لا عمليات بانتظار اعتمادك الآن</div>'; return; }
      el.innerHTML = items.map((x, i) => '<div class="card"><div class="pend"><div class="t"><div class="lbl">' + esc(x.label) + '</div>' +
        (x.amount != null ? '<div class="amt">' + money(x.amount) + '</div>' : '') + '</div>' +
        (x.action.needsDate ? '<input type="date" class="pd" data-i="' + i + '" value="' + today() + '" style="margin-left:6px">' : '') +
        '<button class="btn" data-i="' + i + '">اعتماد</button></div></div>').join('');
      $$('.pend .btn', el).forEach((b) => b.addEventListener('click', () => doApprove(items, Number(b.dataset.i), b)));
    } catch (e) { el.innerHTML = '<div class="msg warn">' + esc(e.message) + '</div>'; }
  }
  async function doApprove(items, i, btn) {
    const x = items[i];
    if (!confirm('تأكيد: ' + x.label + (x.amount != null ? ' (' + money(x.amount) + ')' : '') + '؟')) return;
    btn.disabled = true; btn.textContent = '…';
    try {
      const body = { ...x.action.body };
      if (x.action.needsDate) { const d = $('.pd[data-i="' + i + '"]'); if (d) body.date = d.value; }
      await api('POST', x.action.path, body);
      loadPending();
    } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = 'اعتماد'; }
  }

  // ---------- التقارير ----------
  const REPORTS = [
    { key: 'tb', label: 'ميزان المراجعة' }, { key: 'is', label: 'قائمة الدخل (الشهر)' }, { key: 'bs', label: 'الميزانية' },
    { key: 'sa', label: 'تحليل المبيعات (الشهر)' }, { key: 'ar', label: 'أرصدة العملاء' }, { key: 'ap', label: 'أرصدة الموردين' },
  ];
  function showReportsMenu() {
    $('#pg-reports').innerHTML = '<div class="reports-grid">' + REPORTS.map((r) => '<button data-k="' + r.key + '">' + esc(r.label) + '</button>').join('') + '</div>';
    $$('.reports-grid button').forEach((b) => b.addEventListener('click', () => openReport(b.dataset.k, REPORTS.find((r) => r.key === b.dataset.k).label)));
  }
  const monthStart = () => today().slice(0, 8) + '01';
  const table = (head, rows) => '<div class="rtab"><table class="rt"><thead><tr>' + head.map((h) => '<th class="' + (h.n ? 'n' : '') + '">' + esc(h.t) + '</th>').join('') +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  async function openReport(key, label) {
    const el = $('#pg-reports');
    el.innerHTML = '<a href="#" class="back" id="rback">‹ رجوع</a><h2 class="sec">' + esc(label) + '</h2><div class="spin">جارٍ التحميل…</div>';
    $('#rback').addEventListener('click', (ev) => { ev.preventDefault(); showReportsMenu(); });
    const out = $('#pg-reports');
    try {
      let html = '';
      if (key === 'tb') {
        const r = await api('GET', '/reports/trial-balance');
        html = table([{ t: 'الرمز' }, { t: 'الحساب' }, { t: 'مدين', n: 1 }, { t: 'دائن', n: 1 }],
          r.rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td class="n">' + money(x.balanceDebit || '') + '</td><td class="n">' + money(x.balanceCredit || '') + '</td></tr>').join(''));
      } else if (key === 'is') {
        const r = await api('GET', '/reports/income-statement?' + new URLSearchParams({ from: monthStart(), to: today() }));
        html = '<div class="cards"><div class="stat"><div class="k">الإيرادات</div><div class="v">' + money(r.totalRevenue) + '</div></div>' +
          '<div class="stat"><div class="k">المصروفات</div><div class="v">' + money(r.totalExpense) + '</div></div>' +
          '<div class="stat wide"><div class="k">الصافي</div><div class="v">' + money(r.netIncome) + '</div></div></div>' +
          table([{ t: 'الحساب' }, { t: 'المبلغ', n: 1 }], [...r.revenue, ...r.expense].map((x) => '<tr><td>' + esc(x.name) + '</td><td class="n">' + money(x.amount) + '</td></tr>').join(''));
      } else if (key === 'bs') {
        const r = await api('GET', '/reports/balance-sheet?' + new URLSearchParams({ asof: today() }));
        html = '<div class="cards"><div class="stat"><div class="k">الأصول</div><div class="v">' + money(r.totalAssets) + '</div></div>' +
          '<div class="stat"><div class="k">الخصوم</div><div class="v">' + money(r.totalLiabilities) + '</div></div>' +
          '<div class="stat wide"><div class="k">حقوق الملكية</div><div class="v">' + money(r.totalEquity) + '</div></div></div>' +
          (r.balanced ? '' : '<div class="msg warn">غير متوازنة</div>') +
          table([{ t: 'الحساب' }, { t: 'المبلغ', n: 1 }], [...r.assets, ...r.liabilities, ...r.equity].map((x) => '<tr><td>' + esc(x.name) + '</td><td class="n">' + money(x.amount) + '</td></tr>').join(''));
      } else if (key === 'sa') {
        const r = await api('GET', '/reports/sales-analysis?' + new URLSearchParams({ by: 'party', kind: 'SALES', from: monthStart(), to: today() }));
        html = '<div class="cards"><div class="stat wide"><div class="k">إجمالي المبيعات (صافي)</div><div class="v">' + money(r.total) + '</div></div></div>' +
          table([{ t: 'العميل' }, { t: 'الصافي', n: 1 }], r.rows.slice(0, 50).map((x) => '<tr><td>' + esc(x.label) + '</td><td class="n">' + money(x.net) + '</td></tr>').join(''));
      } else if (key === 'ar' || key === 'ap') {
        const r = await api('GET', '/reports/party-balances?' + new URLSearchParams({ kind: key === 'ar' ? 'CUSTOMER' : 'SUPPLIER' }));
        html = '<div class="cards"><div class="stat wide"><div class="k">الإجمالي</div><div class="v">' + money(r.totals.balance) + '</div></div></div>' +
          table([{ t: key === 'ar' ? 'العميل' : 'المورد' }, { t: 'الرصيد', n: 1 }], r.rows.map((x) => '<tr><td>' + esc(x.name) + '</td><td class="n">' + money(x.balance) + '</td></tr>').join(''));
      }
      out.innerHTML = '<a href="#" class="back" id="rback2">‹ رجوع</a><h2 class="sec">' + esc(label) + '</h2>' + (html || '<div class="msg warn">لا بيانات</div>');
      $('#rback2').addEventListener('click', (ev) => { ev.preventDefault(); showReportsMenu(); });
    } catch (e) { out.innerHTML += '<div class="msg warn">' + esc(e.message) + '</div>'; }
  }

  boot();
})();
