import db from '../db.js';

function extractDigits(s){ if(s==null) return ''; const m = String(s).match(/\d+/); return m? m[0] : '' }

export default function repair(){
  const rows = db.prepare('SELECT rowNumber, [PP] AS pp, [Pp] AS pp2, [UC] AS uc, [Uc] AS uc2 FROM people').all();
  let changed = 0;
  const tx = db.transaction((list)=>{
    const updPP = db.prepare('UPDATE people SET [PP]=@v WHERE rowNumber=@n');
    const updPp = db.prepare('UPDATE people SET [Pp]=@v WHERE rowNumber=@n');
    const updUC = db.prepare('UPDATE people SET [UC]=@v WHERE rowNumber=@n');
    const updUc = db.prepare('UPDATE people SET [Uc]=@v WHERE rowNumber=@n');
    for (const r of list){
      const n = r.rowNumber;
      // Prefer PP/UC uppercase columns if present
      const rawPP = r.pp !== undefined ? r.pp : r.pp2;
      const rawUC = r.uc !== undefined ? r.uc : r.uc2;
      const dPP = extractDigits(rawPP);
      const dUC = extractDigits(rawUC);
      let did = false;
      if (r.pp !== undefined){ if (String(r.pp||'') !== dPP){ updPP.run({ v: dPP, n }); did = true } }
      if (r.pp === undefined && r.pp2 !== undefined){ if (String(r.pp2||'') !== dPP){ updPp.run({ v: dPP, n }); did = true } }
      if (r.uc !== undefined){ if (String(r.uc||'') !== dUC){ updUC.run({ v: dUC, n }); did = true } }
      if (r.uc === undefined && r.uc2 !== undefined){ if (String(r.uc2||'') !== dUC){ updUc.run({ v: dUC, n }); did = true } }
      if (did) changed++;
    }
  });
  tx(rows);
  const counts = db.prepare('SELECT COUNT(*) AS c FROM people').get().c;
  console.log(JSON.stringify({ repaired: changed, total: counts }));
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`){
  repair();
}

