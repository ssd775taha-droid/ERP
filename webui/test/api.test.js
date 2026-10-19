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
