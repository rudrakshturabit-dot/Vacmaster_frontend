const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const ACCESS = 'vm_access_token', REFRESH = 'vm_refresh_token';
if (!localStorage.getItem(ACCESS) && !localStorage.getItem('vm_token')) location.replace('/admin/login');
// One-time compatibility with the previous single-token login. A legacy token will expire and require a fresh email login.
if (!localStorage.getItem(ACCESS) && localStorage.getItem('vm_token')) localStorage.removeItem('vm_token');
const hdr = () => ({ Authorization: 'Bearer ' + localStorage.getItem(ACCESS) });
const storeTokens = d => { localStorage.setItem(ACCESS, d.access_token); localStorage.setItem(REFRESH, d.refresh_token); };
const signOut = () => { localStorage.removeItem(ACCESS); localStorage.removeItem(REFRESH); localStorage.removeItem('vm_token'); location.replace('/admin/login'); };
async function logout() { const refresh = localStorage.getItem(REFRESH); try { if (refresh) await api('/api/admin/logout', {method:'POST', body:{refresh_token:refresh}}); } catch (_) {} signOut(); }
let refreshPromise = null, CURRENT_ADMIN = null;
async function renewTokens() {
  if (!localStorage.getItem(REFRESH)) throw new Error('Session expired');
  if (!refreshPromise) refreshPromise = (async () => {
    const r = await fetch('/api/admin/refresh', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({refresh_token: localStorage.getItem(REFRESH)}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'Session expired');
    storeTokens(d); CURRENT_ADMIN = d.admin;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
async function request(u, o = {}, retry = true) {
  const h = { ...hdr(), ...(o.headers || {}) };
  let body = o.body;
  if (body && !(body instanceof FormData) && typeof body !== 'string') { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  let r = await fetch(u, { ...o, body, headers: h });
  if (r.status === 401 && retry && localStorage.getItem(REFRESH)) { try { await renewTokens(); return request(u, o, false); } catch (_) { signOut(); throw new Error('Session expired. Please sign in again.'); } }
  return r;
}
async function api(u, o = {}) {
  const r = await request(u, o);
  const d = await r.json().catch(() => null);
  if (r.status === 401) { signOut(); throw new Error('Session expired. Please sign in again.'); }
  if (!r.ok) throw new Error(typeof d?.detail === 'string' ? d.detail : d?.detail?.[0]?.msg || 'Something went wrong');
  return d;
}
async function save(u, name) {
  const r = await request(u);
  if (!r.ok) throw new Error('Download failed');
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
const toast = t => { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 3200); };

const pad = n => String(n).padStart(2, '0'), ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const S = { view: 'dash', tab: 'reg', q: '', imp: '', open: null, edit: null, preset: 'this', from: '', to: '' };
// Report periods. "3m" and "6m" run from the same day that many months ago up to today.
const rangeFor = (p, n = new Date()) => {
  const y = n.getFullYear(), m = n.getMonth();
  if (p === 'this') return [new Date(y, m, 1), n];
  if (p === 'last') return [new Date(y, m - 1, 1), new Date(y, m, 0)];
  const back = p === '3m' ? 3 : 6, lastDay = new Date(y, m - back + 1, 0).getDate();
  return [new Date(y, m - back, Math.min(n.getDate(), lastDay)), n];
};
const applyPreset = p => { S.preset = p; if (p !== 'custom') { const [a, b] = rangeFor(p); S.from = ymd(a); S.to = ymd(b); } };
const repQ = () => `start=${S.from}&end=${S.to}`;
const repName = () => `report-${S.from}-to-${S.to}`;
const links = [['dash', 'Dashboard'], ['cust', 'Customers'], ['cat', 'Catalogue'], ['rep', 'Reports']];
const read = (n, l) => `<div class="read"><b>${n}</b><span>${l}</span></div>`;
const panel = (c, items) => `<div class="panel ${c}"><i class="rv"></i><i class="rv"></i><i class="rv"></i><i class="rv"></i>${items.map(i => read(...i)).join('')}</div>`;
const tag = (c, l) => `<span class="tag t-${c}">${l}</span>`;
const who = r => `<div class="who"><b>${esc(r.name)}</b><span>${esc(r.phone)}</span><span>${esc(r.email)}</span></div>`;
const unit = r => `<div class="unit"><code class="ser">${esc(r.barcode)}</code><span>${esc(r.product)}, ${esc(r.model)}</span><span>Valid to ${fmt(r.warranty_expiry)}</span></div>`;
const empty = t => `<p class="empty">${t}</p>`;

const VIEWS = {
  async dash() {
    const d = await api('/api/admin/dashboard');
    return `<h1>Dashboard</h1>${panel('six', [[d.total_barcodes, 'Total units'], [d.registered, 'Registered'], [d.unregistered, 'Unregistered'], [d.claims_total, 'Claims'], [d.expiring_30_days, 'Expiring in 30 days'], [d.expired, 'Expired']])}
<p class="auto">Customers get an email automatically 30 days before their warranty ends, and again when it expires.</p>
<h2>Import a file</h2>
<label class="drop" id="drop">Drop a file here, or choose one<small>Tally export or spreadsheet. We read .csv, .tsv, .xlsx and .json files and add every new barcode as a unit.</small><input type="file" id="file"></label>
<div class="imp" role="status">${S.imp}</div>
<h2>Recent claims</h2>${d.recent_claims.map(r => `<div class="row s">${who(r)}${unit(r)}<div>${tag('claimed', 'Claimed')}</div></div>`).join('') || empty('No claims yet.')}`;
  },
  async cust() {
    return `<h1>Customers</h1><div class="tabs"><button data-t="reg" class="${S.tab === 'reg' ? 'on' : ''}">Registered</button><button data-t="un" class="${S.tab === 'un' ? 'on' : ''}">Not yet registered</button></div>
<input id="q" placeholder="${S.tab === 'reg' ? 'Search name, barcode, email or phone' : 'Search barcode'}" value="${esc(S.q)}"><div id="list"></div>`;
  },
  async cat() {
    const t = await api('/api/admin/catalog');
    return `<h1>Catalogue</h1><form class="add" data-f="cat"><input name="name" required placeholder="New category, e.g. Air Compressor"><button class="btn">Add category</button></form>` +
      t.map(c => `<section class="cat"><div class="hd"><h2 style="margin:0">${esc(c.name)}</h2><button class="link bad" data-del="/api/admin/categories/${c.id}" data-what="category">Delete</button></div>
<form class="add" data-f="prod" data-id="${c.id}"><input name="name" required placeholder="New product in ${esc(c.name)}"><button class="btn">Add product</button></form>
${c.products.map(p => `<div class="prod"><div class="hd"><h3>${esc(p.name)}</h3><button class="link bad" data-del="/api/admin/products/${p.id}" data-what="product">Delete</button></div>
<form class="add" data-f="model" data-id="${p.id}"><input name="name" required placeholder="New model of ${esc(p.name)}"><input name="months" type="number" min="1" required placeholder="Warranty in months"><button class="btn">Add model</button></form>
${p.models.map(m => `<div class="mrow"><code class="ser">${esc(m.name)}</code><span>${m.warranty_months} months, ${m.units_total} units, ${m.units_unregistered} not yet registered</span><button class="link" data-units="${m.id}">Units</button><button class="link bad" data-del="/api/admin/models/${m.id}" data-what="model">Delete</button></div><div class="up" id="u${m.id}" hidden></div>`).join('')}</div>`).join('')}</section>`).join('');
  },
  async rep() {
    let d, err = '';
    try { d = await api('/api/admin/reports/monthly?' + repQ()); } catch (x) { err = x.message; }
    return `<h1>Reports</h1>
<div class="presets" role="group" aria-label="Report period">${[['this', 'This month'], ['last', 'Last month'], ['3m', 'Last 3 months'], ['6m', 'Last 6 months'], ['custom', 'Custom dates']].map(([k, l]) => `<button class="chip${S.preset === k ? ' on' : ''}" data-pre="${k}" aria-pressed="${S.preset === k}">${l}</button>`).join('')}</div>
${S.preset === 'custom' ? `<div class="filters"><label>From date<input type="date" id="rfrom" value="${S.from}"></label><label>To date<input type="date" id="rto" value="${S.to}"></label></div><p class="auto" style="margin:0 0 .8rem">Pick any start and end day, for example 12 Oct to 11 Nov.</p>` : ''}
${err ? `<p class="err">${esc(err)}</p>` : `<p class="auto" style="margin:.2rem 0 .8rem">Showing: <b>${esc(d.period)}</b></p>
<div class="tools">${['xlsx', 'pdf', 'csv', 'json'].map(f => `<button class="ghost" data-dl="${f}">${f.toUpperCase()}</button>`).join('')}</div>
${panel('three', [[d.registrations, 'Registrations'], [d.claims, 'Claims'], [d.unregistered_stock, 'Unregistered stock']])}
<div class="two"><div><h2>Automatic emails</h2><dl class="l"><div><dt>Ending soon</dt><dd>${d.expiry_reminders_sent}</dd></div><div><dt>Expired</dt><dd>${d.expired_notices_sent}</dd></div></dl></div>
<div><h2>Registrations by model</h2><dl class="l">${Object.entries(d.registrations_by_model).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('') || empty('None in this period.')}</dl></div></div>`}`;
  },
  async admins() {
    const users = await api('/api/admin/users');
    return `<h1>Manage Admins</h1><p class="auto">Only the Main Admin can create, deactivate, reactivate or delete admin accounts. The Main Admin account is protected.</p>
<form class="admin-create" data-f="admin-user"><label>Full name<input name="name" required maxlength="120" placeholder="Admin full name"></label><label>Email address<input name="email" type="email" required placeholder="admin@example.com"></label><label>Temporary password<input name="password" type="password" minlength="12" required autocomplete="new-password" placeholder="At least 12 characters"></label><button class="btn">Create admin</button></form>
<h2>Admin accounts</h2>${users.map(u => `<article class="admin-user"><div><b>${esc(u.name)}</b><span>${esc(u.email)}</span><small>${u.is_super_admin ? 'Main Admin' : 'Additional Admin'} · Created ${fmt(u.created_at)}</small></div><div class="admin-actions">${u.is_super_admin ? '<span class="tag t-approved">Protected</span>' : `<span class="tag ${u.is_active ? 't-approved' : 't-expired'}">${u.is_active ? 'Active' : 'Inactive'}</span><button class="ghost" data-active="${u.id}" data-next="${u.is_active ? 'false' : 'true'}">${u.is_active ? 'Deactivate' : 'Activate'}</button><button class="link bad" data-admin-delete="${u.id}">Delete</button>`}</div></article>`).join('') || empty('No admin accounts yet.')}`;
  }
};

const row = r => {
  const a = r.claim ? `${tag('claimed', 'Claimed')}<span class="mail">Claim email sent to the customer</span>`
    : !r.in_warranty ? `${tag('expired', 'Expired')}<span class="mail">The customer is emailed automatically</span>`
    : `<button class="btn" data-claim="${r.id}">Claim warranty</button>`;
  return `<article class="row">${who(r)}${unit(r)}<div class="act">${a}<button class="ghost" data-edit="${r.id}">Edit details</button></div></article>`;
};
const today = () => ymd(new Date());
const editRow = r => `<form class="editbox" data-f="edit-reg" data-id="${r.id}">
<p class="auto" style="margin:0"><code class="ser">${esc(r.barcode)}</code> ${esc(r.product)}, ${esc(r.model)}. Barcode, product and claim status cannot be changed here.</p>
<div class="egrid"><label>Customer name<input name="name" required minlength="2" maxlength="120" value="${esc(r.name)}"></label>
<label>Email address (optional)<input name="email" type="email" value="${esc(r.email)}"></label>
<label>Phone number<input name="phone" type="tel" inputmode="numeric" required minlength="10" maxlength="10" pattern="[0-9]{10}" title="Enter exactly 10 digits" value="${esc(r.phone)}"></label>
<label>Purchase date<input name="purchase_date" type="date" required max="${today()}" value="${esc(String(r.purchase_date || '').slice(0, 10))}"></label></div>
<p class="auto" style="margin:0">Changing the purchase date recalculates the warranty end date (currently ${fmt(r.warranty_expiry)}).</p>
<div class="ebtns"><button class="btn">Save changes</button><button type="button" class="ghost" data-cancel-edit="1">Cancel</button></div></form>`;
async function loadList() {
  const el = $('list'); if (!el) return;
  const q = encodeURIComponent(S.q);
  try {
    if (S.tab === 'reg') {
      const rs = await api('/api/admin/registrations?q=' + q);
      el.innerHTML = rs.map(r => S.edit === r.id ? editRow(r) : row(r)).join('') || empty('No customer matches. Try a barcode or phone number.');
    } else {
      const us = await api('/api/admin/unregistered?q=' + q);
      el.innerHTML = us.map(x => `<div class="row s"><div class="unit"><code class="ser">${esc(x.code)}</code><span>${esc(x.product)}, ${esc(x.model)}</span></div></div>`).join('') || empty('No unregistered units match.');
    }
  } catch (e) { el.innerHTML = empty(esc(e.message)); }
}
async function openUnits(id) {
  const el = $('u' + id); if (!el) return;
  const us = await api('/api/admin/units?model_id=' + id);
  S.open = id; el.hidden = false;
  el.innerHTML = `<form class="add" data-f="unit" data-id="${id}"><input name="barcode" required placeholder="Barcode number"><button class="btn">Add unit</button></form>
<form class="add" data-f="gen" data-id="${id}"><input name="prefix" placeholder="Prefix, e.g. VM1"><input name="start" type="number" required placeholder="Start number"><input name="count" type="number" required placeholder="How many"><button class="btn">Generate range</button></form>
${us.some(x => x.status === 'unregistered') ? `<div class="bulk"><label class="chk"><input type="checkbox" data-pickall="1"> Select all shown</label><button class="ghost" data-bulk="selected" data-id="${id}">Delete selected</button><button class="ghost bad" data-bulk="all" data-id="${id}">Delete all unregistered</button></div>` : ''}
${us.map(x => `<div class="mrow">${x.status === 'unregistered' ? `<input type="checkbox" class="pick" data-pick="${esc(x.code)}" aria-label="Select ${esc(x.code)}">` : ''}<code class="ser">${esc(x.code)}</code><span>${esc(x.status)}</span>${x.status === 'unregistered' ? `<button class="link bad" data-del="/api/admin/units/${encodeURIComponent(x.code)}" data-what="unit">Delete</button>` : ''}</div>`).join('') || empty('No units yet.')}
${us.length >= 500 ? '<p class="auto">Showing the latest 500 units. "Delete all unregistered" still removes every unregistered unit of this model.</p>' : ''}`;
}
const AFTER = { cust: loadList, cat: () => S.open && openUnits(S.open) };

async function render() {
  const available = CURRENT_ADMIN?.is_super_admin ? [...links, ['admins', 'Manage Admins']] : links;
  if (S.view === 'admins' && !CURRENT_ADMIN?.is_super_admin) S.view = 'dash';
  $('nav').innerHTML = available.map(([k, l]) => `<button data-v="${k}" class="${S.view === k ? 'on' : ''}">${l}</button>`).join('');
  try { $('main').innerHTML = await VIEWS[S.view](); await AFTER[S.view]?.(); }
  catch (e) { $('main').innerHTML = empty(esc(e.message)); }
}
async function ingest(f) {
  if (!f) return;
  const fd = new FormData(); fd.append('file', f);
  try { const r = await api('/api/admin/barcodes/import', { method: 'POST', body: fd }); S.imp = `<b>${esc(f.name)}</b>: ${r.added} units added, ${r.skipped} skipped.`; }
  catch (x) { S.imp = `<b>${esc(f.name)}</b>: ${esc(x.message)}`; }
  S.view = 'dash'; render();
}
function menu(o) { $('side').classList.toggle('open', o); $('scrim').hidden = !o; $('menu').setAttribute('aria-expanded', o); }

let qt;
document.addEventListener('input', e => { if (e.target.id === 'q') { S.q = e.target.value; clearTimeout(qt); qt = setTimeout(loadList, 300); } });
document.addEventListener('input', e => { if (e.target.name === 'phone' && e.target.closest('form[data-f="edit-reg"]')) e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10); });
document.addEventListener('change', e => {
  if (e.target.dataset.pickall) e.target.closest('.up').querySelectorAll('input[data-pick]').forEach(c => c.checked = e.target.checked);
  if (e.target.id === 'file') ingest(e.target.files[0]);
  if (e.target.id === 'rfrom' || e.target.id === 'rto') {
    S.from = $('rfrom').value; S.to = $('rto').value;
    if (S.from && !S.to) S.to = ymd(new Date()); if (S.to && !S.from) S.from = S.to;
    render();
  }
});
document.addEventListener('dragover', e => { const d = e.target.closest('.drop'); if (d) { e.preventDefault(); d.classList.add('on'); } });
document.addEventListener('dragleave', e => { const d = e.target.closest('.drop'); if (d) d.classList.remove('on'); });
document.addEventListener('drop', e => { const d = e.target.closest('.drop'); if (d) { e.preventDefault(); d.classList.remove('on'); ingest(e.dataTransfer.files[0]); } });

document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-f]'); if (!f) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f)), id = +f.dataset.id, post = (u, body) => api(u, { method: 'POST', body });
  const jobs = {
    cat: () => post('/api/admin/categories', { name: v.name }),
    prod: () => post('/api/admin/products', { name: v.name, category_id: id }),
    model: () => post('/api/admin/models', { name: v.name, product_id: id, warranty_months: +v.months }),
    unit: () => post('/api/admin/units', { barcode: v.barcode, model_id: id }),
    gen: () => post('/api/admin/units/generate', { model_id: id, prefix: v.prefix, start: +v.start, count: +v.count }),
    'admin-user': () => post('/api/admin/users', { name: v.name, email: v.email, password: v.password }),
    'edit-reg': () => api('/api/admin/registrations/' + id, { method: 'PUT', body: { name: v.name.trim(), email: v.email.trim(), phone: v.phone.trim(), purchase_date: v.purchase_date || null } })
  };
  try {
    if (f.dataset.f === 'edit-reg' && !/^[0-9]{10}$/.test((v.phone || '').trim())) { toast('Phone number must contain exactly 10 digits'); return; }
    const r = await jobs[f.dataset.f]();
    if (f.dataset.f === 'edit-reg') { S.edit = null; toast('Customer details updated'); loadList(); return; }
    toast(f.dataset.f === 'gen' ? `${r.added} units added (${r.skipped_existing} already existed)` : f.dataset.f === 'admin-user' ? 'Admin account created' : 'Saved');
    render();
  } catch (x) { toast(x.message); }
});
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  try {
    if (b.id === 'out') logout();
    else if (b.id === 'menu') menu(!$('side').classList.contains('open'));
    else if (d.v) { S.view = d.v; menu(false); render(); }
    else if (d.t) { S.tab = d.t; S.q = ''; render(); }
    else if (d.claim) { await api('/api/admin/claims', { method: 'POST', body: { registration_id: +d.claim } }); toast('Warranty claimed. An email has been sent to the customer.'); loadList(); }
    else if (d.del) { if (confirm('Delete this ' + d.what + '?')) { await api(d.del, { method: 'DELETE' }); toast('Deleted'); render(); } }
    else if (d.edit) { S.edit = +d.edit; loadList(); }
    else if (d.cancelEdit) { S.edit = null; loadList(); }
    else if (d.bulk) {
      const id = +d.id, box = $('u' + id);
      if (d.bulk === 'selected') {
        const codes = [...box.querySelectorAll('input[data-pick]:checked')].map(c => c.dataset.pick);
        if (!codes.length) { toast('Tick the units you want to delete first.'); return; }
        if (!confirm(`Delete ${codes.length} selected unregistered unit${codes.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
        const r = await api('/api/admin/units/bulk-delete', { method: 'POST', body: { model_id: id, codes } });
        toast(`${r.deleted} unit${r.deleted === 1 ? '' : 's'} deleted` + (r.kept ? `, ${r.kept} kept (already registered or not found)` : '')); render();
      } else {
        const total = box.querySelectorAll('input[data-pick]').length;
        if (!confirm('Delete ALL unregistered units of this model' + (total ? ` (${total}+ shown)` : '') + '? Registered and claimed units are always kept. This cannot be undone.')) return;
        const r = await api('/api/admin/units/bulk-delete', { method: 'POST', body: { model_id: id, all_unregistered: true } });
        toast(`${r.deleted} unregistered unit${r.deleted === 1 ? '' : 's'} deleted` + (r.kept ? `, ${r.kept} registered/claimed kept` : '')); render();
      }
    }
    else if (d.units) { const el = $('u' + d.units); if (!el.hidden) { el.hidden = true; S.open = null; } else await openUnits(+d.units); }
    else if (d.pre) { applyPreset(d.pre); render(); }
    else if (d.active) { await api(`/api/admin/users/${d.active}/active?active=${d.next}`, { method: 'PATCH' }); toast(d.next === 'true' ? 'Admin activated' : 'Admin deactivated'); render(); }
    else if (d.adminDelete) { if (confirm('Permanently delete this admin account? Their sessions will be revoked.')) { await api(`/api/admin/users/${d.adminDelete}`, { method: 'DELETE' }); toast('Admin deleted'); render(); } }
    else if (d.dl) await save(`/api/admin/reports/monthly?${repQ()}&format=${d.dl}`, `${repName()}.${d.dl}`);
  } catch (x) { toast(x.message); }
});
$('scrim').onclick = () => menu(false);
applyPreset('this');
(async () => {
  try { CURRENT_ADMIN = await api('/api/admin/me'); render(); }
  catch (_) { signOut(); }
})();