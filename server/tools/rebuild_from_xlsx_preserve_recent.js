import XLSX from 'xlsx';
import db from '../db.js';

const CUTOFF = '2025-10-07'; // inclusive

function pick(row, keys){ const map=new Map(Object.keys(row).map(k=>[k.toLowerCase(),k])); for(const k of keys){ const real=map.get(k.toLowerCase()); if(real){ return row[real] } } return undefined }
function sanitizePPUC(v){ if(v==null) return ''; if(typeof v==='number') return String(Math.trunc(v)); const s=String(v).trim(); return s.includes('.')? s.split('.')[0] : s }

function loadXlsx(path){ const wb=XLSX.readFile(path); const ws=wb.Sheets[ wb.SheetNames.includes('merged')?'merged':wb.SheetNames[0] ]; return XLSX.utils.sheet_to_json(ws,{defval:''}) }

function nameKey(obj){ const name = obj['LAWYERNAME'] || obj['LawyerName'] || obj['Name'] || pick(obj,['LAWYERNAME','LawyerName','Name']) || ''; return String(name).trim().toLowerCase() }

function buildSchemaFromXlsx(rows){ if(!rows.length) throw new Error('XLSX has no rows'); const headers=Object.keys(rows[0]); const drop=new Set(['Status','HighlightedAddress','status','highlightedaddress']); const cols=new Set(); for(const h of headers){ if(!h) continue; if(drop.has(String(h))) continue; cols.add(String(h)) } // required fields
  ['LAWYERNAME','PHONE','ADDRESS','LocalityName','Alias','PP','UC','Comments','Called','CallDate','Visited','VisitDate','ConfirmedVoter','LawyerForum','ID','new ID'].forEach(c=>cols.add(c));
  return Array.from(cols); }

function createPeopleNew(cols){
  const safeDefs = ['rowNumber INTEGER PRIMARY KEY'].concat(cols.map(c=>`[${c.replace(']', ']]')}] TEXT`));
  db.exec(`CREATE TABLE people_new (${safeDefs.join(', ')})`);
}

function insertRow(tableCols, rn, rec){
  const keys = tableCols.filter(c=>rec[c]!==undefined);
  if (keys.length === 0){ db.prepare('INSERT INTO people_new (rowNumber) VALUES (@rn)').run({ rn }); return }
  const colSql = keys.map(k=>`[${k.replace(']', ']]')}]`).join(',');
  const ph = keys.map(k=>`@${k.replace(/[^A-Za-z0-9_]/g,'_')}`).join(',');
  const params = {}; keys.forEach(k=>{ params[k.replace(/[^A-Za-z0-9_]/g,'_')] = rec[k] });
  db.prepare(`INSERT INTO people_new (rowNumber, ${colSql}) VALUES (@rn, ${ph})`).run({ rn, ...params });
}

function preserveSetFromAudit(){
  // If audit table doesn't exist, nothing to preserve
  try {
    const chk = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit'").get();
    if(!chk) return new Set();
  } catch { return new Set() }
  try {
    const rows = db.prepare("SELECT DISTINCT rowNumber FROM audit WHERE ts >= @cut AND (details LIKE '%Called%' OR details LIKE '%Visited%' OR details LIKE '%ConfirmedVoter%')").all({ cut: CUTOFF });
    return new Set(rows.map(r=>r.rowNumber));
  } catch { return new Set() }
}

export async function runRebuild(xlsxPath){
  const xrows = loadXlsx(xlsxPath);
  const xmap = new Map(); // name -> row
  for(const r of xrows){ const k=nameKey(r); if(!k) continue; if(!xmap.has(k)) xmap.set(k,r) }
  const drows = db.prepare('SELECT * FROM people').all();
  const dByName = new Map(); drows.forEach(r=>{ const k=nameKey(r); if(k && !dByName.has(k)) dByName.set(k,r) })
  const preserveAudit = preserveSetFromAudit();
  const preserveByName = new Set();
  for(const [name, row] of dByName){ if(preserveAudit.has(row.rowNumber)) preserveByName.add(name) }

  const cols = buildSchemaFromXlsx(xrows);
  db.exec('BEGIN');
  try {
    createPeopleNew(cols);
    let rn = 0;
    for(const [name, xr] of xmap){
      rn++;
      if (preserveByName.has(name)){
        const dr = dByName.get(name);
        const rec = {};
        for(const c of cols){ if(c==='rowNumber') continue; if(dr[c]!==undefined){ let v=dr[c]; if(c==='PP'||c==='UC') v=sanitizePPUC(v); rec[c] = v==null? '' : String(v) } }
        insertRow(cols, rn, rec);
      } else {
        const rec = {};
        for(const c of cols){ if(c==='rowNumber') continue; if(xr[c]!==undefined){ let v=xr[c]; if(c==='PP'||c==='UC') v=sanitizePPUC(v); rec[c] = v==null? '' : String(v) } }
        insertRow(cols, rn, rec);
      }
    }
    // Swap tables
    db.exec('DROP TABLE people');
    db.exec('ALTER TABLE people_new RENAME TO people');
    // Indices
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_people_uc ON people([UC])") } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_people_pp ON people([PP])") } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_people_locality ON people([LocalityName])") } catch {}
    db.exec('COMMIT');
    console.log(`Rebuild complete. New people rows: ${xmap.size}`);
  } catch (e) {
    try { db.exec('ROLLBACK') } catch {}
    throw e;
  }
}
export default runRebuild;
// If run directly from CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const p = process.argv[2] || './tbl_localities.xlsx';
  runRebuild(p).catch(e=>{ console.error('rebuild failed:', e?.message || e); process.exit(1) })
}
