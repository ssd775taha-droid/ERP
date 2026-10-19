'use strict';
// رمز QR للفاتورة الضريبية (هيئة الزكاة والضريبة والجمارك): TLV ثم Base64.
// الوسوم: 1 اسم البائع، 2 الرقم الضريبي، 3 الوقت (ISO 8601)، 4 الإجمالي شاملاً الضريبة، 5 مبلغ الضريبة.
(function (root) {
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(s));
    return Array.from(Buffer.from(s, 'utf8'));
  }
  function tlv(tag, value) {
    const v = utf8(String(value));
    if (v.length > 255) throw new Error('قيمة طويلة في رمز QR (الوسم ' + tag + ')');
    return [tag, v.length].concat(v);
  }
  function b64(bytes) {
    if (typeof btoa !== 'undefined') return btoa(String.fromCharCode.apply(null, bytes));
    return Buffer.from(bytes).toString('base64');
  }
  function payload(sellerName, vatNo, timestamp, total, vat) {
    const f = (n) => Number(n).toFixed(2);
    return b64([].concat(tlv(1, sellerName), tlv(2, vatNo), tlv(3, timestamp), tlv(4, f(total)), tlv(5, f(vat))));
  }
  // رقم ضريبي سعودي: 15 رقماً يبدأ وينتهي بـ 3
  function validVatNo(s) { return /^3\d{13}3$/.test(String(s || '')); }
  const api = { payload, validVatNo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ZATCA = api;
})(typeof window !== 'undefined' ? window : globalThis);
