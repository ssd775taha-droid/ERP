// ضريبة القيمة المضافة السعودية: بيانات المنشأة والنسبة الافتراضية (15%) وتقرير إقرار الضريبة.
// الضريبة نفسها تُحسب وتُرحَّل في حزم القاعدة (ح/2200)؛ هنا الإعدادات والتقرير فقط.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const KEYS = { VAT_RATE: 'vatRate', SELLER_NAME: 'sellerName', SELLER_VAT_NO: 'sellerVatNo', SELLER_ADDRESS: 'sellerAddress' };
const r2 = (n) => Math.round(n * 100) / 100;

async function readSettings() {
  const rows = await db.query(`SELECT name AS "name", value AS "value" FROM erp_settings WHERE name IN ('VAT_RATE','SELLER_NAME','SELLER_VAT_NO','SELLER_ADDRESS')`);
  const m = Object.fromEntries(rows.map((x) => [x.name, x.value]));
  return { vatRate: m.VAT_RATE === undefined ? 15 : Number(m.VAT_RATE), sellerName: m.SELLER_NAME || '', sellerVatNo: m.SELLER_VAT_NO || '', sellerAddress: m.SELLER_ADDRESS || '' };
}

module.exports = function taxRoutes() {
  const r = express.Router();

  r.get('/tax/settings', wrap(async (req, res) => { res.json(await readSettings()); }));

  r.post('/tax/settings', wrap(async (req, res) => {
    const b = req.body || {};
    const rate = Number(b.vatRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) v.bad('نسبة الضريبة بين 0 و100');
    const vatNo = v.str(b.sellerVatNo, 'الرقم الضريبي', { max: 15, optional: true }) || '';
    if (vatNo && !/^3\d{13}3$/.test(vatNo)) v.bad('الرقم الضريبي السعودي 15 رقماً يبدأ بـ 3 وينتهي بـ 3');
    const vals = { VAT_RATE: String(rate), SELLER_NAME: v.str(b.sellerName, 'اسم المنشأة', { max: 120, optional: true }) || '',
      SELLER_VAT_NO: vatNo, SELLER_ADDRESS: v.str(b.sellerAddress, 'العنوان', { max: 200, optional: true }) || '' };
    await db.withConn(async (conn) => {
      for (const [name, value] of Object.entries(vals)) {
        if (value === '') await conn.execute('DELETE FROM erp_settings WHERE name = :n', { n: name });
        else await conn.execute('MERGE INTO erp_settings s USING (SELECT :n AS name, :v AS value FROM dual) x ON (s.name = x.name) WHEN MATCHED THEN UPDATE SET s.value = x.value WHEN NOT MATCHED THEN INSERT (name, value) VALUES (x.name, x.value)', { n: name, v: value });
      }
      await conn.commit();
    });
    res.json(await readSettings());
  }));

  // إقرار ضريبة القيمة المضافة لفترة: ضريبة المخرجات (فواتير مبيعات + نقاط البيع صافي المرتجعات) مقابل ضريبة المدخلات (فواتير المشتريات)
  r.get('/reports/vat-return', wrap(async (req, res) => {
    const from = v.date(req.query.from, 'من تاريخ');
    const to = v.date(req.query.to, 'إلى تاريخ');
    const p = { f: from, t: to };
    const dates = (col) => `${col} BETWEEN TO_DATE(:f, 'YYYY-MM-DD') AND TO_DATE(:t, 'YYYY-MM-DD')`;
    const inv = (kind) => db.query(`SELECT l.vat_rate AS "rate", SUM(l.net) AS "net", SUM(l.vat) AS "vat", COUNT(DISTINCT i.invoice_id) AS "docs"
        FROM erp_invoice_lines l JOIN erp_invoices i ON i.invoice_id = l.invoice_id
       WHERE i.kind = '${kind}' AND i.status = 'OPEN' AND ${dates('i.invoice_date')} GROUP BY l.vat_rate ORDER BY l.vat_rate DESC`, p);
    // إشعارات الدائن تُنقص والمدين تزيد (مجمَّعة حسب نسبة ضريبة بند الإشعار)
    const notes = (kind) => db.query(`SELECT l.vat_rate AS "rate", SUM(CASE n.note_type WHEN 'DEBIT' THEN l.net ELSE -l.net END) AS "net", SUM(CASE n.note_type WHEN 'DEBIT' THEN l.vat ELSE -l.vat END) AS "vat",
        COUNT(DISTINCT n.note_id) AS "docs" FROM erp_note_lines l JOIN erp_notes n ON n.note_id = l.note_id
       WHERE n.doc_kind = '${kind}' AND n.status = 'OPEN' AND ${dates('n.note_date')} GROUP BY l.vat_rate ORDER BY l.vat_rate DESC`, p);
    const [salesNotes, purchaseNotes] = await Promise.all([notes('SALES'), notes('PURCHASE')]);
    const [sales, purchases, pos] = await Promise.all([inv('SALES'), inv('PURCHASE'), db.query(`
      SELECT l.vat_rate AS "rate", SUM(CASE WHEN s.kind = 'SALE' THEN l.net ELSE -l.net END) AS "net", SUM(CASE WHEN s.kind = 'SALE' THEN l.vat ELSE -l.vat END) AS "vat",
             COUNT(DISTINCT s.sale_id) AS "docs"
        FROM erp_pos_sale_lines l JOIN erp_pos_sales s ON s.sale_id = l.sale_id
       WHERE s.status = 'COMPLETED' AND ${dates('s.sale_date')} GROUP BY l.vat_rate ORDER BY l.vat_rate DESC`, p)]);
    const tot = (rows) => ({ net: r2(rows.reduce((s, x) => s + x.net, 0)), vat: r2(rows.reduce((s, x) => s + x.vat, 0)) });
    const ts = tot(sales), tp = tot(pos), tpu = tot(purchases), tsn = tot(salesNotes), tpn = tot(purchaseNotes);
    const outputVat = r2(ts.vat + tp.vat + tsn.vat), inputVat = r2(tpu.vat + tpn.vat);
    res.json({ sales, salesNotes, pos, purchases, purchaseNotes, totals: { salesNotesNet: tsn.net, salesNotesVat: tsn.vat, purchaseNotesNet: tpn.net, purchaseNotesVat: tpn.vat, salesNet: ts.net, salesVat: ts.vat, posNet: tp.net, posVat: tp.vat, purchasesNet: tpu.net, purchasesVat: tpu.vat,
      outputVat, inputVat, netPayable: r2(outputVat - inputVat) } });
  }));

  return r;
};
