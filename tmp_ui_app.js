"use strict";
const el = (id) => document.getElementById(id);
const debounce = (fn, wait=400) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; };
const toast = (msg, ms=2500) => {
  const n = el('toast'); if (!n) { alert(msg); return; }
  n.textContent = msg; n.style.display='block';
  clearTimeout(toast._t); toast._t = setTimeout(()=>{ n.style.display='none'; }, ms);
};

const state = {
  columns: [],
  items: [],
  selectedRowNumber: null,
  selectedData: null,
  creating: false,
  total: 0,
  limit: 50,
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

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

  // Only show: Name, Phone, UC, PP, Locality, Address
  const headers = ['Name','Phone','UC','PP','Locality','Address'];
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
        getFirst(row, ucKeys),
        getFirst(row, ppKeys),
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

  // Top controls: Called / Visited with dates (read-only display)
  const topRow = document.createElement('div'); topRow.className = 'row'; topRow.style.gap = '12px'; topRow.style.flexWrap = 'wrap';
  const calledWrap = document.createElement('label'); const cbCalled = document.createElement('input'); cbCalled.type = 'checkbox'; cbCalled.checked = !!d.Called; calledWrap.append(' Called ', cbCalled);
  const calledDate = document.createElement('span'); calledDate.className = 'muted'; calledDate.textContent = `Date: ${d.CallDate ?? ''}`;
  const visitedWrap = document.createElement('label'); const cbVisited = document.createElement('input'); cbVisited.type = 'checkbox'; cbVisited.checked = !!d.Visited; visitedWrap.append(' Visited ', cbVisited);
  const visitedDate = document.createElement('span'); visitedDate.className = 'muted'; visitedDate.textContent = `Date: ${d.VisitDate ?? ''}`;
  const idBadge = document.createElement('span'); idBadge.className = 'muted'; idBadge.textContent = `ID: ${d.ID ?? ''}  |  New ID: ${d['new ID'] ?? ''}`;
  topRow.append(calledWrap, calledDate, visitedWrap, visitedDate, idBadge);
  fields.appendChild(topRow);

  // Handlers for called/visited toggles (dates update only via checkbox)
  const todayISO = () => new Date().toLocaleDateString('en-CA');
  cbCalled.addEventListener('change', async () => {
    try {
      const payload = { Called: cbCalled.checked ? true : false, CallDate: cbCalled.checked ? todayISO() : '' };
      const updated = await api(`/api/row/${state.selectedRowNumber}`, { method: 'POST', body: JSON.stringify(payload) });
      state.selectedData = updated; renderDetails();
    } catch(e) { alert(e.message); cbCalled.checked = !cbCalled.checked; }
  });
  cbVisited.addEventListener('change', async () => {
    try {
      const payload = { Visited: cbVisited.checked ? true : false, VisitDate: cbVisited.checked ? todayISO() : '' };
      const updated = await api(`/api/row/${state.selectedRowNumber}`, { method: 'POST', body: JSON.stringify(payload) });
      state.selectedData = updated; renderDetails();
    } catch(e) { alert(e.message); cbVisited.checked = !cbVisited.checked; }
  });

  // Build editable grid, excluding read-only fields and ensuring LawyerForum is present
  const readOnly = new Set(['ID','new ID','CallDate','VisitDate']);
  const keys = Array.from(new Set([...Object.keys(d).filter(k => k !== 'rowNumber'), 'LawyerForum']));
  keys.forEach(k => {
    const wrap = document.createElement('div'); wrap.className = 'field';
    const label = document.createElement('label'); label.textContent = k;
    const input = document.createElement('input'); input.type = 'text'; input.value = d[k] == null ? '' : String(d[k]);
    input.dataset.key = k;
    if (readOnly.has(k)) { input.readOnly = true; input.disabled = true; }
    wrap.appendChild(label); wrap.appendChild(input); fields.appendChild(wrap);
  });
}

async function saveChanges() {
  if (!state.selectedRowNumber) return;
  const inputs = el('fields').querySelectorAll('input[data-key]');
  const payload = {};
  inputs.forEach(i => payload[i.dataset.key] = i.value);
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
  const keys = state.columns.filter(k => k && k !== 'Comments');
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
}

(async function init() {
  try {
    bind();
    await loadColumns();
    const limitInput = el('limit'); if (limitInput) limitInput.value = '50';
    await doSearch();
  } catch (e) {
    toast(`Init failed: ${e.message}`);
  }
})();

