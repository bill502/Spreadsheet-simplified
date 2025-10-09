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
  // Auth controls
  el('btnLogin')?.addEventListener('click', async () => {
    const username = prompt('Username'); if (!username) return;
    const password = prompt('Password'); if (password === null) return;
    try { const me = await api('/api/login', { method:'POST', body: JSON.stringify({ username, password }) }); state.user = me.user; state.role = me.role || 'viewer'; renderAuth(); toast('Signed in'); } catch(e){ toast(e.message); }
  });
  el('btnLogout')?.addEventListener('click', async () => {
    try { await api('/api/logout', { method:'POST' }); state.user=null; state.role='viewer'; renderAuth(); toast('Signed out'); } catch(e){ toast(e.message) }
  });
}

(async function init() {
  try {
    bind();
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
  const adm = document.getElementById('adminPanel'); if (adm) adm.style.display = (state.role === 'admin') ? '' : 'none';
}
