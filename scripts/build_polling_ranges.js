// Build polling_ranges.json from append/polling station detail.xlsx
import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';

const SRC = path.resolve('./append/polling station detail.xlsx');
const OUT = path.resolve('./append/polling_ranges.json');

function toNumber(v){ if(v==null) return NaN; const s=String(v).replace(/\D+/g,''); if(!s) return NaN; return parseInt(s,10) }
function norm(s){ return s==null? '' : String(s).trim() }
function headerIndex(headers, candidates){ const lc=headers.map(h=>String(h||'').toLowerCase().trim());
  for(const c of candidates){ const i=lc.indexOf(String(c).toLowerCase().trim()); if(i!==-1) return i }
  for(let i=0;i<lc.length;i++){ for(const c of candidates){ if(lc[i].includes(String(c).toLowerCase().trim())) return i } }
  return -1 }

if (!fs.existsSync(SRC)) { console.error('Source XLSX not found:', SRC); process.exit(1) }
const wb = xlsx.readFile(SRC, { cellDates:false });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { header:1, defval:'' });
if (!rows || rows.length < 2) { console.error('No rows in source'); process.exit(1) }
const header = rows[0].map(norm);
const idxPrefix = headerIndex(header, ['hc/lc','prefix','type','id type']);
const idxStart = headerIndex(header, ['start','from','min','id from','vote from','range start']);
const idxEnd = headerIndex(header, ['end','to','max','id to','vote to','range end']);
const idxLoc = headerIndex(header, ['polling location','location','place','school','address']);
const idxFloor = headerIndex(header, ['floor','level']);
const idxStation = headerIndex(header, ['polling station','station','ps','ps #','station #','booth','room']);
const out=[];
for(let i=1;i<rows.length;i++){
  const r=rows[i]||[];
  const prefix = idxPrefix>=0? norm(r[idxPrefix]) : '';
  const start = toNumber(idxStart>=0? r[idxStart] : null);
  const end = toNumber(idxEnd>=0? r[idxEnd] : null);
  const location = idxLoc>=0? norm(r[idxLoc]) : '';
  const floor = idxFloor>=0? norm(r[idxFloor]) : '';
  const station = idxStation>=0? norm(r[idxStation]) : '';
  if(Number.isFinite(start) && Number.isFinite(end) && start<=end){ out.push({ prefix, start, end, location, floor, station }) }
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log('Wrote', out.length, 'ranges to', OUT);
