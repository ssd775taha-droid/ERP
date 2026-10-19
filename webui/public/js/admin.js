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
      card('settings/password', 'كلمة سري', 'تغيير كلمة السر الخاصة بك', true) + '</div>' +
      '<div class="card"><h3>ملاحظات</h3><ul><li>المدير الأساسي (من ملف الإعدادات) لا يُعطَّل ولا تُغيَّر صلاحياته؛ استخدمه للطوارئ وأنشئ لنفسك مستخدماً بدور «مدير النظام» للعمل اليومي.</li>' +
      '<li>الصلاحيات تُفرض في الخادم على كل طلب، وإخفاء القوائم للراحة فقط.</li>' +
      '<li class="bad">كل المستخدمين يعملون على قاعدة البيانات بحساب Oracle واحد (erp_owner)، وحقل «أنشأه» داخل القاعدة يظهر هذا الحساب. اسم المستخدم الحقيقي يُسجَّل في «سجل العمليات» فقط.</li></ul></div>';
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
  E.pages.adminRoles = async function (el) {
    const [{ roles }, { modules }] = await Promise.all([api('GET', '/roles'), api('GET', '/meta/modules')]);
    const sel = (r, m) => r.id === 'admin' ? '<td><span class="tag good">كتابة</span></td>' :
      '<td><select data-role="' + esc(r.id) + '" data-mod="' + m.key + '">' + ['n', 'r', 'w'].map((l) => '<option value="' + l + '"' + (r.perms[m.key] === l ? ' selected' : '') + '>' + LV[l] + '</option>').join('') + '</select></td>';
    el.innerHTML = E.head('الأدوار والصلاحيات', 'كل مستخدم له دور واحد. اضبط مستوى كل دور على كل وحدة ثم احفظ العمود') +
      '<div style="overflow-x:auto"><table><thead><tr><th>الوحدة</th>' + roles.map((r) => '<th>' + esc(r.name) + '<div class="muted" style="font-weight:400">' + r.users + ' مستخدم' + (r.builtin === 'Y' ? '' : ' · مخصص') + '</div></th>').join('') + '</tr></thead><tbody>' +
      modules.map((m) => '<tr><td>' + esc(m.label) + '</td>' + roles.map((r) => sel(r, m)).join('') + '</tr>').join('') +
      '</tbody><tfoot><tr><td>إجراء</td>' + roles.map((r) => '<td>' + (r.id === 'admin' ? '' : '<button class="btn sm" data-act="save" data-id="' + esc(r.id) + '">حفظ</button>' +
        (r.builtin === 'Y' ? '' : ' <button class="btn danger sm" data-act="del" data-id="' + esc(r.id) + '">حذف</button>')) + '</td>').join('') + '</tr></tfoot></table></div>' +
      '<div class="card" style="margin-top:14px"><h3>دور جديد</h3><form id="f" class="row"><label>الرمز (إنجليزي)<input name="i" required maxlength="30" size="14" dir="ltr"></label><label>الاسم<input name="n" required maxlength="80" size="20"></label><button class="btn">إنشاء (بلا صلاحيات ثم عدّلها)</button></form>' +
      '<p class="muted">مدير النظام يملك كل شيء بما فيه المستخدمون وسجل العمليات، ودوره ثابت. الأدوار الجاهزة قابلة لتعديل صلاحياتها لا لحذفها.</p></div>' +
      '<div class="card"><h3>حدود الصلاحيات</h3><ul><li>المستوى على مستوى الوحدة كاملة: «التجارة» تشمل العملاء والموردين وفواتير البيع والشراء وسنداتها معاً.</li><li>دليل الحسابات والأصناف والمخازن وإعدادات الضريبة تُقرأ لكل مستخدم لتعبئة القوائم.</li></ul></div>';
    E.$('#f', el).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try { await api('POST', '/roles', { id: f.get('i').trim(), name: f.get('n').trim(), perms: {} }); E.toast('أُنشئ الدور'); E.pages.adminRoles(el); } catch (e) { E.toast(e.message, true); }
    });
    E.bind(el, {
      save: async (b) => {
        const perms = {}; E.$$('select[data-role="' + b.dataset.id + '"]', el).forEach((s) => { perms[s.dataset.mod] = s.value; });
        await api('PATCH', '/roles/' + b.dataset.id, { perms }); E.toast('حُفظت الصلاحيات (تسري خلال ثوانٍ)');
      },
      del: async (b) => { if (confirm('حذف الدور؟')) { await api('DELETE', '/roles/' + b.dataset.id); E.toast('حُذف الدور'); E.pages.adminRoles(el); } },
    });
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
