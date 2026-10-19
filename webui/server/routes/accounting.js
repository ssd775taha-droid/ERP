// دليل الحسابات وقيود اليومية. كل الترحيل عبر ERP_GL (توازن القيد والحسابات الطرفية تُفرض في القاعدة).
const express = require('express');
const db = require('../db');
const v = require('../validate');

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

module.exports = function accountingRoutes() {
  const r = express.Router();

  // ---------- دليل الحسابات ----------
  r.get('/accounts', wrap(async (req, res) => {
    const rows = await db.query(`
      SELECT a.code AS "code", a.name AS "name", a.acc_type AS "type", a.parent_code AS "parent", a.active AS "active",
             a.cash_account AS "cashAccount", a.cf_category AS "cfCategory",
             (SELECT COUNT(*) FROM erp_accounts c WHERE c.parent_code = a.code) AS "children"
        FROM erp_accounts a ORDER BY a.code`);
    res.json({ accounts: rows });
  }));

  r.post('/accounts', wrap(async (req, res) => {
    const b = req.body || {};
    const code = v.str(b.code, 'رمز الحساب', { max: 12 });
    if (!/^[0-9A-Za-z.-]{1,12}$/.test(code)) v.bad('رمز الحساب: أحرف لاتينية وأرقام ونقطة وشرطة فقط');
    const name = v.str(b.name, 'اسم الحساب', { max: 120 });
    const type = v.str(b.type, 'نوع الحساب');
    if (!TYPES.includes(type)) v.bad('نوع الحساب غير صالح');
    const parent = b.parent ? v.str(b.parent, 'الحساب الأب', { max: 12 }) : null;
    if (parent) {
      const p = await db.query('SELECT acc_type AS "type" FROM erp_accounts WHERE code = :p', { p: parent });
      if (!p.length) v.bad('الحساب الأب غير موجود');
      if (p[0].type !== type) v.bad('نوع الحساب يجب أن يطابق نوع الحساب الأب');
      const used = await db.query('SELECT COUNT(*) AS "n" FROM erp_lines WHERE account_code = :p', { p: parent });
      if (used[0].n > 0) v.bad('الحساب الأب عليه حركات فلا يصير تجميعياً');
    }
    await db.run(
      'INSERT INTO erp_accounts (code, name, acc_type, parent_code) VALUES (:code, :name, :type, :parent)',
      { code, name, type, parent });
    res.status(201).json({ code });
  }));

  r.patch('/accounts/:code', wrap(async (req, res) => {
    const b = req.body || {};
    const name = b.name === undefined ? null : v.str(b.name, 'اسم الحساب', { max: 120 });
    const active = b.active === undefined ? null : (b.active ? 'Y' : 'N');
    if (name === null && active === null) v.bad('لا تغيير مطلوب');
    const r1 = await db.run(
      'UPDATE erp_accounts SET name = NVL(:name, name), active = NVL(:active, active) WHERE code = :code',
      { name, active, code: req.params.code });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'الحساب غير موجود');
    res.json({ ok: true });
  }));

  // ---------- القيود ----------
  async function loadLines(ids) {
    if (!ids.length) return {};
    const binds = {}; const ph = ids.map((id, i) => { binds[`e${i}`] = id; return `:e${i}`; });
    const rows = await db.query(`
      SELECT l.entry_id AS "entryId", l.account_code AS "account", a.name AS "accountName",
             l.debit AS "debit", l.credit AS "credit", l.note AS "note"
        FROM erp_lines l JOIN erp_accounts a ON a.code = l.account_code
       WHERE l.entry_id IN (${ph.join(',')}) ORDER BY l.line_id`, binds);
    const by = {};
    for (const x of rows) (by[x.entryId] = by[x.entryId] || []).push(x);
    return by;
  }

  const ENTRY_SQL = `
    SELECT e.entry_id AS "id", TO_CHAR(e.entry_date, 'YYYY-MM-DD') AS "date", e.memo AS "memo", e.ref AS "ref",
           e.void_of AS "voidOf", e.kind AS "kind", e.created_by AS "createdBy",
           (SELECT r.entry_id FROM erp_entries r WHERE r.void_of = e.entry_id) AS "reversedBy"
      FROM erp_entries e`;

  r.get('/entries', wrap(async (req, res) => {
    const from = v.date(req.query.from, 'من تاريخ', { optional: true });
    const to = v.date(req.query.to, 'إلى تاريخ', { optional: true });
    const account = req.query.account ? v.str(req.query.account, 'الحساب', { max: 12 }) : null;
    const limit = Math.min(v.int(req.query.limit, 'الحد', { optional: true }) || 100, 500);
    const rows = await db.query(`
      SELECT * FROM (${ENTRY_SQL}
       WHERE (:from_d IS NULL OR e.entry_date >= TO_DATE(:from_d, 'YYYY-MM-DD'))
         AND (:to_d   IS NULL OR e.entry_date <= TO_DATE(:to_d, 'YYYY-MM-DD'))
         AND (:acct   IS NULL OR EXISTS (SELECT 1 FROM erp_lines l WHERE l.entry_id = e.entry_id AND l.account_code = :acct))
       ORDER BY e.entry_date DESC, e.entry_id DESC) WHERE ROWNUM <= :lim`,
      { from_d: { val: from, type: db.oracledb.STRING }, to_d: { val: to, type: db.oracledb.STRING },
        acct: { val: account, type: db.oracledb.STRING }, lim: limit });
    const lines = await loadLines(rows.map((x) => x.id));
    res.json({ entries: rows.map((x) => ({ ...x, lines: lines[x.id] || [] })) });
  }));

  r.get('/entries/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم القيد');
    const rows = await db.query(`${ENTRY_SQL} WHERE e.entry_id = :id`, { id });
    if (!rows.length) throw new db.HttpError(404, 'القيد غير موجود');
    const lines = await loadLines([id]);
    res.json({ entry: { ...rows[0], lines: lines[id] || [] } });
  }));

  r.post('/entries', wrap(async (req, res) => {
    const b = req.body || {};
    const date = v.date(b.date, 'تاريخ القيد');
    const memo = v.str(b.memo, 'البيان', { max: 300, optional: true });
    const ref = v.str(b.ref, 'المرجع', { max: 60, optional: true });
    if (!Array.isArray(b.lines) || b.lines.length < 2 || b.lines.length > 200) v.bad('القيد يحتاج سطرين على الأقل');
    const lines = b.lines.map((l, i) => ({
      account: v.str(l.account, `حساب السطر ${i + 1}`, { max: 12 }),
      debit: v.money(l.debit, `مدين السطر ${i + 1}`),
      credit: v.money(l.credit, `دائن السطر ${i + 1}`),
      note: v.str(l.note, 'ملاحظة السطر', { max: 200, optional: true }),
    }));
    // الأسطر تُمرَّر JSON وتُحوَّل في القاعدة إلى ERP_LINE_TAB، والمبالغ تحتفظ بدقتها العشرية
    const out = await db.run(`
      DECLARE
        v_lines erp_line_tab;
        v_id    NUMBER;
      BEGIN
        SELECT erp_line_t(account_code, debit, credit, note) BULK COLLECT INTO v_lines
          FROM JSON_TABLE(:lines, '$[*]' COLUMNS (
                 account_code VARCHAR2(12)  PATH '$.account',
                 debit        NUMBER        PATH '$.debit',
                 credit       NUMBER        PATH '$.credit',
                 note         VARCHAR2(200) PATH '$.note'));
        v_id := erp_gl.post_entry(TO_DATE(:d, 'YYYY-MM-DD'), :memo, :ref, v_lines);
        :id := v_id;
      END;`,
      { lines: JSON.stringify(lines), d: date, memo, ref, id: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } });
    const id = out.outBinds.id;
    const rows = await db.query(`${ENTRY_SQL} WHERE e.entry_id = :id`, { id });
    const ls = await loadLines([id]);
    res.status(201).json({ entry: { ...rows[0], lines: ls[id] || [] } });
  }));

  r.post('/entries/:id/reverse', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم القيد');
    const d = v.date((req.body || {}).date, 'تاريخ العكس', { optional: true });
    const out = await db.run(
      "BEGIN :n := erp_gl.reverse_entry(:id, CASE WHEN :d IS NULL THEN NULL ELSE TO_DATE(:d, 'YYYY-MM-DD') END); END;",
      { id, d: { val: d, type: db.oracledb.STRING }, n: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } });
    res.status(201).json({ entryId: out.outBinds.n });
  }));

  return r;
};
