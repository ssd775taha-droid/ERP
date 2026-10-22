// تقارير محاسبية متقدمة (قراءة فقط): دفتر اليومية، الأستاذ العام، مقارنة ميزان المراجعة والميزانية بين فترتين، وتجميع الحسابات حسب الحساب الأب.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const S = (val) => ({ val, type: db.oracledb.STRING });
const D = (x) => `TO_DATE(${x}, 'YYYY-MM-DD')`;
const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
function range(req, a = 'from', b = 'to') {
  const f = v.date(req.query[a], 'من تاريخ'), t = v.date(req.query[b], 'إلى تاريخ');
  if (f > t) v.bad('تاريخ البداية بعد النهاية');
  return { f, t };
}
const typeOf = (req) => {
  const t = req.query.type ? String(req.query.type) : null;
  if (t && !TYPES.includes(t)) v.bad('نوع الحساب غير صالح');
  return t;
};
const num = (x, label) => { if (x == null || x === '') return null; const n = Number(x); if (!Number.isFinite(n) || n < 0) v.bad(label + ' غير صالح'); return n; };

module.exports = function accAdvRoutes() {
  const r = express.Router();

  // دفتر اليومية: القيود بسطورها مرتبة بالتاريخ، مع بحث بالبيان/المرجع/الحساب ونطاق مبلغ ونوع القيد (حد أقصى 400 قيد)
  r.get('/reports/general-journal', wrap(async (req, res) => {
    const p = range(req);
    const q = req.query.q ? String(req.query.q).trim().slice(0, 60) : null;
    const kind = req.query.kind ? String(req.query.kind) : null;
    if (kind && !['NORMAL', 'CLOSING', 'REVERSAL'].includes(kind)) v.bad('نوع القيد غير صالح');
    const min = num(req.query.min, 'الحد الأدنى'), max = num(req.query.max, 'الحد الأعلى');
    const LIMIT = 400;
    const heads = await db.query(`
      SELECT * FROM (
        SELECT e.entry_id AS "id", TO_CHAR(e.entry_date, 'YYYY-MM-DD') AS "date", e.memo AS "memo", e.ref AS "ref", e.kind AS "kind", e.void_of AS "voidOf",
               e.created_by AS "by", (SELECT NVL(SUM(l.debit), 0) FROM erp_lines l WHERE l.entry_id = e.entry_id) AS "amount"
          FROM erp_entries e
         WHERE e.entry_date BETWEEN ${D(':f')} AND ${D(':t')}
           AND (:kind IS NULL OR (:kind = 'REVERSAL' AND e.void_of IS NOT NULL) OR (:kind <> 'REVERSAL' AND e.kind = :kind AND e.void_of IS NULL))
           AND (:q IS NULL OR UPPER(e.memo) LIKE '%' || UPPER(:q) || '%' OR UPPER(e.ref) LIKE '%' || UPPER(:q) || '%'
                OR EXISTS (SELECT 1 FROM erp_lines l JOIN erp_accounts a ON a.code = l.account_code WHERE l.entry_id = e.entry_id
                            AND (l.account_code = :q OR UPPER(a.name) LIKE '%' || UPPER(:q) || '%' OR UPPER(l.note) LIKE '%' || UPPER(:q) || '%')))
         ORDER BY e.entry_date, e.entry_id) WHERE ROWNUM <= :lim + 1`, { ...p, kind: S(kind), q: S(q), lim: LIMIT });
    // نطاق المبلغ يُطبَّق على إجمالي القيد
    let list = heads.filter((e) => (min == null || e.amount >= min) && (max == null || e.amount <= max));
    const truncated = heads.length > LIMIT; if (truncated) list = list.slice(0, LIMIT);
    const lines = list.length ? await db.query(`
      SELECT l.entry_id AS "entryId", l.account_code AS "code", a.name AS "name", l.debit AS "debit", l.credit AS "credit", l.note AS "note"
        FROM erp_lines l JOIN erp_accounts a ON a.code = l.account_code
       WHERE l.entry_id IN (SELECT e.entry_id FROM erp_entries e WHERE e.entry_date BETWEEN ${D(':f')} AND ${D(':t')} AND e.entry_id BETWEEN :lo AND :hi)
       ORDER BY l.entry_id, l.line_id`, { ...p, lo: list[0].id, hi: list[list.length - 1].id }) : [];
    const by = new Map(list.map((e) => [e.id, { ...e, amount: r2(e.amount), lines: [] }]));
    for (const l of lines) { const e = by.get(l.entryId); if (e) e.lines.push(l); }
    const entries = [...by.values()];
    const sum = (k) => r2(entries.reduce((s, e) => s + e.lines.reduce((t, l) => t + l[k], 0), 0));
    res.json({ entries, truncated, limit: LIMIT, totals: { count: entries.length, debit: sum('debit'), credit: sum('credit') } });
  }));

  // الأستاذ العام: كل حساب عليه حركة في الفترة برصيده الافتتاحي وحركاته برصيد جارٍ وختامه (حد أقصى 3000 سطر)
  r.get('/reports/general-ledger', wrap(async (req, res) => {
    const p = range(req), type = typeOf(req);
    const LIMIT = 3000;
    const opens = await db.query(`
      SELECT a.code AS "code", a.name AS "name", a.acc_type AS "type", NVL(SUM(l.debit - l.credit), 0) AS "open"
        FROM erp_accounts a JOIN erp_lines l ON l.account_code = a.code JOIN erp_entries e ON e.entry_id = l.entry_id
       WHERE e.entry_date < ${D(':f')} AND (:ty IS NULL OR a.acc_type = :ty) GROUP BY a.code, a.name, a.acc_type`, { f: p.f, ty: S(type) });
    const moves = await db.query(`
      SELECT * FROM (
        SELECT a.code AS "code", a.name AS "name", a.acc_type AS "type", e.entry_id AS "entryId", TO_CHAR(e.entry_date, 'YYYY-MM-DD') AS "date",
               e.memo AS "memo", e.ref AS "ref", l.debit AS "debit", l.credit AS "credit"
          FROM erp_accounts a JOIN erp_lines l ON l.account_code = a.code JOIN erp_entries e ON e.entry_id = l.entry_id
         WHERE e.entry_date BETWEEN ${D(':f')} AND ${D(':t')} AND (:ty IS NULL OR a.acc_type = :ty)
         ORDER BY a.code, e.entry_date, e.entry_id, l.line_id) WHERE ROWNUM <= :lim + 1`, { ...p, ty: S(type), lim: LIMIT });
    const truncated = moves.length > LIMIT; if (truncated) moves.pop();
    const map = new Map();
    const acct = (x) => { if (!map.has(x.code)) map.set(x.code, { code: x.code, name: x.name, type: x.type, open: 0, debit: 0, credit: 0, rows: [] }); return map.get(x.code); };
    for (const o of opens) acct(o).open = r2(o.open);
    for (const m of moves) { const a = acct(m); a.rows.push(m); a.debit = r2(a.debit + m.debit); a.credit = r2(a.credit + m.credit); }
    const accounts = [...map.values()].filter((a) => a.rows.length || a.open !== 0).sort((a, b) => a.code.localeCompare(b.code)).map((a) => {
      let run = a.open;
      const rows = a.rows.map((m) => { run = r2(run + m.debit - m.credit); return { entryId: m.entryId, date: m.date, memo: m.memo, ref: m.ref, debit: m.debit, credit: m.credit, balance: run }; });
      return { code: a.code, name: a.name, type: a.type, open: a.open, debit: a.debit, credit: a.credit, close: run, rows };
    });
    const t = (k) => r2(accounts.reduce((s, a) => s + a[k], 0));
    res.json({ accounts, truncated, limit: LIMIT, totals: { open: t('open'), debit: t('debit'), credit: t('credit'), close: t('close') } });
  }));

  // مقارنة ميزان المراجعة: صافي حركة كل حساب (مدين − دائن) في فترتين والفرق والنسبة
  r.get('/reports/tb-compare', wrap(async (req, res) => {
    const a = range(req, 'from1', 'to1'), b = range(req, 'from2', 'to2'), type = typeOf(req);
    const rows = await db.query(`
      SELECT a.code AS "code", a.name AS "name", a.acc_type AS "type",
             NVL(SUM(CASE WHEN e.entry_date BETWEEN ${D(':f1')} AND ${D(':t1')} THEN l.debit - l.credit END), 0) AS "p1",
             NVL(SUM(CASE WHEN e.entry_date BETWEEN ${D(':f2')} AND ${D(':t2')} THEN l.debit - l.credit END), 0) AS "p2"
        FROM erp_accounts a JOIN erp_lines l ON l.account_code = a.code JOIN erp_entries e ON e.entry_id = l.entry_id
       WHERE (e.entry_date BETWEEN ${D(':f1')} AND ${D(':t1')} OR e.entry_date BETWEEN ${D(':f2')} AND ${D(':t2')}) AND (:ty IS NULL OR a.acc_type = :ty)
       GROUP BY a.code, a.name, a.acc_type ORDER BY a.code`, { f1: a.f, t1: a.t, f2: b.f, t2: b.t, ty: S(type) });
    const list = rows.map((x) => ({ ...x, p1: r2(x.p1), p2: r2(x.p2), diff: r2(x.p2 - x.p1), pct: x.p1 ? r2((x.p2 - x.p1) / Math.abs(x.p1) * 100) : null })).filter((x) => x.p1 !== 0 || x.p2 !== 0);
    const t = (k) => r2(list.reduce((s, x) => s + x[k], 0));
    res.json({ rows: list, totals: { p1: t('p1'), p2: t('p2'), diff: t('diff'), absDiff: r2(list.reduce((s, x) => s + Math.abs(x.diff), 0)) } });
  }));

  // مقارنة الميزانية بين تاريخين: أرصدة الأصول والخصوم وحقوق الملكية مع الأرباح غير المقفلة
  r.get('/reports/bs-compare', wrap(async (req, res) => {
    const d1 = v.date(req.query.asof1, 'التاريخ الأول'), d2 = v.date(req.query.asof2, 'التاريخ الثاني');
    const rows = await db.query(`
      SELECT a.acc_type AS "type", a.code AS "code", a.name AS "name",
             NVL(SUM(CASE WHEN e.entry_date <= ${D(':d1')} THEN CASE WHEN a.acc_type = 'ASSET' THEN l.debit - l.credit ELSE l.credit - l.debit END END), 0) AS "b1",
             NVL(SUM(CASE WHEN e.entry_date <= ${D(':d2')} THEN CASE WHEN a.acc_type = 'ASSET' THEN l.debit - l.credit ELSE l.credit - l.debit END END), 0) AS "b2"
        FROM erp_accounts a JOIN erp_lines l ON l.account_code = a.code JOIN erp_entries e ON e.entry_id = l.entry_id
       WHERE a.acc_type IN ('ASSET', 'LIABILITY', 'EQUITY') AND e.entry_date <= ${D(':mx')}
       GROUP BY a.acc_type, a.code, a.name ORDER BY a.code`, { d1, d2, mx: d1 > d2 ? d1 : d2 });
    const [u] = await db.query(`SELECT erp_fin.unclosed_earnings(${D(':a')}) AS "u1", erp_fin.unclosed_earnings(${D(':b')}) AS "u2" FROM dual`, { a: d1, b: d2 });
    const mk = (x) => ({ ...x, b1: r2(x.b1), b2: r2(x.b2), diff: r2(x.b2 - x.b1), pct: x.b1 ? r2((x.b2 - x.b1) / Math.abs(x.b1) * 100) : null });
    const all = rows.map(mk).filter((x) => x.b1 !== 0 || x.b2 !== 0);
    const grp = (t) => all.filter((x) => x.type === t);
    const tot = (list) => ({ b1: r2(list.reduce((s, x) => s + x.b1, 0)), b2: r2(list.reduce((s, x) => s + x.b2, 0)) });
    const A = tot(grp('ASSET')), L = tot(grp('LIABILITY')), Q = tot(grp('EQUITY'));
    Q.b1 = r2(Q.b1 + u.u1); Q.b2 = r2(Q.b2 + u.u2);
    res.json({ assets: grp('ASSET'), liabilities: grp('LIABILITY'), equity: grp('EQUITY'), unclosed: { b1: r2(u.u1), b2: r2(u.u2) },
      totals: { assets: A, liabilities: L, equity: Q }, balanced: r2(A.b1 - L.b1 - Q.b1) === 0 && r2(A.b2 - L.b2 - Q.b2) === 0 });
  }));

  // تجميع الحسابات: شجرة الحسابات بمجاميع الأب (الرصيد حتى التاريخ وحركة الفترة) حسب الجانب الطبيعي
  r.get('/reports/account-groups', wrap(async (req, res) => {
    const p = range(req);
    const accts = await db.query('SELECT code AS "code", name AS "name", acc_type AS "type", parent_code AS "parent" FROM erp_accounts ORDER BY code');
    const bal = await db.query(`
      SELECT l.account_code AS "code", NVL(SUM(CASE WHEN e.entry_date < ${D(':f')} THEN l.debit - l.credit END), 0) AS "open",
             NVL(SUM(CASE WHEN e.entry_date >= ${D(':f')} THEN l.debit END), 0) AS "debit", NVL(SUM(CASE WHEN e.entry_date >= ${D(':f')} THEN l.credit END), 0) AS "credit"
        FROM erp_lines l JOIN erp_entries e ON e.entry_id = l.entry_id WHERE e.entry_date <= ${D(':t')} GROUP BY l.account_code`, p);
    const own = new Map(bal.map((x) => [x.code, x]));
    const node = new Map(accts.map((a) => [a.code, { ...a, children: [], open: 0, debit: 0, credit: 0 }]));
    for (const a of accts) { const n = node.get(a.code), o = own.get(a.code); if (o) { n.open = o.open; n.debit = o.debit; n.credit = o.credit; } if (a.parent && node.has(a.parent)) node.get(a.parent).children.push(n); }
    const roll = (n) => { for (const c of n.children) { roll(c); n.open += c.open; n.debit += c.debit; n.credit += c.credit; } return n; };
    const roots = accts.filter((a) => !a.parent || !node.has(a.parent)).map((a) => roll(node.get(a.code)));
    const out = [];
    const walk = (n, level) => {
      const sign = ['ASSET', 'EXPENSE'].includes(n.type) ? 1 : -1;
      const open = r2(n.open * sign), close = r2((n.open + n.debit - n.credit) * sign);
      if (open !== 0 || close !== 0 || n.debit !== 0 || n.credit !== 0) out.push({ code: n.code, name: n.name, type: n.type, level, leaf: !n.children.length, open, debit: r2(n.debit), credit: r2(n.credit), close });
      [...n.children].sort((a, b) => a.code.localeCompare(b.code)).forEach((c) => walk(c, level + 1));
    };
    roots.sort((a, b) => a.code.localeCompare(b.code)).forEach((n) => walk(n, 0));
    const leaves = out.filter((x) => x.leaf);
    res.json({ rows: out, totals: { leafDebit: r2(leaves.reduce((s, x) => s + x.debit, 0)), leafCredit: r2(leaves.reduce((s, x) => s + x.credit, 0)) } });
  }));

  return r;
};
