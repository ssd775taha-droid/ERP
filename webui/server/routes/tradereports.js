// تقارير المبيعات والمشتريات الإضافية (قراءة فقط): الفواتير المستحقة والمتأخرة، المقبوضات والمدفوعات، أرصدة الأطراف، وملخص الإشعارات.
const express = require('express');
const db = require('../db');
const v = require('../validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const r2 = (n) => Math.round(n * 100) / 100;
const D = (x) => `TO_DATE(${x}, 'YYYY-MM-DD')`;
const kindOf = (q) => (q === 'PURCHASE' ? 'PURCHASE' : 'SALES');
function range(req) {
  const f = v.date(req.query.from, 'من تاريخ'), t = v.date(req.query.to, 'إلى تاريخ');
  if (f > t) v.bad('تاريخ البداية بعد النهاية');
  return { f, t };
}

module.exports = function tradeReportRoutes() {
  const r = express.Router();

  // فواتير سارية متبقٍّ عليها مبلغ، بعمر التأخر عن الاستحقاق (الاستحقاق أو تاريخ الفاتورة إن لم يُحدَّد) حتى التاريخ المحدد
  r.get('/reports/open-invoices', wrap(async (req, res) => {
    const kind = kindOf(req.query.kind), asof = v.date(req.query.asof, 'بتاريخ');
    const rows = await db.query(`
      SELECT i.invoice_id AS "id", i.invoice_no AS "no", p.name AS "party", TO_CHAR(i.invoice_date, 'YYYY-MM-DD') AS "date", TO_CHAR(NVL(i.due_date, i.invoice_date), 'YYYY-MM-DD') AS "due",
             i.total + erp_note_net(i.invoice_id) AS "total", i.paid AS "paid", i.total + erp_note_net(i.invoice_id) - i.paid AS "remaining",
             TRUNC(${D(':a')}) - TRUNC(NVL(i.due_date, i.invoice_date)) AS "overdue"
        FROM erp_invoices i JOIN erp_parties p ON p.party_id = i.party_id
       WHERE i.kind = :k AND i.status = 'OPEN' AND i.invoice_date <= ${D(':a')} AND i.total + erp_note_net(i.invoice_id) - i.paid > 0 ORDER BY NVL(i.due_date, i.invoice_date), i.invoice_id`, { k: kind, a: asof });
    const out = rows.map((x) => ({ ...x, total: r2(x.total), paid: r2(x.paid), remaining: r2(x.remaining) }));
    const B = [['غير مستحقة', -1e9, 0], ['1 – 30 يوماً', 1, 30], ['31 – 60 يوماً', 31, 60], ['61 – 90 يوماً', 61, 90], ['أكثر من 90 يوماً', 91, 1e9]];
    const buckets = B.map(([label, lo, hi]) => { const g = out.filter((x) => x.overdue >= lo && x.overdue <= hi); return { label, count: g.length, amount: r2(g.reduce((s, x) => s + x.remaining, 0)) }; });
    res.json({ kind, rows: out, buckets, totals: { count: out.length, remaining: r2(out.reduce((s, x) => s + x.remaining, 0)), overdue: r2(out.filter((x) => x.overdue > 0).reduce((s, x) => s + x.remaining, 0)) } });
  }));

  // المقبوضات والمدفوعات: يومياً وحسب الطريقة
  r.get('/reports/payments-summary', wrap(async (req, res) => {
    const p = range(req);
    const days = await db.query(`
      SELECT TO_CHAR(y.pay_date, 'YYYY-MM-DD') AS "date", SUM(CASE WHEN y.kind = 'RECEIPT' THEN y.amount ELSE 0 END) AS "receipts", SUM(CASE WHEN y.kind = 'PAYMENT' THEN y.amount ELSE 0 END) AS "payments",
             COUNT(*) AS "count" FROM erp_payments y WHERE y.pay_date BETWEEN ${D(':f')} AND ${D(':t')} GROUP BY y.pay_date ORDER BY y.pay_date`, p);
    const methods = await db.query(`
      SELECT y.kind AS "kind", y.method AS "method", COUNT(*) AS "count", SUM(y.amount) AS "amount" FROM erp_payments y WHERE y.pay_date BETWEEN ${D(':f')} AND ${D(':t')}
       GROUP BY y.kind, y.method ORDER BY y.kind, y.method`, p);
    const parties = await db.query(`
      SELECT * FROM (SELECT pa.name AS "party", y.kind AS "kind", COUNT(*) AS "count", SUM(y.amount) AS "amount" FROM erp_payments y JOIN erp_parties pa ON pa.party_id = y.party_id
        WHERE y.pay_date BETWEEN ${D(':f')} AND ${D(':t')} GROUP BY pa.name, y.kind ORDER BY SUM(y.amount) DESC) WHERE ROWNUM <= 15`, p);
    const d = days.map((x) => ({ ...x, receipts: r2(x.receipts), payments: r2(x.payments), net: r2(x.receipts - x.payments) }));
    const receipts = r2(d.reduce((s, x) => s + x.receipts, 0)), payments = r2(d.reduce((s, x) => s + x.payments, 0));
    res.json({ days: d, methods: methods.map((x) => ({ ...x, amount: r2(x.amount) })), parties: parties.map((x) => ({ ...x, amount: r2(x.amount) })), totals: { receipts, payments, net: r2(receipts - payments), count: d.reduce((s, x) => s + x.count, 0) } });
  }));

  // أرصدة العملاء أو الموردين: المفوتر + أثر الإشعارات − المسدد = الرصيد (الموجب مستحق على العميل / للمورد)
  r.get('/reports/party-balances', wrap(async (req, res) => {
    const kind = req.query.kind === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER';
    const rows = await db.query(`
      SELECT p.party_id AS "id", p.name AS "name", p.phone AS "phone",
             NVL((SELECT SUM(i.total) FROM erp_invoices i WHERE i.party_id = p.party_id AND i.status = 'OPEN'), 0) AS "invoiced",
             NVL((SELECT SUM(CASE n.note_type WHEN 'DEBIT' THEN n.total ELSE n.refund - n.total END) FROM erp_notes n WHERE n.party_id = p.party_id AND n.status = 'OPEN'), 0) AS "notes",
             NVL((SELECT SUM(y.amount) FROM erp_payments y WHERE y.party_id = p.party_id), 0) AS "paid",
             erp_trade.party_balance(p.party_id) AS "balance"
        FROM erp_parties p WHERE p.kind = :k ORDER BY erp_trade.party_balance(p.party_id) DESC, p.name`, { k: kind });
    const out = rows.map((x) => ({ ...x, invoiced: r2(x.invoiced), notes: r2(x.notes), paid: r2(x.paid), balance: r2(x.balance) }));
    const t = (k) => r2(out.reduce((s, x) => s + x[k], 0));
    res.json({ kind, rows: out, totals: { invoiced: t('invoiced'), notes: t('notes'), paid: t('paid'), balance: t('balance'), withBalance: out.filter((x) => x.balance !== 0).length } });
  }));

  // ملخص الإشعارات الدائنة والمدينة: حسب النوع، مع قائمة الإشعارات
  r.get('/reports/notes-summary', wrap(async (req, res) => {
    const p = range(req);
    const rows = await db.query(`
      SELECT n.note_id AS "id", n.note_no AS "no", TO_CHAR(n.note_date, 'YYYY-MM-DD') AS "date", n.doc_kind AS "docKind", n.note_type AS "type", pa.name AS "party", i.invoice_no AS "invoiceNo",
             n.reason AS "reason", n.subtotal AS "subtotal", n.vat_amount AS "vat", n.total AS "total", n.refund AS "refund"
        FROM erp_notes n JOIN erp_parties pa ON pa.party_id = n.party_id JOIN erp_invoices i ON i.invoice_id = n.invoice_id
       WHERE n.status = 'OPEN' AND n.note_date BETWEEN ${D(':f')} AND ${D(':t')} ORDER BY n.note_date, n.note_id`, p);
    const g = (docKind, type) => { const x = rows.filter((y) => y.docKind === docKind && y.type === type); return { docKind, type, count: x.length, subtotal: r2(x.reduce((s, y) => s + y.subtotal, 0)), vat: r2(x.reduce((s, y) => s + y.vat, 0)), total: r2(x.reduce((s, y) => s + y.total, 0)), refund: r2(x.reduce((s, y) => s + y.refund, 0)) }; };
    res.json({ groups: [g('SALES', 'CREDIT'), g('SALES', 'DEBIT'), g('PURCHASE', 'CREDIT'), g('PURCHASE', 'DEBIT')], rows: rows.map((x) => ({ ...x, subtotal: r2(x.subtotal), vat: r2(x.vat), total: r2(x.total), refund: r2(x.refund) })) });
  }));
  return r;
};
