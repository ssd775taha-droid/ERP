// المبيعات والمشتريات: عملاء وموردون، فواتير، ومدفوعات. كل مستند يُرحَّل إلى قيد في دفتر الأستاذ ضمن المعاملة نفسها.
const { httpError } = require('./store');
const { toMinor, isDate } = require('./erp');

const KINDS = { sales: { party: 'customer', prefix: 'S', line: '4100' }, purchase: { party: 'supplier', prefix: 'P', line: '5100' } };
const AR = '1300'; const AP = '2100'; const VAT = '2200';
const CASH = { cash: '1100', bank: '1200' };

class Trade {
  constructor(db, ledger) {
    this.db = db;
    this.ledger = ledger;
    db.exec(`
      CREATE TABLE IF NOT EXISTS erp_parties (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('customer','supplier')),
        name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', tax_no TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS erp_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('sales','purchase')),
        number TEXT NOT NULL UNIQUE, ref TEXT NOT NULL DEFAULT '', party_id INTEGER NOT NULL REFERENCES erp_parties(id),
        date TEXT NOT NULL, due TEXT, subtotal INTEGER NOT NULL, vat INTEGER NOT NULL, total INTEGER NOT NULL,
        paid INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', note TEXT NOT NULL DEFAULT '',
        entry_id INTEGER NOT NULL REFERENCES erp_entries(id), void_entry_id INTEGER REFERENCES erp_entries(id),
        user_id TEXT NOT NULL, created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS erp_invoice_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES erp_invoices(id) ON DELETE CASCADE,
        description TEXT NOT NULL, qty REAL NOT NULL, price INTEGER NOT NULL, vat_rate REAL NOT NULL,
        account TEXT NOT NULL, net INTEGER NOT NULL, vat INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS erp_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('receipt','payment')),
        party_id INTEGER NOT NULL REFERENCES erp_parties(id), invoice_id INTEGER REFERENCES erp_invoices(id),
        date TEXT NOT NULL, amount INTEGER NOT NULL CHECK (amount > 0), method TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
        entry_id INTEGER NOT NULL REFERENCES erp_entries(id), user_id TEXT NOT NULL, created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS erp_invoices_party ON erp_invoices(party_id);
      CREATE INDEX IF NOT EXISTS erp_payments_party ON erp_payments(party_id);
    `);
  }

  need(...codes) {
    for (const c of codes) {
      if (!this.db.prepare('SELECT 1 FROM erp_accounts WHERE code = ?').get(c)) throw httpError(409, `الحساب ${c} غير موجود: أنشئ دليل الحسابات الافتراضي أولاً`);
    }
  }

  addParty({ kind, name, phone, tax_no: taxNo }) {
    if (!['customer', 'supplier'].includes(kind)) throw httpError(400, 'نوع الطرف غير صالح');
    name = String(name || '').trim();
    if (!name || name.length > 120) throw httpError(400, 'الاسم مطلوب');
    const r = this.db.prepare('INSERT INTO erp_parties (kind, name, phone, tax_no, created) VALUES (?, ?, ?, ?, ?)')
      .run(kind, name, String(phone || '').slice(0, 40), String(taxNo || '').slice(0, 40), Date.now());
    return this.party(Number(r.lastInsertRowid));
  }
  party(id) {
    const p = this.db.prepare('SELECT id, kind, name, phone, tax_no FROM erp_parties WHERE id = ?').get(id);
    if (!p) throw httpError(404, 'الطرف غير موجود');
    return p;
  }
  parties(kind) {
    const rows = this.db.prepare(`SELECT p.id, p.kind, p.name, p.phone, p.tax_no,
        COALESCE((SELECT SUM(total) FROM erp_invoices WHERE party_id = p.id AND status = 'open'), 0)
        - COALESCE((SELECT SUM(amount) FROM erp_payments WHERE party_id = p.id), 0) AS balance
      FROM erp_parties p WHERE (? IS NULL OR p.kind = ?) ORDER BY p.name`).all(kind || null, kind || null);
    return rows;
  }

  createInvoice({ kind, party_id: partyId, date, due, ref, note, lines }, userId) {
    const k = KINDS[kind];
    if (!k) throw httpError(400, 'نوع الفاتورة غير صالح');
    if (!isDate(date)) throw httpError(400, 'تاريخ الفاتورة غير صالح');
    if (due && !isDate(due)) throw httpError(400, 'تاريخ الاستحقاق غير صالح');
    const party = this.party(Number(partyId));
    if (party.kind !== k.party) throw httpError(400, kind === 'sales' ? 'الفاتورة تحتاج عميلاً' : 'الفاتورة تحتاج مورداً');
    if (!Array.isArray(lines) || !lines.length || lines.length > 100) throw httpError(400, 'الفاتورة تحتاج بنداً واحداً على الأقل');
    this.need(AR, AP, VAT, k.line);

    const rows = lines.map((l) => {
      const qty = Number(l.qty);
      const rate = Number(l.vat_rate || 0);
      if (!Number.isFinite(qty) || qty <= 0 || qty > 1e9) throw httpError(400, 'كمية غير صالحة');
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw httpError(400, 'نسبة الضريبة غير صالحة');
      const price = toMinor(l.price);
      const account = String(l.account || k.line);
      const acc = this.db.prepare('SELECT type FROM erp_accounts WHERE code = ?').get(account);
      if (!acc) throw httpError(400, `الحساب ${account} غير موجود`);
      if (kind === 'sales' && acc.type !== 'revenue') throw httpError(400, 'بند المبيعات يُرحَّل إلى حساب إيراد');
      if (kind === 'purchase' && !['expense', 'asset'].includes(acc.type)) throw httpError(400, 'بند المشتريات يُرحَّل إلى حساب مصروف أو أصل');
      const net = Math.round(qty * price);
      const vat = Math.round((net * rate) / 100);
      return { description: String(l.description || '').trim().slice(0, 200) || '—', qty, price, vat_rate: rate, account, net, vat };
    });
    const subtotal = rows.reduce((s, r) => s + r.net, 0);
    const vat = rows.reduce((s, r) => s + r.vat, 0);
    const total = subtotal + vat;
    if (total <= 0) throw httpError(400, 'إجمالي الفاتورة يجب أن يكون أكبر من صفر');

    return this.ledger.tx(() => {
      // التجميع بحسب الحساب يبقي القيد مختصراً
      const byAcct = {};
      rows.forEach((r) => { byAcct[r.account] = (byAcct[r.account] || 0) + r.net; });
      const lg = [];
      const num = (v) => v / 100;
      if (kind === 'sales') {
        lg.push({ account: AR, debit: num(total) });
        Object.entries(byAcct).forEach(([a, v]) => v && lg.push({ account: a, credit: num(v) }));
        if (vat) lg.push({ account: VAT, credit: num(vat) });
      } else {
        Object.entries(byAcct).forEach(([a, v]) => v && lg.push({ account: a, debit: num(v) }));
        if (vat) lg.push({ account: VAT, debit: num(vat) });
        lg.push({ account: AP, credit: num(total) });
      }
      const seq = this.db.prepare('SELECT COUNT(*) n FROM erp_invoices WHERE kind = ?').get(kind).n + 1;
      const number = `${k.prefix}-${String(seq).padStart(6, '0')}`;
      const entry = this.ledger.post({ date, memo: `${kind === 'sales' ? 'فاتورة مبيعات' : 'فاتورة مشتريات'} ${number} — ${party.name}`, ref: number, lines: lg }, userId);
      const r = this.db.prepare(`INSERT INTO erp_invoices (kind, number, ref, party_id, date, due, subtotal, vat, total, note, entry_id, user_id, created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(kind, number, String(ref || '').slice(0, 60), party.id, date, due || null, subtotal, vat, total, String(note || '').slice(0, 300), entry.id, userId, Date.now());
      const id = Number(r.lastInsertRowid);
      const ins = this.db.prepare('INSERT INTO erp_invoice_lines (invoice_id, description, qty, price, vat_rate, account, net, vat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      rows.forEach((x) => ins.run(id, x.description, x.qty, x.price, x.vat_rate, x.account, x.net, x.vat));
      return this.invoice(id);
    });
  }

  invoice(id) {
    const inv = this.db.prepare(`SELECT i.*, p.name AS party_name FROM erp_invoices i JOIN erp_parties p ON p.id = i.party_id WHERE i.id = ?`).get(id);
    if (!inv) throw httpError(404, 'الفاتورة غير موجودة');
    inv.lines = this.db.prepare('SELECT description, qty, price, vat_rate, account, net, vat FROM erp_invoice_lines WHERE invoice_id = ? ORDER BY id').all(id);
    inv.remaining = inv.status === 'open' ? inv.total - inv.paid : 0;
    return inv;
  }

  invoices({ kind, party, status } = {}) {
    return this.db.prepare(`SELECT i.id, i.kind, i.number, i.date, i.due, i.total, i.paid, i.status, p.name AS party_name
      FROM erp_invoices i JOIN erp_parties p ON p.id = i.party_id
      WHERE (? IS NULL OR i.kind = ?) AND (? IS NULL OR i.party_id = ?) AND (? IS NULL OR i.status = ?)
      ORDER BY i.date DESC, i.id DESC LIMIT 300`)
      .all(kind || null, kind || null, party ? Number(party) : null, party ? Number(party) : null, status || null, status || null);
  }

  voidInvoice(id, userId) {
    const inv = this.invoice(id);
    if (inv.status !== 'open') throw httpError(409, 'الفاتورة ملغاة مسبقاً');
    if (inv.paid > 0) throw httpError(409, 'لا تُلغى فاتورة عليها مدفوعات');
    return this.ledger.tx(() => {
      const rev = this.ledger.reverse(inv.entry_id, userId);
      this.db.prepare("UPDATE erp_invoices SET status = 'void', void_entry_id = ? WHERE id = ?").run(rev.id, id);
      return this.invoice(id);
    });
  }

  // سند قبض (من عميل) أو صرف (لمورد)، مع ربط اختياري بفاتورة
  pay({ party_id: partyId, invoice_id: invoiceId, date, amount, method, note }, userId) {
    if (!isDate(date)) throw httpError(400, 'التاريخ غير صالح');
    if (!CASH[method]) throw httpError(400, 'طريقة الدفع: نقدي أو بنكي');
    const party = this.party(Number(partyId));
    const kind = party.kind === 'customer' ? 'receipt' : 'payment';
    const amt = toMinor(amount);
    if (amt <= 0) throw httpError(400, 'المبلغ يجب أن يكون أكبر من صفر');
    this.need(AR, AP, CASH[method]);
    return this.ledger.tx(() => {
      let inv = null;
      if (invoiceId) {
        inv = this.invoice(Number(invoiceId));
        if (inv.party_id !== party.id) throw httpError(400, 'الفاتورة لا تخص هذا الطرف');
        if (inv.status !== 'open') throw httpError(409, 'الفاتورة ملغاة');
        if (amt > inv.remaining) throw httpError(400, 'المبلغ أكبر من المتبقي على الفاتورة');
      }
      const cash = CASH[method];
      const lines = kind === 'receipt'
        ? [{ account: cash, debit: amt / 100 }, { account: AR, credit: amt / 100 }]
        : [{ account: AP, debit: amt / 100 }, { account: cash, credit: amt / 100 }];
      const entry = this.ledger.post({ date, memo: `${kind === 'receipt' ? 'سند قبض من' : 'سند صرف إلى'} ${party.name}${inv ? ` — ${inv.number}` : ''}`, ref: inv ? inv.number : '', lines }, userId);
      const r = this.db.prepare(`INSERT INTO erp_payments (kind, party_id, invoice_id, date, amount, method, note, entry_id, user_id, created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(kind, party.id, inv ? inv.id : null, date, amt, method, String(note || '').slice(0, 300), entry.id, userId, Date.now());
      if (inv) this.db.prepare('UPDATE erp_invoices SET paid = paid + ? WHERE id = ?').run(amt, inv.id);
      return this.db.prepare('SELECT * FROM erp_payments WHERE id = ?').get(Number(r.lastInsertRowid));
    });
  }

  payments({ party } = {}) {
    return this.db.prepare(`SELECT y.id, y.kind, y.date, y.amount, y.method, y.note, y.invoice_id, p.name AS party_name
      FROM erp_payments y JOIN erp_parties p ON p.id = y.party_id WHERE (? IS NULL OR y.party_id = ?) ORDER BY y.date DESC, y.id DESC LIMIT 300`)
      .all(party ? Number(party) : null, party ? Number(party) : null);
  }

  // كشف حساب: فواتير (+) ومدفوعات (−) مرتبة زمنياً برصيد جارٍ (موجب = مستحق على العميل / للمورد)
  statement(id) {
    const party = this.party(id);
    const inv = this.db.prepare("SELECT date, number AS doc, total AS amount, 'invoice' AS type, id FROM erp_invoices WHERE party_id = ? AND status = 'open'").all(id);
    const pay = this.db.prepare("SELECT date, 'سند #' || id AS doc, -amount AS amount, 'payment' AS type, id FROM erp_payments WHERE party_id = ?").all(id);
    const rows = inv.concat(pay).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type === b.type ? a.id - b.id : a.type === 'invoice' ? -1 : 1));
    let run = 0;
    return { party, rows: rows.map((r) => { run += r.amount; return { ...r, balance: run }; }), balance: run };
  }

  summary() {
    const one = (sql, ...a) => this.db.prepare(sql).get(...a).v || 0;
    return {
      receivable: one("SELECT SUM(total - paid) v FROM erp_invoices WHERE kind = 'sales' AND status = 'open'"),
      payable: one("SELECT SUM(total - paid) v FROM erp_invoices WHERE kind = 'purchase' AND status = 'open'"),
      sales: one("SELECT SUM(subtotal) v FROM erp_invoices WHERE kind = 'sales' AND status = 'open'"),
      purchases: one("SELECT SUM(subtotal) v FROM erp_invoices WHERE kind = 'purchase' AND status = 'open'"),
      overdue: one("SELECT COUNT(*) v FROM erp_invoices WHERE status = 'open' AND paid < total AND due IS NOT NULL AND due < ?", new Date().toISOString().slice(0, 10)),
    };
  }
}

module.exports = { Trade };
