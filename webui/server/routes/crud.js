// تعديل وحذف البيانات الأساسية (أطراف، حسابات، أصناف، مخازن، أقسام، موظفون، فئات أصول، نقاط بيع، مكوّنات رواتب) وإلغاء سندات القبض/الصرف.
// الحذف مسموح فقط لما لم يُستخدم (قيود المفاتيح الأجنبية تمنع الباقي برسالة عربية)؛ وغير ذلك يُعطَّل بدل الحذف.
// المستندات المرحَّلة لا تُعدَّل ولا تُحذف: تُلغى بقيد عكسي أو تُنسخ إلى مستند جديد (محاسبياً هذا هو التصحيح الصحيح).
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
// حسابات النظام: حزم PL/SQL تشير إليها برمزها فلا تُحذف ولا يُغيَّر نوعها
const SYSTEM_ACCOUNTS = new Set(['1000', '1100', '1200', '1300', '1350', '1400', '1500', '1510', '2000', '2100', '2200', '2300', '2400', '2500', '3000', '3100', '3200',
  '4000', '4100', '4200', '4300', '5000', '5100', '5200', '5210', '5300', '5400', '5500', '5600', '5700', '5800']);

module.exports = function crudRoutes() {
  const r = express.Router();
  const del = (path, table, idCol, label, { check, idName = 'id' } = {}) => r.delete(path, wrap(async (req, res) => {
    const id = v.int(req.params[idName], 'المعرّف');
    if (check) await check(id);
    const r1 = await db.run(`DELETE FROM ${table} WHERE ${idCol} = :id`, { id });
    if (!r1.rowsAffected) throw new db.HttpError(404, label + ' غير موجود');
    res.json({ ok: true });
  }));
  const opt = (x, label, max) => (x === undefined ? null : v.str(x, label, { max }));

  // ---------- الأطراف ----------
  r.patch('/parties/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الطرف');
    const b = req.body || {};
    const name = opt(b.name, 'الاسم', 120);
    const phone = b.phone === undefined ? undefined : (v.str(b.phone, 'الهاتف', { max: 40, optional: true }) || '');
    const tax = b.taxNo === undefined ? undefined : (v.str(b.taxNo, 'الرقم الضريبي', { max: 40, optional: true }) || '');
    if (name === null && phone === undefined && tax === undefined) v.bad('لا تغيير مطلوب');
    if (tax && !/^\d{15}$/.test(tax)) v.bad('الرقم الضريبي 15 رقماً');
    const r1 = await db.run(`UPDATE erp_parties SET name = NVL(:n, name), phone = CASE WHEN :ph_set = 1 THEN :ph ELSE phone END, tax_no = CASE WHEN :tx_set = 1 THEN :tx ELSE tax_no END WHERE party_id = :id`,
      { n: name, ph_set: phone === undefined ? 0 : 1, ph: phone || null, tx_set: tax === undefined ? 0 : 1, tx: tax || null, id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'الطرف غير موجود');
    res.json({ ok: true });
  }));
  del('/parties/:id', 'erp_parties', 'party_id', 'الطرف');

  // ---------- الحسابات (التعديل في accounting.js) ----------
  r.delete('/accounts/:code', wrap(async (req, res) => {
    const code = v.str(req.params.code, 'رمز الحساب', { max: 12 });
    if (SYSTEM_ACCOUNTS.has(code)) v.bad('حساب أساسي يعتمد عليه النظام: لا يُحذف (يمكن إعادة تسميته)');
    const r1 = await db.run('DELETE FROM erp_accounts WHERE code = :c', { c: code });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'الحساب غير موجود');
    res.json({ ok: true });
  }));

  // ---------- الأصناف والمخازن ----------
  r.delete('/inventory/items/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الصنف');
    await db.withConn(async (c) => {
      try {
        await c.execute('DELETE FROM erp_stock WHERE item_id = :id AND qty = 0', { id });
        const r1 = await c.execute('DELETE FROM erp_items WHERE item_id = :id', { id });
        if (!r1.rowsAffected) throw new db.HttpError(404, 'الصنف غير موجود');
        await c.commit();
      } catch (e) { await c.rollback(); throw e; }
    });
    res.json({ ok: true });
  }));
  r.put('/inventory/warehouses/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم المخزن');
    const r1 = await db.run('UPDATE erp_warehouses SET name = :n WHERE wh_id = :id', { n: v.str((req.body || {}).name, 'اسم المخزن', { max: 120 }), id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'المخزن غير موجود');
    res.json({ ok: true });
  }));
  r.delete('/inventory/warehouses/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم المخزن');
    await db.withConn(async (c) => {
      try {
        await c.execute('DELETE FROM erp_stock WHERE wh_id = :id AND qty = 0', { id });
        const r1 = await c.execute('DELETE FROM erp_warehouses WHERE wh_id = :id', { id });
        if (!r1.rowsAffected) throw new db.HttpError(404, 'المخزن غير موجود');
        await c.commit();
      } catch (e) { await c.rollback(); throw e; }
    });
    res.json({ ok: true });
  }));

  // ---------- الموارد البشرية ----------
  r.patch('/hr/departments/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم القسم');
    const b = req.body || {};
    const name = opt(b.name, 'اسم القسم', 120), active = b.active === undefined ? null : (b.active ? 'Y' : 'N');
    if (name === null && active === null) v.bad('لا تغيير مطلوب');
    const r1 = await db.run('UPDATE erp_departments SET name = NVL(:n, name), active = NVL(:a, active) WHERE dept_id = :id', { n: name, a: active, id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'القسم غير موجود');
    res.json({ ok: true });
  }));
  del('/hr/departments/:id', 'erp_departments', 'dept_id', 'القسم');
  r.patch('/hr/employees/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الموظف');
    const b = req.body || {};
    const name = opt(b.name, 'الاسم', 120);
    const str = (k, label, max) => (b[k] === undefined ? undefined : (v.str(b[k], label, { max, optional: true }) || ''));
    const job = str('jobTitle', 'الوظيفة', 80), nid = str('nationalId', 'رقم الهوية', 30), bank = str('bankAccount', 'الحساب البنكي', 60);
    const dept = b.deptId === undefined ? undefined : (b.deptId === '' || b.deptId === null ? null : v.int(b.deptId, 'القسم'));
    if (name === null && job === undefined && nid === undefined && bank === undefined && dept === undefined) v.bad('لا تغيير مطلوب');
    const r1 = await db.run(`UPDATE erp_employees SET name = NVL(:n, name),
        job_title = CASE WHEN :j_s = 1 THEN :j ELSE job_title END, national_id = CASE WHEN :i_s = 1 THEN :i ELSE national_id END,
        bank_account = CASE WHEN :b_s = 1 THEN :b ELSE bank_account END, dept_id = CASE WHEN :d_s = 1 THEN :d ELSE dept_id END WHERE emp_id = :id`,
      { n: name, j_s: job === undefined ? 0 : 1, j: job || null, i_s: nid === undefined ? 0 : 1, i: nid || null, b_s: bank === undefined ? 0 : 1, b: bank || null,
        d_s: dept === undefined ? 0 : 1, d: { val: dept === undefined ? null : dept, type: db.oracledb.NUMBER }, id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'الموظف غير موجود');
    res.json({ ok: true });
  }));
  r.patch('/hr/components/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم المكوّن');
    const b = req.body || {};
    const name = opt(b.name, 'الاسم', 120), active = b.active === undefined ? null : (b.active ? 'Y' : 'N');
    let pct = null;
    if (b.pct !== undefined && b.pct !== '') { pct = Number(b.pct); if (!Number.isFinite(pct) || pct < 0 || pct > 100) v.bad('النسبة بين 0 و100'); }
    if (name === null && active === null && pct === null) v.bad('لا تغيير مطلوب');
    const r1 = await db.run('UPDATE erp_pay_components SET name = NVL(:n, name), active = NVL(:a, active), pct = NVL(:p, pct) WHERE comp_id = :id', { n: name, a: active, p: pct, id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'المكوّن غير موجود');
    res.json({ ok: true });
  }));
  del('/hr/components/:id', 'erp_pay_components', 'comp_id', 'المكوّن');

  // ---------- الأصول ونقاط البيع ----------
  r.patch('/assets/categories/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم الفئة');
    const b = req.body || {};
    const name = opt(b.name, 'اسم الفئة', 120), active = b.active === undefined ? null : (b.active ? 'Y' : 'N');
    if (name === null && active === null) v.bad('لا تغيير مطلوب');
    const r1 = await db.run('UPDATE erp_asset_categories SET name = NVL(:n, name), active = NVL(:a, active) WHERE cat_id = :id', { n: name, a: active, id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'الفئة غير موجودة');
    res.json({ ok: true });
  }));
  del('/assets/categories/:id', 'erp_asset_categories', 'cat_id', 'الفئة');
  r.patch('/pos/registers/:id', wrap(async (req, res) => {
    const id = v.int(req.params.id, 'رقم النقطة');
    const b = req.body || {};
    const name = opt(b.name, 'اسم النقطة', 120), active = b.active === undefined ? null : (b.active ? 'Y' : 'N');
    if (name === null && active === null) v.bad('لا تغيير مطلوب');
    const r1 = await db.run('UPDATE erp_pos_registers SET name = NVL(:n, name), active = NVL(:a, active) WHERE reg_id = :id', { n: name, a: active, id });
    if (!r1.rowsAffected) throw new db.HttpError(404, 'النقطة غير موجودة');
    res.json({ ok: true });
  }));
  del('/pos/registers/:id', 'erp_pos_registers', 'reg_id', 'النقطة');

  // ---------- إلغاء سند قبض/صرف ----------
  r.post('/payments/:id/void', wrap(async (req, res) => {
    const [{ n }] = await db.query(`SELECT COUNT(*) AS "n" FROM user_procedures WHERE object_name = 'ERP_TRADE' AND procedure_name = 'VOID_PAYMENT'`);
    if (!n) throw new db.HttpError(503, 'إلغاء السندات يحتاج ترقية قاعدة البيانات: شغّل upgrade.sql (أو أعد تشغيل المثبّت)');
    await db.run('BEGIN erp_trade.void_payment(:id); END;', { id: v.int(req.params.id, 'رقم السند') });
    res.json({ ok: true });
  }));
  return r;
};
