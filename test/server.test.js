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
