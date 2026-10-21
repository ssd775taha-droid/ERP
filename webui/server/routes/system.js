// حالة النظام (للمدير): الإصدار والقاعدة والأحجام وعدد السجلات ونشاط المستخدمين، وفحوص سلامة محاسبية للقراءة فقط.
const express = require('express');
const db = require('../db');
const { sensitive } = require('../authz');
const { cleanPerms } = require('../security');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const one = async (sql, binds) => (await db.query(sql, binds || {}))[0] || {};
const safe = async (fn, dflt) => { try { return await fn(); } catch (e) { return dflt; } };

module.exports = function systemRoutes(auth) {
  const r = express.Router();

  r.get('/system/status', wrap(async (req, res) => {
    const banner = await safe(async () => (await one('SELECT banner_full AS "v" FROM v$version WHERE ROWNUM = 1')).v, null)
      || await safe(async () => 'Oracle ' + (await one('SELECT version AS "v" FROM product_component_version WHERE ROWNUM = 1')).v, '—');
    const sizeMb = await safe(async () => r2((await one('SELECT NVL(SUM(bytes), 0) / 1048576 AS "mb" FROM user_segments')).mb), null);
    const counts = {};
    for (const [k, t] of [['entries', 'erp_entries'], ['lines', 'erp_lines'], ['accounts', 'erp_accounts'], ['parties', 'erp_parties'], ['invoices', 'erp_invoices'], ['payments', 'erp_payments'],
      ['items', 'erp_items'], ['posSales', 'erp_pos_sales'], ['employees', 'erp_employees'], ['assets', 'erp_assets']]) counts[k] = await safe(async () => (await one(`SELECT COUNT(*) AS "n" FROM ${t}`)).n, null);
    const users = await one(`SELECT COUNT(*) AS "total", NVL(SUM(CASE WHEN active = 'Y' THEN 1 ELSE 0 END), 0) AS "active" FROM web_users`);
    const act = await one(`SELECT COUNT(*) AS "writes", COUNT(DISTINCT username) AS "users" FROM web_audit WHERE at >= SYSTIMESTAMP - INTERVAL '1' DAY AND status < 400 AND action NOT LIKE 'LOGIN%'`);
    const failed = await one(`SELECT COUNT(*) AS "n" FROM web_audit WHERE at >= SYSTIMESTAMP - INTERVAL '1' DAY AND action LIKE 'LOGIN فاشل%'`);
    const last = await one(`SELECT TO_CHAR(MAX(at), 'YYYY-MM-DD HH24:MI:SS') AS "t" FROM web_audit`);
    const periods = await one(`SELECT COUNT(*) AS "closed", TO_CHAR(MAX(period), 'YYYY-MM') AS "last" FROM erp_periods WHERE status = 'CLOSED'`);
    // فحوص السلامة
    const tb = await one('SELECT NVL(SUM(debit), 0) AS "d", NVL(SUM(credit), 0) AS "c" FROM erp_lines');
    const unbal = await one('SELECT COUNT(*) AS "n" FROM (SELECT entry_id FROM erp_lines GROUP BY entry_id HAVING SUM(debit) <> SUM(credit))');
    const inv = await safe(async () => {
      const s = await one('SELECT NVL(SUM(value), 0) AS "v" FROM erp_stock');
      const g = await one(`SELECT NVL(SUM(l.debit - l.credit), 0) AS "v" FROM erp_lines l WHERE l.account_code = '1400'`);
      return r2(g.v - s.v);
    }, null);
    const negStock = await safe(async () => (await one('SELECT COUNT(*) AS "n" FROM erp_stock WHERE qty < 0')).n, 0);
    const checks = [
      { key: 'tb', label: 'ميزان المراجعة متوازن (إجمالي المدين = الدائن)', ok: r2(tb.d - tb.c) === 0, detail: r2(tb.d - tb.c) === 0 ? null : 'الفرق ' + r2(tb.d - tb.c) },
      { key: 'entries', label: 'كل القيود متوازنة', ok: unbal.n === 0, detail: unbal.n ? unbal.n + ' قيد غير متوازن' : null },
      { key: 'inventory', label: 'رصيد المخزون في الدفاتر يطابق قيمة المخزون', ok: inv === null ? null : inv === 0, detail: inv ? 'الفرق ' + inv : null },
      { key: 'negstock', label: 'لا أرصدة مخزون سالبة', ok: negStock === 0, detail: negStock ? negStock + ' صنف' : null },
      { key: 'logins', label: 'لا محاولات دخول فاشلة كثيرة (آخر 24 ساعة)', ok: failed.n < 10, detail: failed.n ? failed.n + ' محاولة' : null },
    ];
    res.json({ version: require('../../package.json').version, uptimeSec: Math.round(process.uptime()), node: process.version, db: { banner, sizeMb },
      counts, users, activity: { writes: act.writes, users: act.users, failedLogins: failed.n, lastAt: last.t }, periods, checks });
  }));

  // مراجعة أمنية: عمليات إلغاء/حذف/عكس أو اعتماد/ترحيل/إقفال ناجحة في السجل، نُفِّذت بحساب لا يملك الدور الحالي
  // لصاحبه هذه الصلاحية (ثغرة 0.35.0: غياب العلم في دور كان يُعامَل كـ«مسموح» بدل «ممنوع» في إصدارات أقدم).
  // المرجع هو دور المستخدم *الحالي* وقت الفحص لا وقت العملية؛ تغيير دوره لاحقاً يُفقِد الفحص الدقة فيُذكر ذلك صراحة.
  r.get('/system/audit-review', wrap(async (req, res) => {
    const rows = await db.query(`
      SELECT a.audit_id AS "id", TO_CHAR(a.at, 'YYYY-MM-DD HH24:MI:SS') AS "at", a.username AS "username", a.action AS "action", a.ip AS "ip",
             u.active AS "userActive", r.role_id AS "roleId", r.name AS "roleName", r.perms AS "rolePerms"
        FROM web_audit a
        LEFT JOIN web_users u ON LOWER(u.username) = LOWER(a.username)
        LEFT JOIN web_roles r ON r.role_id = u.role_id
       WHERE a.status < 400 AND a.username IS NOT NULL AND (a.action LIKE 'POST %' OR a.action LIKE 'DELETE %')
       ORDER BY a.audit_id DESC FETCH FIRST 5000 ROWS ONLY`);
    const flagged = [];
    let scanned = 0;
    for (const row of rows) {
      const sp = row.action.indexOf(' ');
      if (sp < 0) continue;
      const method = row.action.slice(0, sp), path = row.action.slice(sp + 1);
      const act = sensitive({ method, path });
      if (!act) continue;
      scanned++;
      if (row.roleId === 'admin' || (!row.roleId && row.username.toLowerCase() === auth.rootName.toLowerCase())) continue;   // مدير: له الصلاحية دائماً، ليس ثغرة
      let allowed, roleName, note;
      if (!row.roleId) { allowed = null; roleName = null; note = 'المستخدم لم يعد موجوداً: تعذّر معرفة دوره الآن'; }
      else {
        let p; try { p = cleanPerms(JSON.parse(row.rolePerms)); } catch { p = cleanPerms({}); }
        allowed = p[act] === 'y'; roleName = row.roleName;
        note = row.userActive === 'N' ? 'الحساب معطَّل حالياً' : null;
      }
      if (allowed === true) continue;   // دوره الحالي يملك الصلاحية فعلاً: ليس أثراً للثغرة
      flagged.push({ id: row.id, at: row.at, username: row.username, roleName, ip: row.ip,
        kind: act === '_void' ? 'void' : 'approve', action: row.action, note });
    }
    res.json({ scanned, flagged, caveat: 'المرجع دور المستخدم الحالي وقت الفحص، لا دوره وقت تنفيذ العملية؛ إن غيَّرت دور أحدهم لاحقاً فقد لا تعكس النتيجة واقع تلك اللحظة بدقة.' });
  }));

  return r;
};
