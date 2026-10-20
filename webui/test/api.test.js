// اختبار تكاملي على قاعدة بيانات حقيقية. يُتخطى ما لم يُضبط ERP_DB_PASSWORD (أو webui/.env)،
// وتُتخطى الاختبارات الكاتبة ما لم يُضبط ERP_TEST_WRITE=1 (لأنها ترحّل قيوداً فعلية لا تُحذف).
const test = require('node:test');
const assert = require('node:assert');
const config = require('../server/config');

const cfg = config.load();
const hasDb = !!cfg.dbPassword;
const canWrite = process.env.ERP_TEST_WRITE === '1';

let server, base, cookie = '';
async function call(method, url, body) {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', cookie },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => null) };
}

test.before(async () => {
  if (!hasDb) return;
  await require('../server/db').init(cfg);
  const { createApp } = require('../server/index');
  server = createApp(cfg).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => { if (server) server.close(); try { await require("../server/db").close(); } catch { /* لم يُفتح */ } });

test('الواجهات المحمية ترفض بلا جلسة', { skip: !hasDb }, async () => {
  assert.strictEqual((await call('GET', '/api/accounts')).status, 401);
});
test('كلمة سر خاطئة', { skip: !hasDb }, async () => {
  assert.strictEqual((await call('POST', '/api/login', { username: cfg.webUser, password: 'x-wrong' })).status, 401);
});
test('دخول ثم دليل الحسابات', { skip: !hasDb }, async () => {
  assert.strictEqual((await call('POST', '/api/login', { username: cfg.webUser, password: cfg.webPassword })).status, 200);
  const r = await call('GET', '/api/accounts');
  assert.ok(r.data.accounts.length > 0);
  assert.ok('code' in r.data.accounts[0]);
});
test('ميزان المراجعة متوازن', { skip: !hasDb }, async () => {
  const r = await call('GET', '/api/reports/trial-balance');
  assert.strictEqual(r.data.balanced, true);
});
test('قيد غير متوازن يُرفض برسالة عربية', { skip: !hasDb || !canWrite }, async () => {
  const r = await call('POST', '/api/entries', { date: '2026-01-05', memo: 't', lines: [
    { account: '1100', debit: '10', credit: '0' }, { account: '3100', debit: '0', credit: '9' }] });
  assert.strictEqual(r.status, 400);
  assert.match(r.data.error, /غير متوازن/);
});
test('ترحيل قيد ثم عكسه', { skip: !hasDb || !canWrite }, async () => {
  const r = await call('POST', '/api/entries', { date: '2026-01-05', memo: 'اختبار آلي', lines: [
    { account: '1100', debit: '10', credit: '0' }, { account: '3100', debit: '0', credit: '10' }] });
  assert.strictEqual(r.status, 201);
  const id = r.data.entry.id;
  assert.strictEqual((await call('POST', `/api/entries/${id}/reverse`, {})).status, 201);
  assert.strictEqual((await call('POST', `/api/entries/${id}/reverse`, {})).status, 400);
});

test('عميل وفاتورة مبيعات وسداد جزئي ثم رفض إلغاء الفاتورة', { skip: !hasDb || !canWrite }, async () => {
  const p = await call('POST', '/api/parties', { kind: 'CUSTOMER', name: 'عميل اختبار آلي' });
  assert.strictEqual(p.status, 201);
  const inv = await call('POST', '/api/invoices', { kind: 'SALES', partyId: p.data.id, date: '2026-01-06',
    lines: [{ description: 'خدمة', qty: 2, price: 100, vatRate: 15, account: '4200' }] });
  assert.strictEqual(inv.status, 201);
  assert.strictEqual(inv.data.invoice.total, 230);
  const id = inv.data.invoice.id;
  assert.strictEqual((await call('POST', '/api/payments', { partyId: p.data.id, invoiceId: id, date: '2026-01-07', amount: '100', method: 'CASH' })).status, 201);
  const st = await call('GET', `/api/parties/${p.data.id}/statement`);
  assert.strictEqual(st.data.party.balance, 130);
  const bad = await call('POST', `/api/invoices/${id}/void`, {});
  assert.strictEqual(bad.status, 400);
  assert.match(bad.data.error, /مدفوعات/);
  const over = await call('POST', '/api/payments', { partyId: p.data.id, invoiceId: id, date: '2026-01-07', amount: '500', method: 'CASH' });
  assert.strictEqual(over.status, 400);
});

test('صنف جديد ثم رصيد افتتاحي وتحويل ورفض نقص يتجاوز الرصيد', { skip: !hasDb || !canWrite }, async () => {
  const code = 'T' + Date.now().toString(36).toUpperCase();
  const it = await call('POST', '/api/inventory/items', { code, name: 'صنف اختبار', price: '10' });
  assert.strictEqual(it.status, 201);
  const wh = await call('POST', '/api/inventory/warehouses', { code: 'W' + code.slice(-6), name: 'مخزن اختبار' });
  assert.strictEqual(wh.status, 201);
  const adj = await call('POST', '/api/inventory/adjust', { itemId: it.data.id, whId: 1, date: '2026-01-08', qtyDelta: '4', unitCost: '5', offsetAccount: '3100' });
  assert.strictEqual(adj.status, 201);
  assert.strictEqual((await call('POST', '/api/inventory/transfer', { itemId: it.data.id, fromWh: 1, toWh: wh.data.id, date: '2026-01-08', qty: '1' })).data.value, 5);
  assert.strictEqual((await call('POST', '/api/inventory/adjust', { itemId: it.data.id, whId: 1, date: '2026-01-08', qtyDelta: '-10' })).status, 400);
  assert.strictEqual((await call('GET', '/api/inventory/check')).data.ok, true);
});

test('أصل ثابت: رفض خردة ≥ التكلفة، تسجيل ثم إلغاء، ومطابقة الأستاذ', { skip: !hasDb || !canWrite }, async () => {
  const cats = (await call('GET', '/api/assets/categories')).data.categories;
  const base = { name: 'أصل اختبار', catId: cats[0].id, acqDate: '2026-01-10', cost: '600', offsetAccount: '3100' };
  const code = 'T' + Date.now().toString(36).toUpperCase();
  assert.strictEqual((await call('POST', '/api/assets', { ...base, code, salvage: '600' })).status, 400);
  const a = await call('POST', '/api/assets', { ...base, code, salvage: '0' });
  assert.strictEqual(a.status, 201);
  assert.strictEqual((await call('GET', `/api/assets/${a.data.id}`)).data.asset.cost, 600);
  assert.strictEqual((await call('POST', `/api/assets/${a.data.id}/void`, {})).status, 200);
  assert.strictEqual((await call('GET', '/api/assets/check')).data.ok, true);
});

test('موظف وتسوية وكشف رواتب مسودة ثم إلغاؤه، وبيانات غير صالحة تُرفض', { skip: !hasDb || !canWrite }, async () => {
  const code = 'T' + Date.now().toString(36).toUpperCase();
  assert.strictEqual((await call('POST', '/api/hr/employees', { code, name: 'x', hireDate: '2026-01-01', basic: '0' })).status, 400);
  const e = await call('POST', '/api/hr/employees', { code, name: 'موظف اختبار', hireDate: '2026-01-01', basic: '1000' });
  assert.strictEqual(e.status, 201);
  assert.strictEqual((await call('POST', '/api/hr/adjustments', { empId: e.data.id, period: '2026-12-15', kind: 'EARNING', description: 'x', amount: '5' })).status, 400); // ليس أول الشهر
  const run = await call('POST', '/api/payroll/runs', { period: '2026-12-01' });
  assert.strictEqual(run.status, 201);
  assert.ok(run.data.run.lines.some((l) => l.empCode === code && l.net === 1000));
  assert.strictEqual((await call('POST', '/api/payroll/runs', { period: '2026-12-01' })).status, 400); // كشف فعّال موجود
  assert.strictEqual((await call('POST', `/api/payroll/runs/${run.data.run.id}/cancel`, {})).status, 200);
});

test('نقطة بيع: وردية، بيع بدفعة غير كافية يُرفض، بيع، مرتجع، إقفال بفرق', { skip: !hasDb || !canWrite }, async () => {
  const code = 'P' + Date.now().toString(36).toUpperCase();
  const wh = await call('POST', '/api/inventory/warehouses', { code: code.slice(-12), name: 'مخزن نقطة اختبار' });
  const it = await call('POST', '/api/inventory/items', { code, name: 'صنف نقطة', price: '10', vat: '10' });
  assert.strictEqual((await call('POST', '/api/inventory/adjust', { itemId: it.data.id, whId: wh.data.id, date: '2026-01-09', qtyDelta: '10', unitCost: '4', offsetAccount: '3100' })).status, 201);
  const reg = await call('POST', '/api/pos/registers', { code: code.slice(-12), name: 'نقطة اختبار', whId: wh.data.id });
  assert.strictEqual(reg.status, 201);
  const sh = await call('POST', '/api/pos/shifts/open', { regId: reg.data.id, openingCash: '100' });
  assert.strictEqual(sh.status, 201);
  const lines = [{ itemId: it.data.id, qty: 3 }];
  assert.strictEqual((await call('POST', '/api/pos/sales', { shiftId: sh.data.id, date: '2026-01-09', lines, payments: [{ method: 'CASH', amount: '5' }] })).status, 400);
  const s = await call('POST', '/api/pos/sales', { shiftId: sh.data.id, date: '2026-01-09', lines, payments: [{ method: 'CASH', amount: '40' }] });
  assert.strictEqual(s.status, 201);
  assert.strictEqual(s.data.sale.total, 33);
  assert.strictEqual(s.data.sale.changeDue, 7);
  const ret = await call('POST', `/api/pos/sales/${s.data.sale.id}/return`, { shiftId: sh.data.id, date: '2026-01-09', method: 'CASH', lines: [{ lineId: s.data.sale.lines[0].id, qty: 1 }] });
  assert.strictEqual(ret.status, 201);
  assert.strictEqual(ret.data.sale.total, 11);
  assert.strictEqual((await call('GET', `/api/pos/shifts/${sh.data.id}`)).data.shift.expectedCashNow, 122); // 100 + 33 − 11
  const close = await call('POST', `/api/pos/shifts/${sh.data.id}/close`, { counted: '120' });
  assert.strictEqual(close.data.variance, -2);
  assert.strictEqual((await call('GET', '/api/inventory/check')).data.ok, true);
});

test('أمر شراء: اعتماد واستلام جزئي وفاتورة، ثم إلغاء الاستلام', { skip: !hasDb || !canWrite }, async () => {
  const sup = await call('POST', '/api/parties', { kind: 'SUPPLIER', name: 'مورد اختبار آلي' });
  const po = await call('POST', '/api/po', { partyId: sup.data.id, date: '2026-01-10', lines: [{ description: 'خدمة', qty: 4, price: 25, vatRate: 10, account: '5400' }] });
  assert.strictEqual(po.status, 201);
  assert.strictEqual(po.data.order.total, 110);
  const id = po.data.order.id, lineId = po.data.order.lines[0].id;
  assert.strictEqual((await call('POST', `/api/po/${id}/receive`, { date: '2026-01-11', lines: [{ lineId, qty: 1 }] })).status, 400); // غير معتمد
  assert.strictEqual((await call('POST', `/api/po/${id}/approve`, {})).status, 200);
  assert.strictEqual((await call('POST', `/api/po/${id}/receive`, { date: '2026-01-11', lines: [{ lineId, qty: 5 }] })).status, 400); // يتجاوز المتبقي
  const rc = await call('POST', `/api/po/${id}/receive`, { date: '2026-01-11', ref: 'S-1', lines: [{ lineId, qty: 2 }] });
  assert.strictEqual(rc.status, 201);
  assert.strictEqual(rc.data.order.status, 'PARTIAL');
  assert.strictEqual((await call('POST', `/api/po/receipts/${rc.data.receiptId}/void`, {})).data.order.status, 'APPROVED');
});

test('عرض سعر: إرسال وقبول وتحويل إلى فاتورة ثم إلغاء التحويل', { skip: !hasDb || !canWrite }, async () => {
  const c = await call('POST', '/api/parties', { kind: 'CUSTOMER', name: 'عميل عرض اختبار' });
  const q = await call('POST', '/api/quotes', { partyId: c.data.id, date: '2026-01-12', validUntil: '2099-12-31', lines: [{ description: 'خدمة', qty: 2, price: 100, discountPct: 10, vatRate: 15, account: '4200' }] });
  assert.strictEqual(q.status, 201);
  assert.strictEqual(q.data.quote.total, 207);   // 2 × 90 = 180 + 15%
  const id = q.data.quote.id;
  assert.strictEqual((await call('POST', `/api/quotes/${id}/accept`, {})).status, 400); // لم يُرسل
  assert.strictEqual((await call('POST', `/api/quotes/${id}/send`, {})).status, 200);
  assert.strictEqual((await call('POST', `/api/quotes/${id}/accept`, {})).status, 200);
  const cv = await call('POST', `/api/quotes/${id}/convert`, { date: '2026-01-13' });
  assert.strictEqual(cv.status, 200);
  const inv = await call('GET', `/api/invoices/${cv.data.invoiceId}`);
  assert.strictEqual(inv.data.invoice.total, 207);
  assert.strictEqual((await call('POST', `/api/quotes/${id}/unconvert`, {})).data.quote.status, 'ACCEPTED');
});

test('الضريبة السعودية: رفض رقم ضريبي خاطئ، وإقرار الضريبة يطابق ح/2200', { skip: !hasDb || !canWrite }, async () => {
  const bad = await call('POST', '/api/tax/settings', { vatRate: '15', sellerName: 'x', sellerVatNo: '123' });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await call('POST', '/api/tax/settings', { vatRate: '120' })).status, 400);
  const ok = await call('POST', '/api/tax/settings', { vatRate: '15', sellerName: 'منشأة اختبار', sellerVatNo: '310122393500003' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.vatRate, 15);
  // الإقرار عن كل الفترات يجب أن يساوي رصيد ح/2200 (دائن − مدين) ما لم تُرحَّل قيود يدوية عليه
  const vr = await call('GET', '/api/reports/vat-return?from=2000-01-01&to=2099-12-31');
  const tb = (await call('GET', '/api/reports/trial-balance')).data.rows.find((x) => x.code === '2200');
  assert.strictEqual(Math.round(vr.data.totals.netPayable * 100), Math.round((tb.credit - tb.debit) * 100));
});

test('ترويسة المستندات: حفظ وقراءة والتحقق من المدخلات والشعار', { skip: !hasDb || !canWrite }, async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.strictEqual((await call('POST', '/api/letterhead', { email: 'bad' })).status, 400);
  assert.strictEqual((await call('POST', '/api/letterhead', { phone: 'abc' })).status, 400);
  assert.strictEqual((await call('POST', '/api/letterhead', { logo: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400);
  const ok = await call('POST', '/api/letterhead', { nameEn: 'Test Co', crNo: '1010000000', phone: '+966 11 000 0000', email: 'a@b.sa', website: 'www.b.sa', footerNote: 'IBAN SA00\nشكراً', logo: png });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.logo, png);
  assert.strictEqual((await call('GET', '/api/letterhead')).data.footerNote, 'IBAN SA00\nشكراً');
  assert.strictEqual((await call('POST', '/api/letterhead', {})).data.logo, ''); // مسح كل شيء
});

test('الاستعلام الموحَّد: بحث بنص ونوع ومبلغ، وسند منفرد، والكاشير يرى أنواعه فقط', { skip: !hasDb || !canWrite }, async () => {
  const stamp = 'بحث' + Date.now().toString(36);
  const p = await call('POST', '/api/parties', { kind: 'CUSTOMER', name: 'عميل ' + stamp });
  assert.strictEqual(p.status, 201);
  const inv = await call('POST', '/api/invoices', { kind: 'SALES', partyId: p.data.id, date: '2026-01-20', note: 'ملاحظة ' + stamp, lines: [{ description: 'خدمة', qty: '1', price: '123.45', vatRate: 15, account: '4200' }] });
  assert.strictEqual(inv.status, 201);
  const byText = await call('GET', '/api/search?q=' + encodeURIComponent(stamp));
  assert.strictEqual(byText.status, 200);
  assert.ok(byText.data.rows.some((x) => x.type === 'SALES' && x.id === inv.data.invoice.id));
  assert.ok(!byText.data.rows.some((x) => x.type === 'PURCHASE'));
  assert.strictEqual((await call('GET', '/api/search?q=' + encodeURIComponent(stamp) + '&type=ENTRY')).data.rows.filter((x) => x.type !== 'ENTRY').length, 0);
  assert.strictEqual((await call('GET', '/api/search?type=NOPE')).status, 400);
  assert.strictEqual((await call('GET', '/api/search?min=abc')).status, 400);
  const amt = await call('GET', '/api/search?q=' + encodeURIComponent(String(inv.data.invoice.total)) + '&type=SALES');
  assert.ok(amt.data.rows.some((x) => x.id === inv.data.invoice.id)); // يطابق المبلغ أيضاً
  // سند قبض منفرد
  const pay = await call('POST', '/api/payments', { partyId: p.data.id, invoiceId: inv.data.invoice.id, date: '2026-01-21', amount: '10', method: 'CASH', note: 'دفعة ' + stamp });
  assert.strictEqual(pay.status, 201);
  const pid = pay.data.payment ? pay.data.payment.id : pay.data.id;
  assert.strictEqual((await call('GET', '/api/payments/' + pid)).data.payment.amount, 10);
  assert.strictEqual((await call('GET', '/api/payments/999999999')).status, 404);
  assert.ok((await call('GET', '/api/search?q=' + encodeURIComponent('دفعة ' + stamp))).data.rows.some((x) => x.type === 'PAYMENT'));
});

test('المستخدمون والأدوار: كاشير يصل إلى نقاط البيع فقط، وتعطيله وتغيير كلمة سره يُسقطان جلسته', { skip: !hasDb || !canWrite }, async () => {
  const name = 'cash' + Date.now().toString(36);
  assert.strictEqual((await call('POST', '/api/users', { username: name, roleId: 'cashier', password: 'short' })).status, 400); // كلمة سر قصيرة
  assert.strictEqual((await call('POST', '/api/users', { username: cfg.webUser, roleId: 'cashier', password: 'Password123' })).status, 400); // اسم المدير الأساسي محجوز
  const u = await call('POST', '/api/users', { username: name, fullName: 'كاشير اختبار', roleId: 'cashier', password: 'Password123' });
  assert.strictEqual(u.status, 201);
  assert.strictEqual((await call('POST', '/api/users', { username: name, roleId: 'cashier', password: 'Password123' })).status, 400); // مكرر

  const adminCookie = cookie;
  cookie = '';
  assert.strictEqual((await call('POST', '/api/login', { username: name, password: 'wrong-password' })).status, 401);
  assert.strictEqual((await call('POST', '/api/login', { username: name, password: 'Password123' })).status, 200);
  const status = async (m, url) => (await call(m, url)).status;
  assert.strictEqual(await status('GET', '/api/pos/registers'), 200);
  assert.strictEqual(await status('GET', '/api/accounts'), 200);          // قراءة مرجعية لكل المستخدمين
  for (const url of ['/api/entries', '/api/invoices', '/api/payroll/runs', '/api/hr/employees', '/api/reports/trial-balance', '/api/summary', '/api/users', '/api/roles', '/api/audit']) {
    assert.strictEqual(await status('GET', url), 403, url);
  }
  assert.strictEqual((await call('POST', '/api/accounts', { code: 'X1', name: 'x', type: 'ASSET' })).status, 403);
  const me = await call('GET', '/api/me');
  assert.strictEqual(me.data.role, 'cashier');
  assert.strictEqual(me.data.isAdmin, false);
  const cashierCookie = cookie;

  // تعطيل ثم انتظار انتهاء ذاكرة المستخدم المؤقتة (5 ثوانٍ)
  cookie = adminCookie;
  assert.strictEqual((await call('PATCH', `/api/users/${u.data.id}`, { active: false })).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  cookie = cashierCookie;
  assert.strictEqual((await call('GET', '/api/me')).data.user, null);
  cookie = '';
  assert.strictEqual((await call('POST', '/api/login', { username: name, password: 'Password123' })).status, 401);   // المعطَّل لا يدخل

  // إعادة التفعيل وتغيير كلمة السر يُسقط الجلسات القديمة
  cookie = adminCookie;
  assert.strictEqual((await call('PATCH', `/api/users/${u.data.id}`, { active: true })).status, 200);
  cookie = '';
  assert.strictEqual((await call('POST', '/api/login', { username: name, password: 'Password123' })).status, 200);
  const oldSession = cookie;
  cookie = adminCookie;
  assert.strictEqual((await call('POST', `/api/users/${u.data.id}/password`, { password: 'Changed12345' })).status, 200);
  cookie = oldSession;
  assert.strictEqual((await call('GET', '/api/me')).data.user, null);
  cookie = '';
  assert.strictEqual((await call('POST', '/api/login', { username: name, password: 'Changed12345' })).status, 200);

  // تنظيف: عطّل المستخدم ثم استرجع جلسة المدير
  cookie = adminCookie;
  assert.strictEqual((await call('PATCH', `/api/users/${u.data.id}`, { active: false })).status, 200);
  const audit = await call('GET', '/api/audit?limit=50');
  assert.ok(audit.data.rows.some((x) => x.username === name && x.action === 'LOGIN'));
});

test('الأدوار: دور المدير ثابت، ولا يُحذف دور جاهز أو مستخدَم', { skip: !hasDb || !canWrite }, async () => {
  assert.strictEqual((await call('PATCH', '/api/roles/admin', { name: 'x' })).status, 400);
  assert.strictEqual((await call('DELETE', '/api/roles/cashier')).status, 400);
  const id = 'r' + Date.now().toString(36);
  assert.strictEqual((await call('POST', '/api/roles', { id, name: 'دور اختبار', perms: { pos: 'r', trade: 'bogus' } })).status, 201);
  const role = (await call('GET', '/api/roles')).data.roles.find((x) => x.id === id);
  assert.strictEqual(role.perms.pos, 'r');
  assert.strictEqual(role.perms.trade, 'n');           // قيمة غير صالحة تصير «لا شيء»
  assert.strictEqual((await call('PATCH', `/api/roles/${id}`, { perms: { pos: 'w' } })).status, 200);
  assert.strictEqual((await call('DELETE', `/api/roles/${id}`)).status, 200);
});

test('لوحة المؤشرات: ستة أشهر ومستحقات، وتعديل بنود مسودة أمر شراء', { skip: !hasDb || !canWrite }, async () => {
  const d = await call('GET', '/api/reports/dashboard');
  assert.strictEqual(d.status, 200);
  assert.strictEqual(d.data.months.length, 6);
  assert.ok(d.data.months.every((m) => /^\d{4}-\d{2}$/.test(m.month) && typeof m.sales === 'number'));
  assert.ok(d.data.receivable >= d.data.receivableOverdue);

  const sup = await call('POST', '/api/parties', { kind: 'SUPPLIER', name: 'مورد تعديل المسودة' });
  const po = await call('POST', '/api/po', { partyId: sup.data.id, date: '2026-01-10', lines: [{ description: 'أ', qty: 1, price: 10, account: '5400' }] });
  assert.strictEqual(po.status, 201);
  const upd = await call('PUT', `/api/po/${po.data.order.id}/lines`, { lines: [{ description: 'أ', qty: 2, price: 10, account: '5400', vatRate: 15 }, { description: 'ب', qty: 1, price: 5, account: '5400', vatRate: 0 }] });
  assert.strictEqual(upd.status, 200);
  assert.strictEqual(upd.data.order.lines.length, 2);
  assert.strictEqual(upd.data.order.total, 28);        // 20 + 3 ضريبة + 5
  assert.strictEqual((await call('POST', `/api/po/${po.data.order.id}/approve`, {})).status, 200);
  assert.strictEqual((await call('PUT', `/api/po/${po.data.order.id}/lines`, { lines: [{ description: 'ج', qty: 1, price: 1, account: '5400' }] })).status, 400);   // بعد الاعتماد
});

test('إشعارات الدائن والمدين: إشعار دائن ومدين وسداد وإلغاء ومطابقة الأستاذ', { skip: !hasDb || !canWrite }, async () => {
  const c = await call('POST', '/api/parties', { kind: 'CUSTOMER', name: 'عميل إشعارات آلي' });
  const inv = await call('POST', '/api/invoices', { kind: 'SALES', partyId: c.data.id, date: '2026-01-15', lines: [{ description: 'خدمة', qty: 1, price: 1000, vatRate: 15, account: '4200' }] });
  assert.strictEqual(inv.status, 201);
  const id = inv.data.invoice.id, line = inv.data.invoice.lines[0].id;
  assert.strictEqual(inv.data.invoice.remaining, 1150);

  // إشعار دائن بتخفيض سعر 200 للبند الأصلي (بلا مخزون): 230 بعد الضريبة
  const cn = await call('POST', '/api/notes', { invoiceId: id, type: 'CREDIT', date: '2026-01-16', reason: 'خصم لاحق', lines: [{ origLineId: line, qty: 1, price: 200, vatRate: 15, restock: false }] });
  assert.strictEqual(cn.status, 201);
  assert.strictEqual(cn.data.note.total, 230);
  assert.match(cn.data.note.no, /^SCN-\d{6}$/);
  assert.strictEqual((await call('GET', `/api/invoices/${id}`)).data.invoice.remaining, 920);
  assert.strictEqual((await call('GET', `/api/parties/${c.data.id}/statement`)).data.party.balance, 920);

  // رفض: بلا سبب، سعر أعلى من الأصلي، دائن يتجاوز الفاتورة
  assert.strictEqual((await call('POST', '/api/notes', { invoiceId: id, type: 'CREDIT', date: '2026-01-16', reason: ' ', lines: [{ description: 'x', qty: 1, price: 1, account: '4200' }] })).status, 400);
  const hi = await call('POST', '/api/notes', { invoiceId: id, type: 'CREDIT', date: '2026-01-16', reason: 'غلاء', lines: [{ origLineId: line, qty: 1, price: 5000, vatRate: 15, restock: false }] });
  assert.strictEqual(hi.status, 400);
  assert.match(hi.data.error, /أعلى من سعر الفاتورة/);
  assert.strictEqual((await call('POST', '/api/notes', { invoiceId: id, type: 'CREDIT', date: '2026-01-16', reason: 'كبير', lines: [{ description: 'x', qty: 1, price: 5000, vatRate: 15, account: '4200' }] })).status, 400);

  // إشعار مدين 115 → المتبقي 1035، والدفع محدود بالمتبقي الفعلي
  const dn = await call('POST', '/api/notes', { invoiceId: id, type: 'DEBIT', date: '2026-01-17', reason: 'رسوم تأخير', lines: [{ description: 'رسوم', qty: 1, price: 100, vatRate: 15, account: '4200' }] });
  assert.strictEqual(dn.status, 201);
  assert.match(dn.data.note.no, /^SDN-\d{6}$/);
  assert.strictEqual((await call('POST', '/api/payments', { partyId: c.data.id, invoiceId: id, date: '2026-01-18', amount: '1100', method: 'CASH' })).status, 400);
  assert.strictEqual((await call('POST', '/api/payments', { partyId: c.data.id, invoiceId: id, date: '2026-01-18', amount: '1035', method: 'CASH' })).status, 201);
  assert.strictEqual((await call('GET', `/api/invoices/${id}`)).data.invoice.remaining, 0);

  // لا يُلغى الإشعار المدين المسدَّد، ولا تُلغى فاتورة لها إشعارات
  assert.strictEqual((await call('POST', `/api/notes/${dn.data.note.id}/void`, {})).status, 400);
  assert.strictEqual((await call('POST', `/api/invoices/${id}/void`, {})).status, 400);

  // إشعار دائن على فاتورة مسدَّدة يلزمه رد
  const body = { invoiceId: id, type: 'CREDIT', date: '2026-01-19', reason: 'تعويض', lines: [{ description: 'تعويض', qty: 1, price: 50, vatRate: 15, account: '4200' }] };
  assert.strictEqual((await call('POST', '/api/notes', body)).status, 400);
  const withRefund = await call('POST', '/api/notes', { ...body, refund: '57.5', refundMethod: 'CASH' });
  assert.strictEqual(withRefund.status, 201);
  assert.strictEqual(withRefund.data.note.refund, 57.5);
  assert.strictEqual((await call('GET', `/api/invoices/${id}`)).data.invoice.remaining, 0);
  assert.strictEqual((await call('GET', `/api/parties/${c.data.id}/statement`)).data.party.balance, 0);

  // الإقرار الضريبي يشمل الإشعارات ويبقى مطابقاً لحساب الضريبة في الأستاذ
  const vr = await call('GET', '/api/reports/vat-return?from=2000-01-01&to=2099-12-31');
  assert.ok(vr.data.salesNotes.length > 0);
  const tb = (await call('GET', '/api/reports/trial-balance')).data.rows.find((x) => x.code === '2200');
  assert.strictEqual(Math.round(vr.data.totals.netPayable * 100), Math.round((tb.credit - tb.debit) * 100));
  assert.strictEqual((await call('GET', '/api/reports/trial-balance')).data.balanced, true);

  // إلغاء الإشعار الدائن الأول (230) ممكن: المدفوع 1035 ≤ 1150 + 115 − 57.5 ... والمتبقي بعده 230
  assert.strictEqual((await call('POST', `/api/notes/${cn.data.note.id}/void`, {})).status, 200);
  assert.strictEqual((await call('GET', `/api/invoices/${id}`)).data.invoice.remaining, 230);
  assert.strictEqual((await call('POST', `/api/notes/${cn.data.note.id}/void`, {})).status, 400);   // ملغى مسبقاً
  const list = await call('GET', `/api/notes?invoice=${id}`);
  assert.strictEqual(list.data.notes.length, 3);
});

test('إشعارات الدائن والمدين: الكاشير ممنوع منها', { skip: !hasDb || !canWrite }, async () => {
  const name = 'cn' + Date.now().toString(36);
  const u = await call('POST', '/api/users', { username: name, roleId: 'cashier', password: 'Password123' });
  const adminCookie = cookie; cookie = '';
  await call('POST', '/api/login', { username: name, password: 'Password123' });
  assert.strictEqual((await call('GET', '/api/notes')).status, 403);
  assert.strictEqual((await call('POST', '/api/notes', {})).status, 403);
  cookie = adminCookie;
  await call('PATCH', `/api/users/${u.data.id}`, { active: false });
});
