import db from '../db.js';

function pick(obj, keys){ for(const k of keys){ const v = obj?.[k]; if (v!=null && String(v).trim()!=='') return String(v).trim() } return '' }

export default function repair(){
  const rows = db.prepare('SELECT rowNumber, [LAWYERNAME] AS nm FROM people').all();
  const keys = ['LAWYERNAME','LawyerName','Lawyer Name','Lawyer Names','LAWYER NAMES','Name','Full Name','FullName','Alias'];
  let updated = 0;
  const upd = db.prepare('UPDATE people SET [LAWYERNAME]=@v WHERE rowNumber=@n');
  const tx = db.transaction(()=>{
    for (const r of rows){
      const cur = r.nm==null? '' : String(r.nm).trim();
      if (cur) continue;
      const full = db.prepare('SELECT * FROM people WHERE rowNumber=?').get(r.rowNumber);
      const val = pick(full, keys);
      if (val){ upd.run({ v: val, n: r.rowNumber }); updated++; }
    }
  });
  tx();
  console.log(JSON.stringify({ updated }));
}

if (import.meta.url === `file://${process.argv[1]}`){ repair(); }

