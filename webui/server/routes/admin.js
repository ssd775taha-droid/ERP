// المستخدمون والأدوار والصلاحيات وسجل العمليات وتغيير كلمة السر. (مدير النظام فقط، ما عدا كلمة السر الشخصية)
const express = require('express');
const db = require('../db');
const v = require('../validate');
const { hashPassword, verifyPassword, MODULES, ACTIONS, cleanPerms, LEVELS } = require('../security');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

function pw(x, label = 'كلمة السر') {
  const s = String(x || '');
  if (s.length < 8) v.bad(`${label}: 8 أحرف على الأقل`);
  if (s.length > 100) v.bad(`${label}: طويلة جداً`);
  return s;
}

module.exports = function adminRoutes(auth) {
  const r = express.Router();

  r.get('/meta/modules', (req, res) => res.json({ modules: MODULES.map(([key, label]) => ({ key, label })), actions: ACTIONS.map(([key, label]) => ({ key, label })), levels: LEVELS }));

  // ---------- الأدوار ----------
  r.get('/roles', wrap(async (req, res) => {
    const rows = await db.query(`SELECT r.role_id AS "id", r.name AS "name", r.perms AS "perms", r.builtin AS "builtin",
      (SELECT COUNT(*) FROM web_users u WHERE u.role_id = r.role_id) AS "users" FROM web_roles r ORDER BY r.builtin DESC, r.name`);
    res.json({ roles: rows.map((x) => ({ ...x, perms: cleanPerms(JSON.parse(x.perms)) })) });
  }));
  r.post('/roles', wrap(async (req, res) => {
    const b = req.body || {};
    const id = v.str(b.id, 'رمز الدور', { max: 30 }).toLowerCase();
    if (!/^[a-z0-9_]{2,30}$/.test(id)) v.bad('رمز الدور: أحرف إنجليزية صغيرة وأرقام وشرطة سفلية');
    await db.run("INSERT INTO web_roles (role_id, name, perms, builtin) VALUES (:i, :n, :p, 'N')", { i: id, n: v.str(b.name, 'اسم الدور', { max: 80 }), p: JSON.stringify(cleanPerms(b.perms)) });
    res.status(201).json({ id });
  }));
  // نسخ دور بصلاحياته إلى دور جديد (يبدأ غير جاهز وقابلاً للحذف)
  r.post('/roles/:id/clone', wrap(async (req, res) => {
    const b = req.body || {};
    const id = v.str(b.id, 'رمز الدور', { max: 30 }).toLowerCase();
    if (!/^[a-z0-9_]{2,30}$/.test(id)) v.bad('رمز الدور: أحرف إنجليزية صغيرة وأرقام وشرطة سفلية');
    const src = (await db.query('SELECT perms AS "p" FROM web_roles WHERE role_id = :i', { i: req.params.id }))[0];
    if (!src) throw new db.HttpError(404, 'الدور المصدر غير موجود');
    const perms = req.params.id === 'admin' ? cleanPerms(Object.fromEntries(MODULES.map(([k]) => [k, 'w']))) : cleanPerms(JSON.parse(src.p));
    await db.run("INSERT INTO web_roles (role_id, name, perms, builtin) VALUES (:i, :n, :p, 'N')", { i: id, n: v.str(b.name, 'اسم الدور', { max: 80 }), p: JSON.stringify(perms) });
    res.status(201).json({ id });
  }));
  r.patch('/roles/:id', wrap(async (req, res) => {
    const id = req.params.id, b = req.body || {};
    if (id === 'admin') v.bad('دور مدير النظام ثابت');
    const r1 = await db.run('UPDATE web_roles SET name = NVL(:n, name), perms = NVL(:p, perms) WHERE role_id = :i',
      { n: b.name === undefined ? null : v.str(b.name, 'اسم الدور', { max: 80 }), p: b.perms === undefined ? null : JSON.stringify(cleanPerms(b.perms)), i: id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'الدور غير موجود');
    auth.invalidate();
    res.json({ ok: true });
  }));
  r.delete('/roles/:id', wrap(async (req, res) => {
    const id = req.params.id;
    const x = (await db.query('SELECT builtin AS "b", (SELECT COUNT(*) FROM web_users WHERE role_id = :i) AS "n" FROM web_roles WHERE role_id = :i', { i: id }))[0];
    if (!x) throw new db.HttpError(404, 'الدور غير موجود');
    if (x.b === 'Y') v.bad('لا تُحذف الأدوار الجاهزة');
    if (x.n > 0) v.bad('الدور مستخدم: انقل مستخدميه إلى دور آخر أولاً');
    await db.run('DELETE FROM web_roles WHERE role_id = :i', { i: id });
    res.json({ ok: true });
  }));

  // ---------- المستخدمون ----------
  r.get('/users', wrap(async (req, res) => {
    const rows = await db.query(`SELECT u.user_id AS "id", u.username AS "username", u.full_name AS "fullName", u.role_id AS "role", r.name AS "roleName", u.active AS "active",
      TO_CHAR(u.created_at, 'YYYY-MM-DD HH24:MI') AS "createdAt", TO_CHAR(u.last_login, 'YYYY-MM-DD HH24:MI') AS "lastLogin"
      FROM web_users u JOIN web_roles r ON r.role_id = u.role_id ORDER BY u.username`);
    res.json({ users: rows, root: auth.rootName });
  }));
  r.post('/users', wrap(async (req, res) => {
    const b = req.body || {};
    const username = v.str(b.username, 'اسم المستخدم', { max: 40 }).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) v.bad('اسم المستخدم: 3 إلى 40 حرفاً إنجليزياً صغيراً أو أرقاماً أو . _ -');
    if (username === auth.rootName.toLowerCase()) v.bad('هذا الاسم محجوز للمدير الأساسي');
    const role = v.str(b.roleId, 'الدور', { max: 30 });
    try {
      const out = await db.run("INSERT INTO web_users (username, full_name, role_id, pw_hash) VALUES (:u, :f, :r, :h) RETURNING user_id INTO :id",
        { u: username, f: v.str(b.fullName, 'الاسم', { max: 120, optional: true }), r: role, h: hashPassword(pw(b.password)), id: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } });
      res.status(201).json({ id: out.outBinds.id[0] });
    } catch (e) {
      if (/ORA-00001/.test(e.message)) v.bad('اسم المستخدم مستخدم');
      if (/ORA-02291/.test(e.message)) v.bad('الدور غير موجود');
      throw e;
    }
  }));
  r.patch('/users/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم المستخدم'), b = req.body || {};
    const cur = (await db.query('SELECT username AS "u" FROM web_users WHERE user_id = :i', { i: id }))[0];
    if (!cur) throw new db.HttpError(404, 'المستخدم غير موجود');
    if (cur.u === (req.user.username || '').toLowerCase() && b.active === false) v.bad('لا يمكنك تعطيل حسابك');
    try {
      await db.run('UPDATE web_users SET full_name = NVL(:f, full_name), role_id = NVL(:r, role_id), active = NVL(:a, active) WHERE user_id = :i',
        { f: b.fullName === undefined ? null : v.str(b.fullName, 'الاسم', { max: 120 }), r: b.roleId === undefined ? null : v.str(b.roleId, 'الدور', { max: 30 }), a: b.active === undefined ? null : (b.active ? 'Y' : 'N'), i: id });
    } catch (e) { if (/ORA-02291/.test(e.message)) v.bad('الدور غير موجود'); throw e; }
    auth.invalidate(cur.u);
    res.json({ ok: true });
  }));
  r.post('/users/:id/password', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم المستخدم');
    const r1 = await db.run('UPDATE web_users SET pw_hash = :h WHERE user_id = :i', { h: hashPassword(pw((req.body || {}).password)), i: id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'المستخدم غير موجود');
    auth.invalidate();
    res.json({ ok: true });
  }));

  // ---------- سجل العمليات ----------
  r.get('/audit', wrap(async (req, res) => {
    const user = req.query.user ? v.str(req.query.user, 'المستخدم', { max: 40 }) : null;
    const limit = Math.min(v.int(req.query.limit, 'الحد', { optional: true }) || 200, 1000);
    res.json({ rows: await db.query(`SELECT audit_id AS "id", TO_CHAR(at, 'YYYY-MM-DD HH24:MI:SS') AS "at", username AS "username", action AS "action", status AS "status", ip AS "ip"
      FROM web_audit WHERE (:u IS NULL OR username = :u) ORDER BY audit_id DESC FETCH FIRST :l ROWS ONLY`, { u: user, l: limit }) });
  }));

  // ---------- كلمة سري ----------
  r.post('/account/password', wrap(async (req, res) => {
    if (req.user.builtin) v.bad('كلمة سر المدير الأساسي تُغيَّر من ملف الإعدادات (ERP_WEB_PASSWORD) أو من اختصار ERP Password');
    const b = req.body || {};
    const row = (await db.query('SELECT pw_hash AS "h" FROM web_users WHERE user_id = :i', { i: req.user.id }))[0];
    if (!row || !verifyPassword(String(b.current || ''), row.h)) v.bad('كلمة السر الحالية غير صحيحة');
    await db.run('UPDATE web_users SET pw_hash = :h WHERE user_id = :i', { h: hashPassword(pw(b.password, 'كلمة السر الجديدة')), i: req.user.id });
    auth.invalidate();
    res.json({ ok: true, relogin: true });
  }));

  return r;
};
