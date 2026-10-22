'use strict';
(function (E) {
  const { esc, api } = E;

  // نافذة إدخال: fields = [{ name, label, value, type?, options?, size?, hint? }] وتعيد القيم أو null عند الإلغاء
  E.dialog = (title, fields, okLabel) => new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = '<form method="dialog"><h3>' + esc(title) + '</h3>' + fields.map((f) => '<label class="dlg-f">' + esc(f.label) +
      (f.options ? '<select name="' + f.name + '">' + f.options.map((o) => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(f.value == null ? '' : f.value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>'
        : '<input name="' + f.name + '" value="' + esc(f.value == null ? '' : f.value) + '" ' + (f.type ? 'type="' + f.type + '" ' : '') + (f.inputmode ? 'inputmode="' + f.inputmode + '" ' : '') + 'maxlength="' + (f.max || 200) + '">') +
      (f.hint ? '<small class="muted">' + esc(f.hint) + '</small>' : '') + '</label>').join('') +
      '<div class="row" style="margin-top:12px"><button class="btn" value="ok">' + esc(okLabel || 'حفظ') + '</button> <button type="button" class="btn alt" data-x="cancel">إلغاء</button></div></form>';
    document.body.appendChild(d);
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.addEventListener('cancel', () => done(null));
    E.$('[data-x=cancel]', d).addEventListener('click', () => done(null));
    E.$('form', d).addEventListener('submit', (ev) => {
      ev.preventDefault();
      done(Object.fromEntries(new FormData(ev.target)));
    });
    d.showModal();
    const first = E.$('input,select', d); if (first) first.focus();
  });

  // ما يُعدَّل ويُحذف لكل نوع. patch: الدالة التي تبني الجسم من قيم النافذة، del: مسار الحذف أو إلغاء السند
  const CFG = {
    party: { label: 'الطرف', path: (r) => '/parties/' + r.id, fields: (r) => [{ name: 'name', label: 'الاسم', value: r.name, max: 120 }, { name: 'phone', label: 'الهاتف', value: r.phone, max: 40 }, { name: 'taxNo', label: 'الرقم الضريبي (15 رقماً)', value: r.taxNo, max: 40 }] },
    account: { label: 'الحساب', path: (r) => '/accounts/' + encodeURIComponent(r.id), fields: (r) => [{ name: 'name', label: 'اسم الحساب', value: r.name, max: 120 }], noDelHint: 'عطّله بدلاً من حذفه' },
    item: { label: 'الصنف', path: (r) => '/inventory/items/' + r.id, fields: (r) => [{ name: 'name', label: 'الاسم', value: r.name, max: 120 }, { name: 'price', label: 'سعر البيع', value: r.price, inputmode: 'decimal' }, { name: 'vat', label: 'ضريبة %', value: r.vat, inputmode: 'decimal' }] },
    warehouse: { label: 'المخزن', method: 'PUT', path: (r) => '/inventory/warehouses/' + r.id, fields: (r) => [{ name: 'name', label: 'اسم المخزن', value: r.name, max: 120 }] },
    costcenter: { label: 'مركز التكلفة', path: (r) => '/cost-centers/' + r.id, fields: (r) => [{ name: 'name', label: 'اسم المركز', value: r.name, max: 120 }] },
    dept: { label: 'القسم', path: (r) => '/hr/departments/' + r.id, fields: (r) => [{ name: 'name', label: 'اسم القسم', value: r.name, max: 120 }] },
    employee: { label: 'الموظف', path: (r) => '/hr/employees/' + r.id, noDel: true, fields: (r) => [{ name: 'name', label: 'الاسم', value: r.name, max: 120 }, { name: 'jobTitle', label: 'الوظيفة', value: r.jobTitle, max: 80 }, { name: 'nationalId', label: 'رقم الهوية', value: r.nationalId, max: 30 }, { name: 'bankAccount', label: 'الحساب البنكي', value: r.bankAccount, max: 60 }, ...(r.depts ? [{ name: 'deptId', label: 'القسم', value: r.deptId, options: [['', '—']].concat(r.depts) }] : [])] },
    component: { label: 'المكوّن', path: (r) => '/hr/components/' + r.id, fields: (r) => [{ name: 'name', label: 'الاسم', value: r.name, max: 120 }, { name: 'pct', label: 'النسبة % (للنسبي)', value: r.pct, inputmode: 'decimal' }] },
    category: { label: 'الفئة', path: (r) => '/assets/categories/' + r.id, fields: (r) => [{ name: 'name', label: 'اسم الفئة', value: r.name, max: 120 }] },
    register: { label: 'النقطة', path: (r) => '/pos/registers/' + r.id, fields: (r) => [{ name: 'name', label: 'اسم النقطة', value: r.name, max: 120 }] },
    payment: { label: 'السند', noEdit: true, voidPath: (r) => '/payments/' + r.id + '/void' },
  };

  // أزرار الصف: E.crudBtns('party', { id, name, … }) — البيانات تُخزَّن في الزر نفسه
  E.crudBtns = (kind, rec) => {
    const c = CFG[kind], d = ' data-k="' + kind + '" data-rec="' + esc(JSON.stringify(rec)) + '"';
    return (c.noEdit ? '' : '<button class="btn alt sm" data-act="c-edit"' + d + '>تعديل</button> ') +
      (c.noDel ? '' : '<button class="btn danger sm" data-act="c-del"' + d + '>' + (c.voidPath ? 'إلغاء السند' : 'حذف') + '</button>');
  };

  // يربط أزرار التعديل والحذف داخل عنصر الصفحة مرة واحدة؛ reload يعيد رسم الصفحة بعد النجاح
  E.crudBind = (el, reload) => {
    el._crudReload = reload;
    if (el._crudBound) return;
    el._crudBound = true;
    E.bind(el, {
      'c-edit': async (b) => {
        const c = CFG[b.dataset.k], rec = JSON.parse(b.dataset.rec);
        const vals = await E.dialog('تعديل ' + c.label, c.fields(rec));
        if (!vals) return;
        const body = {};
        for (const [k, v] of Object.entries(vals)) body[k] = typeof v === 'string' ? v.trim().replace(/,/g, k === 'price' || k === 'vat' || k === 'pct' ? '' : ',') : v;
        await api(c.method || 'PATCH', c.path(rec), body);
        E.toast('تم التعديل'); await el._crudReload();
      },
      'c-del': async (b) => {
        const c = CFG[b.dataset.k], rec = JSON.parse(b.dataset.rec);
        const what = rec.name || rec.no || rec.id;
        if (c.voidPath) {
          if (!confirm('إلغاء ' + c.label + ' ' + what + '؟ يُعكس قيده المحاسبي ويُنقص المدفوع من فاتورته.')) return;
          await api('POST', c.voidPath(rec));
          E.toast('أُلغي السند'); await el._crudReload(); return;
        }
        if (!confirm('حذف ' + c.label + ' «' + what + '» نهائياً؟ لا يُحذف ما استُخدم في أي عملية.')) return;
        try { await api('DELETE', c.path(rec)); } catch (e) { throw new Error(e.message + (/سجلات مرتبطة/.test(e.message) ? ' — ' + (c.noDelHint || 'استخدم «إيقاف» بدلاً من الحذف') : '')); }
        E.toast('تم الحذف'); await el._crudReload();
      },
    });
  };
})(window.ERP);
