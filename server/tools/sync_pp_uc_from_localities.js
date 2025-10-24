import db from '../db.js';

export default function sync(){
  db.exec('CREATE TABLE IF NOT EXISTS localities (id INTEGER PRIMARY KEY, name TEXT UNIQUE, alias TEXT, pp TEXT, uc TEXT)');
  const exists = db.prepare('SELECT COUNT(*) AS c FROM localities').get().c;
  if (!exists){ console.log(JSON.stringify({ updated: 0, note: 'localities empty' })); return; }
  const rows = db.prepare('SELECT rowNumber, [LocalityName] AS loc, [PP] AS pp, [UC] AS uc FROM people WHERE [LocalityName] IS NOT NULL AND TRIM([LocalityName])<>""').all();
  const find = db.prepare('SELECT pp, uc FROM localities WHERE name = ?');
  const upd = db.prepare('UPDATE people SET [PP]=@pp, [UC]=@uc WHERE rowNumber=@n');
  let updated = 0;
  const tx = db.transaction((list)=>{
    for (const r of list){
      const m = find.get(r.loc);
      if (!m) continue;
      const newPP = m.pp ? String(m.pp).trim() : '';
      const newUC = m.uc ? String(m.uc).trim() : '';
      if (!newPP && !newUC) continue;
      const curPP = r.pp == null ? '' : String(r.pp).trim();
      const curUC = r.uc == null ? '' : String(r.uc).trim();
      if ((newPP && newPP !== curPP) || (newUC && newUC !== curUC)){
        upd.run({ pp: newPP || curPP, uc: newUC || curUC, n: r.rowNumber });
        updated++;
      }
    }
  });
  tx(rows);
  console.log(JSON.stringify({ updated }));
}

if (import.meta.url === `file://${process.argv[1]}`){ sync(); }

