// ترويسة المستندات: بيانات المنشأة الإضافية (اسم إنجليزي، سجل تجاري، هاتف، بريد، موقع، تذييل) وشعار مصغَّر.
// الجدول يُنشأ عند أول استخدام إن لم يوجد (التثبيتات القديمة لا تحتاج ترقية)، وهو أيضاً في oracle/sql/01b للتثبيت الجديد.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const MAX_LOGO = 300000;            // حرفاً من data URL (≈ 220 كيلوبايت)
let ensured = false;

async function ensure() {
  if (ensured) return;
  const [{ n }] = await db.query(`SELECT COUNT(*) AS "n" FROM user_tables WHERE table_name = 'ERP_COMPANY_PROFILE'`);
  if (!n) {
    await db.run(`CREATE TABLE erp_company_profile (
      id NUMBER(1) CONSTRAINT erp_company_profile_pk PRIMARY KEY CONSTRAINT erp_company_profile_ck CHECK (id = 1),
      name_en VARCHAR2(120), cr_no VARCHAR2(30), phone VARCHAR2(40), email VARCHAR2(120), website VARCHAR2(120),
      footer_note VARCHAR2(500), logo CLOB)`);
  }
  ensured = true;
}

async function read() {
  await ensure();
  const rows = await db.withConn(async (c) => (await c.execute(`SELECT name_en AS "nameEn", cr_no AS "crNo", phone AS "phone", email AS "email", website AS "website",
      footer_note AS "footerNote", logo AS "logo" FROM erp_company_profile WHERE id = 1`, {}, { fetchInfo: { logo: { type: db.oracledb.STRING } } })).rows);
  const o = rows[0] || {};
  const out = {};
  for (const k of ['nameEn', 'crNo', 'phone', 'email', 'website', 'footerNote', 'logo']) out[k] = o[k] == null ? '' : o[k];
  return out;
}

module.exports = function letterheadRoutes() {
  const r = express.Router();
  r.get('/letterhead', wrap(async (req, res) => { res.json(await read()); }));
  r.post('/letterhead', wrap(async (req, res) => {
    const b = req.body || {};
    const s = (x, label, max) => v.str(x, label, { max, optional: true }) || '';
    const email = s(b.email, 'البريد', 120);
    if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) v.bad('البريد الإلكتروني غير صحيح');
    const website = s(b.website, 'الموقع', 120);
    if (/[<>"\s]/.test(website)) v.bad('الموقع غير صحيح');
    const phone = s(b.phone, 'الهاتف', 40);
    if (phone && !/^[\d\s+\-()/،,]+$/.test(phone)) v.bad('الهاتف أرقام وعلامات + - ( ) فقط');
    const logo = typeof b.logo === 'string' ? b.logo : '';
    if (logo && (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > MAX_LOGO)) v.bad('الشعار صورة PNG أو JPEG لا يتجاوز نحو 200 كيلوبايت');
    await ensure();
    await db.withConn(async (conn) => {
      await conn.execute(`MERGE INTO erp_company_profile t USING (SELECT 1 AS id FROM dual) x ON (t.id = x.id)
        WHEN MATCHED THEN UPDATE SET name_en = :a, cr_no = :b, phone = :c, email = :d, website = :e, footer_note = :f, logo = :g
        WHEN NOT MATCHED THEN INSERT (id, name_en, cr_no, phone, email, website, footer_note, logo) VALUES (1, :a, :b, :c, :d, :e, :f, :g)`,
      { a: s(b.nameEn, 'الاسم الإنجليزي', 120) || null, b: s(b.crNo, 'السجل التجاري', 30) || null, c: phone || null, d: email || null, e: website || null,
        f: s(b.footerNote, 'التذييل', 500) || null, g: { val: logo || null, type: db.oracledb.CLOB } });
      await conn.commit();
    });
    res.json(await read());
  }));
  return r;
};
