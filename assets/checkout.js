'use strict';
/* ==========================================================================
   Checkout
   - Login required (sends guests to account.html and back).
   - Address checks: India Post PIN lookup (state must match, city/locality
     suggested), PIN typed inside the address must match, realistic mobile
     numbers only, and a final "confirm your address" review step.
   - Payment options: full online, or partial COD (SHIP.codMin+; SHIP.codAdvancePct% now).
   - Payment is a TEST placeholder until Razorpay is connected: confirming creates
     a test order (Orders.create) and opens order.html.
     For Razorpay: create the Razorpay order on a server for `payNow`, open
     Razorpay Checkout, verify the signature on the server, and only then save
     the order. The browser must never decide that a payment succeeded.
   ========================================================================== */
const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand',
  'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
const stateKey = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '')
  .replace(/^nctof/, '').replace(/^pondicherry$/, 'puducherry').replace(/^orissa$/, 'odisha')
  .replace(/^(dadraandnagarhaveli|damananddiu)$/, 'dadraandnagarhavelianddamananddiu');
const matchState = s => STATES.find(x => stateKey(x) === stateKey(s)) || '';

/* ---------- India Post PIN lookup (free public API, cached) ---------- */
const pinCache = new Map();
async function lookupPin(pin) {
  if (pinCache.has(pin)) return pinCache.get(pin);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: ctl.signal });
    const d = (await r.json())[0];
    const res = d && d.Status === 'Success' && d.PostOffice && d.PostOffice.length
      ? { ok: true, state: matchState(d.PostOffice[0].State) || d.PostOffice[0].State, district: d.PostOffice[0].District,
          places: [...new Set(d.PostOffice.map(p => p.Name))], blocks: [...new Set(d.PostOffice.map(p => p.Block).filter(b => b && b !== 'NA'))] }
      : { ok: false, notFound: true };
    pinCache.set(pin, res); return res;
  } catch (e) { return { ok: false, offline: true }; }                 // service unreachable: don't block the order
  finally { clearTimeout(t); }
}

/* ---------- field checks ---------- */
const digitsOnly = s => String(s || '').replace(/\D/g, '');
function normPhone(v) {
  let d = digitsOnly(v);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
function phoneProblem(v, label = 'mobile number') {
  const d = normPhone(v);
  if (d.length !== 10) return `Please enter a 10-digit ${label}.`;
  if (!/^[6-9]/.test(d)) return `Indian ${label}s start with 6, 7, 8 or 9.`;
  if (new Set(d).size <= 2) return `This ${label} doesn't look right. Please check it.`;
  const steps = [...d].slice(1).map((c, i) => +c - +d[i]);
  if (steps.every(s => s === 1) || steps.every(s => s === -1)) return `This ${label} doesn't look right. Please check it.`;
  return '';
}
const letters = s => (String(s).match(/[a-z]/gi) || []).length;
const cleanSpaces = s => String(s || '').replace(/\s+/g, ' ').trim();

function initCheckout() {
  const main = $('#main'), qs = new URLSearchParams(location.search);
  const me = Auth.current();
  if (!me) { location.replace('account.html?next=' + encodeURIComponent('checkout.html' + location.search)); return; }

  const buyId = qs.get('buy');
  const lines = (buyId
    ? [[buyId, Math.min(99, Math.max(1, parseInt(qs.get('qty'), 10) || 1))]]
    : Object.entries(cart))
    .map(([id, q]) => ({ p: byId(id), q })).filter(l => l.p && l.p.stock && l.q > 0);
  document.title = 'Checkout – Toy Kingdom';

  if (!lines.length) {
    main.innerHTML = `<div class="wrap page notfound"><h1>Nothing to check out</h1>
      <p class="muted">Your cart is empty, or the item is out of stock.</p><a class="btn" href="collection.html">Browse all products</a></div>`;
    return;
  }

  const subtotal = lines.reduce((s, l) => s + l.p.price * l.q, 0);
  const shipping = shippingFor(subtotal);
  const total = subtotal + (shipping || 0);
  const codOk = subtotal >= SHIP.codMin;
  const split = codSplit(total);
  let mode = 'online', pinInfo = null;

  const field = (id, label, attrs = '', req = true, hint = '') => `<div class="field" id="f_${id}"><label for="ck_${id}">${label}${req ? ' <span class="req">*</span>' : ''}</label>
    <input id="ck_${id}" name="${id}" ${req ? 'required' : ''} ${attrs}>${hint ? `<p class="small muted hint">${hint}</p>` : ''}<p class="field-err" id="e_${id}"></p></div>`;
  const shipText = shipping === 0 ? '<b class="free">Free</b>' : shipping ? inr(shipping) : 'Confirmed after order';

  main.innerHTML = `<div class="wrap page checkout">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a>${icon('right')}<span>Checkout</span></nav>
    <h1>Checkout</h1>
    <div class="checkout-grid">
      <form class="panel cform" id="ckForm" novalidate autocomplete="on">
        <h2>Delivery address</h2>
        <div class="note" id="savedNote" hidden></div>
        <div class="frow">${field('name', 'Full name (as on doorbell / ID)', 'autocomplete="name" maxlength="60"')}
          ${field('phone', 'Mobile number', 'type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" placeholder="10-digit mobile"', true, 'The courier will call this number.')}</div>
        <div class="frow">${field('pincode', 'PIN code', 'inputmode="numeric" autocomplete="postal-code" maxlength="6" placeholder="6 digits"')}
          ${field('alt', 'Alternate mobile', 'type="tel" inputmode="numeric" maxlength="14" placeholder="Optional"', false)}</div>
        <p class="pin-status" id="pinStatus" role="status"></p>
        ${field('house', 'House / flat no., building', 'autocomplete="address-line1" maxlength="80" placeholder="e.g. 12B, Lotus Apartments"')}
        ${field('area', 'Street, area / locality', 'autocomplete="address-line2" maxlength="120" list="pinPlaces" placeholder="e.g. 2nd Street, Anna Nagar"')}
        <datalist id="pinPlaces"></datalist>
        ${field('landmark', 'Landmark', 'maxlength="80" placeholder="e.g. Near Murugan Temple (optional)"', false)}
        <div class="frow">${field('city', 'City / town', 'autocomplete="address-level2" maxlength="50"')}
          <div class="field" id="f_state"><label for="ck_state">State <span class="req">*</span></label>
            <select id="ck_state" name="state" class="select" autocomplete="address-level1" required><option value="">Select state</option>${STATES.map(s => `<option>${s}</option>`).join('')}</select>
            <p class="field-err" id="e_state"></p></div></div>

        <h2 class="mt">Payment</h2>
        <div class="pay-opts" role="radiogroup" aria-label="Payment method">
          <label class="pay-opt"><input type="radio" name="pay" value="online" checked>
            <span><b>Pay full amount online</b><span class="small muted">UPI, cards, net banking and wallets via Razorpay</span></span>
            <b class="pay-amt">${inr(total)}</b></label>
          <label class="pay-opt ${codOk ? '' : 'off'}"><input type="radio" name="pay" value="cod" ${codOk ? '' : 'disabled'}>
            <span><b>Partial Cash on Delivery</b>
              <span class="small muted">${codOk
                ? `Pay ${SHIP.codAdvancePct}% (${inr(split.now)}) online now, ${inr(split.later)} in cash on delivery`
                : `Available on orders of ${inr(SHIP.codMin)} and above. Add ${inr(SHIP.codMin - subtotal)} more to use it.`}</span></span>
            ${codOk ? `<b class="pay-amt">${inr(split.now)}</b>` : ''}</label>
        </div>
        <p class="small muted">Test mode: no real payment is taken yet.</p>

        <p class="form-msg" id="ckMsg" role="status"></p>
        <button class="btn btn-lg btn-block" type="submit" id="payBtn"></button>
        <p class="small muted center-text secure-line">${icon('lock')} Payments will be processed securely by Razorpay.</p>
        <p class="small muted center-text">By placing an order you agree to our <a class="link" href="${SITE.refund}">Returns &amp; Refund Policy</a>.</p>
      </form>

      <aside class="panel order-sum">
        <h2>Order summary</h2>
        <ul class="plain sum-lines">${lines.map(({ p, q }) => `<li>
          <a href="${productUrl(p)}" class="sum-img">${img(p.imgs[0], p.name)}<span class="sum-q">${q}</span></a>
          <a href="${productUrl(p)}" class="sum-name">${esc(p.name)}</a><b>${inr(p.price * q)}</b></li>`).join('')}</ul>
        <div class="sum-row"><span>Subtotal</span><span>${inr(subtotal)}</span></div>
        <div class="sum-row"><span>Shipping</span><span>${shipText}</span></div>
        ${shipping === 0 ? '' : `<p class="small note">Add ${inr(SHIP.freeAbove - subtotal)} more for <b>free shipping</b> (orders above ₹${SHIP.freeAbove}).</p>`}
        <div class="sum-row total"><span>Total</span><b>${inr(total)}${shipping === null ? ' + shipping' : ''}</b></div>
        <div class="cod-split" id="codSplit" hidden>
          <div class="sum-row"><span>Pay now (${SHIP.codAdvancePct}% online)</span><b>${inr(split.now)}</b></div>
          <div class="sum-row"><span>Pay on delivery (cash)</span><b>${inr(split.later)}</b></div>
        </div>
        ${!codOk ? `<p class="small muted">Partial COD unlocks at ${inr(SHIP.codMin)}. Add ${inr(SHIP.codMin - subtotal)} more.</p>` : ''}
        <ul class="plain ship-info">
          <li>${icon('truck')}<span>Delivery in <b>${SHIP.days}</b></span></li>
          <li>${icon('tag')}<span><b>Free Shipping</b> On All Orders Above ₹ ${SHIP.freeAbove}</span></li>
          <li>${icon('receipt')}<span><b>Partial COD</b> on orders above ₹ ${SHIP.codMin}</span></li>
        </ul>
      </aside>
    </div>
  </div>

  <div class="modal" id="review" role="dialog" aria-modal="true" aria-labelledby="reviewTitle" hidden>
    <div class="modal-card">
      <h2 id="reviewTitle">Confirm your delivery address</h2>
      <p class="small muted">Please read it once more. Parcels can't be redirected after they're shipped.</p>
      <div class="addr-preview" id="addrPreview"></div>
      <ul class="plain checks" id="checks"></ul>
      <label class="check confirm-check"><input type="checkbox" id="confirmAddr"> I have checked that the name, mobile number and full address are correct.</label>
      <p class="form-msg" id="reviewMsg" role="status"></p>
      <div class="modal-actions">
        <button class="btn btn-outline" type="button" id="editAddr">Edit address</button>
        <button class="btn" type="button" id="placeBtn" disabled></button>
      </div>
    </div>
  </div>`;

  const form = $('#ckForm'), msg = $('#ckMsg');
  const F = k => $('#ck_' + k);
  const setErr = (k, text) => { const e = $('#e_' + k); if (e) e.textContent = text || ''; $('#f_' + k)?.classList.toggle('err', !!text); };
  const payNow = () => (mode === 'cod' ? split.now : total);

  /* ---------- prefill: last used address ---------- */
  F('name').value = me.name || '';
  Profile.getAddress().then(a => {
    if (!a) return;
    ['name', 'phone', 'alt', 'house', 'area', 'landmark', 'city', 'pincode'].forEach(k => { if (a[k]) F(k).value = a[k]; });
    if (a.state) F('state').value = matchState(a.state);
    const note = $('#savedNote');
    note.innerHTML = `${icon('pin')} We filled in the address you used ${a.savedAt ? 'on <b>' + fmtDate(a.savedAt) + '</b>' : 'last time'}. <b>Please check it's still where you want this order delivered.</b>`;
    note.hidden = false;
    if (a.pincode) checkPin();
  });

  /* ---------- PIN lookup ---------- */
  let pinSeq = 0;
  async function checkPin() {
    const pin = digitsOnly(F('pincode').value).slice(0, 6), st = $('#pinStatus');
    F('pincode').value = pin;
    pinInfo = null; st.className = 'pin-status'; st.textContent = '';
    if (pin.length < 6) return;
    if (!/^[1-9]\d{5}$/.test(pin)) { setErr('pincode', 'A PIN code has 6 digits and doesn’t start with 0.'); return; }
    setErr('pincode', '');
    st.textContent = 'Checking PIN code…';
    const seq = ++pinSeq, info = await lookupPin(pin);
    if (seq !== pinSeq) return;
    pinInfo = { pin, ...info };
    if (info.ok) {
      st.className = 'pin-status ok';
      st.innerHTML = `${icon('check')} PIN ${pin}: <b>${esc(info.district)}, ${esc(info.state)}</b>`;
      $('#pinPlaces').innerHTML = info.places.map(p => `<option value="${esc(p)}">`).join('');
      if (matchState(info.state)) F('state').value = matchState(info.state);
      if (!F('city').value.trim()) F('city').value = info.district;
      validate(['state', 'city']);
    } else if (info.notFound) {
      st.className = 'pin-status bad'; st.textContent = '';
      setErr('pincode', `PIN code ${pin} doesn’t exist in India Post records. Please check it.`);
    } else {
      st.className = 'pin-status warn';
      st.textContent = 'Couldn’t verify the PIN code right now (no connection to India Post). Please double-check it.';
    }
  }
  F('pincode').addEventListener('input', checkPin);

  /* ---------- validation ---------- */
  function values() {
    const v = k => cleanSpaces(F(k).value);
    return { name: v('name'), phone: normPhone(v('phone')), alt: normPhone(v('alt')), house: v('house'), area: v('area'),
      landmark: v('landmark'), city: v('city'), state: F('state').value, pincode: digitsOnly(v('pincode')) };
  }
  const CHECKS = {
    name: a => !a.name ? 'Please enter the receiver’s full name.'
      : letters(a.name) < 3 || !/^[a-z][a-z .'-]*$/i.test(a.name) || new Set(a.name.toLowerCase().replace(/[^a-z]/g, '')).size < 2 ? 'Please enter a real name (letters only).' : '',
    phone: a => phoneProblem(a.phone),
    alt: a => !a.alt ? '' : phoneProblem(a.alt, 'alternate number') || (a.alt === a.phone ? 'The alternate number must be different from the mobile number.' : ''),
    pincode: a => !/^[1-9]\d{5}$/.test(a.pincode) ? 'Please enter your 6-digit PIN code.'
      : pinInfo && pinInfo.pin === a.pincode && pinInfo.notFound ? `PIN code ${a.pincode} doesn’t exist in India Post records. Please check it.` : '',
    house: a => !a.house ? 'Please enter the house / flat number and building.' : !/[a-z0-9]/i.test(a.house) ? 'Please enter a valid house / flat number.' : '',
    area: a => !a.area ? 'Please enter the street and area.' : letters(a.area) < 4 ? 'Please enter the street / area name in words.' : '',
    city: a => !a.city ? 'Please enter your city or town.' : letters(a.city) < 2 || /\d/.test(a.city) ? 'Please enter a valid city name.' : '',
    state: a => !a.state ? 'Please select your state.'
      : pinInfo && pinInfo.ok && pinInfo.pin === a.pincode && matchState(pinInfo.state) && matchState(pinInfo.state) !== a.state
        ? `PIN code ${a.pincode} is in ${pinInfo.state}, but you selected ${a.state}.` : '',
  };
  /* a different PIN code written inside the address lines */
  function strayPin(a) {
    const found = `${a.house} ${a.area} ${a.landmark} ${a.city}`.match(/\b[1-9]\d{5}\b/g) || [];
    const other = found.find(p => p !== a.pincode);
    return other ? `Your address mentions PIN ${other}, but the PIN code field says ${a.pincode}. Which one is correct?` : '';
  }
  function validate(keys = Object.keys(CHECKS)) {
    const a = values(); let first = '';
    keys.forEach(k => { const m = CHECKS[k](a); setErr(k, m); if (m && !first) first = k; });
    return first;
  }
  form.addEventListener('focusout', e => { const k = (e.target.name || ''); if (CHECKS[k] && e.target.value) validate([k]); });

  /* soft warnings shown in the review step */
  function warnings(a) {
    const w = [];
    if (pinInfo && pinInfo.ok && pinInfo.pin === a.pincode) {
      const known = [pinInfo.district, ...pinInfo.places, ...pinInfo.blocks].map(s => s.toLowerCase());
      const city = a.city.toLowerCase();
      if (!known.some(k => k.includes(city) || city.includes(k)))
        w.push(`City “${esc(a.city)}” isn't listed for PIN ${a.pincode} (${esc(pinInfo.district)} district). Please make sure both are right.`);
    } else if (!pinInfo || pinInfo.offline) w.push('We couldn’t verify the PIN code online. Please double-check it.');
    if (a.house.length + a.area.length < 15) w.push('The address is quite short. Add a street name or landmark so the courier can find you.');
    return w;
  }

  /* ---------- payment mode ---------- */
  function syncMode() {
    mode = (form.querySelector('input[name=pay]:checked') || {}).value || 'online';
    $$('.pay-opt', form).forEach(l => l.classList.toggle('on', $('input', l).checked));
    $('#codSplit').hidden = mode !== 'cod';
    $('#payBtn').innerHTML = `Continue · ${mode === 'cod' ? `pay ${inr(split.now)} now` : `pay ${inr(total)}`}`;
  }
  form.addEventListener('change', e => { if (e.target.name === 'pay') syncMode(); });
  syncMode();

  /* ---------- review step ---------- */
  const modal = $('#review');
  let reviewing = null;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    msg.className = 'form-msg'; msg.textContent = '';
    if (pinInfo === null && /^[1-9]\d{5}$/.test(digitsOnly(F('pincode').value))) await checkPin();
    const bad = validate();
    if (bad) { msg.className = 'form-msg bad'; msg.textContent = 'Please fix the highlighted details.'; F(bad).focus(); return; }
    const a = values();
    const stray = strayPin(a);
    if (stray) { setErr('area', stray); msg.className = 'form-msg bad'; msg.textContent = stray; F('area').focus(); return; }
    if (mode === 'cod' && !codOk) { msg.className = 'form-msg bad'; msg.textContent = `Partial COD is available on orders of ${inr(SHIP.codMin)} and above.`; return; }

    reviewing = { ...a, district: pinInfo && pinInfo.ok ? pinInfo.district : '', verified: !!(pinInfo && pinInfo.ok) };
    $('#addrPreview').innerHTML = `<b>${esc(a.name)}</b><br>${esc(a.house)}<br>${esc(a.area)}${a.landmark ? `<br>Landmark: ${esc(a.landmark)}` : ''}
      <br>${esc(a.city)}${reviewing.district && reviewing.district.toLowerCase() !== a.city.toLowerCase() ? ` (${esc(reviewing.district)} district)` : ''}, ${esc(a.state)} - <b>${a.pincode}</b>
      <br>Mobile: <b>${a.phone.replace(/(\d{5})(\d{5})/, '$1 $2')}</b>${a.alt ? ` · Alternate: ${a.alt.replace(/(\d{5})(\d{5})/, '$1 $2')}` : ''}`;
    const warn = warnings(a);
    $('#checks').innerHTML = (reviewing.verified ? `<li class="ok">${icon('check')} PIN ${a.pincode} matches ${esc(pinInfo.district)}, ${esc(pinInfo.state)}</li>` : '')
      + `<li class="ok">${icon('check')} Mobile number looks valid</li>`
      + warn.map(w => `<li class="warn">${icon('close')} ${w}</li>`).join('');
    $('#confirmAddr').checked = false;
    $('#placeBtn').disabled = true;
    $('#placeBtn').textContent = mode === 'cod' ? `Confirm & pay ${inr(split.now)} (test)` : `Confirm & pay ${inr(total)} (test)`;
    $('#reviewMsg').textContent = '';
    modal.hidden = false; document.body.classList.add('modal-open');
    $('#confirmAddr').focus();
  });
  const closeModal = () => { modal.hidden = true; document.body.classList.remove('modal-open'); };
  $('#editAddr').onclick = () => { closeModal(); F('house').focus(); };
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  $('#confirmAddr').addEventListener('change', e => { $('#placeBtn').disabled = !e.target.checked; });

  /* ---------- place the (test) order ---------- */
  $('#placeBtn').onclick = async () => {
    const btn = $('#placeBtn'), rmsg = $('#reviewMsg');
    btn.disabled = true; $('#editAddr').disabled = true;
    btn.textContent = 'Processing test payment…';
    try {
      await new Promise(r => setTimeout(r, 900));                          // stands in for Razorpay Checkout
      const now = Date.now();
      const order = {
        id: Orders.newId(), uid: me.uid, email: me.email, created: now, status: 'placed', test: true,
        items: lines.map(({ p, q }) => ({ id: String(p.id), name: p.name, sku: p.sku || '', price: p.price, mrp: p.mrp || p.price, qty: q, img: p.imgs[0] || '' })),
        subtotal, shipping, total,
        payment: mode === 'cod'
          ? { mode: 'cod', method: 'Partial COD', paidNow: split.now, dueOnDelivery: split.later, status: 'advance paid (test)' }
          : { mode: 'online', method: 'Online', paidNow: total, dueOnDelivery: 0, status: 'paid (test)' },
        address: reviewing,
      };
      const saved = await Orders.create(order);
      await Profile.saveAddress(reviewing);
      if (!buyId) { cart = {}; saveCart(); renderCart(); }
      location.href = `order.html?id=${encodeURIComponent(saved.id)}&new=1`;
    } catch (err) {
      rmsg.className = 'form-msg bad'; rmsg.textContent = err.message || 'Could not place the order.';
      btn.disabled = false; $('#editAddr').disabled = false; btn.textContent = 'Try again';
    }
  };
}
