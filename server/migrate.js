import { runMigrations } from './db.js';

(async function(){
  try {
    runMigrations();
    console.log('Migrations complete');
  } catch (e) {
    console.error('Migration error:', e?.message || e);
    process.exitCode = 1;
  }
})();

