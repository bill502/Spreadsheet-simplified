import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import db from '../db.js';

function loadXlsxRows(filePath){
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames.includes('merged') ? 'merged' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows;
}

function nameKey(row){
  const candidates = ['LAWYERNAME','LawyerName','Lawyer Name','Lawyer Names','LAWYER NAMES','Name','Full Name','FullName','Alias'];
  for (const k of candidates){ if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim().toLowerCase(); }
  return '';
}

function sanitizePPUC(v){
  if (v==null) return '';
  if (typeof v==='number') return String(Math.trunc(v));
  const s = String(v).trim();
  // Extract first continuous digits if present
  const m = s.match(/\d+/);
  if (m && m[0]) return m[0];
  // Fallback: if pure numeric-looking with decimal, take integer part
  if (s.includes('.')) return s.split('.')[0];
  return s;
}

function phoneDigits(v){ if(v==null) return ''; return String(v).replace(/\D+/g,'') }

function getExistingKeys(){
  const rows = db.prepare('SELECT * FROM people').all();
  const names = new Set();
  const phones = new Set();
  for (const r of rows){
    const k = nameKey(r); if (k) names.add(k);
    const ph = r.PHONE ?? r.Phone ?? r['Phone'] ?? r['Phone Number'] ?? r.Mobile ?? r['Mobile Number'] ?? r.Contact ?? '';
    const pd = phoneDigits(ph); if (pd) phones.add(pd);
  }
  return { names, phones };
}

function ensureColumns(fields){
  const info = db.prepare('PRAGMA table_info(people)').all();
  const existingLower = new Set(info.map(r => String(r.name).toLowerCase()));
  for (const k of Object.keys(fields)){
    if (k === 'rowNumber') continue;
    const kl = String(k).toLowerCase();
    if (!existingLower.has(kl)){
      const safe = String(k).replace(']', ']]');
      db.prepare(`ALTER TABLE people ADD COLUMN [${safe}] TEXT`).run();
      existingLower.add(kl);
    }
  }
}

function insertRow(rn, rec){
  const keys = Object.keys(rec);
  if (keys.length === 0){ db.prepare('INSERT INTO people (rowNumber) VALUES (@rn)').run({ rn }); return; }
  const colSql = keys.map(k => `[${k.replace(']', ']]')}]`).join(',');
  const ph = keys.map(k => `@${k.replace(/[^A-Za-z0-9_]/g,'_')}`).join(',');
  const params = {}; keys.forEach(k=>{ params[k.replace(/[^A-Za-z0-9_]/g,'_')] = rec[k] });
  db.prepare(`INSERT INTO people (rowNumber, ${colSql}) VALUES (@rn, ${ph})`).run({ rn, ...params });
}

export default async function runAppend({ dir = './append', apply = false, patch = false, overwrite = false } = {}){
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) throw new Error(`Append dir not found: ${abs}`);
  const files = fs.readdirSync(abs).filter(f => f.toLowerCase().endsWith('.xlsx')).map(f => path.join(abs, f));
  if (files.length === 0) throw new Error('No .xlsx files found in append directory');

  const existing = getExistingKeys();
  const toAdd = [];
  const toPatch = [];
  const columnsUnion = new Set();
  let scanned = 0;
  for (const f of files){
    const rows = loadXlsxRows(f);
    for (const r of rows){
      scanned++;
      let key = nameKey(r);
      let keyType = 'name';
      if (!key){ const pd = phoneDigits(r.PHONE ?? r.Phone ?? r['Phone'] ?? r['Phone Number'] ?? r.Mobile ?? r['Mobile Number'] ?? r.Contact ?? ''); if (pd){ key = pd; keyType = 'phone' } }
      if (!key) continue;
      const rec = { ...r };
      // Normalize key casing for PP/UC variants
      if (rec.PP === undefined && rec.Pp !== undefined) rec.PP = rec.Pp;
      if (rec.UC === undefined && rec.Uc !== undefined) rec.UC = rec.Uc;
      // Canonicalize common columns (name/phone/address/locality)
      const get = (obj, arr)=>{ for(const key of arr){ if (obj[key] != null && String(obj[key]).trim() !== '') return String(obj[key]).trim() } return '' };
      const canonName = get(rec, ['LAWYERNAME','LawyerName','Lawyer Name','Lawyer Names','LAWYER NAMES','Name','Full Name','FullName','Alias']);
      const canonPhone = get(rec, ['PHONE','Phone','Phone Number','Mobile','Mobile Number','Contact','Cell']);
      const canonAddr = get(rec, ['ADDRESS','Address','HighlightedAddress']);
      const canonLoc = get(rec, ['LocalityName','Locality','Location','Area','Mohalla','Village','Ward']);
      if (!rec.LAWYERNAME && canonName) rec.LAWYERNAME = canonName;
      if (!rec.PHONE && canonPhone) rec.PHONE = canonPhone;
      if (!rec.ADDRESS && canonAddr) rec.ADDRESS = canonAddr;
      if (!rec.LocalityName && canonLoc) rec.LocalityName = canonLoc;
      // Normalize PP/UC as integer-like strings
      if (rec.PP !== undefined) rec.PP = sanitizePPUC(rec.PP);
      if (rec.UC !== undefined) rec.UC = sanitizePPUC(rec.UC);
      const exists = (keyType==='name') ? existing.names.has(key) : existing.phones.has(key);
      if (exists) {
        if (patch) toPatch.push({ key, keyType, PP: rec.PP || '', UC: rec.UC || '', rec });
        continue;
      }
      toAdd.push(rec);
      Object.keys(rec).forEach(k => { if (k && k !== 'rowNumber') columnsUnion.add(k) });
      if (keyType==='name') existing.names.add(key); else existing.phones.add(key); // prevent duplicates across multiple files
    }
  }

  // Compute expected counts
  const totalBefore = db.prepare('SELECT COUNT(*) AS c FROM people').get().c;
  const willAdd = toAdd.length;
  const expectedAfter = Number(totalBefore) + Number(willAdd);

  const summary = {
    dir: abs,
    files: files.map(p => path.basename(p)),
    scannedRows: scanned,
    uniqueNewNames: willAdd,
    totalBefore,
    expectedAfter,
    apply,
    patchCandidates: toPatch.length,
  };

  if (!apply){
    // Write a plan file for review
    try { fs.writeFileSync(path.join(abs, 'append_plan.json'), JSON.stringify(summary, null, 2)) } catch {}
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  // Apply changes
  const colsObj = {}; columnsUnion.forEach(k => colsObj[k] = '');
  ensureColumns(colsObj);
  const max = db.prepare('SELECT IFNULL(MAX(rowNumber), 0) AS m FROM people').get().m;
  let rn = Number(max);
  const tx = db.transaction((list)=>{
    for (const rec of list){ rn++; insertRow(rn, rec); }
  });
  tx(toAdd);
  // Optional patch for existing rows to set PP/UC when missing/invalid (0/empty)
  let patched = 0;
  if (patch && toPatch.length){
    // Build a name->row mapping from current DB (avoid referencing non-existent columns)
    const rows = db.prepare('SELECT * FROM people').all();
    const byName = new Map();
    const byPhone = new Map();
    for (const r of rows){
      const k = nameKey(r); if (k && !byName.has(k)) byName.set(k, r);
      const ph = r.PHONE ?? r.Phone ?? r['Phone'] ?? r['Phone Number'] ?? r.Mobile ?? r['Mobile Number'] ?? r.Contact ?? '';
      const pd = phoneDigits(ph); if (pd && !byPhone.has(pd)) byPhone.set(pd, r);
    }
    const info = db.prepare('PRAGMA table_info(people)').all();
    const has = (n) => info.some(r => String(r.name) === n);
    const updPP = has('PP') ? db.prepare('UPDATE people SET [PP]=@v WHERE rowNumber=@n') : null;
    const updPp = has('Pp') ? db.prepare('UPDATE people SET [Pp]=@v WHERE rowNumber=@n') : null;
    const updUC = has('UC') ? db.prepare('UPDATE people SET [UC]=@v WHERE rowNumber=@n') : null;
    const updUc = has('Uc') ? db.prepare('UPDATE people SET [Uc]=@v WHERE rowNumber=@n') : null;
    const patchTx = db.transaction((list)=>{
      for (const it of list){
        let row = (it.keyType === 'name') ? byName.get(it.key) : null;
        if (!row){
          const srcPh = it.rec?.PHONE ?? it.rec?.Phone ?? it.rec?.['Phone'] ?? it.rec?.['Phone Number'] ?? it.rec?.Mobile ?? it.rec?.['Mobile Number'] ?? it.rec?.Contact ?? '';
          const pd = phoneDigits(srcPh);
          if (pd) row = byPhone.get(pd);
        }
        if (!row) continue;
        const curPP = row.PP == null ? '' : String(row.PP);
        const curUC = row.UC == null ? '' : String(row.UC);
        const curName = row.LAWYERNAME == null ? '' : String(row.LAWYERNAME).trim();
        const newPP = it.PP ? String(it.PP) : '';
        const newUC = it.UC ? String(it.UC) : '';
        const newName = it.rec ? (it.rec.LAWYERNAME || it.rec.LawyerName || it.rec['Lawyer Name'] || it.rec['Lawyer Names'] || it.rec['Full Name'] || it.rec.FullName || '') : '';
        const curPPDigits = sanitizePPUC(curPP);
        const curUCDigits = sanitizePPUC(curUC);
        let setPP = null, setUC = null;
        if (newPP && (overwrite || curPP !== newPP)) setPP = newPP;
        else if (curPPDigits && curPP !== curPPDigits) setPP = curPPDigits;
        if (newUC && (overwrite || curUC !== newUC)) setUC = newUC;
        else if (curUCDigits && curUC !== curUCDigits) setUC = curUCDigits;
        // Also set LAWYERNAME if missing and we have a candidate
        const setName = (!curName && newName) ? newName : null;
        if (setPP !== null || setUC !== null || setName !== null){
          if (setPP !== null){ if (updPP) updPP.run({ v: setPP, n: row.rowNumber }); if (updPp) updPp.run({ v: setPP, n: row.rowNumber }); }
          if (setUC !== null){ if (updUC) updUC.run({ v: setUC, n: row.rowNumber }); if (updUc) updUc.run({ v: setUC, n: row.rowNumber }); }
          if (setName !== null){ db.prepare('UPDATE people SET [LAWYERNAME]=@v WHERE rowNumber=@n').run({ v: setName, n: row.rowNumber }); }
          patched++;
        }
      }
    });
    patchTx(toPatch);
  }
  const after = db.prepare('SELECT COUNT(*) AS c FROM people').get().c;
  const applied = { ...summary, totalAfter: after, patched };
  try { fs.writeFileSync(path.join(abs, 'append_result.json'), JSON.stringify(applied, null, 2)) } catch {}
  console.log(JSON.stringify(applied, null, 2));
  return applied;
}

// CLI usage
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const __file = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] || '') === resolve(__file)){
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const dirArg = [...args].find(a => a.startsWith('--dir='));
  const dir = dirArg ? dirArg.split('=')[1] : './append';
  runAppend({ dir, apply }).catch(e=>{ console.error(e?.message || e); process.exit(1) });
}
