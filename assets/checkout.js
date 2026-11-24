'use strict';
/* ==========================================================================
   Checkout
   - Login required (sends guests to account.html and back).
   - Address checks: India Post PIN lookup (state must match, city/locality
     suggested), PIN typed inside the address must match, realistic mobile
     numbers only, and a final "confirm your address" review step.
   - Two steps: 1. address (+ review), 2. payment method. Gift wrap and shipping are added to the total.
   - Payment options: full online, or partial COD (items total SHIP.codMin+; SHIP.codAdvance paid now).
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

/* ---------- address suggestions: OpenStreetMap data via Photon (free, no key) ---------- */
const PHOTON = 'https://photon.komoot.io/api/';
async function photon(params) {
  const u = new URL(PHOTON);
  Object.entries(params).forEach(([k, v]) => [].concat(v).forEach(x => u.searchParams.append(k, x)));
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
  try { const r = await fetch(u, { signal: ctl.signal }); return r.ok ? ((await r.json()).features || []) : []; }
  catch (e) { return []; }                                              // offline / blocked: just no suggestions
  finally { clearTimeout(t); }
}
/* centre point of a PIN code area, so suggestions stay near the customer's PIN */
const pinCentreCache = new Map();
async function pinCentre(pin, info) {
  if (pinCentreCache.has(pin)) return pinCentreCache.get(pin);
  let f = (await photon({ q: pin, limit: 5, lang: 'en' }))
    .find(x => x.properties.countrycode === 'IN' && String(x.properties.postcode || x.properties.name || '') === pin);
  if (!f && info && info.district) f = (await photon({ q: `${info.district}, ${info.state}`, limit: 3, lang: 'en' })).find(x => x.properties.countrycode === 'IN');
  const c = f ? f.geometry.coordinates : null;
  pinCentreCache.set(pin, c);
  return c;
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
    .map(([id, q]) => ({ p: byId(id), q, gift: buyId ? qs.get('gift') === '1' : !!gifts[id] }))
    .filter(l => l.p && l.p.stock && l.q > 0);
  document.title = 'Checkout – Toy Kingdom';

  if (!lines.length) {
    main.innerHTML = `<div class="wrap page notfound"><h1>Nothing to check out</h1>
      <p class="muted">Your cart is empty, or the item is out of stock.</p><a class="btn" href="collection.html">Browse all products</a></div>`;
    return;
  }

  /* money: shipping and partial-COD eligibility are based on the items total */
  const subtotal = lines.reduce((s, l) => s + l.p.price * l.q, 0);
  const giftWrap = lines.reduce((s, l) => s + (l.gift ? SHIP.giftWrap * l.q : 0), 0);
  const shipping = shippingFor(subtotal);
  const total = subtotal + giftWrap + shipping;
  const codOk = subtotal >= SHIP.codMin;
  const split = codSplit(total);
  let mode = 'online', pinInfo = null, reviewing = null, step = 'address';

  const field = (id, label, attrs = '', req = true, hint = '') => `<div class="field" id="f_${id}"><label for="ck_${id}">${label}${req ? ' <span class="req">*</span>' : ''}</label>
    <input id="ck_${id}" name="${id}" ${req ? 'required' : ''} ${attrs}>${hint ? `<p class="small muted hint">${hint}</p>` : ''}<p class="field-err" id="e_${id}"></p></div>`;

  main.innerHTML = `<div class="wrap page checkout">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a>${icon('right')}<span>Checkout</span></nav>
    <h1>Checkout</h1>
    <ol class="steps" id="steps" aria-label="Checkout steps">
      <li data-s="address"><span class="sn">1</span><span>Address</span></li>
      <li data-s="payment"><span class="sn">2</span><span>Payment</span></li>
      <li data-s="done"><span class="sn">3</span><span>Order placed</span></li>
    </ol>
    <div class="checkout-grid">
      <div class="ck-main">
        <!-- STEP 1: delivery address -->
        <form class="panel cform" id="ckForm" novalidate autocomplete="on">
          <h2>Delivery address</h2>
          <div class="note" id="savedNote" hidden></div>
          <div class="frow">${field('name', 'Full name (as on doorbell / ID)', 'autocomplete="name" maxlength="60"')}
            ${field('phone', 'Mobile number', 'type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" placeholder="10-digit mobile"', true, 'The courier will call this number.')}</div>
          <div class="frow">${field('pincode', 'PIN code', 'inputmode="numeric" autocomplete="postal-code" maxlength="6" placeholder="6 digits"')}
            ${field('alt', 'Alternate mobile', 'type="tel" inputmode="numeric" maxlength="14" placeholder="Optional"', false)}</div>
          <p class="pin-status" id="pinStatus" role="status"></p>
          ${field('house', 'House / flat no., building', 'autocomplete="tk-house" maxlength="80" placeholder="e.g. 12B, Lotus Apartments"')}
          ${field('area', 'Street, area / locality', 'autocomplete="tk-street-area" maxlength="120" placeholder="Start typing: e.g. 2nd Street, Anna Nagar"')}
          ${field('landmark', 'Landmark', 'autocomplete="tk-landmark" maxlength="80" placeholder="e.g. Near Murugan Temple (optional)"', false)}
          <div class="frow">${field('city', 'City / town', 'autocomplete="address-level2" maxlength="50"')}
            <div class="field" id="f_state"><label for="ck_state">State <span class="req">*</span></label>
              <select id="ck_state" name="state" class="select" autocomplete="address-level1" required><option value="">Select state</option>${STATES.map(s => `<option>${s}</option>`).join('')}</select>
              <p class="field-err" id="e_state"></p></div></div>
          <p class="form-msg" id="ckMsg" role="status"></p>
          <button class="btn btn-lg btn-block" type="submit">Continue to payment ${icon('right')}</button>
        </form>

        <!-- STEP 2: payment method -->
        <section class="panel cform" id="payStep" hidden>
          <div class="ship-to">
            <div><h2>Delivering to</h2><p class="addr-block" id="shipTo"></p></div>
            <button class="btn btn-outline btn-sm" type="button" id="changeAddr">Change</button>
          </div>
          <h2 class="mt">Payment method</h2>
          <div class="pay-opts" role="radiogroup" aria-label="Payment method">
            <label class="pay-opt"><input type="radio" name="pay" value="online" checked>
              <span><b>Pay full amount online</b><span class="small muted">UPI, cards, net banking and wallets via Razorpay</span></span>
              <b class="pay-amt">${inr(total)}</b></label>
            <label class="pay-opt ${codOk ? '' : 'off'}"><input type="radio" name="pay" value="cod" ${codOk ? '' : 'disabled'}>
              <span><b>Partial Cash on Delivery</b>
                <span class="small muted">${codOk
                  ? `Pay ${inr(split.now)} online now, ${inr(split.later)} in cash when it arrives`
                  : `Available on orders of ${inr(SHIP.codMin)} and above. Add ${inr(SHIP.codMin - subtotal)} more to use it.`}</span></span>
              ${codOk ? `<b class="pay-amt">${inr(split.now)}</b>` : ''}</label>
          </div>
          <p class="small muted">Test mode: no real payment is taken yet.</p>
          <p class="form-msg" id="payMsg" role="status"></p>
          <button class="btn btn-lg btn-block" type="button" id="placeBtn"></button>
          <p class="small muted center-text secure-line">${icon('lock')} Payments will be processed securely by Razorpay.</p>
          <p class="small muted center-text">By placing an order you agree to our <a class="link" href="${SITE.refund}">Returns &amp; Refund Policy</a>.</p>
        </section>
      </div>

      <aside class="panel order-sum">
        <h2>Order summary</h2>
        <ul class="plain sum-lines">${lines.map(({ p, q, gift }) => `<li>
          <a href="${productUrl(p)}" class="sum-img">${img(p.imgs[0], p.name)}<span class="sum-q">${q}</span></a>
          <span class="sum-name"><a href="${productUrl(p)}">${esc(p.name)}</a>${gift ? `<span class="gift-tag">${icon('gift')}Gift wrapped</span>` : ''}</span><b>${inr(p.price * q)}</b></li>`).join('')}</ul>
        <div class="sum-row"><span>Subtotal</span><span>${inr(subtotal)}</span></div>
        ${giftWrap ? `<div class="sum-row"><span>Gift wrap</span><span>${inr(giftWrap)}</span></div>` : ''}
        <div class="sum-row"><span>Shipping</span><span>${shipping === 0 ? '<b class="free">Free</b>' : inr(shipping)}</span></div>
        ${shipping === 0 ? '' : `<p class="small note">Add ${inr(SHIP.freeAbove - subtotal)} more for <b>free shipping</b> (orders above ₹${SHIP.freeAbove}).</p>`}
        <div class="sum-row total"><span>Total</span><b>${inr(total)}</b></div>
        <div class="cod-split" id="codSplit" hidden>
          <div class="sum-row"><span>Pay now (online)</span><b>${inr(split.now)}</b></div>
          <div class="sum-row"><span>Pay on delivery (cash)</span><b>${inr(split.later)}</b></div>
        </div>
        <ul class="plain ship-info">
          <li>${icon('truck')}<span>Delivery in <b>${SHIP.days}</b></span></li>
          <li>${icon('tag')}<span><b>Free Shipping</b> On All Orders Above ₹ ${SHIP.freeAbove}</span></li>
        </ul>
      </aside>
    </div>
  </div>

  <div class="modal" id="review" role="dialog" aria-modal="true" aria-labelledby="reviewTitle" hidden>
    <div class="modal-card">
      <h2 id="reviewTitle">Can you confirm your address?</h2>
      <div class="addr-preview" id="addrPreview"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" type="button" id="editAddr">Edit address</button>
        <button class="btn" type="button" id="useAddr">Yes, deliver here ${icon('right')}</button>
      </div>
    </div>
  </div>`;

  const form = $('#ckForm'), msg = $('#ckMsg'), payStep = $('#payStep');
  const F = k => $('#ck_' + k);
  const setErr = (k, text) => { const e = $('#e_' + k); if (e) e.textContent = text || ''; $('#f_' + k)?.classList.toggle('err', !!text); };

  /* ---------- steps (browser Back goes from Payment to Address) ---------- */
  function showStep(s, push) {
    if (s === 'payment' && !reviewing) s = 'address';
    step = s;
    form.hidden = s !== 'address';
    payStep.hidden = s !== 'payment';
    const order = ['address', 'payment', 'done'];
    $$('#steps li').forEach(li => {
      const i = order.indexOf(li.dataset.s), cur = order.indexOf(s);
      li.classList.toggle('on', i === cur); li.classList.toggle('done', i < cur);
      if (i === cur) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (push) history.pushState({ ck: s }, '', s === 'payment' ? '#payment' : location.pathname + location.search);
    if (push !== undefined) $('#steps').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  addEventListener('popstate', e => showStep((e.state && e.state.ck) || 'address', false));
  history.replaceState({ ck: 'address' }, '', location.pathname + location.search);

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
      if (matchState(info.state)) F('state').value = matchState(info.state);
      if (!F('city').value.trim()) F('city').value = info.district;
      validate(['state', 'city']);
    } else if (info.notFound) {
      st.className = 'pin-status bad'; st.textContent = '';
      setErr('pincode', `PIN code ${pin} doesn’t exist in India Post records. Please check it.`);
    } else {
      st.className = 'pin-status'; st.textContent = '';          // India Post unreachable: say nothing, don't block
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
  form.addEventListener('input', () => { reviewing = null; });           // address edited: confirm it again

  /* ---------- address suggestions while typing (street/area and landmark) ---------- */
  function attachSuggest(key, layers) {
    const inp = F(key), box = document.createElement('div');
    box.className = 'addr-sug'; box.id = 'sug_' + key; box.hidden = true; box.setAttribute('role', 'listbox');
    inp.setAttribute('aria-controls', box.id); inp.setAttribute('aria-autocomplete', 'list');
    $('#f_' + key).append(box);
    let items = [], active = -1, seq = 0, timer = 0, pressing = false;
    const close = () => { box.hidden = true; active = -1; };
    const pinNow = () => { const pin = digitsOnly(F('pincode').value); return pinInfo && pinInfo.ok && pinInfo.pin === pin ? pin : ''; };
    const render = (note = '') => {
      if (!items.length && !note) return close();
      box.innerHTML = (note ? `<p class="sug-note">${note}</p>` : '')
        + items.map((it, i) => `<button type="button" class="sug ${i === active ? 'on' : ''}" data-i="${i}" role="option">${icon('pin')}
          <span><b>${esc(it.main)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`).join('')
        + (items.length ? '<p class="sug-src">Suggestions from India Post &amp; © OpenStreetMap</p>' : '');
      box.hidden = false;
      if (innerWidth < 700) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });   // keep it above the phone keyboard
    };
    const pick = it => {
      inp.value = it.fill;
      if (it.city && !F('city').value.trim()) F('city').value = it.city;
      if (it.area && !F('area').value.trim()) F('area').value = it.area;     // building picked: fill its street/area too
      setErr(key, ''); reviewing = null; close();
    };
    /* the PIN's own localities from India Post (shown first, and on focus before typing) */
    const postOffices = (q, pin) => key !== 'area' || !pin ? [] : pinInfo.places
      .filter(p => !q || p.toLowerCase().includes(q.toLowerCase()))
      .map(p => ({ main: p, sub: `${pinInfo.district}, ${pinInfo.state} - ${pin}`, fill: p }));

    async function query() {
      const raw = cleanSpaces(inp.value), my = ++seq;
      const near = key === 'landmark' && /^near\s+/i.test(raw);
      const q = raw.replace(/^near\s+/i, '');
      const pin = pinNow();
      if (q.length < 3) {                                                  // not enough to search yet
        items = key === 'area' && pin ? postOffices('', pin).slice(0, 6) : [];
        active = -1; return render(pin || q.length === 0 ? '' : '');
      }
      if (!pin) { items = []; active = -1; return render('Enter a valid <b>PIN code</b> above to see suggestions near you.'); }
      const local = postOffices(q, pin).slice(0, 3);
      const centre = await pinCentre(pin, pinInfo);
      if (my !== seq) return;
      const params = { q, limit: 12, lang: 'en', layer: layers };
      if (centre) params.bbox = [centre[0] - 0.2, centre[1] - 0.2, centre[0] + 0.2, centre[1] + 0.2].map(n => n.toFixed(3)).join(',');
      else params.q = `${q}, ${pinInfo.district}, ${pinInfo.state}`;
      const feats = await photon(params);
      if (my !== seq) return;                                              // a newer search already started
      /* rank: same PIN first, then same district/locality names, drop other postal regions */
      const near3 = pin.slice(0, 3), known = [pinInfo.district, ...pinInfo.places, ...pinInfo.blocks].map(s => s.toLowerCase());
      const seen = new Set(local.map(x => x.fill.toLowerCase()));
      const remote = feats.filter(f => f.properties.countrycode === 'IN').map(f => {
        const p = f.properties;
        const main = key === 'house'
          ? (p.name || (p.housenumber && p.street ? p.housenumber + ', ' + p.street : ''))
          : (p.name || p.street);
        if (!main) return null;
        const pc = String(p.postcode || '').replace(/\D/g, '');
        if (pc.length === 6 && pc.slice(0, 3) !== near3) return null;
        const area = p.district || p.locality || '';
        const town = p.city || p.county || '';
        let score = 0;
        if (pc === pin) score += 3; else if (pc.slice(0, 3) === near3) score += 1;
        if ([town, area].some(t => t && known.some(k => k.includes(t.toLowerCase()) || t.toLowerCase().includes(k)))) score += 2;
        if (main.toLowerCase().startsWith(q.toLowerCase())) score += 1;
        const sub = [p.street && p.street !== main ? p.street : '', area !== main ? area : '', town, p.postcode].filter(Boolean).join(', ');
        const fill = key === 'area' ? [main, area && area !== main ? area : ''].filter(Boolean).join(', ')
          : key === 'house' ? ([p.housenumber, p.name].filter(Boolean).join(', ') || main)
          : (near ? 'Near ' : '') + main;
        const areaFill = key === 'house' ? [p.street, area].filter(Boolean).join(', ') : '';
        return { main, sub, fill, area: areaFill, city: p.city || '', score };
      }).filter(x => x && !seen.has(x.fill.toLowerCase()) && seen.add(x.fill.toLowerCase()))
        .sort((a, b) => b.score - a.score);
      items = [...local, ...remote].slice(0, 7); active = -1;
      render(items.length ? '' : key === 'house' ? 'No buildings found. Just type your house / flat number and building name.' : key === 'landmark' ? 'No matches found. Just type a well-known place near you.' : 'No matches found. Just type your full street / area name.');
    }
    inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(query, 300); });
    inp.addEventListener('focus', () => { if (!inp.value.trim() || box.hidden) query(); });
    inp.addEventListener('keydown', e => {
      if (box.hidden || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; render(); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
    /* taps: keep the list open while a finger/mouse is pressed on it, so the tap isn't lost when the keyboard closes */
    box.addEventListener('pointerdown', () => { pressing = true; });
    box.addEventListener('mousedown', e => e.preventDefault());            // keep focus in the field
    box.addEventListener('click', e => { pressing = false; const b = e.target.closest('.sug'); if (b) pick(items[+b.dataset.i]); });
    document.addEventListener('pointerup', () => setTimeout(() => { pressing = false; }, 400));
    inp.addEventListener('blur', () => setTimeout(() => { if (!pressing) close(); }, 250));
  }
  attachSuggest('house', ['house']);
  attachSuggest('area', ['street', 'locality', 'district']);
  attachSuggest('landmark', ['house', 'street', 'locality']);

  const addrHTML = (a, district) => `<b>${esc(a.name)}</b><br>${esc(a.house)}<br>${esc(a.area)}${a.landmark ? `<br>Landmark: ${esc(a.landmark)}` : ''}
      <br>${esc(a.city)}${district && district.toLowerCase() !== a.city.toLowerCase() ? ` (${esc(district)} district)` : ''}, ${esc(a.state)} - <b>${a.pincode}</b>
      <br>Mobile: <b>${a.phone.replace(/(\d{5})(\d{5})/, '$1 $2')}</b>${a.alt ? ` · Alternate: ${a.alt.replace(/(\d{5})(\d{5})/, '$1 $2')}` : ''}`;

  /* ---------- step 1 -> address review ---------- */
  const modal = $('#review');
  let pending = null;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    msg.className = 'form-msg'; msg.textContent = '';
    if (pinInfo === null && /^[1-9]\d{5}$/.test(digitsOnly(F('pincode').value))) await checkPin();
    const bad = validate();
    if (bad) { msg.className = 'form-msg bad'; msg.textContent = 'Please fix the highlighted details.'; F(bad).focus(); return; }
    const a = values();
    const stray = strayPin(a);
    if (stray) { setErr('area', stray); msg.className = 'form-msg bad'; msg.textContent = stray; F('area').focus(); return; }

    pending = { ...a, district: pinInfo && pinInfo.ok ? pinInfo.district : '', verified: !!(pinInfo && pinInfo.ok) };
    $('#addrPreview').innerHTML = addrHTML(a, pending.district);
    modal.hidden = false; document.body.classList.add('modal-open');
    $('#useAddr').focus();
  });
  const closeModal = () => { modal.hidden = true; document.body.classList.remove('modal-open'); };
  $('#editAddr').onclick = () => { closeModal(); F('house').focus(); };
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  /* ---------- step 2: payment ---------- */
  $('#useAddr').onclick = () => {
    reviewing = pending;
    closeModal();
    $('#shipTo').innerHTML = addrHTML(reviewing, reviewing.district);
    $('#payMsg').textContent = '';
    showStep('payment', true);
  };
  $('#changeAddr').onclick = () => history.back();

  function syncMode() {
    mode = (payStep.querySelector('input[name=pay]:checked') || {}).value || 'online';
    $$('.pay-opt', payStep).forEach(l => l.classList.toggle('on', $('input', l).checked));
    $('#codSplit').hidden = mode !== 'cod';
    $('#placeBtn').innerHTML = `${icon('lock')} Place order · pay ${inr(mode === 'cod' ? split.now : total)} (test)`;
  }
  payStep.addEventListener('change', e => { if (e.target.name === 'pay') syncMode(); });
  syncMode();

  /* ---------- place the (test) order ---------- */
  $('#placeBtn').onclick = async () => {
    const btn = $('#placeBtn'), pmsg = $('#payMsg');
    if (!reviewing) { showStep('address', false); return; }
    if (mode === 'cod' && !codOk) { pmsg.className = 'form-msg bad'; pmsg.textContent = `Partial COD is available on orders of ${inr(SHIP.codMin)} and above.`; return; }
    btn.disabled = true; $('#changeAddr').disabled = true;
    btn.textContent = 'Processing test payment…';
    try {
      await new Promise(r => setTimeout(r, 900));                          // stands in for Razorpay Checkout
      const order = {
        id: Orders.newId(), uid: me.uid, email: me.email, created: Date.now(), status: 'placed', test: true,
        items: lines.map(({ p, q, gift }) => ({ id: String(p.id), name: p.name, sku: p.sku || '', price: p.price, mrp: p.mrp || p.price, qty: q, img: p.imgs[0] || '', gift: !!gift })),
        subtotal, giftWrap, shipping, total,
        payment: mode === 'cod'
          ? { mode: 'cod', method: 'Partial COD', paidNow: split.now, dueOnDelivery: split.later, status: 'advance paid (test)' }
          : { mode: 'online', method: 'Online', paidNow: total, dueOnDelivery: 0, status: 'paid (test)' },
        address: reviewing,
      };
      const saved = await Orders.create(order);
      await Profile.saveAddress(reviewing);
      if (!buyId) { cart = {}; saveCart(); gifts = {}; saveGifts(); renderCart(); }
      showStep('done', false);
      location.href = `order.html?id=${encodeURIComponent(saved.id)}&new=1`;
    } catch (err) {
      pmsg.className = 'form-msg bad'; pmsg.textContent = err.message || 'Could not place the order.';
      btn.disabled = false; $('#changeAddr').disabled = false; syncMode();
    }
  };

  showStep('address');
}
