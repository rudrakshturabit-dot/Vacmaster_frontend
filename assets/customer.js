const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
async function J(u, o) {
  const r = await fetch(u, o), d = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error(typeof d?.detail === 'string' ? d.detail : d?.detail?.[0]?.msg || 'Something went wrong. Please try again.');
    err.status = r.status; err.retry = +r.headers.get('Retry-After') || 0;
    throw err;
  }
  return d;
}
let models = [];
const sel = $('model'), byId = id => models.find(m => String(m.id) === String(id));

function plate(code, m) {
  $('pSerial').textContent = code.trim().toUpperCase() || 'VM-- ----';
  $('pType').textContent = m ? m.type : '-';
  $('pModel').textContent = m ? m.name : '-';
  $('pWar').textContent = m ? (m.months ? m.months + ' months' : m.until || '-') : '-';
  $('stamp').hidden = true;
}
function stamp(t, s, ok) {
  const e = $('stamp');
  e.className = 'stamp' + (ok ? ' ok' : '');
  e.innerHTML = esc(t) + '<small>' + esc(s) + '</small>';
  e.hidden = false; e.style.animation = 'none'; void e.offsetWidth; e.style.animation = '';
}

// Barcode typed (or arriving from the QR link): look it up and fill the plate and model
let timer;
async function lookup(v) {
  v = v.trim(); $('err').textContent = '';
  if (v.length < 4) return;
  try {
    const i = await J('/api/barcode/' + encodeURIComponent(v));
    sel.value = i.model_id; plate(v, byId(i.model_id));
    if (i.status !== 'unregistered') $('err').textContent = 'This product is already registered.';
  } catch (e) {
    $('err').textContent = /invalid barcode/i.test(e.message) ? 'We can’t find this barcode. Check the number printed on the plate.' : e.message;
  }
}
$('code').addEventListener('input', e => { plate(e.target.value, byId(sel.value)); clearTimeout(timer); timer = setTimeout(() => lookup(e.target.value), 400); });
sel.onchange = () => plate($('code').value, byId(sel.value));
$('code2').addEventListener('input', e => plate(e.target.value, null));
$('pd').max = new Date().toISOString().slice(0, 10);

// Phone fields accept digits only and must contain exactly 10 digits.
['phone', 'phone2'].forEach(id => {
  const field = $(id);
  field.addEventListener('input', () => {
    field.value = field.value.replace(/\D/g, '').slice(0, 10);
    field.setCustomValidity(field.value.length === 10 ? '' : 'Enter exactly 10 digits.');
  });
});
const validPhone = value => /^[0-9]{10}$/.test(value);

// ---- email verification (6-digit code sent to the exact address) ----
let verifiedEmail = '', cool = { email: '', until: 0 }, coolTimer = null;
const emailNow = () => $('email').value.trim().toLowerCase();
const emailOk = () => $('email').checkValidity() && emailNow().length > 3;
const EMAIL_HINT = 'Optional. Add an email to get confirmation emails; we will verify it first.';
function vmsg(t, cls) { const e = $('vstatus'); e.textContent = t; e.className = 'vstatus' + (cls ? ' ' + cls : ''); }
function isVerified() { return !!verifiedEmail && verifiedEmail === emailNow(); }
function syncVerifyUI() {
  const left = cool.email === emailNow() ? Math.ceil((cool.until - Date.now()) / 1000) : 0;
  $('sendOtp').disabled = !emailOk() || isVerified() || left > 0;
  $('sendOtp').textContent = isVerified() ? 'Email verified' : left > 0 ? 'Resend code in ' + left + 's' : (cool.email === emailNow() ? 'Resend code' : 'Send verification code');
  $('otp').disabled = $('verifyOtp').disabled = isVerified() || cool.email !== emailNow();
  $('regBtn').disabled = !!emailNow() && !isVerified();   // blank email is allowed
  if (left <= 0 && coolTimer) { clearInterval(coolTimer); coolTimer = null; }
}
function startCooldown(email, secs) {
  cool = { email, until: Date.now() + secs * 1000 };
  clearInterval(coolTimer); coolTimer = setInterval(syncVerifyUI, 1000); syncVerifyUI();
}
function resetVerification() {
  verifiedEmail = ''; cool = { email: '', until: 0 }; $('otp').value = '';
  vmsg(EMAIL_HINT); syncVerifyUI();
}
$('email').addEventListener('input', () => {
  // changing the address invalidates any earlier verification
  if (verifiedEmail && !isVerified()) { verifiedEmail = ''; $('otp').value = ''; vmsg('Email changed. Please verify the new address.', 'bad'); }
  else if (!isVerified() && cool.email !== emailNow()) { $('otp').value = ''; vmsg(emailNow() ? 'Verify this email with the code, or clear the field to skip.' : EMAIL_HINT); }
  syncVerifyUI();
});
$('otp').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
$('sendOtp').onclick = async () => {
  if (!emailOk()) { vmsg('Enter a valid email address first.', 'bad'); return; }
  const email = emailNow(); $('sendOtp').disabled = true; vmsg('Sending code…');
  try {
    const r = await J('/api/email/send-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    vmsg('Code sent to ' + email + '. It expires in 10 minutes. Check your spam folder too.');
    startCooldown(email, r.resend_after || 60); $('otp').focus();
  } catch (x) {
    vmsg(x.message, 'bad');
    if (x.status === 429) startCooldown(email, x.retry || 60); else syncVerifyUI();
  }
};
$('verifyOtp').onclick = async () => {
  const otp = $('otp').value.trim();
  if (!/^[0-9]{6}$/.test(otp)) { vmsg('Enter the 6-digit code from the email.', 'bad'); return; }
  $('verifyOtp').disabled = true;
  try {
    await J('/api/email/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emailNow(), otp }) });
    verifiedEmail = emailNow(); vmsg('✓ Email verified. You can now register your warranty.', 'ok');
  } catch (x) { vmsg(x.message, 'bad'); }
  syncVerifyUI();
};
syncVerifyUI();


$('reg').onsubmit = async e => {
  e.preventDefault();
  if (!$('reg').reportValidity()) return;
  $('err2').textContent = '';
  if (emailNow() && !isVerified()) { $('err2').textContent = 'Please verify your email address, or clear the email field to skip it.'; return; }
  const phone = $('phone').value.trim();
  if (!validPhone(phone)) {
    $('err2').textContent = 'Please enter a phone number containing exactly 10 digits.';
    $('phone').focus();
    return;
  }
  try {
    const r = await J('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode: $('code').value.trim(), model_id: +sel.value, name: $('name').value.trim(), email: $('email').value.trim(), phone, purchase_date: $('pd').value || null })
    });
    stamp('Registered', 'Valid to ' + fmt(r.warranty_expiry));
    $('doneText').textContent = 'Valid until ' + fmt(r.warranty_expiry) + (r.email ? '. We’ve emailed your confirmation.' : '.');
    $('reg').hidden = true; $('done').hidden = false;
  } catch (x) { $('err2').textContent = x.message; }
};
$('again').onclick = () => { $('reg').reset(); resetVerification(); $('err').textContent = ''; plate('', null); $('done').hidden = true; $('reg').hidden = false; };

$('toChk').onclick = () => { $('reg').hidden = true; $('chk').hidden = false; plate($('code2').value, null); };
$('toReg').onclick = () => { $('chk').hidden = true; $('reg').hidden = false; plate($('code').value, byId(sel.value)); };
$('chk').onsubmit = async e => {
  e.preventDefault(); $('cerr').textContent = '';
  const c = $('code2').value.trim();
  const phone = $('phone2').value.trim();
  if (!validPhone(phone)) {
    $('cerr').textContent = 'Please enter the same 10-digit phone number used during registration.';
    $('phone2').focus();
    return;
  }
  try {
    const r = await J(`/api/warranty/check?code=${encodeURIComponent(c)}&phone=${encodeURIComponent(phone)}`);
    plate(c, { type: r.product, name: r.model, until: 'Until ' + fmt(r.warranty_expiry) });
    const ex = fmt(r.warranty_expiry);
    if (r.state === 'active') stamp('Under warranty', 'Valid to ' + ex, true);
    else if (r.state === 'claimed') stamp('Claimed', 'Warranty already used');
    else stamp('Expired', 'Ended on ' + ex);
  } catch (x) { $('stamp').hidden = true; $('cerr').textContent = x.message; }
};

(async () => {
  try {
    const cat = await J('/api/catalog');
    models = cat.flatMap(c => c.products.flatMap(p => p.models.map(m => ({ id: m.id, name: m.name, type: p.name, months: m.warranty_months }))));
    sel.innerHTML = '<option value="">Select your model</option>' + cat.map(c => c.products.filter(p => p.models.length).map(p =>
      `<optgroup label="${esc(c.name)}: ${esc(p.name)}">${p.models.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</optgroup>`).join('')).join('');
    const q = new URLSearchParams(location.search).get('code');   // the QR on the product opens /register?code=...
    if (q) { $('code').value = q; plate(q, null); lookup(q); }
  } catch (e) { $('err').textContent = 'Could not load the product list. Please refresh the page.'; }
})();