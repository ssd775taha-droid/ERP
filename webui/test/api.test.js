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
  {
    const po = (await call('GET', `/api/po/${id}`)).data.order;
    assert.ok(po.receipts[0].lines.length >= 1 && po.receipts[0].lines[0].qty === 2 && po.receipts[0].invoiceNo);   // أسطر الاستلام لإشعار الاستلام
  }
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

test('التقارير المتقدمة: تطابق إجمالي التحليل بين الطرف والصنف والشهر، وربحية الأصناف، والمقارنة', { skip: !hasDb || !canWrite }, async () => {
  const q = 'from=2000-01-01&to=2099-12-31';
  for (const kind of ['SALES', 'PURCHASE']) {
    const tot = {};
    for (const by of ['party', 'item', 'month']) {
      const r = await call('GET', `/api/reports/sales-analysis?${q}&kind=${kind}&by=${by}`);
      assert.strictEqual(r.status, 200);
      tot[by] = r.data.total;
      assert.strictEqual(Math.round(r.data.rows.reduce((s, x) => s + x.net, 0) * 100), Math.round(r.data.total * 100));
    }
    assert.strictEqual(tot.party, tot.item); assert.strictEqual(tot.party, tot.month);
  }
  // المبيعات الصافية تطابق إيرادات المبيعات الظاهرة في ضريبة المخرجات (net) بعد الإشعارات ونقاط البيع
  const vr = (await call('GET', `/api/reports/vat-return?${q}`)).data;
  const sales = (await call('GET', `/api/reports/sales-analysis?${q}&kind=SALES&by=month`)).data.total;
  const vnet = [...vr.sales, ...vr.pos, ...vr.salesNotes].reduce((s, x) => s + x.net, 0);
  assert.strictEqual(Math.round(sales * 100), Math.round(vnet * 100));
  const ip = await call('GET', `/api/reports/item-profit?${q}`);
  assert.strictEqual(ip.status, 200);
  assert.strictEqual(Math.round((ip.data.totals.revenue - ip.data.totals.cost) * 100), Math.round(ip.data.totals.margin * 100));
  const cmp = await call('GET', '/api/reports/comparative?f1=2000-01-01&t1=2099-12-31&f2=2000-01-01&t2=2099-12-31');
  assert.strictEqual(cmp.status, 200);
  const is = (await call('GET', `/api/reports/income-statement?${q}`)).data;
  assert.strictEqual(cmp.data.totals.net.current, is.netIncome);
  assert.strictEqual(cmp.data.totals.net.current, cmp.data.totals.net.previous);
  assert.strictEqual((await call('GET', '/api/reports/comparative?f1=x')).status, 400);
});

test('تقارير المخزون: التقييم يطابق الأرصدة والأستاذ، وكارت الصنف وملخص الحركة متسقان', { skip: !hasDb || !canWrite }, async () => {
  const stock = (await call('GET', '/api/inventory/stock')).data;
  const val = await call('GET', '/api/inventory/reports/valuation?asof=2099-12-31');
  assert.strictEqual(val.status, 200);
  assert.strictEqual(Math.round(val.data.totalValue * 100), Math.round(stock.totalValue * 100));
  const split = (await call('GET', '/api/inventory/reports/valuation?asof=2099-12-31&split=1')).data;
  assert.strictEqual(Math.round(split.totalValue * 100), Math.round(stock.totalValue * 100));
  const mv = (await call('GET', '/api/inventory/reports/movement?from=2000-01-01&to=2099-12-31')).data;
  assert.strictEqual(Math.round(mv.totals.closeValue * 100), Math.round(stock.totalValue * 100));
  assert.strictEqual(Math.round((mv.totals.openValue + mv.totals.inValue - mv.totals.outValue) * 100), Math.round(mv.totals.closeValue * 100));
  const withStock = stock.rows.find((x) => x.qty > 0);
  if (withStock) {
    const card = await call('GET', `/api/inventory/reports/item-card?item=${withStock.itemId}&from=2000-01-01&to=2099-12-31`);
    assert.strictEqual(card.status, 200);
    const total = stock.rows.filter((x) => x.itemId === withStock.itemId).reduce((s, x) => s + x.qty, 0);
    assert.strictEqual(Math.round(card.data.closing.qty * 1000), Math.round(total * 1000));
  }
  assert.strictEqual((await call('GET', '/api/inventory/reports/item-card?item=999999999&from=2000-01-01&to=2099-12-31')).status, 404);
  assert.strictEqual((await call('GET', '/api/inventory/reports/item-card?from=2000-01-01&to=2099-12-31')).status, 400);
  const slow = await call('GET', '/api/inventory/reports/slow-moving?asof=2099-12-31&days=30');
  assert.strictEqual(slow.status, 200);
  assert.ok(slow.data.rows.every((x) => x.idleDays >= 30));
  const sh = await call('GET', '/api/inventory/reports/shortage?asof=2099-12-31&limit=0');
  assert.strictEqual(sh.status, 200);
  assert.ok(sh.data.rows.every((x) => x.qty <= 0));
  assert.strictEqual((await call('GET', '/api/inventory/reports/shortage?asof=2099-12-31&limit=-1')).status, 400);
});

test('تعديل وحذف البيانات الأساسية وإلغاء السند', { skip: !hasDb || !canWrite }, async () => {
  const stamp = Date.now().toString(36);
  // طرف: إضافة ثم تعديل ثم حذف؛ ومن عليه فاتورة لا يُحذف
  const p = await call('POST', '/api/parties', { kind: 'CUSTOMER', name: 'عميل حذف ' + stamp });
  assert.strictEqual(p.status, 201);
  assert.strictEqual((await call('PATCH', `/api/parties/${p.data.id}`, { name: 'عميل معدّل ' + stamp, phone: '0500000000' })).status, 200);
  assert.strictEqual((await call('PATCH', `/api/parties/${p.data.id}`, { taxNo: '123' })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/parties/${p.data.id}`, {})).status, 400);
  assert.strictEqual((await call('DELETE', `/api/parties/${p.data.id}`)).status, 200);
  assert.strictEqual((await call('DELETE', `/api/parties/${p.data.id}`)).status, 404);
  const p2 = await call('POST', '/api/parties', { kind: 'CUSTOMER', name: 'عميل بفاتورة ' + stamp });
  const inv = await call('POST', '/api/invoices', { kind: 'SALES', partyId: p2.data.id, date: '2026-01-25', lines: [{ description: 'خدمة', qty: 1, price: 100, vatRate: 15, account: '4200' }] });
  assert.strictEqual(inv.status, 201);
  assert.strictEqual((await call('DELETE', `/api/parties/${p2.data.id}`)).status, 409);
  // سند: قبض ثم إلغاء يعيد المدفوع والرصيد ويبقي الميزان متوازناً
  const bal0 = (await call('GET', `/api/parties/${p2.data.id}/statement`)).data;
  const pay = await call('POST', '/api/payments', { partyId: p2.data.id, invoiceId: inv.data.invoice.id, date: '2026-01-26', amount: '40', method: 'CASH' });
  assert.strictEqual(pay.status, 201);
  assert.strictEqual((await call('GET', `/api/invoices/${inv.data.invoice.id}`)).data.invoice.paid, 40);
  assert.strictEqual((await call('POST', `/api/payments/${pay.data.id}/void`, {})).status, 200);
  assert.strictEqual((await call('GET', `/api/invoices/${inv.data.invoice.id}`)).data.invoice.paid, 0);
  assert.strictEqual((await call('POST', `/api/payments/${pay.data.id}/void`, {})).status, 400);   // لا سند بعد الإلغاء
  assert.strictEqual((await call('GET', '/api/reports/trial-balance')).data.balanced, true);
  assert.deepStrictEqual((await call('GET', `/api/parties/${p2.data.id}/statement`)).data.closing, bal0.closing);
  // الفاتورة صارت بلا مدفوعات فيمكن إلغاؤها
  assert.strictEqual((await call('POST', `/api/invoices/${inv.data.invoice.id}/void`, {})).status, 200);
  // حسابات: النظام محمي، وحساب جديد يُحذف
  assert.strictEqual((await call('DELETE', '/api/accounts/1100')).status, 400);
  const code = '9' + String(Date.now()).slice(-5);
  assert.strictEqual((await call('POST', '/api/accounts', { code, name: 'حساب مؤقت', type: 'EXPENSE', parent: '5000' })).status, 201);
  assert.strictEqual((await call('DELETE', `/api/accounts/${code}`)).status, 200);
  assert.strictEqual((await call('DELETE', `/api/accounts/${code}`)).status, 404);
  // صنف ومخزن: حذف غير المستخدم، ورفض المستخدم
  const it = await call('POST', '/api/inventory/items', { code: 'DEL' + stamp, name: 'صنف مؤقت', price: '5', vat: '15' });
  assert.strictEqual(it.status, 201);
  assert.strictEqual((await call('DELETE', `/api/inventory/items/${it.data.id}`)).status, 200);
  const wh = await call('POST', '/api/inventory/warehouses', { code: 'W' + stamp.slice(-6), name: 'مخزن مؤقت' });
  assert.strictEqual(wh.status, 201);
  assert.strictEqual((await call('PUT', `/api/inventory/warehouses/${wh.data.id}`, { name: 'مخزن معدّل' })).status, 200);
  assert.strictEqual((await call('DELETE', `/api/inventory/warehouses/${wh.data.id}`)).status, 200);
  const used = (await call('GET', '/api/inventory/stock')).data.rows.find((x) => x.qty > 0);
  if (used) { assert.strictEqual((await call('DELETE', `/api/inventory/items/${used.itemId}`)).status, 409); }
  // قسم وموظف
  const dp = await call('POST', '/api/hr/departments', { code: 'D' + stamp.slice(-6), name: 'قسم مؤقت' });
  assert.strictEqual(dp.status, 201);
  assert.strictEqual((await call('PATCH', `/api/hr/departments/${dp.data.id}`, { name: 'قسم معدّل' })).status, 200);
  const em = await call('POST', '/api/hr/employees', { code: 'E' + stamp.slice(-8), name: 'موظف مؤقت', hireDate: '2026-01-01', basic: '3000', deptId: dp.data.id });
  assert.strictEqual(em.status, 201);
  assert.strictEqual((await call('DELETE', `/api/hr/departments/${dp.data.id}`)).status, 409);   // عليه موظف
  assert.strictEqual((await call('PATCH', `/api/hr/employees/${em.data.id}`, { jobTitle: 'محاسب', bankAccount: 'SA00' })).status, 200);
  const list = (await call('GET', '/api/hr/employees')).data.employees.find((x) => x.id === em.data.id);
  assert.strictEqual(list.bankAccount, 'SA00'); assert.strictEqual(list.deptId, dp.data.id);
});

test('ميزان المراجعة بأعمدة الفترة: افتتاحي + حركة = ختامي لكل حساب', { skip: !hasDb || !canWrite }, async () => {
  const cum = (await call('GET', '/api/reports/trial-balance?to=2099-12-31')).data;
  assert.strictEqual(cum.hasPeriod, false);
  const per = await call('GET', '/api/reports/trial-balance?from=2026-01-15&to=2026-12-31');
  assert.strictEqual(per.status, 200);
  assert.strictEqual(per.data.hasPeriod, true);
  for (const x of per.data.rows) {
    const open = x.openDebit - x.openCredit, mov = x.periodDebit - x.periodCredit, close = x.balanceDebit - x.balanceCredit;
    assert.strictEqual(Math.round((open + mov) * 100), Math.round(close * 100), x.code);
  }
  assert.strictEqual(per.data.openBalanced, true);
  assert.strictEqual(per.data.balanced, true);
  // ختامي الفترة = الأرصدة التراكمية لنفس التاريخ
  const cum2 = (await call('GET', '/api/reports/trial-balance?to=2026-12-31')).data;
  assert.strictEqual(per.data.totals.balanceDebit, cum2.totals.balanceDebit);
  assert.strictEqual((await call('GET', '/api/reports/trial-balance?from=2026-12-31&to=2026-01-01')).status, 400);
});

test('تفاصيل مستندات الإهلاك وإقفال السنة', { skip: !hasDb || !canWrite }, async () => {
  const months = (await call('GET', '/api/depreciation/months')).data.months;
  if (months.length) {
    const d = await call('GET', `/api/depreciation/months/${months[0].period}`);
    assert.strictEqual(d.status, 200);
    assert.strictEqual(Math.round(d.data.rows.reduce((s, x) => s + x.amount, 0) * 100), Math.round(months[0].amount * 100));
    assert.ok(months[0].entryId);
  }
  assert.strictEqual((await call('GET', '/api/depreciation/months/2000-01-01')).status, 404);
  assert.strictEqual((await call('GET', '/api/depreciation/months/x')).status, 400);
  const per = (await call('GET', '/api/periods')).data;
  for (const y of per.years) assert.ok('entryId' in y && 'changedBy' in y);
});

test('تقارير الرواتب: تطابق الأقسام والموظفين والمكوّنات والاتجاه', { skip: !hasDb || !canWrite }, async () => {
  const q = 'from=2000-01-01&to=2099-12-31';
  const d = await call('GET', `/api/payroll/reports/by-department?${q}`);
  const e = await call('GET', `/api/payroll/reports/by-employee?${q}`);
  const c = await call('GET', `/api/payroll/reports/components?${q}`);
  const tr = await call('GET', `/api/payroll/reports/trend?${q}`);
  for (const x of [d, e, c, tr]) assert.strictEqual(x.status, 200);
  const cents = (n) => Math.round(n * 100);
  assert.strictEqual(cents(d.data.totals.net), cents(tr.data.totals.net));
  assert.strictEqual(cents(e.data.totals.net), cents(tr.data.totals.net));
  assert.strictEqual(cents(d.data.totals.gross), cents(tr.data.totals.gross));
  assert.strictEqual(cents(e.data.totals.gross), cents(tr.data.totals.gross));
  assert.strictEqual(cents(Object.values(e.data.monthTotals).reduce((s, x) => s + x, 0)), cents(tr.data.totals.net));
  // الصافي = الإجمالي − الاستقطاعات − السلف
  assert.strictEqual(cents(d.data.totals.gross - d.data.totals.deductions - d.data.totals.advance), cents(d.data.totals.net));
  // المكوّنات: الاستقطاعات والسلف وحصة صاحب العمل تطابق الأسطر
  assert.strictEqual(cents(c.data.totals.deduction), cents(d.data.totals.deductions));
  assert.strictEqual(cents(c.data.totals.advance), cents(d.data.totals.advance));
  assert.strictEqual(cents(c.data.totals.employer), cents(d.data.totals.employer));
  assert.strictEqual(cents(c.data.totals.basic + c.data.totals.earning), cents(d.data.totals.gross));
  assert.strictEqual((await call('GET', '/api/payroll/reports/trend?from=2026-05-01&to=2026-01-01')).status, 400);
  assert.strictEqual((await call('GET', '/api/payroll/reports/trend')).status, 400);
});

test('تقارير الموارد البشرية: القوى العاملة والحركة ومدة الخدمة وتغيّرات الرواتب والسلف والنواقص', { skip: !hasDb || !canWrite }, async () => {
  const today = new Date().toISOString().slice(0, 10);
  const emps = (await call('GET', '/api/hr/employees')).data.employees;
  const hc = (await call('GET', `/api/hr/reports/headcount?asof=${today}`)).data;
  assert.strictEqual(hc.totals.active, emps.filter((e) => e.status === 'ACTIVE' && e.hireDate <= today).length);
  const tn = (await call('GET', `/api/hr/reports/tenure?asof=${today}`)).data;
  assert.strictEqual(tn.rows.length, hc.totals.active);
  assert.strictEqual(tn.buckets.reduce((s, b) => s + b.count, 0), tn.rows.length);
  // الحركة: أول الفترة + تعيينات − إنهاءات = آخر الفترة = على رأس العمل في نهايتها
  const mv = (await call('GET', `/api/hr/reports/movements?from=2000-01-01&to=${today}`)).data;
  assert.strictEqual(mv.totals.closing, mv.totals.opening + mv.totals.hires - mv.totals.terms);
  assert.strictEqual(mv.totals.closing, hc.totals.active);
  assert.strictEqual((await call('GET', '/api/hr/reports/movements?from=2026-05-01&to=2026-01-01')).status, 400);
  // تغيّر راتب: موظف جديد بزيادة
  const st = Date.now().toString(36).slice(-6);
  const em = await call('POST', '/api/hr/employees', { code: 'H' + st, name: 'موظف تقرير', hireDate: '2025-01-15', basic: '3000' });
  assert.strictEqual(em.status, 201);
  assert.strictEqual((await call('POST', `/api/hr/employees/${em.data.id}/salary`, { basic: '3500', from: '2026-12-01' })).status, 200);
  const sc = (await call('GET', '/api/hr/reports/salary-changes?from=2026-01-01&to=2026-12-31')).data;
  const mine = sc.rows.find((x) => x.code === 'H' + st);
  assert.ok(mine && mine.oldBasic === 3000 && mine.newBasic === 3500 && mine.diff === 500);
  assert.ok(!sc.rows.some((x) => x.code === 'H' + st && x.oldBasic == null));
  const gaps = (await call('GET', '/api/hr/reports/data-gaps')).data;
  assert.ok(gaps.rows.some((x) => x.code === 'H' + st && x.noId === 1 && x.noBank === 1));
  const adv = (await call('GET', '/api/hr/reports/advances')).data;
  assert.ok(adv.totals.remaining >= 0 && adv.rows.every((x) => x.remaining > 0));
  assert.strictEqual((await call('GET', '/api/hr/reports/headcount')).status, 400);
});

test('تقارير نقاط البيع: تطابق اليومي والأصناف والكاشير والساعة مع ملخص الورديات', { skip: !hasDb || !canWrite }, async () => {
  const q = 'from=2000-01-01&to=2099-12-31', cents = (n) => Math.round(n * 100);
  const d = (await call('GET', `/api/pos/reports/daily?${q}`)).data;
  const it = (await call('GET', `/api/pos/reports/items?${q}`)).data;
  const ca = (await call('GET', `/api/pos/reports/cashiers?${q}`)).data;
  const hr = await call('GET', `/api/pos/reports/hourly?${q}`);
  const sh = await call('GET', `/api/pos/reports/shifts?${q}`);
  const rt = await call('GET', `/api/pos/reports/returns?${q}`);
  for (const x of [hr, sh, rt]) assert.strictEqual(x.status, 200);
  assert.strictEqual(cents(d.totals.net), cents(it.totals.net));           // صافي اليومي = صافي الأصناف
  assert.strictEqual(cents(d.totals.net), cents(ca.totals.net));           // = صافي الكاشير
  assert.strictEqual(cents(d.totals.cash + d.totals.card), cents(d.totals.total));   // نقد + بطاقة = الإجمالي بعد المرتجعات
  assert.strictEqual(cents(d.totals.net + d.totals.vat), cents(d.totals.total));
  assert.strictEqual(cents(d.totals.gross - d.totals.returned), cents(d.totals.net));
  assert.strictEqual(d.totals.sales, ca.totals.sales);
  assert.strictEqual(d.totals.sales, hr.data.totals.sales);
  assert.strictEqual(rt.data.totals.count, d.totals.returns);
  assert.strictEqual(cents(rt.data.totals.total + 0), cents(rt.data.rows.reduce((s, x) => s + x.total, 0)));
  for (const x of sh.data.rows) assert.strictEqual(cents(x.counted - x.expected), cents(x.variance));
  assert.strictEqual((await call('GET', '/api/pos/reports/daily?from=2026-05-01&to=2026-01-01')).status, 400);
});

test('تقارير الأصول: تطابق السجل وحركة الأصول والمتوقع والاستبعادات', { skip: !hasDb || !canWrite }, async () => {
  const cents = (n) => Math.round(n * 100) / 100 * 100;
  const far = '2099-12-31', all = await call('GET', '/api/assets');
  const reg = (await call('GET', `/api/assets/reports/register?asof=${far}`)).data;
  assert.strictEqual(cents(reg.totals.cost), cents(all.data.totals.cost));
  assert.strictEqual(cents(reg.totals.accumulated), cents(all.data.totals.accumulated));
  assert.strictEqual(cents(reg.totals.cost - reg.totals.accumulated), cents(reg.totals.bookValue));
  // الحركة: إغلاقها يطابق السجل في تاريخ النهاية، والتكلفة والمجمع يتوازنان
  const rf = (await call('GET', `/api/assets/reports/rollforward?from=2000-01-01&to=${far}`)).data;
  assert.strictEqual(cents(rf.totals.openCost + rf.totals.additions - rf.totals.disposals), cents(rf.totals.closeCost));
  assert.strictEqual(cents(rf.totals.openAcc + rf.totals.dep - rf.totals.removedAcc), cents(rf.totals.closeAcc));
  assert.strictEqual(cents(rf.totals.closeCost), cents(reg.totals.cost));
  assert.strictEqual(cents(rf.totals.closeAcc), cents(reg.totals.accumulated));
  const mid = (await call('GET', '/api/assets/reports/rollforward?from=2026-06-01&to=2026-09-30')).data;
  assert.strictEqual(cents(mid.totals.openCost + mid.totals.additions - mid.totals.disposals), cents(mid.totals.closeCost));
  assert.strictEqual(cents(mid.totals.openAcc + mid.totals.dep - mid.totals.removedAcc), cents(mid.totals.closeAcc));
  // المتوقع: مجموع أقساط كل أصل لا يتجاوز المتبقي للإهلاك
  const fc = (await call('GET', '/api/assets/reports/forecast?months=36')).data;
  for (const x of fc.rows) assert.ok(x.total <= x.remaining + 0.001, x.code);
  assert.strictEqual(fc.cols.length, 36);
  const ds = (await call('GET', '/api/assets/reports/disposals?from=2000-01-01&to=' + far)).data;
  for (const x of ds.rows) assert.strictEqual(cents(x.proceeds - x.bookValue), cents(x.gain));
  assert.strictEqual((await call('GET', '/api/assets/reports/life?within=24')).status, 200);
  assert.strictEqual((await call('GET', '/api/assets/reports/rollforward?from=2026-05-01&to=2026-01-01')).status, 400);
  assert.strictEqual((await call('GET', '/api/assets/reports/register')).status, 400);
});

test('تقارير المحاسبة الإضافية: تطابق الشهري مع قائمة الدخل، وحركة الحسابات مع الميزان، ودفتر النقدية مع الأستاذ', { skip: !hasDb || !canWrite }, async () => {
  const cents = (n) => Math.round(n * 100), q = 'from=2026-01-01&to=2026-12-31';
  const is = (await call('GET', `/api/reports/income-statement?${q}`)).data;
  const pl = (await call('GET', `/api/reports/monthly-pl?${q}`)).data;
  assert.strictEqual(cents(pl.totals.net), cents(is.netIncome));
  assert.strictEqual(cents(pl.totals.revenue), cents(is.totalRevenue));
  assert.strictEqual(cents(pl.totals.expense), cents(is.totalExpense));
  assert.strictEqual(cents(Object.values(pl.net).reduce((s, x) => s + x, 0)), cents(pl.totals.net));
  // الحركة الشهرية: الختامي لكل حساب = رصيده في الميزان (مدين − دائن) حتى نهاية الفترة، والمجموع صفر
  const act = (await call('GET', `/api/reports/account-activity?${q}`)).data;
  const tb = (await call('GET', '/api/reports/trial-balance?to=2026-12-31')).data;
  for (const a of act.rows) { const t = tb.rows.find((x) => x.code === a.code); assert.strictEqual(cents(a.close), cents(t.balanceDebit - t.balanceCredit), a.code); }
  assert.strictEqual(cents(act.totals.close), 0);
  assert.strictEqual(cents(act.totals.open), 0);
  assert.strictEqual((await call('GET', '/api/reports/account-activity?from=2020-01-01&to=2026-12-31')).status, 400);   // أطول من 12 شهراً
  assert.strictEqual((await call('GET', `/api/reports/account-activity?${q}&type=BAD`)).status, 400);
  // دفتر النقدية: الختامي يطابق دفتر الأستاذ للحساب نفسه
  const cb = (await call('GET', `/api/reports/cash-book?${q}`)).data;
  for (const a of cb.accounts) {
    const lg = (await call('GET', `/api/reports/ledger/${a.code}?${q}`)).data;
    assert.strictEqual(cents(a.closing), cents(lg.closing), a.code);
    assert.strictEqual(cents(a.opening), cents(lg.opening), a.code);
  }
  const rt = (await call('GET', `/api/reports/ratios?${q}`)).data;
  assert.strictEqual(cents(rt.base.grossProfit), cents(rt.base.revenue - rt.base.cogs));
  assert.strictEqual(cents(rt.base.net), cents(is.netIncome));
  const au = (await call('GET', `/api/reports/journal-audit?${q}`)).data;
  assert.strictEqual(au.totals.entries, au.monthly.reduce((s, x) => s + x.entries, 0));
  assert.strictEqual(au.reversals.length, au.totals.reversals);
  assert.strictEqual((await call('GET', '/api/reports/monthly-pl?from=2026-05-01&to=2026-01-01')).status, 400);
});

test('التقارير المحاسبية المتقدمة: اليومية والأستاذ العام والمقارنات وتجميع الحسابات', { skip: !hasDb || !canWrite }, async () => {
  const cents = (n) => Math.round(n * 100), q = 'from=2000-01-01&to=2099-12-31';
  const gj = (await call('GET', `/api/reports/general-journal?${q}`)).data;
  assert.strictEqual(cents(gj.totals.debit), cents(gj.totals.credit));
  assert.ok(gj.entries.every((e) => cents(e.lines.reduce((s, l) => s + l.debit, 0)) === cents(e.lines.reduce((s, l) => s + l.credit, 0))));
  const gjc = (await call('GET', `/api/reports/general-journal?${q}&kind=CLOSING`)).data;
  assert.ok(gjc.entries.every((e) => e.kind === 'CLOSING'));
  assert.strictEqual((await call('GET', `/api/reports/general-journal?${q}&kind=BAD`)).status, 400);
  assert.strictEqual((await call('GET', `/api/reports/general-journal?${q}&min=-5`)).status, 400);
  // الأستاذ العام يطابق ميزان المراجعة وكشف الحساب
  const tb = (await call('GET', `/api/reports/trial-balance?to=2099-12-31`)).data;
  const gl0 = (await call('GET', `/api/reports/general-ledger?${q}`)).data;
  assert.ok(gl0.truncated || cents(gl0.totals.debit) === cents(tb.totals.debit));      // الحد الأقصى للأسطر يقطع الفترات الكبيرة
  const tbp = (await call('GET', '/api/reports/trial-balance?from=2026-12-01&to=2026-12-31')).data;
  const gl = (await call('GET', '/api/reports/general-ledger?from=2026-12-01&to=2026-12-31')).data;
  assert.ok(!gl.truncated);
  assert.strictEqual(cents(gl.totals.debit), cents(tbp.totals.periodDebit));
  assert.strictEqual(cents(gl.totals.credit), cents(tbp.totals.periodCredit));
  const a0 = gl.accounts[0], lg = (await call("GET", `/api/reports/ledger/${a0.code}?from=2000-01-01&to=2026-12-31`)).data;
  assert.strictEqual(cents(a0.close), cents(lg.closing * (['ASSET', 'EXPENSE'].includes(lg.account.type) ? 1 : -1)));
  // مقارنة الميزان: الفترتان المتطابقتان بلا فروق ومجموعها صفر
  const tc = (await call('GET', `/api/reports/tb-compare?from1=2000-01-01&to1=2099-12-31&from2=2000-01-01&to2=2099-12-31`)).data;
  assert.strictEqual(cents(tc.totals.absDiff), 0);
  assert.strictEqual(cents(tc.totals.p1), 0);
  assert.strictEqual((await call('GET', '/api/reports/tb-compare?from1=2026-05-01&to1=2026-01-01&from2=2026-01-01&to2=2026-02-01')).status, 400);
  // مقارنة الميزانية تطابق الميزانية العادية في كل تاريخ
  const bc = (await call('GET', '/api/reports/bs-compare?asof1=2026-01-31&asof2=2099-12-31')).data;
  const b2 = (await call('GET', '/api/reports/balance-sheet?asof=2099-12-31')).data, b1 = (await call('GET', '/api/reports/balance-sheet?asof=2026-01-31')).data;
  assert.strictEqual(cents(bc.totals.assets.b2), cents(b2.totalAssets));
  assert.strictEqual(cents(bc.totals.assets.b1), cents(b1.totalAssets));
  assert.strictEqual(cents(bc.totals.equity.b2), cents(b2.totalEquity));
  assert.ok(bc.balanced);
  // تجميع الحسابات: مجموع الأوراق يطابق ميزان المراجعة، والجذور الخمسة أو أقل تحمل مجموع أبنائها
  const ag = (await call('GET', `/api/reports/account-groups?${q}`)).data;
  assert.strictEqual(cents(ag.totals.leafDebit), cents(tb.totals.debit));
  assert.strictEqual(cents(ag.totals.leafCredit), cents(tb.totals.credit));
});

test('تطبيق المالك: الملخص والمعتمدات قراءة فقط ومتسقة مع التقارير الأصلية', { skip: !hasDb || !canWrite }, async () => {
  const cents = (n) => Math.round(n * 100);
  const s = await call('GET', '/api/owner/summary');
  assert.strictEqual(s.status, 200);
  assert.ok(s.data.can.reports);
  const tb = (await call('GET', '/api/reports/trial-balance')).data;
  const cashAcct = tb.rows.filter((x) => ['1100', '1200'].includes(x.code));
  const cash = cashAcct.reduce((sum, x) => sum + (x.balanceDebit - x.balanceCredit), 0);
  assert.strictEqual(cents(s.data.finance.cash), cents(cash));
  const p = await call('GET', '/api/owner/pending');
  assert.strictEqual(p.status, 200);
  assert.ok(Array.isArray(p.data.items));
  for (const it of p.data.items) {
    assert.ok(['po', 'payroll-post', 'payroll-pay', 'period-close'].includes(it.kind));
    assert.ok(it.action && it.action.path);
  }
  // غير مسجَّل دخول: لا وصول
  const cur = cookie; cookie = '';
  assert.strictEqual((await call('GET', '/api/owner/summary')).status, 401);
  cookie = cur;
});

test('مراكز التكلفة والموازنات: الوسم والعكس والموازنة مقابل الفعلي', { skip: !hasDb || !canWrite }, async () => {
  const cents = (n) => Math.round(n * 100), code = 'T' + String(Date.now()).slice(-8);
  const c1 = await call('POST', '/api/cost-centers', { code, name: 'مركز اختبار' });
  assert.strictEqual(c1.status, 201);
  assert.strictEqual((await call('POST', '/api/cost-centers', { code, name: 'مكرر' })).status, 409);
  const id = c1.data.id;
  const e = await call('POST', '/api/entries', { date: '2026-12-05', memo: 'اختبار مركز', lines: [
    { account: '1100', debit: '700', credit: '0', cc: id }, { account: '4100', debit: '0', credit: '700', cc: id } ] });
  assert.strictEqual(e.status, 201);
  assert.ok(e.data.entry.lines.some((l) => l.costCenter === code));
  const pl = (await call('GET', `/api/reports/cost-center-pl?from=2026-12-01&to=2026-12-31&cc=${id}`)).data;
  const mine = pl.summary.find((x) => x.id === id);
  assert.strictEqual(cents(mine.revenue), 70000);
  assert.strictEqual(cents(pl.detail.reduce((s, x) => s + x.amount, 0)), 70000);
  // العكس يرث المركز فيصفّر أثره
  assert.strictEqual((await call('POST', `/api/entries/${e.data.entry.id}/reverse`, {})).status, 201);
  const pl2 = (await call('GET', `/api/reports/cost-center-pl?from=2026-12-01&to=2026-12-31`)).data;
  assert.ok(!pl2.summary.find((x) => x.id === id));
  // الملخص يطابق قائمة الدخل (مع غير الموزّع)
  const is = (await call('GET', '/api/reports/income-statement?from=2026-01-01&to=2026-12-31')).data;
  const pl3 = (await call('GET', '/api/reports/cost-center-pl?from=2026-01-01&to=2026-12-31')).data;
  assert.strictEqual(cents(pl3.totals.revenue), cents(is.totalRevenue));
  assert.strictEqual(cents(pl3.totals.expense), cents(is.totalExpense));
  // الموازنة
  const g = (await call('GET', '/api/budgets/2026')).data;
  assert.ok(g.rows.length && g.rows.every((x) => x.months.length === 12));
  const months = Array(12).fill(0); months[0] = 1000; months[1] = 500.5;
  assert.strictEqual((await call('PUT', '/api/budgets/2026', { cc: 0, rows: [{ account: '4100', months }, { account: '5200', months: Array(12).fill(10) }] })).status, 200);
  assert.strictEqual((await call('PUT', '/api/budgets/2026', { cc: 0, rows: [{ account: '1100', months }] })).status, 400);
  assert.strictEqual((await call('PUT', '/api/budgets/2026', { cc: 0, rows: [{ account: '4100', months: [1] }] })).status, 400);
  const bva = (await call('GET', '/api/reports/budget-vs-actual?year=2026&month=12')).data;
  assert.strictEqual(cents(bva.totals.revBudget), 150050);
  assert.strictEqual(cents(bva.totals.expBudget), 12000);
  assert.strictEqual(cents(bva.totals.revActual), cents(is.totalRevenue));
  assert.strictEqual(cents(bva.monthly.reduce((s, x) => s + x.revBudget, 0)), cents(bva.totals.revBudget));
  const part = (await call('GET', '/api/reports/budget-vs-actual?year=2026&fromMonth=2&month=2')).data;
  assert.strictEqual(cents(part.totals.revBudget), 50050);
  assert.strictEqual((await call('GET', '/api/reports/budget-vs-actual?year=2026&month=13')).status, 400);
  await call('PUT', '/api/budgets/2026', { cc: 0, rows: [] });
  // مركز مستخدم لا يُحذف
  assert.strictEqual((await call('DELETE', `/api/cost-centers/${id}`)).status, 409);
  assert.strictEqual((await call('PATCH', `/api/cost-centers/${id}`, { active: false })).status, 200);
});

test('حالة النظام: فحوص السلامة وصلاحية المدير فقط', { skip: !hasDb || !canWrite }, async () => {
  const st = await call('GET', '/api/system/status');
  assert.strictEqual(st.status, 200);
  assert.ok(st.data.version && st.data.counts.entries >= 0 && Array.isArray(st.data.checks));
  assert.strictEqual(st.data.checks.find((c) => c.key === 'tb').ok, true);
  assert.strictEqual(st.data.checks.find((c) => c.key === 'entries').ok, true);
});

test('تقارير المبيعات والمشتريات الإضافية: المستحقات والأرصدة والمقبوضات والمقارنة والإشعارات', { skip: !hasDb || !canWrite }, async () => {
  const cents = (n) => Math.round(n * 100), far = '2099-12-31', q = 'from=2000-01-01&to=' + far;
  for (const kind of ['SALES', 'PURCHASE']) {
    const op = (await call('GET', `/api/reports/open-invoices?kind=${kind}&asof=${far}`)).data;
    assert.strictEqual(cents(op.buckets.reduce((s, b) => s + b.amount, 0)), cents(op.totals.remaining));
    assert.ok(op.rows.every((x) => x.remaining > 0));
  }
  // أرصدة الأطراف: المجموع = مجموع party_balance، والرصيد = مفوتر + إشعارات − مسدد
  for (const kind of ['CUSTOMER', 'SUPPLIER']) {
    const pb = (await call('GET', `/api/reports/party-balances?kind=${kind}`)).data;
    for (const x of pb.rows) assert.strictEqual(cents(x.invoiced + x.notes - x.paid), cents(x.balance), x.name);
    assert.strictEqual(cents(pb.totals.balance), cents(pb.rows.reduce((s, x) => s + x.balance, 0)));
  }
  const ps = (await call('GET', `/api/reports/payments-summary?${q}`)).data;
  assert.strictEqual(cents(ps.totals.receipts), cents(ps.methods.filter((m) => m.kind === 'RECEIPT').reduce((s, m) => s + m.amount, 0)));
  assert.strictEqual(cents(ps.totals.payments), cents(ps.methods.filter((m) => m.kind === 'PAYMENT').reduce((s, m) => s + m.amount, 0)));
  // المقارنة: إجمالي الفترة الحالية = تحليل المبيعات للفترة نفسها
  const cmp = (await call('GET', `/api/reports/sales-comparison?kind=SALES&by=party&f1=2000-01-01&t1=${far}&f2=2000-01-01&t2=${far}`)).data;
  const an = (await call('GET', `/api/reports/sales-analysis?${q}&kind=SALES&by=party`)).data;
  assert.strictEqual(cents(cmp.totals.current), cents(an.total));
  assert.strictEqual(cents(cmp.totals.diff), 0);
  const ns = (await call('GET', `/api/reports/notes-summary?${q}`)).data;
  assert.strictEqual(ns.groups.reduce((s, g) => s + g.count, 0), ns.rows.length);
  assert.strictEqual((await call('GET', '/api/reports/payments-summary?from=2026-05-01&to=2026-01-01')).status, 400);
  assert.strictEqual((await call('GET', '/api/reports/open-invoices?kind=SALES')).status, 400);
});

test('التنبيهات والاستيراد: بنية التنبيهات، وتجربة الاستيراد لا تحفظ، والحقيقي يحفظ الصحيح ويرفض المكرر والخاطئ', { skip: !hasDb || !canWrite }, async () => {
  const al = await call('GET', '/api/alerts');
  assert.strictEqual(al.status, 200);
  for (const a of al.data.alerts) { assert.ok(['bad', 'warn', 'info'].includes(a.level) && a.count > 0 && a.href.startsWith('#/')); }
  const st = Date.now().toString(36);
  const before = (await call('GET', '/api/parties?kind=CUSTOMER')).data.parties.length;
  const rows = [{ name: 'مستورد ' + st + 'أ', phone: '0500000001', taxNo: '310122393500003' }, { name: 'مستورد ' + st + 'ب' }, { name: 'مستورد ' + st + 'أ' }, { name: 'ضريبي خاطئ ' + st, taxNo: '123' }, { name: '' }];
  const dry = await call('POST', '/api/import/parties', { kind: 'CUSTOMER', rows, dryRun: true });
  assert.strictEqual(dry.status, 200);
  assert.deepStrictEqual([dry.data.ok, dry.data.failed], [2, 3]);
  assert.strictEqual((await call('GET', '/api/parties?kind=CUSTOMER')).data.parties.length, before);   // التجربة لم تحفظ
  const real = await call('POST', '/api/import/parties', { kind: 'CUSTOMER', rows, dryRun: false });
  assert.deepStrictEqual([real.data.ok, real.data.failed], [2, 3]);
  assert.strictEqual((await call('GET', '/api/parties?kind=CUSTOMER')).data.parties.length, before + 2);
  const again = await call('POST', '/api/import/parties', { kind: 'CUSTOMER', rows: [rows[0]], dryRun: false });
  assert.strictEqual(again.data.failed, 1);       // موجود مسبقاً
  assert.strictEqual((await call('POST', '/api/import/parties', { kind: 'X', rows })).status, 400);
  assert.strictEqual((await call('POST', '/api/import/parties', { kind: 'CUSTOMER', rows: [] })).status, 400);
  // أصناف: رمز مكرر داخل الملف، وسعر خاطئ، وخدمة
  const items = [{ code: 'IM' + st + '1', name: 'صنف مستورد', unit: 'علبة', price: '12.5', vat: '15', trackStock: 'نعم' }, { code: 'IM' + st + '2', name: 'خدمة مستوردة', price: '100', trackStock: 'لا' },
    { code: 'IM' + st + '1', name: 'مكرر' }, { code: 'IM' + st + '3', name: 'سعر خاطئ', price: 'abc' }];
  const ri = await call('POST', '/api/import/items', { rows: items, dryRun: false });
  assert.deepStrictEqual([ri.data.ok, ri.data.failed], [2, 2]);
  const list = (await call('GET', '/api/items')).data.items;
  assert.strictEqual(list.find((x) => x.code === 'IM' + st + '2').trackStock, 'N');
  assert.strictEqual(list.find((x) => x.code === 'IM' + st + '1').price, 12.5);
});

test('الصلاحيات الحساسة: الإلغاء والاعتماد علمان مستقلان عن كتابة الوحدة، ونسخ الدور', { skip: !hasDb || !canWrite }, async () => {
  const st = Date.now().toString(36).slice(-6), rid = 'lim' + st;
  // دور بكتابة التجارة والطلبات بلا إلغاء ولا اعتماد
  assert.strictEqual((await call('POST', '/api/roles', { id: rid, name: 'محدود ' + st, perms: { trade: 'w', orders: 'w', inventory: 'r', _void: 'n', _approve: 'n' } })).status, 201);
  const un = 'u' + st, pw = 'Password123';
  assert.strictEqual((await call('POST', '/api/users', { username: un, roleId: rid, password: pw })).status, 201);
  const adminCookie = cookie; cookie = '';
  assert.strictEqual((await call('POST', '/api/login', { username: un, password: pw })).status, 200);
  // يكتب في التجارة
  const p = await call('POST', '/api/parties', { kind: 'CUSTOMER', name: 'عميل محدود ' + st });
  assert.strictEqual(p.status, 201);
  const inv = await call('POST', '/api/invoices', { kind: 'SALES', partyId: p.data.id, date: '2026-01-27', lines: [{ description: 'خدمة', qty: 1, price: 50, vatRate: 15, account: '4200' }] });
  assert.strictEqual(inv.status, 201);
  // لكن لا يلغي ولا يحذف
  const v1 = await call('POST', `/api/invoices/${inv.data.invoice.id}/void`, {});
  assert.strictEqual(v1.status, 403); assert.ok(/الإلغاء/.test(v1.data.error));
  assert.strictEqual((await call('DELETE', `/api/parties/${p.data.id}`)).status, 403);
  // ولا يعتمد أمر شراء
  const sup = await call('POST', '/api/parties', { kind: 'SUPPLIER', name: 'مورد محدود ' + st });
  const po = await call('POST', '/api/po', { partyId: sup.data.id, date: '2026-01-27', lines: [{ description: 'بند', qty: 1, price: 10, vatRate: 15, account: '5400' }] });
  assert.strictEqual(po.status, 201);
  const ap = await call('POST', `/api/po/${po.data.order ? po.data.order.id : po.data.id}/approve`, {});
  assert.strictEqual(ap.status, 403); assert.ok(/الاعتماد/.test(ap.data.error));
  assert.strictEqual((await call('POST', '/api/periods/close', { month: '2026-01-01' })).status, 403);
  const me = await call('GET', '/api/me');
  assert.strictEqual(me.data.perms._void, 'n'); assert.strictEqual(me.data.perms._approve, 'n');
  cookie = adminCookie;
  // المدير يستطيع، ونسخ الدور ينقل الأعلام
  assert.strictEqual((await call('POST', `/api/roles/${rid}/clone`, { id: rid + 'c', name: 'نسخة ' + st })).status, 201);
  const roles = (await call('GET', '/api/roles')).data.roles;
  const cl = roles.find((x) => x.id === rid + 'c');
  assert.strictEqual(cl.perms.trade, 'w'); assert.strictEqual(cl.perms._void, 'n'); assert.strictEqual(cl.builtin, 'N');
  assert.strictEqual((await call('POST', `/api/roles/${rid}/clone`, { id: rid + 'c', name: 'مكرر' })).status, 409);
  assert.strictEqual((await call('POST', '/api/roles/nope/clone', { id: 'zz' + st, name: 'x' })).status, 404);
  // دور بلا أعلام صريحة (قديم، من قبل إضافة هذين العلمين) يُعامل كممنوع افتراضاً (أكثر أماناً)؛
  // migrate.js يُكمِّل الأدوار الجاهزة القديمة بالقيمة الصحيحة من BUILTIN_ROLES عند الترقية
  assert.strictEqual(require('../server/security').cleanPerms({ trade: 'w' })._void, 'n');
  assert.strictEqual(require('../server/security').cleanPerms({ trade: 'w', _void: 'y' })._void, 'y');
});

test('ترقية الأدوار الجاهزة القديمة: migrate.js يُكمِّل أعلام _void/_approve الناقصة دون لمس بقية الصلاحيات', { skip: !hasDb || !canWrite }, async () => {
  const db = require('../server/db');
  const { ensureSchema } = require('../server/migrate');
  // محاكاة دور جاهز محفوظ قبل إضافة هذين العلمين (كما في تثبيت أُنشئ قبل هذه الميزة ثم رُقّي)
  const before = (await db.query("SELECT perms AS \"p\" FROM web_roles WHERE role_id = 'cashier'"))[0].p;
  const stripped = JSON.parse(before); delete stripped._void; delete stripped._approve;
  await db.run('UPDATE web_roles SET perms = :p WHERE role_id = :id', { p: JSON.stringify(stripped), id: 'cashier' });
  const mid = JSON.parse((await db.query("SELECT perms AS \"p\" FROM web_roles WHERE role_id = 'cashier'"))[0].p);
  assert.ok(!('_void' in mid) && !('_approve' in mid));
  await ensureSchema();   // كما يحدث عند كل إقلاع للخادم
  const after = JSON.parse((await db.query("SELECT perms AS \"p\" FROM web_roles WHERE role_id = 'cashier'"))[0].p);
  assert.strictEqual(after._void, 'n'); assert.strictEqual(after._approve, 'n');   // القيمة الصحيحة من BUILTIN_ROLES، لا 'y' الخطرة
  assert.strictEqual(after.pos, 'w');   // صلاحيات الوحدات لم تتأثر
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
