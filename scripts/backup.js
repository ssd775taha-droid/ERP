// نسخة احتياطية متسقة من قاعدة البيانات أثناء عمل الخادم. الاستخدام: npm run backup [مجلد]
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'erp.sqlite');
const dir = process.argv[2] || path.join(path.dirname(file), 'backups');
fs.mkdirSync(dir, { recursive: true });
const dest = path.join(dir, `erp-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = new DatabaseSync(file);
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();
console.log(`تم حفظ النسخة: ${dest}`);
