// Polling location resolver using prebuilt JSON ranges (no XLSX at runtime).
import fs from 'node:fs';
import path from 'node:path';

let ranges = [];

function toNumber(v) {
  if (v == null) return NaN;
  const s = String(v).replace(/\D+/g, '');
  if (!s) return NaN;
  try { return parseInt(s, 10); } catch { return NaN }
}

function norm(s) { return s == null ? '' : String(s).trim(); }

function loadRangesSync() {
  try {
    const candidates = [
      path.resolve('./append/polling_ranges.json'),
      path.resolve('./server/polling_ranges.json'),
      path.resolve('./data/polling_ranges.json'),
    ];
    const file = candidates.find(p => fs.existsSync(p));
    if (!file) { console.warn('[pollingMap] No polling_ranges.json found; polling info disabled'); return; }
    const txt = fs.readFileSync(file, 'utf8');
    const arr = JSON.parse(txt);
    if (!Array.isArray(arr)) { console.warn('[pollingMap] polling_ranges.json not an array'); return; }
    ranges = arr.map(r => ({
      prefix: norm(r.prefix).toUpperCase(),
      start: Number(r.start),
      end: Number(r.end),
      location: norm(r.location),
      floor: norm(r.floor),
      station: norm(r.station),
    })).filter(r => Number.isFinite(r.start) && Number.isFinite(r.end));
    console.log(`[pollingMap] Loaded ${ranges.length} polling ranges from ${path.basename(file)}`);
  } catch (e) {
    console.warn('[pollingMap] Failed to load polling ranges:', e?.message || e);
  }
}

loadRangesSync();

export function findPollingFor(newIdStr, idValue) {
  try {
    const prefix = String(newIdStr || '').slice(0, 2).toUpperCase();
    const idNum = toNumber(idValue);
    if (!Number.isFinite(idNum) || !ranges || ranges.length === 0) return null;
    const candidates = ranges.filter(r => r.prefix ? (r.prefix === prefix) : true);
    const hit = candidates.find(r => idNum >= r.start && idNum <= r.end);
    if (!hit) return null;
    return { location: hit.location || '', floor: hit.floor || '', station: hit.station || '' };
  } catch {
    return null;
  }
}

export default { findPollingFor };
