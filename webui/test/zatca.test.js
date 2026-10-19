// رمز QR للفاتورة الضريبية: مطابقة المثال المنشور في وثائق هيئة الزكاة والضريبة والجمارك. لا يحتاج قاعدة بيانات.
const test = require('node:test');
const assert = require('node:assert');
const z = require('../public/js/zatca.js');

test('TLV/Base64 يطابق مثال الهيئة', () => {
  assert.strictEqual(z.payload('Bobs Records', '310122393500003', '2022-04-25T15:30:00Z', 1000, 150),
    'AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==');
});
test('الاسم العربي يُرمَّز UTF-8 بطول البايتات لا الحروف', () => {
  const b = Buffer.from(z.payload('شركة', '310122393500003', '2026-01-01T00:00:00Z', 115, 15), 'base64');
  assert.strictEqual(b[0], 1);
  assert.strictEqual(b[1], 8);                       // 4 حروف × 2 بايت
  assert.strictEqual(b.slice(2, 10).toString('utf8'), 'شركة');
});
test('التحقق من الرقم الضريبي السعودي', () => {
  assert.ok(z.validVatNo('310122393500003'));
  for (const bad of ['', '3101223935000', '210122393500003', '310122393500002', '3101223935000033', 'abc']) assert.ok(!z.validVatNo(bad), bad);
});
