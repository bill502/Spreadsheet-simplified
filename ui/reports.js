"use strict";

// Reports page state
const state = { user:null, role:'viewer', items:[], columns: ['Name','Phone','UC','PP','Locality','Address','ConfirmedVoter'] };

// isTrueish provided by util.js

function getFirst(row, keys){
  for(const k of keys){ const v = row?.[k]; if(v!==undefined && v!==null && String(v).trim()!==''){ return String(v) } }
  return ''
}

// Load current session info
async function refreshUser(){ try{ const me=await api('/api/me'); state.user=me.user||null; state.role=me.role||'viewer' } catch { state.user=null; state.role='viewer' } }
function renderAuth(){ const lbl=el('userLabel'); if(lbl) lbl.textContent = state.user ? `${state.user} (${state.role})` : 'Viewer'; const lo=el('btnLogout'); if(lo) lo.style.display = state.user ? '' : 'none'; const adm=el('linkAdmin'); if(adm) adm.style.display = (state.role==='admin')?'':'none' }

async function ensureEditor(){ await refreshUser(); renderAuth(); const ok = (state.role==='editor' || state.role==='admin'); el('guardPanel').style.display = ok ? 'none' : 'block'; el('quickPanel').style.display = ok ? 'block' : 'none'; return ok }

function buildQuery(){ const p=new URLSearchParams(); const v=(id)=> (el(id)?.value||'').trim(); const add=(k,val)=>{ if(val) p.set(k,val) };
  add('calledFrom', v('fCalledFrom')); add('calledTo', v('fCalledTo'));
  add('visitedFrom', v('fVisitedFrom')); add('visitedTo', v('fVisitedTo'));
  add('modifiedFrom', v('fModFrom')); add('modifiedTo', v('fModTo'));
  add('byUser', v('fByUser'));
  add('uc', v('fUC')); add('locality', v('fLocality')); add('pp', v('fPP'));
  const lim = v('fLimit'); if(lim) add('limit', lim);
  const confirmed = el('fConfirmed'); if (confirmed && confirmed.checked) add('confirmed', 'true');
  return p.toString();
}

// Render results table with curated columns and width distribution favoring long text columns
function render(items){
  const thead=el('thead'); const tbody=el('tbody'); const colg=el('colgroup');
  thead.innerHTML=''; tbody.innerHTML=''; if(colg) colg.innerHTML='';
  const nameKeys = ['Name','LAWYERNAME','LawyerName','Lawyer Name','LAWYER NAME','Lawyer Names','LAWYER NAMES','Full Name','FullName','Alias'];
  const phoneKeys = ['PHONE','Phone','Phone Number','Mobile','Mobile Number','Contact','Cell'];
  const ucKeys = ['UC','Uc','Union Council','UnionCouncil'];
  const ppKeys = ['PP','Pp'];
  const locKeys = ['Locality','LocalityName','Location','Area','Mohalla','Village','Ward'];
  const addrKeys = ['ADDRESS','Address','HighlightedAddress'];
  // Columns: remove Called/Visited booleans and ConfirmedVoter; keep dates.
  // Always omit Comments as a column; render comments as a sub-row when present.
  const shown = ['Name','Phone','UC/PP','Locality','Address','Call','Visit'];
  // Widths sum to 100%; shrink dates (MM-DD) and expand phone for no-break display
  const widths = ['20%','15%','8%','10%','30%','8%','9%'];
  if (colg) widths.forEach(w=>{ const c=document.createElement('col'); c.style.width=w; colg.appendChild(c) });
  shown.forEach(h=>{ const th=document.createElement('th'); th.textContent=h; thead.appendChild(th) });
  // Update title with count
  const title = el('resultsTitle'); if (title) title.textContent = `Results (${items.length})`;
  // Optional grouping
  const groupBySel = (el('fGroupBy')?.value || 'none').toLowerCase();
  const groupKey = (row) => {
    if (groupBySel === 'pp') return getFirst(row, ppKeys) || '(No PP)';
    if (groupBySel === 'uc') return getFirst(row, ucKeys) || '(No UC)';
    if (groupBySel === 'locality') return getFirst(row, locKeys) || '(No Locality)';
    return null;
  };
  const groups = new Map();
  if (groupBySel !== 'none') {
    items.forEach(row => {
      const k = groupKey(row);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(row);
    });
  }

  const toMD = (s) => {
    if (!s) return '';
    const t = String(s);
    const m = t.match(/\d{4}-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
    if (t.includes('-') && t.length >= 5) return t.slice(-5);
    return t;
  };
  const renderRow = (row) => {
    const tr=document.createElement('tr');
    const callDate = toMD(getFirst(row, ['CallDate','CALLDATE','Call Date','CALL DATE']));
    const visitDate = toMD(getFirst(row, ['VisitDate','VISITDATE','Visit Date','VISIT DATE']));
    const ucVal = getFirst(row, ['UC','Uc','Union Council','UnionCouncil']);
    const ppVal = getFirst(row, ['PP','Pp']);
    const ucpp = (ucVal || ppVal) ? `${ucVal||''}\n${ppVal||''}` : '';
    const cellVals = [
      getFirst(row, nameKeys) || 'Unknown',
      getFirst(row, phoneKeys),
      ucpp,
      getFirst(row, locKeys),
      getFirst(row, addrKeys),
      callDate || '',
      visitDate || ''
    ];
    cellVals.forEach((t,i)=>{
      const td=document.createElement('td'); td.textContent=t||'';
      if(i===2) td.style.whiteSpace='pre-wrap'; // UC/PP can wrap
      if(i===1 || i===5 || i===6) td.style.whiteSpace='nowrap'; // phone and dates stay on one line
      tr.appendChild(td)
    });
    tbody.appendChild(tr);
    // Optional comment sub-row
    const cmt = (row.Comments && String(row.Comments).trim()!=='') ? String(row.Comments) : '';
    if (cmt){
      const ctr = document.createElement('tr');
      const ctd = document.createElement('td'); ctd.colSpan = shown.length; ctd.textContent = cmt; ctd.style.whiteSpace='pre-wrap'; ctd.style.fontSize='12px'; ctd.style.color='var(--sub)'; ctd.style.paddingTop='4px';
      ctr.appendChild(ctd); tbody.appendChild(ctr);
    }
  };

  if (groupBySel === 'none') {
    items.forEach(renderRow);
  } else {
    // Sort by grouping key; no section headers printed
    const orderedKeys = Array.from(groups.keys()).sort((a,b)=> String(a).localeCompare(String(b), undefined, { numeric:true }));
    orderedKeys.forEach(key => { groups.get(key).forEach(renderRow); });
  }
  el('resultsPanel').style.display = items.length? 'block':'none';
  const meta=el('meta'); if(meta) meta.textContent = `Showing ${items.length} row(s)`
}

async function runReport(params){ const qs = params ? new URLSearchParams(params).toString() : buildQuery(); const url = '/api/reports' + (qs? ('?'+qs):''); const data = await api(url); state.items = data.items||[]; render(state.items) }

function bind(){
  el('btnLogout')?.addEventListener('click', async ()=>{ try{ await api('/api/logout',{method:'POST'}); location.href='index.html' }catch(e){ toast(e.message) } });
  el('btnRun')?.addEventListener('click', ()=> runReport().catch(e=>toast(e.message)));
  el('btnPrint')?.addEventListener('click', ()=>{ if(state.items.length===0){ if(!confirm('No results. Print anyway?')) return } window.print() });
  el('btnToggleAdvanced')?.addEventListener('click', ()=>{ const p=el('advancedPanel'); if(!p) return; const show = (p.style.display==='none'||p.style.display===''); p.style.display = show? 'block':'none' });
  // Quick actions
  el('btnQuickToday')?.addEventListener('click', ()=>{
    const d = new Date(); const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const isoFrom = start.toISOString().slice(0,19); const isoTo = new Date().toISOString().slice(0,19);
    runReport({ modifiedFrom: isoFrom, modifiedTo: isoTo, limit: '500' }).catch(e=>toast(e.message));
  });
  el('btnQuickMySession')?.addEventListener('click', ()=>{
    runReport({ session: 'current', byUser: state.user, limit: '500' }).catch(e=>toast(e.message));
  });
  el('btnQuickCalled')?.addEventListener('click', ()=>{
    const d = (el('qCalledDate')?.value||'').trim(); if(!d){ toast('Pick a date'); return } runReport({ calledFrom: d, calledTo: d, limit: '500' }).catch(e=>toast(e.message));
  });
  el('btnQuickVisited')?.addEventListener('click', ()=>{
    const d = (el('qVisitedDate')?.value||'').trim(); if(!d){ toast('Pick a date'); return } runReport({ visitedFrom: d, visitedTo: d, limit: '500' }).catch(e=>toast(e.message));
  });
}

(async function init(){
  try{
    bind();
    const ok = await ensureEditor();
    if(!ok) return;
    // Auto-run a default report on load for convenience
    await runReport();
  } catch(e){ toast(`Init failed: ${e.message}`) }
})();
