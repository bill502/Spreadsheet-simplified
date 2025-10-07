const el = (id) => document.getElementById(id);

const state = {
  columns: [],
  items: [],
  selectedRowNumber: null,
  selectedData: null,
  creating: false,
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

function renderTable(items) {
  const thead = el('thead');
  const tbody = el('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';
  if (!items || items.length === 0) return;

  // Build columns from first item
  const cols = ['rowNumber', ...state.columns.filter(c => c !== 'rowNumber')];
  const trHead = document.createElement('tr');
  cols.forEach(c => {
    const th = document.createElement('th'); th.textContent = c; trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  items.forEach(row => {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => selectRow(row.rowNumber));
    cols.forEach(c => {
      const td = document.createElement('td');
      const v = row[c];
      td.textContent = v == null ? '' : String(v);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

async function doSearch() {
  const q = el('query').value.trim();
  const limit = parseInt(el('limit').value || '100', 10);
  const url = new URL('/api/search', window.location.origin);
  if (q) url.searchParams.set('q', q);
  if (limit) url.searchParams.set('limit', String(limit));
  const data = await api(url.toString());
  state.items = data.items || [];
  el('resultMeta').textContent = `Showing ${state.items.length} of ${data.total} matching rows`;
  renderTable(state.items);
}

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
  const keys = Object.keys(d).filter(k => k !== 'rowNumber');
  keys.forEach(k => {
    const wrap = document.createElement('div'); wrap.className = 'field';
    const label = document.createElement('label'); label.textContent = k;
    const input = document.createElement('input'); input.type = 'text'; input.value = d[k] == null ? '' : String(d[k]);
    input.dataset.key = k;
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
  el('query').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch().catch(alert); });
  el('btnSave').addEventListener('click', () => saveChanges().catch(alert));
  el('btnReload').addEventListener('click', () => selectRow(state.selectedRowNumber).catch(alert));
  el('btnComment').addEventListener('click', () => addComment().catch(alert));
  el('btnNew').addEventListener('click', () => showCreateForm());
  el('btnCreate').addEventListener('click', () => createEntry().catch(alert));
  el('btnCancelCreate').addEventListener('click', () => hideCreateForm());
}

(async function init() {
  try {
    bind();
    await loadColumns();
    await doSearch();
  } catch (e) {
    alert(`Init failed: ${e.message}`);
  }
})();
