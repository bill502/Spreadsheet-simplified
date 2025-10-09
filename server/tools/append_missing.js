import XLSX from 'xlsx';
import db from '../db.js';

function pick(row, keys){
  const map = new Map(Object.keys(row).map(k => [k.toLowerCase(), k]));
  for (const k of keys){ const real = map.get(k.toLowerCase()); if(real){ return row[real] } }
  return undefined;
}
function normId(v){ if(v==null) return ''; const s=String(v).trim(); if(!s) return ''; const n=Number(s); if(Number.isFinite(n)) return String(Math.trunc(n)); return s }
function keyFromXlsx(r){ const name=pick(r,['LAWYERNAME','LawyerName','Name'])||''; return String(name).trim().toLowerCase() }
function keyFromDb(r){ const name=r['LAWYERNAME']||r['LawyerName']||r['Name']||''; return String(name).trim().toLowerCase() }
function sanitizePPUC(v){ if(v==null) return ''; if(typeof v==='number') return String(Math.trunc(v)); const s=String(v).trim(); return s.includes('.')? s.split('.')[0] : s }

function ensureColumns(obj){
  const info = db.prepare('PRAGMA table_info(people)').all();
  const have = new Set(info.map(r=>String(r.name)));
  for (const k of Object.keys(obj)){
    if (k === 'rowNumber') continue;
    if (!have.has(k)){
      const safe = k.replace(']', ']]');
      db.prepare(`ALTER TABLE people ADD COLUMN [${safe}] TEXT`).run();
      have.add(k);
    }
  }
}

function loadXlsx(path){ const wb=XLSX.readFile(path); const ws=wb.Sheets[ wb.SheetNames.includes('merged')?'merged':wb.SheetNames[0] ]; return XLSX.utils.sheet_to_json(ws,{defval:''}) }

async function main(){
  const path = process.argv[2] || './tbl_localities.xlsx';
  const rowsX = loadXlsx(path);
  const rowsD = db.prepare('SELECT * FROM people').all();
  const dKeys = new Set(rowsD.map(keyFromDb));
  const toInsert = [];
  for(const r of rowsX){ const k=keyFromXlsx(r); if(!dKeys.has(k)) toInsert.push(r) }
  console.log(`Found ${toInsert.length} missing rows to append`);
  if(toInsert.length===0) return;
  // Prepare insert
  let max = db.prepare('SELECT IFNULL(MAX(rowNumber),0) AS m FROM people').get().m;
  const tx = db.transaction((list)=>{
    for(const r of list){
      const rec = {};
      // Copy all fields except Status/HighlightedAddress
      for(const [k,v] of Object.entries(r)){
        const key = String(k);
        if (key.toLowerCase()==='status' || key.toLowerCase()==='highlightedaddress') continue;
        let val = v;
        if (key.toUpperCase()==='PP' || key.toUpperCase()==='UC') val = sanitizePPUC(v);
        rec[key] = (val==null)? '' : String(val);
      }
      ensureColumns(rec);
      const keys = Object.keys(rec);
      const colSql = keys.map(k=>`[${k.replace(']',']]')}]`).join(',');
      const ph = keys.map(k=>`@${k.replace(/[^A-Za-z0-9_]/g,'_')}`).join(',');
      const params={}; keys.forEach(k=>{ params[k.replace(/[^A-Za-z0-9_]/g,'_')] = rec[k] });
      const rn = ++max;
      db.prepare(`INSERT INTO people (rowNumber, ${colSql}) VALUES (@rn, ${ph})`).run({ rn, ...params });
    }
  });
  tx(toInsert);
  console.log('Append complete');
}

main().catch(e=>{ console.error('append failed:', e?.message || e); process.exit(1) })
