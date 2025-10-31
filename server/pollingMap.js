// Optional polling location resolver from local XLSX ranges.
// This module is safe to require in all envs; it no-ops if the XLSX or xlsx package is missing.
import fs from 'node:fs';
import path from 'node:path';

const POLLING_XLSX = path.resolve('./append/polling station detail.xlsx');

let ranges = [];

function toNumber(v) {
  if (v == null) return NaN;
  const s = String(v).replace(/\D+/g, '');
  if (!s) return NaN;
  try { return parseInt(s, 10); } catch { return NaN }
}

function norm(s) {
  if (s == null) return '';
  return String(s).trim();
}

function headerIndex(headers, candidates) {
  const lc = headers.map(h => String(h || '').toLowerCase().trim());
  for (const c of candidates) {
    const idx = lc.indexOf(String(c).toLowerCase().trim());
    if (idx !== -1) return idx;
  }
  // fuzzy contains
  for (let i = 0; i < lc.length; i++) {
    for (const c of candidates) {
      if (lc[i].includes(String(c).toLowerCase().trim())) return i;
    }
  }
  return -1;
}

async function loadRanges() {
  try {
    if (!fs.existsSync(POLLING_XLSX)) return;
    // Dynamic import so production can run without the package
    let XLSX;
    try {
      XLSX = (await import('xlsx')).default || (await import('xlsx'));
    } catch {
      console.warn('[pollingMap] xlsx package not installed; skipping load of polling ranges');
      return;
    }
    const wb = XLSX.readFile(POLLING_XLSX, { cellDates: false });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows || rows.length < 2) return;
    const header = rows[0].map(v => String(v || '').trim());
    const idxPrefix = headerIndex(header, ['hc/lc', 'prefix', 'type', 'id type']);
    const idxStart = headerIndex(header, ['start', 'from', 'min', 'id from', 'vote from', 'range start']);
    const idxEnd = headerIndex(header, ['end', 'to', 'max', 'id to', 'vote to', 'range end']);
    const idxLoc = headerIndex(header, ['polling location', 'location', 'place', 'school', 'address']);
    const idxFloor = headerIndex(header, ['floor', 'level']);
    const idxStation = headerIndex(header, ['polling station', 'station', 'ps', 'ps #', 'station #', 'booth', 'room']);
    const result = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const prefix = idxPrefix >= 0 ? norm(r[idxPrefix]) : '';
      const start = toNumber(idxStart >= 0 ? r[idxStart] : null);
      const end = toNumber(idxEnd >= 0 ? r[idxEnd] : null);
      const location = idxLoc >= 0 ? norm(r[idxLoc]) : '';
      const floor = idxFloor >= 0 ? norm(r[idxFloor]) : '';
      const station = idxStation >= 0 ? norm(r[idxStation]) : '';
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
        result.push({ prefix: (prefix || '').toUpperCase(), start, end, location, floor, station });
      }
    }
    ranges = result;
    console.log(`[pollingMap] Loaded ${ranges.length} polling ranges from ${path.basename(POLLING_XLSX)}`);
  } catch (e) {
    console.warn('[pollingMap] Failed to load ranges:', e?.message || e);
  }
}

// Kick off load (non-blocking)
await loadRanges();

export function findPollingFor(newIdStr, idValue) {
  try {
    const prefix = String(newIdStr || '').slice(0, 2).toUpperCase();
    const idNum = toNumber(idValue);
    if (!Number.isFinite(idNum) || !ranges || ranges.length === 0) return null;
    // Prefer prefix-matched ranges, fallback to any
    const candidates = ranges.filter(r => r.prefix ? (r.prefix === prefix) : true);
    const hit = candidates.find(r => idNum >= r.start && idNum <= r.end);
    if (!hit) return null;
    return { location: hit.location || '', floor: hit.floor || '', station: hit.station || '' };
  } catch {
    return null;
  }
}

export default { findPollingFor };
