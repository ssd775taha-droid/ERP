// مخزن مستندات بأسلوب Firestore فوق PostgreSQL: المسار الزوجي مستند، والفردي مجموعة.
const { Pool } = require('pg');

const OPS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains', 'array-contains-any']);

function segs(path) {
  const s = String(path || '').split('/').filter(Boolean);
  if (!s.length || s.some((x) => x === '.' || x === '..')) throw httpError(400, 'مسار غير صالح');
  return s;
}
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function docParts(path) {
  const s = segs(path);
  if (s.length % 2) throw httpError(400, 'المسار يشير إلى مجموعة وليس مستنداً');
  return { path: s.join('/'), id: s[s.length - 1], parent: s.slice(0, -1).join('/') };
}
function colPath(path) {
  const s = segs(path);
  if (!(s.length % 2)) throw httpError(400, 'المسار يشير إلى مستند وليس مجموعة');
  return s.join('/');
}
function getField(obj, field) {
  let v = obj;
  for (const k of String(field).split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = v[k];
  }
  return v;
}
function setField(obj, field, value) {
  const ks = String(field).split('.');
  // منع تلويث Object.prototype عبر مفاتيح مثل __proto__
  if (ks.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) throw httpError(400, 'اسم حقل غير مسموح');
  let o = obj;
  for (const k of ks.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[ks[ks.length - 1]] = value;
}
function cmp(a, b) {
  if (a === b) return 0;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : 1;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (a && b && typeof a === 'object' && typeof b === 'object' && '__d' in a && '__d' in b) return a.__d - b.__d;
  return String(typeof a).localeCompare(String(typeof b)) || (String(a) < String(b) ? -1 : 1);
}
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function match(v, op, x) {
  switch (op) {
    case '==': return v !== undefined && same(v, x);
    case '!=': return v !== undefined && !same(v, x);
    case '<': return v !== undefined && cmp(v, x) < 0;
    case '<=': return v !== undefined && cmp(v, x) <= 0;
    case '>': return v !== undefined && cmp(v, x) > 0;
    case '>=': return v !== undefined && cmp(v, x) >= 0;
    case 'in': return Array.isArray(x) && x.some((y) => same(v, y));
    case 'not-in': return v !== undefined && Array.isArray(x) && !x.some((y) => same(v, y));
    case 'array-contains': return Array.isArray(v) && v.some((y) => same(y, x));
    case 'array-contains-any': return Array.isArray(v) && Array.isArray(x) && v.some((y) => x.some((z) => same(y, z)));
    default: return false;
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS docs (
    path TEXT PRIMARY KEY, parent TEXT NOT NULL, id TEXT NOT NULL,
    data JSONB NOT NULL, updated BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL, pass TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires BIGINT NOT NULL
  );
`;

class Store {
  constructor(connectionString) {
    this.pool = new Pool({ connectionString });
  }
  async init() {
    await this.pool.query(SCHEMA);
    return this;
  }

  async getDoc(path) {
    const { path: p } = docParts(path);
    const r = await this.pool.query('SELECT data FROM docs WHERE path = $1', [p]);
    return r.rows[0] ? r.rows[0].data : null;
  }
  async setDoc(path, data) {
    const d = docParts(path);
    if (data == null || typeof data !== 'object' || Array.isArray(data)) throw httpError(400, 'بيانات المستند يجب أن تكون كائناً');
    await this.pool.query(
      `INSERT INTO docs (path, parent, id, data, updated) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (path) DO UPDATE SET data = excluded.data, updated = excluded.updated`,
      [d.path, d.parent, d.id, JSON.stringify(data), Date.now()],
    );
    return d;
  }
  async updateDoc(path, patch) {
    const d = docParts(path);
    const cur = await this.getDoc(d.path);
    if (!cur) throw httpError(404, 'المستند غير موجود');
    for (const [k, v] of Object.entries(patch || {})) setField(cur, k, v);
    await this.pool.query(
      `INSERT INTO docs (path, parent, id, data, updated) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (path) DO UPDATE SET data = excluded.data, updated = excluded.updated`,
      [d.path, d.parent, d.id, JSON.stringify(cur), Date.now()],
    );
    return d;
  }
  async deleteDoc(path) {
    const d = docParts(path);
    await this.pool.query('DELETE FROM docs WHERE path = $1', [d.path]);
    return d;
  }
  async addDoc(col, data) {
    const c = colPath(col);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    return this.setDoc(`${c}/${id}`, data);
  }
  async query(col, { where = [], orderBy = [], limit } = {}) {
    const c = colPath(col);
    const r = await this.pool.query('SELECT id, data FROM docs WHERE parent = $1', [c]);
    let rows = r.rows.map((row) => ({ id: row.id, data: row.data }));
    for (const [f, op, v] of where) {
      if (!OPS.has(op)) throw httpError(400, 'عامل مقارنة غير مدعوم');
      rows = rows.filter((row) => match(getField(row.data, f), op, v));
    }
    for (const [f] of orderBy) rows = rows.filter((row) => getField(row.data, f) !== undefined);
    const order = orderBy.length ? orderBy : [];
    rows.sort((a, b) => {
      for (const [f, dir] of order) {
        const c2 = cmp(getField(a.data, f), getField(b.data, f));
        if (c2) return dir === 'desc' ? -c2 : c2;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    if (Number.isInteger(limit) && limit >= 0) rows = rows.slice(0, limit);
    return rows;
  }
  async close() {
    await this.pool.end();
  }
}

module.exports = { Store, httpError };
