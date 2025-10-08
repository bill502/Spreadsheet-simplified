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
  return p.toString();
}

// Render results table with curated columns
function render(items){
  const thead=el('thead'); const tbody=el('tbody'); thead.innerHTML=''; tbody.innerHTML='';
  const nameKeys = ['Name','LAWYERNAME','LawyerName','Full Name','FullName','Alias'];
  const phoneKeys = ['Phone','PHONE','Phone Number','Mobile','Mobile Number','Contact','Cell'];
  const ucKeys = ['UC','Uc','Union Council','UnionCouncil'];
  const ppKeys = ['PP','Pp'];
  const locKeys = ['Locality','LocalityName','Location','Area','Mohalla','Village','Ward'];
  const addrKeys = ['ADDRESS','Address','HighlightedAddress'];
  const shown=['Name','Phone','UC','PP','Locality','Address','Status','Called','CallDate','Visited','VisitDate','ConfirmedVoter'];
  shown.forEach(h=>{ const th=document.createElement('th'); th.textContent=h; thead.appendChild(th) });
  items.forEach(row=>{
    const tr=document.createElement('tr');
    const called = isTrueish(row.Called) ? 'Yes' : 'No';
    const visited = isTrueish(row.Visited) ? 'Yes' : 'No';
    const voter = isTrueish(row.ConfirmedVoter) ? 'Yes' : 'No';
    const cells=[
      getFirst(row, nameKeys) || 'Unknown',
      getFirst(row, phoneKeys),
      getFirst(row, ucKeys),
      getFirst(row, ppKeys),
      getFirst(row, locKeys),
      getFirst(row, addrKeys),
      row.Status || '',
      called,
      row.CallDate || '',
      visited,
      row.VisitDate || '',
      voter
    ];
    cells.forEach(t=>{ const td=document.createElement('td'); td.textContent=t||''; tr.appendChild(td) });
    tbody.appendChild(tr)
  });
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

(async function init(){ try{ bind(); const ok = await ensureEditor(); if(!ok) return } catch(e){ toast(`Init failed: ${e.message}`) } })();
