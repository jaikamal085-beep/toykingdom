'use strict';
/* ---------------- Checkout (Razorpay placeholder) ----------------
   Payment options:
   - Pay online: the full total.
   - Partial COD (orders of SHIP.codMin or more): SHIP.codAdvancePct% online now,
     the rest in cash on delivery.
   Shipping: free from SHIP.freeAbove; below that SHIP.fee (null = confirmed later).
   Rules live in SHIP in assets/common.js.

   Online payment is not connected yet. When Razorpay is added, replace
   payOnline() with: create an order on a server for `payNow` (the Razorpay secret key
   must never be in the browser) -> open Razorpay Checkout -> verify the payment
   signature on the server -> save the order with its payment mode and COD balance. */
function initCheckout() {
  const main = $('#main'), qs = new URLSearchParams(location.search);
  const ADDR_KEY = 'tk-checkout-addr';
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
  const shipping = shippingFor(subtotal);                 // 0, a fee, or null (to be confirmed)
  const total = subtotal + (shipping || 0);
  const codOk = subtotal >= SHIP.codMin;
  const split = codSplit(total);
  let mode = 'online';

  let saved = {}; try { saved = JSON.parse(localStorage.getItem(ADDR_KEY)) || {}; } catch (e) { /* ignore */ }
  const me = Auth.current() || {};
  const val = k => esc(saved[k] || (k === 'name' ? me.name : k === 'email' ? me.email : '') || '');
  const field = (id, label, attrs = '', req = true) => `<div class="field"><label for="ck_${id}">${label}${req ? ' <span class="req">*</span>' : ''}</label>
    <input id="ck_${id}" name="${id}" value="${val(id)}" ${req ? 'required' : ''} ${attrs}></div>`;
  const shipText = shipping === 0 ? '<b class="free">Free</b>' : shipping ? inr(shipping) : 'Confirmed after order';

  main.innerHTML = `<div class="wrap page checkout">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a>${icon('right')}<span>Checkout</span></nav>
    <h1>Checkout</h1>
    <div class="checkout-grid">
      <form class="panel cform" id="ckForm" novalidate>
        <h2>Delivery details</h2>
        <div class="frow">${field('name', 'Full name', 'autocomplete="name" maxlength="80"')}${field('phone', 'Mobile number', 'type="tel" inputmode="numeric" autocomplete="tel" maxlength="14" placeholder="10-digit mobile"')}</div>
        ${field('email', 'Email', 'type="email" autocomplete="email" placeholder="For the order confirmation"', false)}
        ${field('address', 'Address (house no, street, area)', 'autocomplete="street-address" maxlength="200"')}
        <div class="frow">${field('city', 'City', 'autocomplete="address-level2" maxlength="60"')}${field('state', 'State', 'autocomplete="address-level1" maxlength="60"')}${field('pincode', 'PIN code', 'inputmode="numeric" autocomplete="postal-code" maxlength="6"')}</div>

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
        <p class="small muted">Online payment is coming soon.</p>

        <p class="form-msg" id="ckMsg" role="status"></p>
        <button class="btn btn-lg btn-block" type="submit" id="payBtn"></button>
        <div class="note pay-dummy" id="payDummy" hidden>
          <p><b>Online payment isn't switched on yet.</b> This is a preview of the Razorpay checkout, so no money was taken and the order hasn't been placed.</p>
          <a class="btn btn-block" id="waOrder" target="_blank" rel="noopener">${icon('whatsapp')}Send this order on WhatsApp instead</a>
        </div>
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
  </div>`;

  const form = $('#ckForm'), msg = $('#ckMsg');
  const payNow = () => (mode === 'cod' ? split.now : total);
  function syncMode() {
    mode = (form.querySelector('input[name=pay]:checked') || {}).value || 'online';
    $$('.pay-opt', form).forEach(l => l.classList.toggle('on', $('input', l).checked));
    $('#codSplit').hidden = mode !== 'cod';
    $('#payBtn').innerHTML = `${icon('lock')}${mode === 'cod' ? `Pay ${inr(split.now)} now · ${inr(split.later)} on delivery` : `Pay ${inr(total)}`}`;
    $('#payDummy').hidden = true;
  }
  form.addEventListener('change', e => { if (e.target.name === 'pay') syncMode(); });
  syncMode();

  const RULES = {
    name: [v => v.length >= 2, 'Please enter your full name.'],
    phone: [v => /^(?:\+?91)?[6-9]\d{9}$/.test(v.replace(/[\s-]/g, '')), 'Please enter a valid 10-digit mobile number.'],
    email: [v => !v || EMAIL_RE.test(v), 'Please enter a valid email address.'],
    address: [v => v.length >= 6, 'Please enter your full address.'],
    city: [v => v.length >= 2, 'Please enter your city.'],
    state: [v => v.length >= 2, 'Please enter your state.'],
    pincode: [v => /^[1-9]\d{5}$/.test(v), 'Please enter a valid 6-digit PIN code.'],
  };

  form.addEventListener('submit', e => {
    e.preventDefault();
    const f = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()]));
    $$('.field', form).forEach(x => x.classList.remove('err'));
    const bad = Object.keys(RULES).filter(k => !RULES[k][0](f[k] || ''));
    if (bad.length) {
      bad.forEach(k => $('#ck_' + k).closest('.field').classList.add('err'));
      msg.className = 'form-msg bad'; msg.textContent = RULES[bad[0]][1];
      $('#ck_' + bad[0]).focus();
      return;
    }
    if (mode === 'cod' && !codOk) { msg.className = 'form-msg bad'; msg.textContent = `Partial COD is available on orders of ${inr(SHIP.codMin)} and above.`; return; }
    msg.className = 'form-msg'; msg.textContent = '';
    const { pay, ...addr } = f;
    try { localStorage.setItem(ADDR_KEY, JSON.stringify(addr)); } catch (err) { /* ignore */ }
    payOnline(addr, payNow());
  });

  /* Placeholder until Razorpay is connected */
  function payOnline(a, amount) {
    const items = lines.map(({ p, q }) => `• ${p.name} × ${q} = ${inr(p.price * q)}`).join('\n');
    const ship = shipping === 0 ? 'Free' : shipping ? inr(shipping) : 'to be confirmed';
    const payLine = mode === 'cod'
      ? `Payment: Partial COD (pay ${inr(split.now)} online now, ${inr(split.later)} cash on delivery)`
      : `Payment: Full online payment (${inr(amount)})`;
    $('#waOrder').href = waLink(`Hi Toy Kingdom! I'd like to order:\n${items}\n\nSubtotal: ${inr(subtotal)}\nShipping: ${ship}\nTotal: ${inr(total)}\n${payLine}\n\nDeliver to:\n${a.name}, ${a.phone}${a.email ? ', ' + a.email : ''}\n${a.address}, ${a.city}, ${a.state} - ${a.pincode}`);
    $('#payDummy').hidden = false;
    $('#payDummy').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
