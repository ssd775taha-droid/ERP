const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

async function boot() {
  const srv = createApp({ dbFile: ':memory:' });
  const http = srv.app.listen(0);
  const base = `http://127.0.0.1:${http.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const t = await r.text();
    let j = null;
    try { j = JSON.parse(t); } catch { /* html */ }
    return { status: r.status, body: j };
  };
  const db = (b) => call('POST', '/api/db', b);
  const close = () => { http.closeAllConnections(); http.close(); srv.close(); };
  return { call, db, close, clear: () => { cookie = ''; } };
}

const OWNER = { username: 'owner', name: 'مالك', password: 'password123' };

test('الإعداد الأول ثم الدخول وحماية الواجهات', async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('GET', '/api/auth/state')).body.needsSetup, true);
    assert.equal((await t.db({ op: 'get', path: 'a/b' })).status, 401);
    assert.equal((await t.call('GET', '/')).status, 302);
    assert.equal((await t.call('GET', '/audit.html')).status, 302);
    assert.equal((await t.call('GET', '/login.html')).status, 200);

    assert.equal((await t.call('POST', '/api/auth/setup', { ...OWNER, password: 'short' })).status, 400);
    const ok = await t.call('POST', '/api/auth/setup', { ...OWNER, username: 'Owner' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.role, 'owner');
    assert.equal((await t.call('POST', '/api/auth/setup', { ...OWNER, username: 'other' })).status, 403);
    assert.equal((await t.call('GET', '/audit.html')).status, 200);
    assert.equal((await t.call('GET', '/vendor/jspdf.umd.min.js')).status, 200);
  } finally { t.close(); }
});

test('المستند: set/get/update/delete', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/auth/setup', OWNER);
    await t.db({ op: 'set', path: 'm/audit/clients/c1', data: { name: 'شركة', a: { b: 1 } } });
    assert.deepEqual((await t.db({ op: 'get', path: 'm/audit/clients/c1' })).body.data.a, { b: 1 });
    await t.db({ op: 'update', path: 'm/audit/clients/c1', data: { 'a.b': 2, tag: 'x' } });
    const g = (await t.db({ op: 'get', path: 'm/audit/clients/c1' })).body;
    assert.equal(g.data.a.b, 2);
    assert.equal(g.data.tag, 'x');
    assert.equal((await t.db({ op: 'update', path: 'm/audit/clients/none', data: { a: 1 } })).status, 404);
    await t.db({ op: 'delete', path: 'm/audit/clients/c1' });
    assert.equal((await t.db({ op: 'get', path: 'm/audit/clients/c1' })).body.exists, false);
    assert.equal((await t.db({ op: 'get', path: 'a/../b' })).status, 400);
    assert.equal((await t.db({ op: 'get', path: 'a/b/c' })).status, 400);
  } finally { t.close(); }
});

test('الاستعلام: where وorderBy وlimit والإضافة', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/auth/setup', OWNER);
    for (const [id, d] of [['a', { n: 3, tags: ['x'], t: 'ب' }], ['b', { n: 1, tags: ['y'], t: 'أ' }], ['c', { n: 2 }]]) {
      await t.db({ op: 'set', path: `col/${id}`, data: d });
    }
    const ids = async (spec) => (await t.db({ op: 'query', path: 'col', ...spec })).body.docs.map((d) => d.id);
    assert.deepEqual(await ids({ orderBy: [['n', 'asc']] }), ['b', 'c', 'a']);
    assert.deepEqual(await ids({ orderBy: [['n', 'desc']], limit: 2 }), ['a', 'c']);
    assert.deepEqual(await ids({ where: [['n', '>=', 2]], orderBy: [['n', 'asc']] }), ['c', 'a']);
    assert.deepEqual(await ids({ where: [['tags', 'array-contains', 'y']] }), ['b']);
    assert.deepEqual(await ids({ where: [['n', 'in', [1, 3]]], orderBy: [['n', 'asc']] }), ['b', 'a']);
    assert.deepEqual(await ids({ orderBy: [['t', 'asc']] }), ['b', 'a']);
    assert.equal((await t.db({ op: 'query', path: 'col', where: [['n', '~', 1]] })).status, 400);
    assert.ok((await t.db({ op: 'add', path: 'col', data: { n: 9 } })).body.id);
    assert.equal((await ids({})).length, 4);
  } finally { t.close(); }
});

test('إدارة المستخدمين والصلاحيات', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/auth/setup', OWNER);
    const body = { username: 'sara', name: 'سارة', password: 'password456' };
    assert.equal((await t.call('POST', '/api/admin/users', body)).status, 200);
    assert.equal((await t.call('POST', '/api/admin/users', body)).status, 409);
    const me = (await t.call('GET', '/api/auth/state')).body.user;
    assert.equal((await t.call('PATCH', `/api/admin/users/${me.id}`, { active: false })).status, 400);

    t.clear();
    assert.equal((await t.call('POST', '/api/auth/login', { username: 'sara', password: 'wrong-pass' })).status, 401);
    assert.equal((await t.call('POST', '/api/auth/login', { username: 'sara', password: 'password456' })).status, 200);
    assert.equal((await t.call('GET', '/api/admin/users')).status, 403);
    assert.equal((await t.db({ op: 'set', path: 'a/b', data: { x: 1 } })).status, 200);
    await t.call('POST', '/api/auth/logout');
    assert.equal((await t.db({ op: 'get', path: 'a/b' })).status, 401);
  } finally { t.close(); }
});

test('تقييد محاولات الدخول الفاشلة', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/auth/setup', OWNER);
    t.clear();
    for (let i = 0; i < 5; i++) await t.call('POST', '/api/auth/login', { username: 'owner', password: 'nope-nope' });
    assert.equal((await t.call('POST', '/api/auth/login', { username: 'owner', password: 'password123' })).status, 429);
  } finally { t.close(); }
});

test('فحص الصحة والنسخ الاحتياطي مع الإبقاء على الأحدث', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { backup } = require('../server/backup');
  const t = await boot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-bk-'));
  const srv = createApp({ dbFile: ':memory:' });
  try {
    assert.equal((await t.call('GET', '/healthz')).body.ok, true);
    srv.store.setDoc('a/b', { x: 1 });
    for (let i = 0; i < 4; i++) { backup(srv.store, dir, 2); await new Promise((r) => setTimeout(r, 5)); }
    assert.equal(fs.readdirSync(dir).length, 2);
  } finally { t.close(); srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('وكيل المساعد الذكي: مفتاح مخفي، تحقق، وإعادة توجيه', async () => {
  const http = require('node:http');
  const { createAi } = require('../server/ai');
  const seen = [];
  const mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      seen.push({ key: req.headers['x-api-key'], body: JSON.parse(b) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'مرحبا' }], stop_reason: 'end_turn' }));
    });
  }).listen(0);
  const baseUrl = `http://127.0.0.1:${mock.address().port}`;
  const on = createApp({ dbFile: ':memory:', ai: createAi({ apiKey: 'sk-test', baseUrl }) });
  const off = createApp({ dbFile: ':memory:', ai: createAi({ apiKey: '' }) });
  const srvs = [on, off].map((s) => ({ s, http: s.app.listen(0) }));
  const run = async (i, method, url, body, cookie) => {
    const r = await fetch(`http://127.0.0.1:${srvs[i].http.address().port}${url}`, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    return { r, j: await r.json().catch(() => null) };
  };
  try {
    const cookies = [];
    for (const i of [0, 1]) {
      const { r } = await run(i, 'POST', '/api/auth/setup', OWNER);
      cookies[i] = r.headers.get('set-cookie').split(';')[0];
    }
    assert.equal((await run(0, 'GET', '/api/ai/status')).r.status, 401);
    assert.equal((await run(0, 'GET', '/api/ai/status', null, cookies[0])).j.enabled, true);
    assert.equal((await run(1, 'GET', '/api/ai/status', null, cookies[1])).j.enabled, false);
    assert.equal((await run(1, 'POST', '/api/ai', { messages: [{ role: 'user', content: 'x' }] }, cookies[1])).r.status, 503);
    assert.equal((await run(0, 'POST', '/api/ai', { messages: [] }, cookies[0])).r.status, 400);
    assert.equal((await run(0, 'POST', '/api/ai', { messages: [{ role: 'system', content: 'x' }] }, cookies[0])).r.status, 400);
    const ok = await run(0, 'POST', '/api/ai', { messages: [{ role: 'user', content: 'سلام' }], tools: [{ name: 't', input_schema: { type: 'object' } }], model: 'evil' }, cookies[0]);
    assert.equal(ok.r.status, 200);
    assert.equal(ok.j.content[0].text, 'مرحبا');
    assert.equal(seen[0].key, 'sk-test');
    assert.equal(seen[0].body.model, 'claude-sonnet-5-5');
    assert.equal(seen[0].body.tools[0].name, 't');
    assert.equal(JSON.stringify(ok.j).includes('sk-test'), false);
  } finally {
    for (const x of srvs) { x.http.closeAllConnections(); x.http.close(); x.s.close(); }
    mock.closeAllConnections(); mock.close();
  }
});

test('المحاسبة العامة: قيد متوازن، رفض غير المتوازن، ميزان مراجعة، دفتر أستاذ، وعكس القيد', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/auth/setup', OWNER);
    assert.equal((await t.call('POST', '/api/erp/accounts/seed')).body.created > 10, true);
    assert.equal((await t.call('POST', '/api/erp/accounts/seed')).status, 409);
    const post = (lines, date = '2026-01-10') => t.call('POST', '/api/erp/entries', { date, memo: 'ت', lines });

    assert.equal((await post([{ account: '1100', debit: 100 }, { account: '3100', credit: 90 }])).status, 400);
    assert.equal((await post([{ account: '1000', debit: 100 }, { account: '3100', credit: 100 }])).status, 400, 'تجميعي');
    assert.equal((await post([{ account: '1100', debit: 0.1 }, { account: '1200', debit: 0.2 }, { account: '3100', credit: 0.3 }])).status, 200, 'لا أخطاء فاصلة عائمة');
    assert.equal((await post([{ account: '1100', debit: 100, credit: 5 }, { account: '3100', credit: 95 }])).status, 400);

    const cap = await post([{ account: '1200', debit: 1000 }, { account: '3100', credit: 1000 }]);
    assert.equal(cap.status, 200);
    await post([{ account: '1100', debit: 250.5 }, { account: '4100', credit: 250.5 }], '2026-02-01');

    const tb = (await t.call('GET', '/api/erp/trial-balance')).body;
    assert.equal(tb.balanced, true);
    assert.equal(tb.totals.debit, tb.totals.credit);
    assert.equal(tb.rows.find((r) => r.code === '1100').balance_debit, 25050 + 10);

    const early = (await t.call('GET', '/api/erp/trial-balance?to=2026-01-31')).body;
    assert.equal(early.rows.find((r) => r.code === '4100'), undefined);

    const lg = (await t.call('GET', '/api/erp/ledger/1100')).body;
    assert.equal(lg.closing, 25060);
    assert.equal((await t.call('GET', '/api/erp/ledger/4100')).body.closing, 25050, 'الإيراد دائن طبيعياً');

    const rev = await t.call('POST', `/api/erp/entries/${cap.body.entry.id}/reverse`, {});
    assert.equal(rev.status, 200);
    assert.equal((await t.call('POST', `/api/erp/entries/${cap.body.entry.id}/reverse`, {})).status, 409);
    assert.equal((await t.call('POST', `/api/erp/entries/${rev.body.entry.id}/reverse`, {})).status, 400);
    assert.equal((await t.call('GET', '/api/erp/ledger/3100')).body.closing, 30, 'بعد عكس رأس المال يبقى قيد 0.3');
    assert.equal((await t.call('GET', '/api/erp/trial-balance')).body.balanced, true);
  } finally { t.close(); }
});

test('المبيعات والمشتريات: فواتير بضريبة، قيود تلقائية، مدفوعات، كشف حساب، وإلغاء', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/auth/setup', OWNER);
    const inv0 = { kind: 'sales', date: '2026-03-01', lines: [{ description: 'خدمة', qty: 2, price: 100, vat_rate: 15 }] };
    assert.equal((await t.call('POST', '/api/erp/parties', { kind: 'customer', name: 'ع' })).status, 200);
    assert.equal((await t.call('POST', '/api/erp/invoices', { ...inv0, party_id: 1 })).status, 409, 'بلا دليل حسابات');
    await t.call('POST', '/api/erp/accounts/seed');
    const sup = (await t.call('POST', '/api/erp/parties', { kind: 'supplier', name: 'م' })).body.party;

    assert.equal((await t.call('POST', '/api/erp/invoices', { ...inv0, party_id: sup.id })).status, 400, 'مبيعات لمورد');
    assert.equal((await t.call('POST', '/api/erp/invoices', { ...inv0, party_id: 1, lines: [{ qty: 1, price: 5, account: '5100' }] })).status, 400, 'إيراد فقط');

    const si = (await t.call('POST', '/api/erp/invoices', { ...inv0, party_id: 1 })).body.invoice;
    assert.equal(si.number, 'S-000001');
    assert.deepEqual([si.subtotal, si.vat, si.total], [20000, 3000, 23000]);

    const pi = await t.call('POST', '/api/erp/invoices', { kind: 'purchase', party_id: sup.id, date: '2026-03-02', lines: [{ description: 'بضاعة', qty: 10, price: 12.5, vat_rate: 15 }] });
    assert.equal(pi.body.invoice.total, 14375);

    const tb = (await t.call('GET', '/api/erp/trial-balance')).body;
    const bal = (c) => tb.rows.find((r) => r.code === c);
    assert.equal(tb.balanced, true);
    assert.equal(bal('1300').balance_debit, 23000);
    assert.equal(bal('4100').balance_credit, 20000);
    assert.equal(bal('2100').balance_credit, 14375);
    assert.equal(bal('2200').balance_credit, 3000 - 1875, 'ضريبة المخرجات ناقص المدخلات');

    assert.equal((await t.call('POST', '/api/erp/payments', { party_id: 1, invoice_id: si.id, date: '2026-03-05', amount: 300, method: 'bank' })).status, 400, 'أكثر من المتبقي');
    assert.equal((await t.call('POST', '/api/erp/payments', { party_id: 1, invoice_id: si.id, date: '2026-03-05', amount: 100, method: 'bank' })).status, 200);
    assert.equal((await t.call('GET', `/api/erp/invoices/${si.id}`)).body.invoice.remaining, 13000);
    assert.equal((await t.call('POST', `/api/erp/invoices/${si.id}/void`)).status, 409, 'عليها مدفوعات');
    assert.equal((await t.call('POST', '/api/erp/payments', { party_id: sup.id, date: '2026-03-06', amount: 143.75, method: 'cash', invoice_id: pi.body.invoice.id })).status, 200);

    const st = (await t.call('GET', '/api/erp/parties/1/statement')).body;
    assert.equal(st.balance, 13000);
    assert.equal(st.rows.length, 2);
    const sm = (await t.call('GET', '/api/erp/trade/summary')).body;
    assert.deepEqual([sm.receivable, sm.payable], [13000, 0]);

    const v = await t.call('POST', `/api/erp/invoices/${pi.body.invoice.id}/void`);
    assert.equal(v.status, 409);
    const si2 = (await t.call('POST', '/api/erp/invoices', { ...inv0, party_id: 1 })).body.invoice;
    assert.equal((await t.call('POST', `/api/erp/invoices/${si2.id}/void`)).body.invoice.status, 'void');
    assert.equal((await t.call('GET', '/api/erp/trial-balance')).body.balanced, true);
    assert.equal((await t.call('GET', '/api/erp/parties/1/statement')).body.balance, 13000, 'الملغاة لا تظهر');

    // فشل الترحيل لا يترك فاتورة يتيمة
    const before = (await t.call('GET', '/api/erp/invoices')).body.invoices.length;
    assert.equal((await t.call('POST', '/api/erp/invoices', { ...inv0, party_id: 1, date: 'bad' })).status, 400);
    assert.equal((await t.call('GET', '/api/erp/invoices')).body.invoices.length, before);
  } finally { t.close(); }
});
