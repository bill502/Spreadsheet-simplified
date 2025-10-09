"use strict";
// App state for search/edit view
const state = {
  columns: [],
  items: [],
  selectedRowNumber: null,
  selectedData: null,
  creating: false,
  total: 0,
  limit: 50,
  editMode: false,
  user: null,
  role: 'viewer',
  searchBy: null, // 'uc' | 'pp' | 'locality' | null
};
// api/toast/isTrueish/el/debounce provided by util.js

async function loadColumns() {
  const data = await api('/api/columns');
  state.columns = (data.columns || []).filter(Boolean);
}

function getFirst(row, keys) {
  for (const k of keys) {
    const v = row?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return '';
}

function renderTable(items) {
  const thead = el('thead');
  const tbody = el('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';
  if (!items || items.length === 0) return;

  // Only show: Name, Phone, PP, UC, Locality, Address (order updated)
  const headers = ['Name','Phone','PP','UC','Locality','Address'];
  const trHead = document.createElement('tr');
  headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; trHead.appendChild(th); });
  thead.appendChild(trHead);

  const nameKeys = ['LAWYERNAME','LawyerName','Lawyer Name','Name','Full Name','FullName','Alias'];
  const phoneKeys = ['Phone','PHONE','Phone Number','Mobile','Mobile Number','Contact','Cell'];
  const ucKeys = ['UC','Uc','Union Council','UnionCouncil'];
  const ppKeys = ['PP','Pp'];
  const locKeys = ['Locality','LocalityName','Location','Area','Mohalla','Village','Ward'];
  const addrKeys = ['ADDRESS','Address','HighlightedAddress'];

  items.forEach(row => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => selectRow(row.rowNumber));
      const cells = [
        getFirst(row, nameKeys) || 'Unknown',
        getFirst(row, phoneKeys),
        getFirst(row, ppKeys),
        getFirst(row, ucKeys),
        getFirst(row, locKeys),
        getFirst(row, addrKeys),
      ];
    cells.forEach(txt => { const td = document.createElement('td'); td.textContent = txt || ''; tr.appendChild(td); });
    tbody.appendChild(tr);
  });
}

async function doSearch() {
  const q = el('query').value.trim();
  const limitInput = el('limit');
  state.limit = parseInt((limitInput?.value || state.limit || 25), 10);
  if (limitInput) limitInput.value = String(state.limit);
  const url = new URL('/api/search', window.location.origin);
  if (q) url.searchParams.set('q', q);
  if (state.limit) url.searchParams.set('limit', String(state.limit));
  if (state.searchBy) url.searchParams.set('by', state.searchBy);
  try {
    setLoading(true);
    const data = await api(url.toString());
    state.items = data.items || [];
    state.total = data.total ?? state.items.length;
    el('resultMeta').textContent = `Showing ${state.items.length} of ${state.total} matching rows`;
    renderTable(state.items);
    const more = el('btnMore');
    if (more) more.style.display = (state.items.length < state.total) ? '' : 'none';
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading){ const n = el('loading'); if(n) n.style.display = isLoading ? '' : 'none'; }

function clearDetails() {
  el('details').style.display = 'none';
  el('detailsEmpty').style.display = 'block';
  state.selectedRowNumber = null;
  state.selectedData = null;
}

async function selectRow(rowNumber) {
  const data = await api(`/api/row/${rowNumber}`);
  state.selectedRowNumber = rowNumber;
  state.selectedData = data;
  renderDetails();
}

function renderDetails() {
  const d = state.selectedData;
  if (!d) return clearDetails();
  el('detailsEmpty').style.display = 'none';
  el('details').style.display = 'block';
  el('rowInfo').textContent = `Row ${d.rowNumber}`;
  const fields = el('fields');
  fields.innerHTML = '';
  const canEdit = (state.role === 'editor' || state.role === 'admin');
  const btnSave = el('btnSave'); if (btnSave) btnSave.disabled = !canEdit;

  // Main info (read-only) for mobile-first
  const nameKeys = ['LAWYERNAME','LawyerName','Lawyer Name','Name','Full Name','FullName','Alias'];
  const phoneKeys = ['Phone','PHONE','Phone Number','Mobile','Mobile Number','Contact','Cell'];
  const locKeys = ['Locality','LocalityName','Location','Area','Mohalla','Village','Ward'];
  const addrKeys = ['ADDRESS','Address','HighlightedAddress'];
  const statusKeys = ['Status'];
  const ppKeys = ['PP','Pp'];
  const ucKeys = ['UC','Uc','Union Council','UnionCouncil'];

  const info = document.createElement('div'); info.className = 'grid-fields';
  const addRO = (labelText, val) => {
    const wrap = document.createElement('div'); wrap.className = 'field';
    const label = document.createElement('label'); label.textContent = labelText;
    const input = document.createElement('input'); input.type = 'text'; input.value = val || ''; input.readOnly = true; input.disabled = true;
    wrap.appendChild(label); wrap.appendChild(input); info.appendChild(wrap);
  };
  addRO('Name', getFirst(d, nameKeys) || 'Unknown');
  addRO('Phone', getFirst(d, phoneKeys));
  addRO('Address', getFirst(d, addrKeys));
  addRO('Status', getFirst(d, statusKeys));
  addRO('PP', getFirst(d, ppKeys));
  addRO('UC', getFirst(d, ucKeys));
  addRO('Locality', getFirst(d, locKeys));
  fields.appendChild(info);

  // Called / Visited toggles with dates and ID badges
  const topRow = document.createElement('div'); topRow.className = 'row'; topRow.style.gap = '12px'; topRow.style.flexWrap = 'wrap';
  const calledWrap = document.createElement('label'); const cbCalled = document.createElement('input'); cbCalled.type = 'checkbox'; cbCalled.checked = isTrueish(d.Called); cbCalled.disabled = !canEdit; calledWrap.append(' Called ', cbCalled);
  const calledDate = document.createElement('span'); calledDate.className = 'muted'; calledDate.textContent = `Date: ${d.CallDate ?? ''}`;
  const visitedWrap = document.createElement('label'); const cbVisited = document.createElement('input'); cbVisited.type = 'checkbox'; cbVisited.checked = isTrueish(d.Visited); cbVisited.disabled = !canEdit; visitedWrap.append(' Visited ', cbVisited);
  const visitedDate = document.createElement('span'); visitedDate.className = 'muted'; visitedDate.textContent = `Date: ${d.VisitDate ?? ''}`;
  const voterWrap = document.createElement('label'); const cbVoter = document.createElement('input'); cbVoter.type = 'checkbox'; cbVoter.checked = isTrueish(d.ConfirmedVoter); cbVoter.disabled = !canEdit; voterWrap.append(' Confirmed Voter ', cbVoter);
  const forumInput = document.createElement('input'); forumInput.type = 'text'; forumInput.placeholder = 'Lawyer Forum'; forumInput.value = d.LawyerForum ?? '';
  forumInput.style.minWidth = '160px'; forumInput.dataset.key = 'LawyerForum'; forumInput.readOnly = !canEdit; forumInput.disabled = !canEdit;
  const idBadge = document.createElement('span'); idBadge.className = 'muted'; idBadge.textContent = `ID: ${d.ID ?? ''}  |  New ID: ${d['new ID'] ?? ''}`;
  topRow.append(calledWrap, calledDate, visitedWrap, visitedDate, voterWrap, forumInput, idBadge);
  fields.appendChild(topRow);

  const todayISO = () => new Date().toLocaleDateString('en-CA');
  if (canEdit) cbCalled.addEventListener('change', async () => {
    try {
      const payload = { Called: cbCalled.checked ? true : false, CallDate: cbCalled.checked ? todayISO() : '' };
      const updated = await api(`/api/row/${state.selectedRowNumber}`, { method: 'POST', body: JSON.stringify(payload) });
      state.selectedData = updated; renderDetails();
    } catch(e) { toast(e.message); cbCalled.checked = !cbCalled.checked; }
  });
  if (canEdit) cbVisited.addEventListener('change', async () => {
    try {
      const payload = { Visited: cbVisited.checked ? true : false, VisitDate: cbVisited.checked ? todayISO() : '' };
      const updated = await api(`/api/row/${state.selectedRowNumber}`, { method: 'POST', body: JSON.stringify(payload) });
      state.selectedData = updated; renderDetails();
    } catch(e) { toast(e.message); cbVisited.checked = !cbVisited.checked; }
  });
  if (canEdit) cbVoter.addEventListener('change', async () => {
    try {
      const payload = { ConfirmedVoter: cbVoter.checked ? true : false };
      const updated = await api(`/api/row/${state.selectedRowNumber}`, { method: 'POST', body: JSON.stringify(payload) });
      state.selectedData = updated; renderDetails();
    } catch(e) { toast(e.message); cbVoter.checked = !cbVoter.checked; }
  });
  // No separate save for forum; Save Changes will include this field via data-key

  // Edit toggle
  if (!state.editMode) {
    if (!canEdit) { return; }
    const row = document.createElement('div'); row.className='row'; row.style.marginTop='8px';
    const btn = document.createElement('button'); btn.className='ghost'; btn.textContent='Edit Info';
    btn.addEventListener('click', ()=>{ state.editMode = true; renderDetails(); });
    row.appendChild(btn); fields.appendChild(row);
    return;
  }

  // Full editable grid (edit mode)
  const readOnly = new Set(['ID','new ID','CallDate','VisitDate','LCDate']);
  const hideKeys = new Set(['Status','HighlightedAddress']);
  const keys = Array.from(new Set([...Object.keys(d).filter(k => k !== 'rowNumber' && !hideKeys.has(k)), 'LawyerForum']));
  // Render editable inputs with Locality dropdown and admin-only PP/UC edit
  const all = document.createElement('div'); all.className='grid-fields'; all.style.marginTop='10px';
  const isAdmin = (state.role === 'admin');
  keys.forEach(k => {
    const wrap = document.createElement('div'); wrap.className = 'field';
    const label = document.createElement('label'); label.textContent = k;
    if (k === 'Locality' || k === 'LocalityName') {
      const sel = document.createElement('select'); sel.id = 'localitySelect';
      const optEmpty = document.createElement('option'); optEmpty.value=''; optEmpty.textContent='(select locality)'; sel.appendChild(optEmpty);
      (state.localities||[]).forEach(loc => { const o=document.createElement('option'); o.value=loc.name; o.textContent=loc.name; if(String(d[k]||'')===loc.name) o.selected=true; sel.appendChild(o) });
      wrap.appendChild(label); wrap.appendChild(sel); all.appendChild(wrap);
    } else {
      const input = document.createElement('input'); input.type = 'text'; input.value = d[k] == null ? '' : String(d[k]);
      input.dataset.key = k;
      if (readOnly.has(k)) { input.readOnly = true; input.disabled = true; }
      if (!isAdmin && (k === 'PP' || k === 'UC' || k === 'Alias')) { input.readOnly = true; input.disabled = true; }
      wrap.appendChild(label); wrap.appendChild(input); all.appendChild(wrap);
    }
  });fields.appendChild(all);

  const row = document.createElement('div'); row.className='row'; row.style.marginTop='8px';
  const btnDone = document.createElement('button'); btnDone.className='secondary'; btnDone.textContent='Done';
  btnDone.addEventListener('click', ()=>{ state.editMode = false; renderDetails(); });
  row.appendChild(btnDone); fields.appendChild(row);
}

async function saveChanges() {
  if (!state.selectedRowNumber) return;
  const inputs = el('fields').querySelectorAll('input[data-key]');
  const payload = {};
  inputs.forEach(i => payload[i.dataset.key] = i.value);
  // If a locality select exists and is set, send LocalityName and let server map PP/UC
  const sel = el('localitySelect');
  if (sel && sel.value) { payload['LocalityName'] = sel.value }
  const updated = await api(`/api/row/${state.selectedRowNumber}`, { method: 'POST', body: JSON.stringify(payload) });
  state.selectedData = updated;
  renderDetails();
}

async function addComment() {
  if (!state.selectedRowNumber) return;
  const txt = el('comment').value.trim();
  if (!txt) return;
  const updated = await api(`/api/row/${state.selectedRowNumber}/comment`, { method: 'POST', body: JSON.stringify({ comment: txt }) });
  el('comment').value = '';
  state.selectedData = updated;
  renderDetails();
}

function showCreateForm() {
  state.creating = true;
  const panel = el('createPanel');
  const wrap = el('createFields');
  wrap.innerHTML = '';
  // Show inputs for all columns except rowNumber and Comments
  const keys = state.columns.filter(k => k && k !== 'Comments' && k !== 'rowNumber');
  keys.forEach(k => {
    const div = document.createElement('div'); div.className = 'field';
    const label = document.createElement('label'); label.textContent = k;
    const input = document.createElement('input'); input.type = 'text'; input.dataset.key = k; input.placeholder = '(optional)';
    div.appendChild(label); div.appendChild(input); wrap.appendChild(div);
  });
  panel.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function hideCreateForm() {
  state.creating = false;
  el('createPanel').style.display = 'none';
  el('createFields').innerHTML = '';
}

async function createEntry() {
  const inputs = el('createFields').querySelectorAll('input[data-key]');
  const payload = {};
  inputs.forEach(i => { if (i.value.trim() !== '') payload[i.dataset.key] = i.value; });
  const created = await api('/api/row', { method: 'POST', body: JSON.stringify(payload) });
  hideCreateForm();
  await doSearch();
  await selectRow(created.rowNumber);
}

function bind() {
  el('btnSearch').addEventListener('click', () => doSearch().catch(alert));
  const debounced = debounce(() => doSearch().catch(e => toast(e.message)), 400);
  el('query').addEventListener('input', debounced);
  el('btnSave').addEventListener('click', () => saveChanges().catch(e => toast(e.message)));
  el('btnReload').addEventListener('click', () => selectRow(state.selectedRowNumber).catch(e => toast(e.message)));
  el('btnComment').addEventListener('click', () => addComment().catch(e => toast(e.message)));
  el('btnNew').addEventListener('click', () => showCreateForm());
  el('btnCreate').addEventListener('click', () => createEntry().catch(e => toast(e.message)));
  el('btnCancelCreate').addEventListener('click', () => hideCreateForm());
  const more = el('btnMore'); if (more) more.addEventListener('click', () => { state.limit += 50; if (el('limit')) el('limit').value = String(state.limit); doSearch().catch(e => toast(e.message)); });
  // Search-by checkboxes (mutually exclusive, or none)
  const setSearchBy = (by) => {
    state.searchBy = by;
    const m = { uc: el('byUC'), pp: el('byPP'), locality: el('byLocality') };
    if (m.uc) m.uc.checked = (by === 'uc');
    if (m.pp) m.pp.checked = (by === 'pp');
    if (m.locality) m.locality.checked = (by === 'locality');
  };
  el('byUC')?.addEventListener('change', (e) => setSearchBy(e.target.checked ? 'uc' : null));
  el('byPP')?.addEventListener('change', (e) => setSearchBy(e.target.checked ? 'pp' : null));
  el('byLocality')?.addEventListener('change', (e) => setSearchBy(e.target.checked ? 'locality' : null));
  // Auth controls
  el('btnLogin')?.addEventListener('click', () => {
    const p = el('loginPanel'); if (p) { p.style.display = (p.style.display === 'none' || p.style.display === '') ? 'block' : 'none'; if (p.style.display==='block'){ el('loginUser')?.focus() } }
  });
  el('btnLoginSubmit')?.addEventListener('click', async () => {
    const username = (el('loginUser')?.value || '').trim(); const password = (el('loginPass')?.value || '');
    if (!username || !password) { toast('Username and password required'); return }
    try { const me = await api('/api/login', { method:'POST', body: JSON.stringify({ username, password }) }); state.user = me.user; state.role = me.role || 'viewer'; renderAuth(); const p=el('loginPanel'); if(p) p.style.display='none'; toast('Signed in'); } catch(e){ toast(e.message); }
  });
  el('btnLogout')?.addEventListener('click', async () => {
    try { await api('/api/logout', { method:'POST' }); state.user=null; state.role='viewer'; renderAuth(); toast('Signed out'); } catch(e){ toast(e.message) }
  });
}

(async function init() {
  try {
    bind();
    // Load localities for dropdowns
    try { const loc = await api('/api/localities'); state.localities = loc.items || [] } catch {}
    await loadColumns();
    const limitInput = el('limit'); if (limitInput) limitInput.value = '50';
    await refreshUser();
    renderAuth();
    await doSearch();
  } catch (e) {
    toast(`Init failed: ${e.message}`);
  }
})();

async function refreshUser(){
  try { const me = await api('/api/me'); state.user = me.user || null; state.role = me.role || 'viewer'; } catch { state.user=null; state.role='viewer' }
}
function renderAuth(){
  const lbl = el('userLabel'); if (lbl) lbl.textContent = state.user ? `${state.user} (${state.role})` : 'Viewer';
  const login = el('btnLogin'), logout=el('btnLogout');
  if (login && logout){ if (state.user){ login.style.display='none'; logout.style.display=''; } else { login.style.display=''; logout.style.display='none'; } }
  const linkAdm = el('linkAdmin'); if (linkAdm) linkAdm.style.display = (state.role === 'admin') ? '' : 'none';
  const linkRep = el('linkReports'); if (linkRep) linkRep.style.display = (state.role === 'editor' || state.role === 'admin') ? '' : 'none';
  const loginPanel = el('loginPanel'); if (loginPanel) loginPanel.style.display = state.user ? 'none' : loginPanel.style.display;
}

