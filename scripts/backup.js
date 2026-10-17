// نسخة احتياطية يدوية أثناء عمل الخادم. الاستخدام: npm run backup [مجلد]
const path = require('node:path');
const { Store } = require('../server/store');
const { backup } = require('../server/backup');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'erp.sqlite');
const store = new Store(file);
console.log(`تم حفظ النسخة: ${backup(store, process.argv[2] || path.join(path.dirname(file), 'backups'), Infinity)}`);
store.close();
