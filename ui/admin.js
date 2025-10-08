"use strict";

// Admin page state
const state = { user:null, role:'viewer', users:[], editing:null };

// Load current session info
async function refreshUser(){ try{ const me=await api('/api/me'); state.user=me.user||null; state.role=me.role||'viewer' } catch { state.user=null; state.role='viewer' } }
function renderAuth(){ const lbl=el('userLabel'); if(lbl) lbl.textContent = state.user ? `${state.user} (${state.role})` : 'Viewer'; const lo=el('btnLogout'); if(lo) lo.style.display = state.user ? '' : 'none' }

async function ensureAdmin(){ await refreshUser(); renderAuth(); const isAdmin = state.role === 'admin'; el('guardPanel').style.display = isAdmin ? 'none' : 'block'; el('usersPanel').style.display = isAdmin ? 'block' : 'none'; el('managePanel').style.display = isAdmin ? 'block' : 'none'; el('revertPanel').style.display = isAdmin ? 'block' : 'none'; return isAdmin }

// Fetch users from server and render table
async function loadUsers(){ const data = await api('/api/admin/users'); state.users = data.users || []; renderUsers() }

function renderUsers(){ const tbody = el('usersBody'); tbody.innerHTML = ''; state.users.forEach(u=>{ const tr=document.createElement('tr'); const td1=document.createElement('td'); const td2=document.createElement('td'); const td3=document.createElement('td'); td1.textContent=u.username; td2.textContent=u.role; const btnE=document.createElement('button'); btnE.className='ghost'; btnE.textContent='Edit'; btnE.addEventListener('click',()=> startEdit(u)); const btnD=document.createElement('button'); btnD.className='ghost'; btnD.style.borderColor='var(--border)'; btnD.style.color='var(--text)'; btnD.textContent='Delete'; btnD.addEventListener('click',()=> deleteUser(u)); const actions=document.createElement('div'); actions.className='row'; actions.style.gap='6px'; actions.append(btnE,btnD); td3.append(actions); tr.append(td1,td2,td3); tbody.appendChild(tr) }); const meta=el('usersMeta'); if(meta) meta.textContent = `${state.users.length} users` }

function startEdit(u){ state.editing = { ...u }; el('manageTitle').textContent = `Edit User: ${u.username}`; el('admUser').value = u.username; el('admPass').value = ''; el('admRole').value = u.role; el('managePanel').scrollIntoView({behavior:'smooth'}) }

async function deleteUser(u){ if(!confirm(`Delete user '${u.username}'? This cannot be undone.`)) return; try { await api(`/api/admin/user/${encodeURIComponent(u.username)}`, { method:'DELETE' }); toast('User deleted'); await loadUsers(); if(state.editing && state.editing.username===u.username){ cancelEdit() } } catch(e){ toast(e.message) } }

function cancelEdit(){ state.editing=null; el('manageTitle').textContent='Create / Update User'; el('admUser').value=''; el('admPass').value=''; el('admRole').value='viewer' }

async function createOrUpdateUser(){ const username=el('admUser').value.trim(); const password=el('admPass').value; const role=el('admRole').value; if(!username||!role){ toast('Username and role required'); return } if(state.editing){ const elevating = state.editing.role !== 'admin' && role === 'admin'; if(elevating && !confirm(`Are you sure you want to grant admin to '${username}'?`)) return; const body = { oldUsername: state.editing.username, username, role }; if(password && password.trim()!==''){ body.password = password } await api('/api/admin/user',{ method:'POST', body: JSON.stringify(body) }); toast('User updated'); } else { if(!password){ toast('Password required for new user'); return } await api('/api/admin/user',{ method:'POST', body: JSON.stringify({ username, password, role })}); toast('User created') } el('admPass').value=''; await loadUsers(); if(state.editing){ state.editing = { username, role } }
}

async function doRevert(){ const from=el('revFrom').value; const to=el('revTo').value; if(!from||!to){ toast('from/to required'); return } const res = await api('/api/admin/revert',{ method:'POST', body: JSON.stringify({ from, to })}); el('revertMsg').textContent = `Reverted ${res.reverted ?? 0} change(s)` }

function bind(){ el('btnLogout')?.addEventListener('click', async ()=>{ try{ await api('/api/logout',{method:'POST'}); location.href='index.html' }catch(e){ toast(e.message) } }); el('btnUsersRefresh')?.addEventListener('click', ()=> loadUsers().catch(e=>toast(e.message))); el('btnCreateUser')?.addEventListener('click', ()=> createOrUpdateUser().catch(e=>toast(e.message))); el('btnCancelEdit')?.addEventListener('click', ()=> cancelEdit()); el('btnRevert')?.addEventListener('click', ()=> doRevert().catch(e=>toast(e.message))) }

(async function init(){ try{ bind(); const ok = await ensureAdmin(); if(ok){ await loadUsers() } } catch(e){ toast(`Init failed: ${e.message}`) } })();
