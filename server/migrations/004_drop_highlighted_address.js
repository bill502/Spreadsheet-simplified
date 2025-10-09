// JS migration: drop HighlightedAddress column from people, preserving all other columns/types/PK.
export default function(db){
  let info;
  try { info = db.prepare('PRAGMA table_info(people)').all(); } catch { return }
  if (!info || !info.length) return;
  const hasCol = info.some(r => String(r.name) === 'HighlightedAddress');
  if (!hasCol) return;

  const cols = info.filter(r => String(r.name) !== 'HighlightedAddress');
  const colDefs = cols.map(r => {
    const name = `[${String(r.name).replace(']', ']]')}]`;
    const type = r.type && String(r.type).trim() ? String(r.type).trim() : 'TEXT';
    const pk = (r.pk === 1) ? ' PRIMARY KEY' : '';
    return `${name} ${type}${pk}`;
  }).join(', ');

  const colNames = cols.map(r => `[${String(r.name).replace(']', ']]')}]`).join(', ');

  db.exec('BEGIN');
  try {
    db.exec(`CREATE TABLE people_new (${colDefs})`);
    db.exec(`INSERT INTO people_new (${colNames}) SELECT ${colNames} FROM people`);
    db.exec('DROP TABLE people');
    db.exec('ALTER TABLE people_new RENAME TO people');
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_people_uc ON people([UC])") } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_people_pp ON people([PP])") } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_people_locality ON people([LocalityName])") } catch {}
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK') } catch {}
    throw e;
  }
}
