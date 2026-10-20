'use strict';
(function (E) {
  const { esc, api } = E;

  // قارئ CSV بسيط: يدعم الاقتباس والفاصلة والفاصلة المنقوطة والتبويب ويتجاهل BOM
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
      else cur += c;
    }
    row.push(cur); if (row.some((x) => x.trim() !== '')) rows.push(row);
    return rows;
  }

  const ENT = {
    customers: { label: 'العملاء', perm: ['trade', 'w'], api: '/import/parties', extra: { kind: 'CUSTOMER' },
      cols: { name: ['name', 'الاسم', 'اسم', 'اسم العميل'], phone: ['phone', 'mobile', 'الهاتف', 'جوال', 'الجوال'], taxNo: ['taxno', 'tax', 'vat', 'الرقم الضريبي', 'الرقم_الضريبي'] },
      sample: 'الاسم,الهاتف,الرقم الضريبي\nشركة النور,0500000000,310122393500003\nمؤسسة الأمل,0555555555,' },
    suppliers: { label: 'الموردون', perm: ['trade', 'w'], api: '/import/parties', extra: { kind: 'SUPPLIER' },
      cols: { name: ['name', 'الاسم', 'اسم', 'اسم المورد'], phone: ['phone', 'mobile', 'الهاتف', 'جوال', 'الجوال'], taxNo: ['taxno', 'tax', 'vat', 'الرقم الضريبي', 'الرقم_الضريبي'] },
      sample: 'الاسم,الهاتف,الرقم الضريبي\nمورد الخليج,0111111111,\nمؤسسة التوريد,0522222222,310122393500003' },
    items: { label: 'الأصناف', perm: ['inventory', 'w'], api: '/import/items', extra: {},
      cols: { code: ['code', 'الرمز', 'رمز', 'كود'], name: ['name', 'الاسم', 'اسم', 'اسم الصنف'], unit: ['unit', 'الوحدة'], price: ['price', 'سعر البيع', 'السعر'], vat: ['vat', 'الضريبة', 'ضريبة', 'ضريبة %'], barcode: ['barcode', 'الباركود'], trackStock: ['trackstock', 'track', 'مخزني', 'مخزني؟'] },
      sample: 'الرمز,الاسم,الوحدة,سعر البيع,ضريبة %,الباركود,مخزني؟\nA100,قلم حبر,قطعة,3.5,15,6281000000001,نعم\nS200,خدمة صيانة,ساعة,150,15,,لا' },
  };

  E.pages.importData = function (el) {
    const avail = Object.entries(ENT).filter(([, e]) => E.can(e.perm[0], e.perm[1]));
    if (!avail.length) { el.innerHTML = E.head('استيراد البيانات') + '<div class="msg warn">لا تملك صلاحية الكتابة على العملاء أو الأصناف.</div>'; return; }
    el.innerHTML = E.head('استيراد البيانات من CSV', 'ارفع ملف CSV (يمكن حفظ Excel بصيغة CSV UTF-8). يُتحقق من كل صف أولاً، ولا يُحفظ شيء قبل ضغط «استيراد»') +
      '<div class="card"><div class="row"><label>ماذا تستورد؟<select id="ent">' + avail.map(([k, e]) => '<option value="' + k + '">' + e.label + '</option>').join('') + '</select></label>' +
      '<label>ملف CSV<input type="file" id="file" accept=".csv,text/csv,.txt"></label><button type="button" class="btn alt" id="sample">تنزيل نموذج</button></div>' +
      '<p class="muted" id="hint"></p></div><div id="out"></div>';
    const out = E.$('#out', el); let rows = [], map = [];
    const ent = () => ENT[E.$('#ent', el).value];
    const hint = () => { E.$('#hint', el).innerHTML = 'الأعمدة المقبولة (يكفي أحد أسماء كل عمود، عربياً أو إنجليزياً): ' + Object.entries(ent().cols).map(([k, v]) => '<b>' + esc(v[1] || v[0]) + '</b>').join('، ') + '. الأول (الاسم/الرمز) مطلوب.'; };
    hint(); E.$('#ent', el).addEventListener('change', () => { hint(); out.innerHTML = ''; rows = []; });
    E.$('#sample', el).addEventListener('click', () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + ent().sample], { type: 'text/csv;charset=utf-8' })); a.download = 'erp_import_' + E.$('#ent', el).value + '.csv';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    function build(table) {
      const head = table[0].map((h) => E.norm(h)), cols = ent().cols;
      map = Object.keys(cols).map((k) => ({ key: k, idx: head.findIndex((h) => cols[k].some((a) => E.norm(a) === h)) }));
      const required = Object.keys(cols)[0] === 'code' ? ['code', 'name'] : ['name'];
      const missing = required.filter((k) => map.find((m) => m.key === k).idx < 0);
      if (missing.length) { out.innerHTML = E.err('لم أجد عمود: ' + missing.map((k) => cols[k][1] || cols[k][0]).join('، ') + '. تحقق من سطر العناوين في الملف.'); rows = []; return; }
      rows = table.slice(1).map((r) => Object.fromEntries(map.filter((m) => m.idx >= 0).map((m) => [m.key, (r[m.idx] || '').trim()])));
      show(null);
    }
    function show(res) {
      const keys = map.filter((m) => m.idx >= 0).map((m) => m.key), names = { name: 'الاسم', phone: 'الهاتف', taxNo: 'الرقم الضريبي', code: 'الرمز', unit: 'الوحدة', price: 'السعر', vat: 'الضريبة', barcode: 'الباركود', trackStock: 'مخزني' };
      const sum = res ? '<div class="msg ' + (res.failed ? 'warn' : 'good') + '">' + (res.dryRun ? 'نتيجة الفحص: ' : 'تم الاستيراد: ') + res.ok + ' صف صحيح' + (res.failed ? '، ' + res.failed + ' فيه أخطاء' : '') + ' من ' + res.total + (res.dryRun ? ' — لم يُحفظ شيء بعد' : '') + '</div>' : '<div class="msg">' + rows.length + ' صف جاهز. اضغط «فحص» للتحقق قبل الاستيراد.</div>';
      out.innerHTML = sum + '<p class="noprint"><button type="button" class="btn alt" id="chk">فحص (دون حفظ)</button> <button type="button" class="btn" id="go"' + (res && !res.dryRun ? ' disabled' : '') + '>استيراد</button></p>' +
        '<table><thead><tr><th>#</th>' + keys.map((k) => '<th>' + names[k] + '</th>').join('') + '<th>الحالة</th></tr></thead><tbody>' +
        rows.slice(0, 300).map((r, i) => { const x = res && res.results[i]; return '<tr><td>' + (i + 1) + '</td>' + keys.map((k) => '<td>' + esc(r[k]) + '</td>').join('') + '<td>' + (x ? (x.ok ? '<span class="tag good">' + (res.dryRun ? 'صالح' : 'تمّ') + '</span>' : '<span class="tag bad">' + esc(x.error) + '</span>') : '') + '</td></tr>'; }).join('') + '</tbody></table>' +
        (rows.length > 300 ? '<p class="muted">يُعرض أول 300 صف فقط، والكل يُستورد.</p>' : '');
      E.$('#chk', el).addEventListener('click', () => submit(true)); E.$('#go', el).addEventListener('click', () => submit(false));
    }
    async function submit(dry) {
      if (!dry && !confirm('استيراد ' + rows.length + ' صفاً؟ تُحفظ الصحيحة فقط.')) return;
      try { show(await api('POST', ent().api, { ...ent().extra, rows, dryRun: dry })); if (!dry) E.toast('تم الاستيراد'); } catch (e) { E.toast(e.message, true); }
    }
    E.$('#file', el).addEventListener('change', async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      if (f.size > 3e6) { E.toast('الملف كبير (الحد 3 ميغابايت)', true); return; }
      const table = parseCsv(await f.text());
      if (table.length < 2) { out.innerHTML = E.err('الملف فارغ أو بلا صفوف'); return; }
      build(table);
    });
  };
})(window.ERP);
