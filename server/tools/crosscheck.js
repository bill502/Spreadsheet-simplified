import XLSX from 'xlsx';
import db from '../db.js';

function pick(row, keys){ const map=new Map(Object.keys(row).map(k=>[k.toLowerCase(),k])); for(const k of keys){ const real=map.get(k.toLowerCase()); if(real){ return row[real] } } return undefined }
function nameKeyFromXlsx(row){ const name = pick(row,['LAWYERNAME','LawyerName','Name']) || ''; return String(name).trim().toLowerCase() }
function nameKeyFromDb(row){ const name = row['LAWYERNAME'] || row['LawyerName'] || row['Name'] || ''; return String(name).trim().toLowerCase() }

function loadSpreadsheet(path){
  const wb = XLSX.readFile(path);
  const sheet = wb.Sheets[ wb.SheetNames.includes('merged') ? 'merged' : wb.SheetNames[0] ];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows;
}

function crosscheck(xlsxRows, dbRows){
  const xKeys = new Map(); const xDup=[];
  for(const r of xlsxRows){ const k=nameKeyFromXlsx(r); if(!k) continue; if(xKeys.has(k)) xDup.push(k); else xKeys.set(k,r) }
  const dKeys = new Map(); const dDup=[];
  for(const r of dbRows){ const k=nameKeyFromDb(r); if(!k) continue; if(dKeys.has(k)) dDup.push(k); else dKeys.set(k,r) }
  const missing=[]; for(const [k,r] of xKeys){ if(!dKeys.has(k)) missing.push({ key:k, row:r }) }
  const extra=[]; for(const [k,r] of dKeys){ if(!xKeys.has(k)) extra.push({ key:k, row:r }) }
  return { counts:{ xlsx:xKeys.size, db:dKeys.size, missing:missing.length, extra:extra.length, xdup:xDup.length, ddup:dDup.length }, missing, extra, xDup, dDup };
}

async function main(){
  const path = process.argv[2] || './tbl_localities.xlsx';
  const rowsX = loadSpreadsheet(path);
  const rowsD = db.prepare('SELECT * FROM people').all();
  const rep = crosscheck(rowsX, rowsD);
  console.log(JSON.stringify(rep.counts, null, 2));
  // Write missing rows keys to a file for review
  try { const fs = await import('node:fs'); fs.writeFileSync('missing_keys.json', JSON.stringify(rep.missing.map(m=>m.key), null, 2)) } catch {}
}

main().catch(e=>{ console.error('crosscheck failed:', e?.message || e); process.exit(1) })
