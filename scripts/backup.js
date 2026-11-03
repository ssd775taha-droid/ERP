// نسخة احتياطية يدوية. الاستخدام: npm run backup [مجلد]
const path = require('node:path');
const { Store } = require('../server/store');
const { backup } = require('../server/backup');

(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL غير مضبوط: يلزم رابط اتصال PostgreSQL');
  const store = await new Store(databaseUrl).init();
  const dir = process.argv[2] || path.join(__dirname, '..', 'data', 'backups');
  console.log(`تم حفظ النسخة: ${backup(store, dir, Infinity)}`);
  await store.close();
})().catch((e) => { console.error('فشل النسخ الاحتياطي:', e); process.exit(1); });
