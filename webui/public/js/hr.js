'use strict';
(function (E) {
  const { esc, money, api } = E;
  const KIND = { EARNING: 'استحقاق', DEDUCTION: 'استقطاع', EMPLOYER: 'حصة صاحب العمل', BASIC: 'أساسي', ADVANCE: 'سلفة' };
  const RUN_ST = { DRAFT: '<span class="tag warn">مسودة</span>', POSTED: '<span class="tag">مرحَّل</span>', PAID: '<span class="tag good">مصروف</span>', VOID: '<span class="tag bad">ملغى</span>', CANCELLED: '<span class="tag bad">ملغى</span>' };
  const opts = (rows, f) => rows.map(f).join('');
  const val = (f, n) => f.get(n).trim();
  const numv = (f, n) => f.get(n).replace(/,/g, '').trim();
  const monthFirst = (d) => d.slice(0, 8) + '01';
  const submit = (el, sel, fn) => E.$(sel, el).addEventListener('submit', async (ev) => { ev.preventDefault(); try { await fn(new FormData(ev.target), ev.target); } catch (e) { E.toast(e.message, true); } });

  // ---------- الموظفون والأقسام ----------
  E.pages.hrEmployees = async function (el) {
    const [{ employees }, { departments }] = await Promise.all([api('GET', '/hr/employees'), api('GET', '/hr/departments')]);
    el.innerHTML = E.head('الموظفون') +
      '<div class="card"><h3>موظف جديد</h3><form id="f" class="row"><label>الرمز<input name="code" required maxlength="20" size="8"></label><label>الاسم<input name="name" required maxlength="120" size="22"></label>' +
      '<label>القسم<select name="dept"><option value="">—</option>' + opts(departments, (d) => '<option value="' + d.id + '">' + esc(d.name) + '</option>') + '</select></label><label>الوظيفة<input name="job" maxlength="80" size="14"></label>' +
      '<label>تاريخ التعيين<input type="date" name="hire" value="' + E.today() + '"></label><label>الراتب الأساسي<input name="basic" inputmode="decimal" required size="10"></label>' +
      '<label>رقم الهوية<input name="nid" maxlength="30" size="12"></label><label>الحساب البنكي<input name="bank" maxlength="60" size="14"></label><button class="btn">إضافة</button></form></div>' +
      '<div class="card"><h3>قسم جديد</h3><form id="fd" class="row"><label>الرمز<input name="code" required maxlength="12" size="8"></label><label>الاسم<input name="name" required maxlength="120" size="20"></label><button class="btn alt">إضافة قسم</button>' +
      (departments.length ? ' <span class="muted">الأقسام: ' + departments.map((d) => esc(d.name) + ' (' + d.employees + ') ' + E.crudBtns('dept', { id: d.id, name: d.name })).join('<br>') + '</span>' : '') + '</form></div>' +
      (employees.length ? '<table><thead><tr><th>الرمز</th><th>الاسم</th><th>القسم</th><th>الوظيفة</th><th>التعيين</th><th class="n">الأساسي الحالي</th><th>الحالة</th><th class="noprint"></th></tr></thead><tbody>' +
        employees.map((e) => '<tr><td><a href="#/employee/view/' + e.id + '">' + esc(e.code) + '</a></td><td>' + esc(e.name) + '</td><td>' + esc(e.deptName || '') + '</td><td>' + esc(e.jobTitle || '') + '</td><td>' + esc(e.hireDate) + '</td><td class="n">' + (e.basic ? money(e.basic) : '') + '</td><td>' +
          (e.status === 'ACTIVE' ? '<span class="tag good">على رأس العمل</span>' : '<span class="tag bad">انتهت خدمته ' + esc(e.termDate) + '</span>') + '</td><td class="noprint">' + E.crudBtns('employee', { id: e.id, name: e.name, jobTitle: e.jobTitle || '', nationalId: e.nationalId || '', bankAccount: e.bankAccount || '', deptId: e.deptId || '', depts: departments.map((d) => [d.id, d.name]) }) + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا موظفون</div>');
    submit(el, '#f', async (f) => {
      const r = await api('POST', '/hr/employees', { code: val(f, 'code'), name: val(f, 'name'), deptId: f.get('dept') || null, jobTitle: val(f, 'job'), hireDate: f.get('hire'), basic: numv(f, 'basic'), nationalId: val(f, 'nid'), bankAccount: val(f, 'bank') });
      E.toast('أُضيف الموظف'); location.hash = '#/employee/view/' + r.id;
    });
    E.crudBind(el, () => E.pages.hrEmployees(el));
    submit(el, '#fd', async (f) => { await api('POST', '/hr/departments', { code: val(f, 'code'), name: val(f, 'name') }); E.toast('أُضيف القسم'); E.pages.hrEmployees(el); });
  };

  E.pages.hrEmployee = async function (el, id) {
    async function load() {
      const [{ employee: e }, { components }] = await Promise.all([api('GET', '/hr/employees/' + encodeURIComponent(id)), api('GET', '/hr/components')]);
      const free = components.filter((c) => c.active === 'Y' && !e.components.some((x) => x.compId === c.id));
      el.innerHTML = E.head(e.code + ' — ' + e.name, [e.jobTitle, e.deptName].filter(Boolean).join(' · ')) +
        '<p>' + (e.status === 'ACTIVE' ? '<span class="tag good">على رأس العمل منذ ' + esc(e.hireDate) + '</span>' : '<span class="tag bad">انتهت خدمته ' + esc(e.termDate) + '</span>') + ' <span class="muted">' + esc(e.nationalId || '') + ' ' + esc(e.bankAccount || '') + '</span></p>' +
        '<h3>تاريخ الراتب الأساسي</h3><table><tbody>' + e.salary.map((s) => '<tr><td>من ' + esc(s.from) + '</td><td class="n">' + money(s.basic) + '</td></tr>').join('') + '</tbody></table>' +
        (e.status === 'ACTIVE' ? '<div class="card noprint" style="margin-top:12px"><h3>تعديل الراتب</h3><form id="fs" class="row"><label>الراتب الجديد<input name="b" inputmode="decimal" required size="10"></label><label>يسري من أول شهر<input type="date" name="f" value="' + monthFirst(E.today()) + '"></label><button class="btn">حفظ</button></form></div>' : '') +
        '<h3>المكوّنات المرتبطة</h3>' + (e.components.length ? '<table><thead><tr><th>المكوّن</th><th>النوع</th><th>القيمة</th><th class="noprint"></th></tr></thead><tbody>' +
          e.components.map((c) => '<tr><td>' + esc(c.name) + '</td><td>' + (KIND[c.kind] || c.kind) + '</td><td>' + (c.calcType === 'PCT' ? c.pct + '%' : money(c.amount)) + '</td><td class="noprint"><button class="btn alt sm" data-act="unassign" data-c="' + c.compId + '">إزالة</button></td></tr>').join('') + '</tbody></table>' : '<p class="muted">لا مكوّنات</p>') +
        (e.status === 'ACTIVE' && free.length ? '<div class="card noprint" style="margin-top:12px"><form id="fc" class="row"><label>مكوّن<select name="c">' + opts(free, (c) => '<option value="' + c.id + '">' + esc(c.name) + ' (' + (c.calcType === 'PCT' ? c.pct + '%' : 'مبلغ ثابت') + ')</option>') + '</select></label>' +
          '<label>المبلغ (للثابت)<input name="a" inputmode="decimal" size="10"></label><label>نسبة خاصة % (اختياري)<input name="p" inputmode="decimal" size="6"></label><button class="btn">ربط</button></form></div>' : '') +
        (e.status === 'ACTIVE' ? '<div class="card noprint" style="margin-top:12px"><h3>إنهاء الخدمة</h3><form id="ft" class="row"><label>التاريخ<input type="date" name="d" value="' + E.today() + '"></label><button class="btn danger">إنهاء الخدمة</button></form><p class="muted">يُحتسب راتب الشهر الأخير بالتناسب، ولا يُسمح إن رُحّل كشف لشهر بعده.</p></div>' : '') +
        '<p class="noprint"><button class="btn gold sm noprint" data-act="print">معاينة وطباعة</button> <a href="#/hr/employees">رجوع للموظفين</a></p>';
      const fs = E.$('#fs', el), fc = E.$('#fc', el), ft = E.$('#ft', el);
      const on = (form, fn) => form && form.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await fn(new FormData(form)); await load(); } catch (x) { E.toast(x.message, true); } });
      on(fs, async (f) => { await api('POST', '/hr/employees/' + id + '/salary', { basic: numv(f, 'b'), from: f.get('f') }); E.toast('عُدّل الراتب'); });
      on(fc, async (f) => { await api('POST', '/hr/employees/' + id + '/components', { compId: Number(f.get('c')), amount: numv(f, 'a') || null, pct: numv(f, 'p') || null }); E.toast('رُبط المكوّن'); });
      on(ft, async (f) => { if (!confirm('إنهاء خدمة الموظف؟')) throw new Error('أُلغي'); await api('POST', '/hr/employees/' + id + '/terminate', { date: f.get('d') }); E.toast('أُنهيت الخدمة'); });
    }
    E.bind(el, { unassign: async (b) => { await api('POST', '/hr/employees/' + id + '/components/' + b.dataset.c + '/remove'); E.toast('أُزيل المكوّن'); await load(); } });
    await load();
  };

  // ---------- مكوّنات الراتب ----------
  E.pages.hrComponents = async function (el) {
    const [{ components }, accts] = await Promise.all([api('GET', '/hr/components'), E.loadAccounts()]);
    const ao = (def) => '<option value="">—</option>' + accts.filter((a) => a.active === 'Y' && !a.children).map((a) => '<option value="' + esc(a.code) + '"' + (a.code === def ? ' selected' : '') + '>' + esc(a.code) + ' ' + esc(a.name) + '</option>').join('');
    el.innerHTML = E.head('مكوّنات الراتب', 'النسب والسقوف تضبطها أنت وفق نظام بلدك؛ لا قيم افتراضية مزروعة') +
      '<div class="card"><form id="f" class="row"><label>الرمز<input name="code" required maxlength="20" size="8"></label><label>الاسم<input name="name" required maxlength="120" size="18"></label>' +
      '<label>النوع<select name="kind"><option value="EARNING">استحقاق (بدل)</option><option value="DEDUCTION">استقطاع من الموظف</option><option value="EMPLOYER">حصة صاحب العمل</option></select></label>' +
      '<label>الحساب<select name="calc"><option value="FIXED">مبلغ ثابت</option><option value="PCT">نسبة %</option></select></label><label>النسبة %<input name="pct" inputmode="decimal" size="6" value="0"></label>' +
      '<label>الوعاء<select name="base"><option value="BASIC">الأساسي</option><option value="GROSS">الإجمالي</option></select></label><label>سقف الوعاء<input name="cap" inputmode="decimal" size="10"></label>' +
      '<label>حساب المصروف<select name="ea">' + ao('5200') + '</select></label><label>حساب الالتزام<select name="la">' + ao('2400') + '</select></label><button class="btn">إضافة</button></form>' +
      '<p class="muted">الاستحقاق يحتاج حساب مصروف، والاستقطاع يحتاج حساب التزام، وحصة صاحب العمل تحتاج الاثنين.</p></div>' +
      (components.length ? '<table><thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>الحساب</th><th>الوعاء</th><th>السقف</th><th>المصروف</th><th>الالتزام</th><th class="noprint"></th></tr></thead><tbody>' +
        components.map((c) => '<tr><td>' + esc(c.code) + '</td><td>' + esc(c.name) + '</td><td>' + (KIND[c.kind] || c.kind) + '</td><td>' + (c.calcType === 'PCT' ? c.pct + '%' : 'ثابت') + '</td><td>' + (c.calcType === 'PCT' ? (c.baseType === 'BASIC' ? 'الأساسي' : 'الإجمالي') : '') + '</td><td class="n">' + (c.baseCap ? money(c.baseCap) : '') + '</td><td>' + esc(c.expenseAccount || '') + '</td><td>' + esc(c.liabilityAccount || '') + '</td><td class="noprint">' + E.crudBtns('component', { id: c.id, name: c.name, pct: c.pct }) + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا مكوّنات معرّفة</div>');
    submit(el, '#f', async (f) => {
      await api('POST', '/hr/components', { code: val(f, 'code'), name: val(f, 'name'), kind: f.get('kind'), calcType: f.get('calc'), pct: f.get('pct'), baseType: f.get('base'), baseCap: numv(f, 'cap') || null, expenseAccount: f.get('ea') || null, liabilityAccount: f.get('la') || null });
      E.toast('أُضيف المكوّن'); E.pages.hrComponents(el);
    });
    E.crudBind(el, () => E.pages.hrComponents(el));
  };

  // ---------- التسويات الشهرية ----------
  E.pages.hrAdjustments = async function (el) {
    const [{ adjustments }, { employees }, accts] = await Promise.all([api('GET', '/hr/adjustments'), api('GET', '/hr/employees'), E.loadAccounts()]);
    el._adjs = adjustments;
    const act = employees.filter((e) => e.status === 'ACTIVE');
    el.innerHTML = E.head('تسويات الرواتب', 'مكافآت وعمل إضافي وجزاءات؛ تبقى معلّقة حتى يلتقطها أول كشف يغطي شهرها') +
      '<div class="card"><form id="f" class="row"><label>الموظف<select name="e">' + opts(act, (e) => '<option value="' + e.id + '">' + esc(e.code) + ' ' + esc(e.name) + '</option>') + '</select></label>' +
      '<label>الشهر<input type="date" name="p" value="' + monthFirst(E.today()) + '"></label><label>النوع<select name="k"><option value="EARNING">استحقاق (مكافأة / عمل إضافي)</option><option value="DEDUCTION">استقطاع (جزاء / خصم)</option></select></label>' +
      '<label style="flex:1">الوصف<input name="d" required maxlength="200"></label><label>المبلغ<input name="a" inputmode="decimal" required size="10"></label><button class="btn">إضافة</button></form></div>' +
      (adjustments.length ? '<table><thead><tr><th>الموظف</th><th>الشهر</th><th>النوع</th><th>الوصف</th><th class="n">المبلغ</th><th>الحالة</th><th class="noprint"></th></tr></thead><tbody>' +
        adjustments.map((a) => '<tr><td>' + esc(a.empName) + '</td><td>' + esc(a.period) + '</td><td>' + (KIND[a.kind] || a.kind) + '</td><td>' + esc(a.description) + '</td><td class="n">' + money(a.amount) + '</td><td>' +
          ({ PENDING: '<span class="tag warn">معلّقة</span>', APPLIED: '<span class="tag good">مطبّقة</span>', VOID: '<span class="tag bad">ملغاة</span>' }[a.status] || a.status) + '</td><td class="noprint"><button class="btn alt sm" data-act="adjdoc" data-id="' + a.id + '">طباعة</button> ' + (a.status !== 'VOID' ? '<button class="btn alt sm" data-act="void" data-id="' + a.id + '">إلغاء</button>' : '') + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا تسويات</div>');
    submit(el, '#f', async (f) => { await api('POST', '/hr/adjustments', { empId: Number(f.get('e')), period: f.get('p'), kind: f.get('k'), description: val(f, 'd'), amount: numv(f, 'a') }); E.toast('أُضيفت التسوية'); E.pages.hrAdjustments(el); });
    if (!el._adjBound) { el._adjBound = true; E.bind(el, { adjdoc: (b) => E.openDoc(E.docSpec.adjustment(el._adjs.find((x) => String(x.id) === b.dataset.id))) }); }
    E.bind(el, { void: async (b) => { if (confirm('إلغاء التسوية؟')) { await api('POST', '/hr/adjustments/' + b.dataset.id + '/void'); E.toast('أُلغيت'); E.pages.hrAdjustments(el); } } });
  };

  // ---------- السلف ----------
  E.pages.hrAdvances = async function (el) {
    const [{ advances }, { employees }] = await Promise.all([api('GET', '/hr/advances'), api('GET', '/hr/employees')]);
    el._advances = advances;
    const act = employees.filter((e) => e.status === 'ACTIVE');
    el.innerHTML = E.head('سلف الموظفين', 'يُرحَّل قيد (مدين سلف الموظفين / دائن الصندوق أو البنك) وتُقتطع أقساطاً شهرية في الكشوف') +
      '<div class="card"><form id="f" class="row"><label>الموظف<select name="e">' + opts(act, (e) => '<option value="' + e.id + '">' + esc(e.code) + ' ' + esc(e.name) + '</option>') + '</select></label>' +
      '<label>التاريخ<input type="date" name="d" value="' + E.today() + '"></label><label>المبلغ<input name="a" inputmode="decimal" required size="10"></label><label>عدد الأقساط<input name="i" inputmode="numeric" required size="5" value="3"></label>' +
      '<label>أول شهر اقتطاع<input type="date" name="f" value="' + monthFirst(E.today()) + '"></label><label>الصرف<select name="m"><option value="CASH">نقداً</option><option value="BANK">بنك</option></select></label>' +
      '<label style="flex:1">ملاحظة<input name="n" maxlength="300"></label><button class="btn">منح السلفة</button></form></div>' +
      (advances.length ? '<table><thead><tr><th>#</th><th>الموظف</th><th>التاريخ</th><th class="n">المبلغ</th><th class="n">المسدّد</th><th class="n">المتبقي</th><th>الأقساط</th><th>الحالة</th><th class="noprint"></th></tr></thead><tbody>' +
        advances.map((a) => '<tr><td>' + a.id + '</td><td>' + esc(a.empName) + '</td><td>' + esc(a.date) + '</td><td class="n">' + money(a.amount) + '</td><td class="n">' + money(a.repaid) + '</td><td class="n">' + money(a.remaining) + '</td><td>' + a.done + ' / ' + a.installments + '</td><td>' +
          (a.status === 'SETTLED' ? '<span class="tag good">مسدّدة</span>' : '<span class="tag">مفتوحة</span>') + '</td><td class="noprint">' + '<button class="btn alt sm" data-act="advdoc" data-id="' + a.id + '">طباعة السند</button> ' + (a.done === 0 && a.status === 'OPEN' ? '<button class="btn alt sm" data-act="void" data-id="' + a.id + '">إلغاء</button>' : '') + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا سلف</div>');
    submit(el, '#f', async (f) => { await api('POST', '/hr/advances', { empId: Number(f.get('e')), date: f.get('d'), amount: numv(f, 'a'), installments: Number(f.get('i')), firstPeriod: f.get('f'), method: f.get('m'), note: val(f, 'n') }); E.toast('مُنحت السلفة'); E.pages.hrAdvances(el); });
    if (!el._advBound) { el._advBound = true; E.bind(el, { advdoc: (b) => E.openDoc(E.docSpec.advance(el._advances.find((x) => String(x.id) === b.dataset.id))) }); }
    E.bind(el, { void: async (b) => { if (confirm('إلغاء السلفة وعكس قيدها؟')) { await api('POST', '/hr/advances/' + b.dataset.id + '/void'); E.toast('أُلغيت'); E.pages.hrAdvances(el); } } });
  };

  // ---------- كشوف الرواتب ----------
  E.pages.payroll = async function (el) {
    const [{ runs }, chk] = await Promise.all([api('GET', '/payroll/runs'), api('GET', '/payroll/check')]);
    el.innerHTML = E.head('كشوف الرواتب', 'مسودة ← ترحيل (قيد) ← صرف (قيد). كشف فعّال واحد لكل شهر') +
      (chk.ok ? '<div class="msg good">رصيد الرواتب المستحقة يطابق الكشوف المرحَّلة</div>' : '<div class="msg bad">فرق بين الكشوف ورصيد ح/2300: ' + money(chk.difference) + '</div>') +
      '<div class="card"><form id="f" class="row"><label>الشهر<input type="date" name="p" value="' + monthFirst(E.today()) + '"></label><button class="btn">إنشاء كشف وحسابه</button></form></div>' +
      (runs.length ? '<table><thead><tr><th>الشهر</th><th>الموظفون</th><th class="n">الإجمالي</th><th class="n">الاستقطاعات</th><th class="n">الصافي</th><th>الحالة</th></tr></thead><tbody>' +
        runs.map((r) => '<tr><td><a href="#/payroll/view/' + r.id + '">' + esc(r.period) + '</a></td><td>' + r.employees + '</td><td class="n">' + money(r.gross) + '</td><td class="n">' + money(r.deductions) + '</td><td class="n">' + money(r.net) + '</td><td>' + (RUN_ST[r.status] || r.status) + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا كشوف</div>');
    submit(el, '#f', async (f) => { const r = await api('POST', '/payroll/runs', { period: f.get('p') }); E.toast('أُنشئ الكشف'); location.hash = '#/payroll/view/' + r.run.id; });
  };

  E.pages.payrollView = async function (el, id) {
    let cur = null;
    async function load() {
      const { run: r } = await api('GET', '/payroll/runs/' + encodeURIComponent(id));
      cur = r; el._openDoc = () => E.openDoc(E.docSpec.payroll(r, (RUN_ST[r.status] || '').replace(/<[^>]+>/g, '')));
      const base = '/payroll/runs/' + r.id;
      el.innerHTML = E.head('كشف رواتب ' + r.period) + '<p>' + (RUN_ST[r.status] || r.status) + ' <span class="muted">' + (r.entryId ? 'قيد الترحيل ' + r.entryId : '') + (r.payEntryId ? ' · قيد الصرف ' + r.payEntryId + ' (' + esc(r.payDate) + ')' : '') + '</span></p>' +
        '<div class="cards"><div class="stat"><div class="k">الإجمالي</div><div class="v">' + money(r.gross) + '</div></div><div class="stat"><div class="k">الاستقطاعات والأقساط</div><div class="v">' + money(r.deductions) + '</div></div><div class="stat"><div class="k">الصافي</div><div class="v">' + money(r.net) + '</div></div><div class="stat"><div class="k">حصة صاحب العمل</div><div class="v">' + money(r.employer) + '</div></div></div>' +
        '<table><thead><tr><th>الموظف</th><th>الأيام</th><th class="n">الأساسي</th><th class="n">استحقاقات</th><th class="n">الإجمالي</th><th class="n">استقطاعات</th><th class="n">سلف</th><th class="n">الصافي</th><th class="noprint"></th></tr></thead><tbody>' +
        r.lines.map((l, li) => '<tr><td>' + esc(l.empName) + '<div class="muted" style="font-size:12px">' + l.items.map((i) => esc(i.description) + ' ' + money(i.amount)).join(' · ') + '</div></td><td>' + l.days + '/' + l.daysInPeriod + '</td><td class="n">' + money(l.basic) + '</td><td class="n">' + money(l.earnings) + '</td><td class="n">' + money(l.gross) + '</td><td class="n">' + money(l.deductions) + '</td><td class="n">' + money(l.advance) + '</td><td class="n">' + money(l.net) + '</td><td class="noprint">' + '<button class="btn alt sm" data-act="slip" data-i="' + li + '">قسيمة راتب</button>' + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="4">الإجمالي</td><td class="n">' + money(r.gross) + '</td><td class="n" colspan="2">' + money(r.deductions) + '</td><td class="n">' + money(r.net) + '</td></tr></tfoot></table>' +
        '<div class="card noprint" style="margin-top:14px">' +
        (r.status === 'DRAFT' ? '<button class="btn alt" data-act="calc">إعادة الحساب</button> <button class="btn" data-act="post">ترحيل القيد</button> <button class="btn danger" data-act="cancel">إلغاء المسودة</button>' : '') +
        (r.status === 'POSTED' ? '<form id="fp" class="row"><label>تاريخ الصرف<input type="date" name="d" value="' + E.today() + '"></label><label>الصرف<select name="m"><option value="BANK">بنك</option><option value="CASH">نقداً</option></select></label><button class="btn">صرف الرواتب</button></form><button class="btn danger sm" data-act="void">إلغاء الكشف (قيد عكسي)</button>' : '') +
        (r.status === 'PAID' ? '<button class="btn alt" data-act="unpay">إلغاء الصرف</button>' : '') +
        ' <button class="btn" data-act="doc">معاينة وطباعة الكشف</button> <button class="btn alt" data-act="print">طباعة الشاشة</button> <a href="#/payroll">رجوع</a></div>';
      const fp = E.$('#fp', el);
      if (fp) fp.addEventListener('submit', async (ev) => { ev.preventDefault(); const f = new FormData(fp); try { await api('POST', base + '/pay', { date: f.get('d'), method: f.get('m') }); E.toast('صُرفت الرواتب'); await load(); } catch (e) { E.toast(e.message, true); } });
    }
    const go = (path, msg, ask) => async () => { if (ask && !confirm(ask)) return; await api('POST', '/payroll/runs/' + encodeURIComponent(id) + '/' + path); E.toast(msg); await load(); };
    E.bind(el, {
      print: () => window.print(),
      doc: () => E.openDoc(E.docSpec.payroll(cur, (RUN_ST[cur.status] || '').replace(/<[^>]+>/g, ''))),
      slip: (b) => E.openDoc(E.docSpec.payslip(cur.lines[Number(b.dataset.i)], cur)),
      calc: go('calculate', 'أُعيد الحساب'), post: go('post', 'رُحّل القيد', 'ترحيل الكشف؟ لن يُعدَّل بعده.'), cancel: go('cancel', 'أُلغيت المسودة', 'إلغاء المسودة؟'),
      void: go('void', 'أُلغي الكشف', 'إلغاء الكشف بقيد عكسي؟'), unpay: go('unpay', 'أُلغي الصرف', 'إلغاء الصرف؟'),
    });
    await load();
  };
})(window.ERP);
