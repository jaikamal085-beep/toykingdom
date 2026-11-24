'use strict';
/* ---------------- Order placed / order details page (order.html?id=...) ---------------- */
function initOrder() {
  const main = $('#main'), qs = new URLSearchParams(location.search), id = qs.get('id') || '', fresh = qs.get('new') === '1';
  if (!Auth.current()) { location.replace('account.html?next=' + encodeURIComponent('order.html?id=' + id)); return; }
  main.innerHTML = '<div class="wrap page"><p class="muted">Loading your order…</p></div>';

  Orders.get(id).then(o => {
    document.title = `Order ${o.id} – Toy Kingdom`;
    const a = o.address, pay = o.payment;
    const ship = o.shipping === 0 ? 'Free' : o.shipping ? inr(o.shipping) : 'To be confirmed';
    main.innerHTML = `<div class="wrap page order-page">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a>${icon('right')}<a href="account.html">My account</a>${icon('right')}<span>Order ${esc(o.id)}</span></nav>
      ${fresh ? `<div class="panel order-hero"><span class="ok-ic">${icon('check')}</span>
        <div><h1>Order placed, thank you!</h1><p class="muted">Order number <b>${esc(o.id)}</b> · ${fmtDate(o.created, true)}</p>
        <p class="small">We'll deliver in ${SHIP.days}. We'll call ${esc(a.phone)} if the courier needs help finding you.</p>
        <p class="mail-status" id="mailStatus" role="status"></p></div></div>`
        : `<header class="page-head"><h1>Order ${esc(o.id)}</h1><p class="muted">Placed ${fmtDate(o.created, true)} · Status: <b>${esc(o.status)}</b></p></header>`}
      ${o.test ? '<p class="note">This is a <b>test order</b>. Online payment isn’t switched on yet, so no money was taken.</p>' : ''}
      ${o.storage === 'local' ? '<p class="note">Saved on this device only, because the database rules for orders aren’t published yet.</p>' : ''}
      <div class="order-grid">
        <section class="panel">
          <h2>Items</h2>
          <ul class="plain sum-lines">${o.items.map(i => `<li>
            <a href="product.html?id=${encodeURIComponent(i.id)}" class="sum-img">${img(i.img, i.name)}<span class="sum-q">${i.qty}</span></a>
            <span class="sum-name"><a href="product.html?id=${encodeURIComponent(i.id)}">${esc(i.name)}</a>${i.gift ? `<span class="gift-tag">${icon('gift')}Gift wrapped</span>` : ''}</span><b>${inr(i.price * i.qty)}</b></li>`).join('')}</ul>
          <div class="sum-row"><span>Subtotal</span><span>${inr(o.subtotal)}</span></div>
          ${o.giftWrap ? `<div class="sum-row"><span>Gift wrap</span><span>${inr(o.giftWrap)}</span></div>` : ''}
          <div class="sum-row"><span>Shipping</span><span>${ship}</span></div>
          <div class="sum-row total"><span>Total</span><b>${inr(o.total)}</b></div>
          <div class="cod-split">
            <div class="sum-row"><span>Paid online${o.test ? ' (test)' : ''}</span><b>${inr(pay.paidNow)}</b></div>
            ${pay.dueOnDelivery ? `<div class="sum-row"><span>To pay in cash on delivery</span><b>${inr(pay.dueOnDelivery)}</b></div>` : ''}
          </div>
        </section>
        <aside class="panel">
          <h2>Delivering to</h2>
          <p class="addr-block"><b>${esc(a.name)}</b><br>${esc(a.house)}<br>${esc(a.area)}${a.landmark ? `<br>Landmark: ${esc(a.landmark)}` : ''}<br>${esc(a.city)}, ${esc(a.state)} - <b>${esc(a.pincode)}</b><br>Mobile: ${esc(a.phone)}${a.alt ? ` · ${esc(a.alt)}` : ''}</p>
          <p class="small muted">Payment: ${esc(pay.method)}</p>
          <a class="btn btn-block" href="invoice.html?id=${encodeURIComponent(o.id)}" target="_blank" rel="noopener">${icon('receipt')}View / print bill</a>
          <a class="btn btn-outline btn-block" href="${waLink(`Hi Toy Kingdom! About my order ${o.id}:`)}" target="_blank" rel="noopener">${icon('whatsapp')}Ask about this order</a>
          <a class="link center-text" href="collection.html">Continue shopping</a>
        </aside>
      </div></div>`;

    /* order confirmation e-mails (customer: bill; admin: bill + label) */
    const st = $('#mailStatus');
    if (fresh && st && typeof Mailer !== 'undefined' && Mailer.enabled() && o.storage === 'cloud') {
      if (Mailer.alreadySent(o.id)) st.innerHTML = `${icon('mail')} Confirmation e-mail sent to <b>${esc(o.email)}</b>.`;
      else {
        st.innerHTML = `${icon('mail')} Sending your confirmation e-mail with the bill to <b>${esc(o.email)}</b>…`;
        Mailer.sendOrder(o)
          .then(res => { st.innerHTML = res.ok ? `${icon('check')} Confirmation e-mail with your bill sent to <b>${esc(o.email)}</b>. Not in your inbox? Check <b>Spam</b> and tap “Not spam” so our e-mails reach you.` : ''; })
          .catch(err => { st.className = 'mail-status bad'; st.textContent = `We couldn't send the confirmation e-mail (${err.message}). You can still download your bill below.`; });
      }
    }
  }).catch(err => {
    main.innerHTML = `<div class="wrap page notfound"><h1>Order not found</h1><p class="muted">${esc(err.message)}</p><a class="btn" href="account.html">My orders</a></div>`;
  });
}
