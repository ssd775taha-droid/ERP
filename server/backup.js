const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// نسخة متسقة من قاعدة بيانات PostgreSQL عبر pg_dump، مع إبقاء أحدث `keep` نسخة فقط.
function backup(store, dir, keep = 14) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `erp-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
  const r = spawnSync('pg_dump', [store.pool.options.connectionString, '-f', dest], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.error || r.status !== 0) {
    throw new Error(`فشل pg_dump: ${r.error ? r.error.message : r.stderr?.toString().trim()}`);
  }
  const old = fs.readdirSync(dir).filter((f) => /^erp-.*\.sql$/.test(f)).sort().slice(0, -keep);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return dest;
}

function schedule(store, dir, { keep = 14, everyMs = 24 * 3600 * 1000 } = {}) {
  const run = () => {
    try { console.log(`نسخة احتياطية: ${backup(store, dir, keep)}`); } catch (e) { console.error('فشل النسخ الاحتياطي', e); }
  };
  run();
  const t = setInterval(run, everyMs);
  t.unref();
  return () => clearInterval(t);
}

module.exports = { backup, schedule };
