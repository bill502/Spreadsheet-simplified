"use strict";
// Shared UI utilities used across pages

// DOM helper: get element by id
function el(id){ return document.getElementById(id) }

// Debounce helper to limit rapid calls (e.g., search input)
function debounce(fn, wait=400){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait) } }

// Normalize DB-ish truthy values to boolean (supports 1/0, "1"/"0", yes/no)
function isTrueish(v){
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  if (s === '' || s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  return false;
}

// Toast notification with graceful fallback to alert
function toast(msg, ms=2500){ const n=el('toast'); if(!n){ alert(msg); return } n.textContent=msg; n.style.display='block'; clearTimeout(toast._t); toast._t=setTimeout(()=>{ n.style.display='none' }, ms) }

// Fetch wrapper: JSON by default, sends cookies, throws with error message
async function api(path, opts={}){
  const res = await fetch(path, { headers:{ 'Content-Type':'application/json' }, credentials:'include', ...opts });
  if(!res.ok){ let msg=`${res.status} ${res.statusText}`; try{ const j=await res.json(); if(j && j.error) msg=j.error } catch{}; throw new Error(msg) }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

// Export to window for inline scripts
window.el = el; window.debounce = debounce; window.isTrueish = isTrueish; window.toast = toast; window.api = api;

