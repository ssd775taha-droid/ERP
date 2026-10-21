'use strict';
(function (E) {
  const { esc, api } = E;
  const LV = { n: 'لا شيء', r: 'قراءة', w: 'قراءة وكتابة' };

  // ---------- مركز الإعدادات ----------
  E.pages.settingsHome = async function (el) {
    const card = (href, title, text, ok) => ok ? '<a class="stat" href="#/' + href + '" style="display:block;text-decoration:none;color:inherit"><div class="v" style="font-size:17px">' + title + '</div><div class="k">' + text + '</div></a>' : '';
    el.innerHTML = E.head('إعدادات النظام', 'دورك: ' + (E.me.roleName || '')) + '<div class="cards">' +
      card('tax/settings', 'المنشأة والضريبة السعودية', 'اسم المنشأة والرقم الضريبي ونسبة الضريبة', E.can('settings', 'r')) +
      card('settings', 'ضوابط الاعتماد والخصم', 'حد اعتماد أوامر الشراء وأعلى خصم للعروض', E.can('settings', 'r')) +
      card('settings/users', 'المستخدمون', 'إضافة مستخدمين وتعطيلهم وتغيير كلمات سرهم', E.me.isAdmin) +
      card('settings/roles', 'الأدوار والصلاحيات', 'ما يستطيع كل دور رؤيته وتعديله في كل وحدة', E.me.isAdmin) +
      card('settings/audit', 'سجل العمليات', 'من فعل ماذا ومتى', E.me.isAdmin) +
      card('settings/backup', 'النسخ الاحتياطي', 'كيف تنسخ بياناتك وتستعيدها', E.me.isAdmin) +
      card('settings/system', 'حالة النظام', 'الإصدار وحجم القاعدة والنشاط وفحوص سلامة الأرقام', E.me.isAdmin) +
      card('settings/security-review', 'مراجعة أمنية', 'عمليات إلغاء أو اعتماد نُفِّذت بحسابات لا تملك هذه الصلاحية الآن', E.me.isAdmin) +
      card('settings/password', 'كلمة سري', 'تغيير كلمة السر الخاصة بك', true) + '</div>' +
      '<div class="card"><h3>ملاحظات</h3><ul><li>المدير الأساسي (من ملف الإعدادات) لا يُعطَّل ولا تُغيَّر صلاحياته؛ استخدمه للطوارئ وأنشئ لنفسك مستخدماً بدور «مدير النظام» للعمل اليومي.</li>' +
      '<li>الصلاحيات تُفرض في الخادم على كل طلب، وإخفاء القوائم للراحة فقط.</li>' +
      '<li class="bad">كل المستخدمين يعملون على قاعدة البيانات بحساب Oracle واحد (erp_owner)، وحقل «أنشأه» داخل القاعدة يظهر هذا الحساب. اسم المستخدم الحقيقي يُسجَّل في «سجل العمليات» فقط.</li></ul></div>';
  };

  // ---------- النسخ الاحتياطي (تعليمات؛ التنفيذ من قائمة ابدأ لأن الواجهة لا تملك صلاحية Docker) ----------
  E.pages.adminSystem = async function (el) {
    const s = await api('GET', '/system/status');
    const stat = (k, v) => '<div class="stat"><div class="muted">' + k + '</div><b>' + v + '</b></div>';
    const up = s.uptimeSec >= 86400 ? Math.floor(s.uptimeSec / 86400) + ' يوم' : s.uptimeSec >= 3600 ? Math.floor(s.uptimeSec / 3600) + ' ساعة' : Math.max(1, Math.floor(s.uptimeSec / 60)) + ' دقيقة';
    const C = s.counts, LBL = { entries: 'القيود', lines: 'أسطر القيود', accounts: 'الحسابات', parties: 'العملاء والموردون', invoices: 'الفواتير', payments: 'السندات', items: 'الأصناف', posSales: 'مبيعات نقاط البيع', employees: 'الموظفون', assets: 'الأصول' };
    const bad = s.checks.filter((c) => c.ok === false).length;
    el.innerHTML = E.head('حالة النظام', 'للمدير: صحة الخادم والقاعدة وسلامة الأرقام المحاسبية (قراءة فقط)') +
      '<div class="cards">' + stat('الإصدار', s.version) + stat('مدة تشغيل الخادم', up) + stat('حجم البيانات', s.db.sizeMb == null ? '—' : E.money(s.db.sizeMb) + ' م.ب') +
      stat('المستخدمون الفعّالون', s.users.active + ' / ' + s.users.total) + stat('عمليات كتابة آخر 24 ساعة', s.activity.writes + ' (' + s.activity.users + ' مستخدم)') + '</div>' +
      '<h3>فحوص السلامة ' + (bad ? '<span class="tag bad">' + bad + ' تحتاج مراجعة</span>' : '<span class="tag good">سليمة</span>') + '</h3><table><tbody>' +
      s.checks.map((c) => '<tr><td style="width:2em">' + (c.ok === null ? '—' : c.ok ? '<span class="good">✔</span>' : '<span class="bad">✘</span>') + '</td><td>' + E.esc(c.label) + '</td><td class="muted">' + E.esc(c.detail || '') + '</td></tr>').join('') + '</tbody></table>' +
      '<h3>السجلات</h3><table><tbody>' + Object.keys(LBL).map((k) => '<tr><td>' + LBL[k] + '</td><td class="n">' + (C[k] == null ? '—' : C[k].toLocaleString('en-US')) + '</td></tr>').join('') + '</tbody></table>' +
      '<h3>معلومات</h3><table><tbody><tr><td>قاعدة البيانات</td><td dir="ltr">' + E.esc(s.db.banner || '—') + '</td></tr><tr><td>Node.js</td><td dir="ltr">' + E.esc(s.node) + '</td></tr>' +
      '<tr><td>آخر نشاط مسجَّل</td><td>' + E.esc(s.activity.lastAt || '—') + '</td></tr><tr><td>محاولات دخول فاشلة (24 ساعة)</td><td>' + s.activity.failedLogins + '</td></tr>' +
      '<tr><td>الفترات المقفلة</td><td>' + s.periods.closed + (s.periods.last ? ' (آخرها ' + E.esc(s.periods.last) + ')' : '') + '</td></tr></tbody></table>';
  };

  E.pages.adminSecurityReview = async function (el) {
    el.innerHTML = E.head('مراجعة أمنية', 'فحص سجل العمليات بحثاً عن إلغاء أو حذف أو عكس أو اعتماد نُفِّذ بنجاح بحساب لا يملك دوره الحالي هذه الصلاحية — مؤشر على ثغرة إصدار سابق (0.35.0 فما قبله) وليس بالضرورة سوء استخدام') + '<div id="out"></div>';
    const out = E.$('#out', el);
    out.innerHTML = '<p class="muted">جارٍ الفحص…</p>';
    try {
      const r = await api('GET', '/system/audit-review');
      const KIND = { void: 'إلغاء/حذف/عكس', approve: 'اعتماد/ترحيل/إقفال' };
      out.innerHTML = '<div class="cards">' + '<div class="stat"><div class="muted">عمليات حساسة في السجل</div><b>' + r.scanned + '</b></div>' +
        '<div class="stat"><div class="muted">' + (r.flagged.length ? 'حالات تحتاج مراجعة' : 'النتيجة') + '</div><b>' + (r.flagged.length ? r.flagged.length : 'لا شيء يستدعي القلق') + '</b></div></div>' +
        '<p class="muted">' + esc(r.caveat) + '</p>' +
        (r.flagged.length ? '<table><thead><tr><th>الوقت</th><th>المستخدم</th><th>الدور الحالي</th><th>نوع الإجراء</th><th>العملية</th><th>ملاحظة</th></tr></thead><tbody>' +
          r.flagged.map((x) => '<tr><td>' + esc(x.at) + '</td><td>' + esc(x.username) + '</td><td>' + esc(x.roleName || '—') + '</td><td>' + KIND[x.kind] + '</td><td dir="ltr" style="text-align:right">' + esc(x.action) + '</td><td class="muted">' + esc(x.note || '') + '</td></tr>').join('') +
          '</tbody></table>' : '<div class="msg good">لا عمليات حساسة سُجِّلت بحساب لا يملك دوره الحالي صلاحيتها.</div>');
    } catch (e) { out.innerHTML = E.err(e.message); }
  };

  E.pages.adminBackup = async function (el) {
    el.innerHTML = E.head('النسخ الاحتياطي والاستعادة', 'كل بيانات النظام ومستخدمي الواجهة في مخطط واحد (erp_owner) يُنسخ بأداة Data Pump من Oracle') +
      '<div class="card"><h3>نسخة احتياطية</h3><ol><li>من قائمة ابدأ ← ERP ← <b>ERP Backup now</b>.</li><li>تُحفظ النسخة في <span dir="ltr">المستندات\\ERP-Backups</span> باسم <span dir="ltr">erp_التاريخ-الوقت.dmp</span> ويفتح المجلد (آخر 30 نسخة).</li>' +
      '<li>انسخ الملف إلى قرص خارجي أو سحابة؛ النسخة على الجهاز نفسه لا تحميك من تلف الجهاز.</li></ol></div>' +
      '<div class="card"><h3>نسخة يومية تلقائية</h3><p>قائمة ابدأ ← ERP ← <b>ERP Daily backup (on-off)</b> ثم اكتب <span dir="ltr">on</span>: تُجدول نسخة كل يوم 23:30 (يلزم أن يكون Docker Desktop شغالاً في ذلك الوقت).</p></div>' +
      '<div class="card"><h3>استعادة</h3><ol><li>قائمة ابدأ ← ERP ← <b>ERP Restore backup</b> واختر ملف النسخة.</li><li class="bad">تُحذف كل البيانات الحالية وتُستبدل بالنسخة، ويُطلب منك كتابة RESTORE للتأكيد.</li><li>قبل الحذف تُؤخذ نسخة أمان تلقائية في مجلد <span dir="ltr">before-restore</span> بجوار الملف.</li></ol></div>' +
      '<p class="muted">بياناتك محفوظة في وحدة تخزين Docker باسم erp-oracle-data؛ لا تحذفها من Docker Desktop (Volumes) ولا تستخدم «Reset to factory defaults».</p>';
  };

  // ---------- المستخدمون ----------
  E.pages.adminUsers = async function (el) {
    const [{ users, root }, { roles }] = await Promise.all([api('GET', '/users'), api('GET', '/roles')]);
    el.innerHTML = E.head('المستخدمون', 'المدير الأساسي: ' + root + ' (من ملف الإعدادات، لا يظهر في القائمة)') +
      '<div class="card"><h3>مستخدم جديد</h3><form id="f" class="row"><label>اسم المستخدم (إنجليزي)<input name="u" required maxlength="40" size="14" dir="ltr" autocomplete="off"></label>' +
      '<label>الاسم الكامل<input name="n" maxlength="120" size="20"></label><label>الدور<select name="r">' + roles.map((r) => '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>').join('') + '</select></label>' +
      '<label>كلمة السر (8 أحرف فأكثر)<input name="p" type="password" required minlength="8" size="16" autocomplete="new-password"></label><button class="btn">إضافة</button></form></div>' +
      (users.length ? '<table><thead><tr><th>المستخدم</th><th>الاسم</th><th>الدور</th><th>آخر دخول</th><th>الحالة</th><th class="noprint"></th></tr></thead><tbody>' +
        users.map((u) => '<tr><td dir="ltr" style="text-align:right">' + esc(u.username) + '</td><td>' + esc(u.fullName || '') + '</td><td><select data-act-change="role" data-id="' + u.id + '">' +
          roles.map((r) => '<option value="' + esc(r.id) + '"' + (r.id === u.role ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></td><td>' + esc(u.lastLogin || '—') + '</td><td>' +
          (u.active === 'Y' ? '<span class="tag good">فعّال</span>' : '<span class="tag bad">معطَّل</span>') + '</td><td class="noprint"><button class="btn alt sm" data-act="toggle" data-id="' + u.id + '" data-active="' + u.active + '">' +
          (u.active === 'Y' ? 'تعطيل' : 'تفعيل') + '</button> <button class="btn alt sm" data-act="pw" data-id="' + u.id + '" data-u="' + esc(u.username) + '">كلمة سر جديدة</button></td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا مستخدمون بعد؛ يعمل المدير الأساسي وحده</div>');
    E.$('#f', el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try { await api('POST', '/users', { username: f.get('u').trim(), fullName: f.get('n').trim(), roleId: f.get('r'), password: f.get('p') }); E.toast('أُضيف المستخدم'); E.pages.adminUsers(el); }
      catch (e) { E.toast(e.message, true); }
    });
    el.addEventListener('change', async (ev) => {
      const s = ev.target.closest('[data-act-change=role]'); if (!s) return;
      try { await api('PATCH', '/users/' + s.dataset.id, { roleId: s.value }); E.toast('تغيّر الدور'); } catch (e) { E.toast(e.message, true); E.pages.adminUsers(el); }
    });
    E.bind(el, {
      toggle: async (b) => { await api('PATCH', '/users/' + b.dataset.id, { active: b.dataset.active !== 'Y' }); E.toast('تم التحديث'); E.pages.adminUsers(el); },
      pw: async (b) => { const p = prompt('كلمة السر الجديدة للمستخدم ' + b.dataset.u + ' (8 أحرف فأكثر)'); if (p) { await api('POST', '/users/' + b.dataset.id + '/password', { password: p }); E.toast('غُيّرت كلمة السر وسقطت جلساته'); } },
    });
  };

  // ---------- الأدوار والصلاحيات ----------
  const LVS = { n: '—', r: 'قراءة', w: 'كتابة' };
  E.pages.adminRoles = async function (el) {
    const [{ roles }, { modules, actions }] = await Promise.all([api('GET', '/roles'), api('GET', '/meta/modules')]);
    const cell = (r, m) => r.id === 'admin' ? '<td><span class="tag good">كتابة</span></td>' :
      '<td><select data-role="' + esc(r.id) + '" data-mod="' + m.key + '">' + ['n', 'r', 'w'].map((l) => '<option value="' + l + '"' + (r.perms[m.key] === l ? ' selected' : '') + '>' + LVS[l] + '</option>').join('') + '</select></td>';
    const flag = (r, a) => r.id === 'admin' ? '<td><span class="tag good">مسموح</span></td>' :
      '<td><label class="chk"><input type="checkbox" data-role="' + esc(r.id) + '" data-flag="' + a.key + '"' + (r.perms[a.key] === 'y' ? ' checked' : '') + '> مسموح</label></td>';
    el.innerHTML = E.head('الأدوار والصلاحيات', 'لكل مستخدم دور واحد. مستوى كل وحدة: لا شيء / قراءة / كتابة. والإجراءات الحساسة (الإلغاء والحذف، والاعتماد والإقفال) علمان مستقلان لا يكفي لهما مستوى الكتابة') +
      '<div style="overflow-x:auto"><table class="matrix"><thead><tr><th>الوحدة</th>' + roles.map((r) => '<th data-col="' + esc(r.id) + '">' + esc(r.name) + '<div class="muted" style="font-weight:400">' + r.users + ' مستخدم' + (r.builtin === 'Y' ? ' · جاهز' : '') + '</div>' +
        (r.id === 'admin' ? '' : '<select class="preset noprint" data-preset="' + esc(r.id) + '"><option value="">قالب سريع…</option><option value="n">لا شيء</option><option value="r">قراءة للكل</option><option value="w">كتابة للكل</option></select>') + '</th>').join('') + '</tr></thead><tbody>' +
      modules.map((m) => '<tr><td>' + esc(m.label) + '</td>' + roles.map((r) => cell(r, m)).join('') + '</tr>').join('') +
      '<tr class="head"><td colspan="' + (roles.length + 1) + '">الإجراءات الحساسة</td></tr>' +
      actions.map((a) => '<tr><td>' + esc(a.label) + '</td>' + roles.map((r) => flag(r, a)).join('') + '</tr>').join('') +
      '</tbody><tfoot><tr><td>إجراء</td>' + roles.map((r) => '<td class="noprint">' + (r.id === 'admin' ? '<button class="btn alt sm" data-act="clone" data-id="admin">نسخ</button>' :
        '<button class="btn sm" data-act="save" data-id="' + esc(r.id) + '">حفظ</button> <button class="btn alt sm" data-act="clone" data-id="' + esc(r.id) + '">نسخ</button> <button class="btn alt sm" data-act="rename" data-id="' + esc(r.id) + '" data-n="' + esc(r.name) + '">تسمية</button>' +
        (r.builtin === 'Y' ? '' : ' <button class="btn danger sm" data-act="del" data-id="' + esc(r.id) + '">حذف</button>')) + '</td>').join('') + '</tr></tfoot></table></div>' +
      '<div class="card" style="margin-top:14px"><h3>دور جديد</h3><form id="f" class="row"><label>الرمز (إنجليزي)<input name="i" required maxlength="30" size="14" dir="ltr"></label><label>الاسم<input name="n" required maxlength="80" size="22"></label><button class="btn">إنشاء دور فارغ</button></form>' +
      '<p class="muted">الدور الجديد يبدأ بلا أي صلاحية وبلا الإجراءات الحساسة. لإنشاء دور مشابه لدور قائم استخدم «نسخ» تحت عموده.</p></div>' +
      '<div class="card"><h3>ما الذي تغطيه الصلاحيات</h3><ul><li>المستوى على الوحدة كاملة: «التجارة» تشمل العملاء والموردين والفواتير والسندات والإشعارات. «قراءة» تُخفي أدوات الإضافة والتعديل.</li>' +
      '<li><b>الإلغاء والحذف:</b> إلغاء الفواتير والسندات والإشعارات، وعكس القيود، وحذف البيانات الأساسية، وإلغاء الاستلام والكشوف.</li>' +
      '<li><b>الاعتماد والإقفال:</b> اعتماد أوامر الشراء، وترحيل الرواتب وصرفها، وإقفال الأشهر والسنوات وإعادة فتحها، وتشغيل الإهلاك.</li>' +
      '<li>المستخدمون والأدوار وسجل العمليات والنسخ الاحتياطي لمدير النظام وحده. والصلاحية تسري خلال ثوانٍ دون إعادة دخول.</li></ul></div>';
    const mark = (id) => { const th = E.$('th[data-col="' + id + '"]', el); if (th) th.classList.add('dirty'); };
    el.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.preset !== undefined) {
        const v = t.value; if (!v) return;
        E.$$('select[data-role="' + t.dataset.preset + '"]', el).forEach((s) => { s.value = v; }); mark(t.dataset.preset); t.value = ''; return;
      }
      if (t.dataset.role) mark(t.dataset.role);
    });
    E.$('#f', el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try { await api('POST', '/roles', { id: f.get('i').trim(), name: f.get('n').trim(), perms: { _void: 'n', _approve: 'n' } }); E.toast('أُنشئ الدور'); E.pages.adminRoles(el); } catch (e) { E.toast(e.message, true); }
    });
    E.bind(el, {
      save: async (b) => {
        const perms = {}; E.$$('select[data-role="' + b.dataset.id + '"][data-mod]', el).forEach((s) => { perms[s.dataset.mod] = s.value; });
        E.$$('input[data-role="' + b.dataset.id + '"][data-flag]', el).forEach((c) => { perms[c.dataset.flag] = c.checked ? 'y' : 'n'; });
        await api('PATCH', '/roles/' + b.dataset.id, { perms }); E.toast('حُفظت الصلاحيات (تسري خلال ثوانٍ)');
        const th = E.$('th[data-col="' + b.dataset.id + '"]', el); if (th) th.classList.remove('dirty');
      },
      clone: async (b) => {
        const v = await E.dialog('نسخ الدور', [{ name: 'i', label: 'رمز الدور الجديد (إنجليزي)', value: '', max: 30 }, { name: 'n', label: 'اسم الدور الجديد', value: '', max: 80 }], 'نسخ');
        if (!v) return;
        await api('POST', '/roles/' + b.dataset.id + '/clone', { id: v.i.trim(), name: v.n.trim() }); E.toast('نُسخ الدور'); E.pages.adminRoles(el);
      },
      rename: async (b) => {
        const v = await E.dialog('تسمية الدور', [{ name: 'n', label: 'الاسم', value: b.dataset.n, max: 80 }]);
        if (!v || !v.n.trim()) return;
        await api('PATCH', '/roles/' + b.dataset.id, { name: v.n.trim() }); E.toast('تغيّر الاسم'); E.pages.adminRoles(el);
      },
      del: async (b) => { if (confirm('حذف الدور؟')) { await api('DELETE', '/roles/' + b.dataset.id); E.toast('حُذف الدور'); E.pages.adminRoles(el); } },
    });
  };

  // ---------- مصفوفة صلاحيات المستخدمين الفعلية ----------
  E.pages.adminAccess = async function (el) {
    const [{ users, root }, { roles }, { modules, actions }] = await Promise.all([api('GET', '/users'), api('GET', '/roles'), api('GET', '/meta/modules')]);
    const byRole = Object.fromEntries(roles.map((r) => [r.id, r]));
    const lv = (r, k) => (r.id === 'admin' ? 'w' : r.perms[k]);
    const tag = (l) => '<span class="tag ' + (l === 'w' ? 'good' : l === 'r' ? '' : 'bad') + '">' + LVS[l] + '</span>';
    const yes = (r, k) => (r.id === 'admin' || r.perms[k] === 'y' ? '<span class="tag good">نعم</span>' : '<span class="tag bad">لا</span>');
    const all = [{ username: root, fullName: 'المدير الأساسي', role: 'admin', active: 'Y' }].concat(users);
    el.innerHTML = E.head('صلاحيات المستخدمين الفعلية', 'ما يستطيعه كل مستخدم الآن بحسب دوره: مستوى كل وحدة والإجراءات الحساسة. للتدقيق والمراجعة الدورية') +
      '<table><thead><tr><th>المستخدم</th><th>الدور</th><th>الحالة</th>' + modules.map((m) => '<th>' + esc(m.label.split(' (')[0]) + '</th>').join('') + actions.map((a) => '<th>' + esc(a.label) + '</th>').join('') + '</tr></thead><tbody>' +
      all.map((u) => { const r = byRole[u.role]; return '<tr><td dir="ltr" style="text-align:right">' + esc(u.username) + (u.fullName ? '<div class="muted" dir="rtl">' + esc(u.fullName) + '</div>' : '') + '</td><td>' + esc(r ? r.name : u.role) + '</td><td>' + (u.active === 'Y' ? 'فعّال' : '<span class="tag bad">معطَّل</span>') + '</td>' +
        modules.map((m) => '<td>' + (r ? tag(lv(r, m.key)) : '') + '</td>').join('') + actions.map((a) => '<td>' + (r ? yes(r, a.key) : '') + '</td>').join('') + '</tr>'; }).join('') + '</tbody></table>';
  };

  // ---------- سجل العمليات ----------
  E.pages.adminAudit = async function (el) {
    const { users } = await api('GET', '/users');
    el.innerHTML = E.head('سجل العمليات', 'كل عملية تعديل (إضافة/ترحيل/إلغاء…) ومحاولات الدخول؛ بلا محتوى الطلبات') +
      '<form id="f" class="row noprint"><label>المستخدم<select name="u"><option value="">الكل</option>' + users.map((u) => '<option>' + esc(u.username) + '</option>').join('') + '</select></label><button class="btn">عرض</button></form><div id="out"></div>';
    async function go() {
      const { rows } = await api('GET', '/audit?' + E.qs({ user: new FormData(E.$('#f', el)).get('u'), limit: 300 }));
      E.$('#out', el).innerHTML = rows.length ? '<table><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>النتيجة</th><th>العنوان</th></tr></thead><tbody>' +
        rows.map((x) => '<tr><td>' + esc(x.at) + '</td><td>' + esc(x.username || '') + '</td><td dir="ltr" style="text-align:right">' + esc(x.action) + '</td><td>' + (x.status < 400 ? '<span class="tag good">' + x.status + '</span>' : '<span class="tag bad">' + x.status + '</span>') + '</td><td dir="ltr">' + esc(x.ip || '') + '</td></tr>').join('') + '</tbody></table>' : '<div class="msg warn">لا سجلات</div>';
    }
    E.$('#f', el).addEventListener('submit', (ev) => { ev.preventDefault(); go().catch((e) => E.toast(e.message, true)); });
    await go();
  };

  // ---------- كلمة سري ----------
  E.pages.myPassword = async function (el) {
    el.innerHTML = E.head('كلمة سري', E.me.fullName || E.me.user) +
      (E.me.user && !E.me.builtinHint ? '' : '') + '<div class="card"><form id="f" class="row"><label>الحالية<input name="c" type="password" required autocomplete="current-password"></label>' +
      '<label>الجديدة (8 أحرف فأكثر)<input name="p" type="password" required minlength="8" autocomplete="new-password"></label><label>تأكيد الجديدة<input name="q" type="password" required minlength="8" autocomplete="new-password"></label><button class="btn">تغيير</button></form>' +
      '<p class="muted">المدير الأساسي يغيّر كلمة سره من ملف الإعدادات أو اختصار «ERP Password» في قائمة ابدأ. بعد التغيير تحتاج تسجيل الدخول من جديد.</p></div>';
    E.$('#f', el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      if (f.get('p') !== f.get('q')) { E.toast('تأكيد كلمة السر لا يطابقها', true); return; }
      try { await api('POST', '/account/password', { current: f.get('c'), password: f.get('p') }); E.toast('غُيّرت كلمة السر؛ سجّل الدخول من جديد'); setTimeout(() => location.reload(), 1200); }
      catch (e) { E.toast(e.message, true); }
    });
  };
})(window.ERP);
