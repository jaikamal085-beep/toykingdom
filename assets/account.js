'use strict';
/* ==========================================================================
   My account dashboard (account.html when logged in)
   Sections (URL hash): #overview, #orders, #address, #profile
   Re-uses the address checks from assets/checkout.js (PIN lookup, phone rules).
   ========================================================================== */
const ORDER_STEPS = ['placed', 'packed', 'shipped', 'delivered'];
const STATUS_LABEL = { placed: 'Order placed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
const isOpen = o => !['delivered', 'cancelled'].includes(o.status);

function renderAccountDashboard(s) {
  const main = $('#main');
  const SECTIONS = [['overview', 'Overview', 'user'], ['orders', 'My orders', 'bag'], ['address', 'Saved address', 'pin'], ['profile', 'Profile & security', 'lock']];
  const initials = (s.name || s.email).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  let orders = null, address, current = '';

  main.innerHTML = `<div class="wrap page acct">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a>${icon('right')}<span>My account</span></nav>
    <header class="acct-head panel">
      <div class="avatar">${s.photo ? `<img src="${esc(s.photo)}" alt="" referrerpolicy="no-referrer">` : esc(initials)}</div>
      <div class="acct-id"><h1>Hello, ${esc(s.name.split(' ')[0])}</h1>
        <p class="muted">${esc(s.email)}${s.role === 'admin' ? ' <span class="badge">Admin</span>' : ''}</p></div>
      <div class="acct-head-actions">${s.role === 'admin' ? '<a class="btn" href="admin.html">Admin dashboard</a>' : ''}
        <button class="btn btn-outline" id="logoutTop">Log out</button></div>
    </header>
    <div class="acct-grid">
      <nav class="acct-nav panel" aria-label="Account sections">${SECTIONS.map(([k, t, ic]) =>
        `<a href="#${k}" data-sec="${k}">${icon(ic)}<span>${t}</span><span class="cnt" data-cnt="${k}"></span></a>`).join('')}
        <a href="${waLink('Hi Toy Kingdom! I need help with my account.')}" target="_blank" rel="noopener">${icon('whatsapp')}<span>Help on WhatsApp</span></a>
      </nav>
      <section class="acct-body" id="acctBody" aria-live="polite"></section>
    </div>
  </div>`;
  $('#logoutTop').onclick = async () => { await Auth.logout(); location.href = 'account.html'; };

  /* ---------- data ---------- */
  const loadOrders = () => orders ? Promise.resolve(orders) : Orders.mine().then(l => (orders = l)).catch(e => { orders = []; throw e; });
  const loadAddress = () => address !== undefined ? Promise.resolve(address) : Profile.getAddress().then(a => (address = a));
  loadOrders().then(l => { const c = $('[data-cnt=orders]'); if (c && l.length) c.textContent = l.length; }).catch(() => {});

  /* ---------- pieces ---------- */
  const statusBadge = o => `<span class="ostatus ${esc(o.status)}">${STATUS_LABEL[o.status] || esc(o.status)}</span>`;
  function tracker(o) {
    if (o.status === 'cancelled') return '<p class="small muted">This order was cancelled.</p>';
    const at = Math.max(0, ORDER_STEPS.indexOf(o.status));
    return `<ol class="track">${ORDER_STEPS.map((st, i) => `<li class="${i <= at ? 'done' : ''} ${i === at ? 'now' : ''}"><span class="dot">${i <= at ? icon('check') : ''}</span><span>${STATUS_LABEL[st]}</span></li>`).join('')}</ol>`;
  }
  function orderCard(o) {
    const pieces = o.items.reduce((n, i) => n + i.qty, 0);
    const first = o.items[0];
    return `<article class="ocard">
      <header class="ocard-head">
        <div><span class="k">Order placed</span><b>${fmtDate(o.created)}</b></div>
        <div><span class="k">Total</span><b>${inr(o.total)}</b></div>
        <div><span class="k">Payment</span><b>${esc(o.payment.method)}</b></div>
        <div class="ocard-id"><span class="k">Order #</span><b>${esc(o.id)}</b></div>
      </header>
      <div class="ocard-body">
        <div class="ocard-items">
          <div class="othumbs">${o.items.slice(0, 3).map(i => `<a href="product.html?id=${encodeURIComponent(i.id)}">${img(i.img, i.name)}</a>`).join('')}${o.items.length > 3 ? `<span class="more">+${o.items.length - 3}</span>` : ''}</div>
          <div class="oinfo"><div class="obadges">${statusBadge(o)}${o.test ? '<span class="ostatus test">Test order</span>' : ''}</div>
            <a class="oname" href="product.html?id=${encodeURIComponent(first.id)}">${esc(first.name)}</a>
            <span class="small muted">${pieces} item${pieces === 1 ? '' : 's'}${o.items.length > 1 ? ` · and ${o.items.length - 1} more product${o.items.length > 2 ? 's' : ''}` : ''}${o.payment.dueOnDelivery ? ` · ${inr(o.payment.dueOnDelivery)} to pay on delivery` : ''}</span>
            <span class="small muted">Delivering to ${esc(o.address.name)}, ${esc(o.address.city)} ${esc(o.address.pincode)}</span></div>
        </div>
        ${tracker(o)}
        <div class="ocard-actions">
          <a class="btn btn-sm" href="order.html?id=${encodeURIComponent(o.id)}">View details</a>
          <a class="btn btn-sm btn-outline" href="invoice.html?id=${encodeURIComponent(o.id)}" target="_blank" rel="noopener">${icon('receipt')}Download bill</a>
          <button class="btn btn-sm btn-outline" data-again="${esc(o.id)}">${icon('bag')}Buy again</button>
          <a class="btn btn-sm btn-outline" href="${waLink(`Hi Toy Kingdom! I need help with order ${o.id}.`)}" target="_blank" rel="noopener">${icon('whatsapp')}Get help</a>
        </div>
      </div>
    </article>`;
  }
  const emptyOrders = `<div class="empty-state">${icon('bag')}<h3>No orders yet</h3><p class="muted">When you place an order, you can track it and download the bill here.</p><a class="btn" href="collection.html">Start shopping</a></div>`;
  const addrText = a => `<b>${esc(a.name)}</b><br>${esc(a.house)}<br>${esc(a.area)}${a.landmark ? `<br>Landmark: ${esc(a.landmark)}` : ''}<br>${esc(a.city)}, ${esc(a.state)} - <b>${esc(a.pincode)}</b><br>Mobile: ${esc(a.phone)}${a.alt ? ` · ${esc(a.alt)}` : ''}`;

  /* ---------- sections ---------- */
  const body = $('#acctBody');
  const VIEWS = {
    async overview() {
      body.innerHTML = '<div class="panel"><p class="muted">Loading…</p></div>';
      const [list, a] = await Promise.all([loadOrders().catch(() => []), loadAddress()]);
      const open = list.filter(isOpen);
      body.innerHTML = `
        <div class="acct-cards">
          <a class="acard panel" href="#orders">${icon('bag')}<b>${list.length}</b><span>Orders</span></a>
          <a class="acard panel" href="#orders">${icon('truck')}<b>${open.length}</b><span>In progress</span></a>
          <a class="acard panel" href="#address">${icon('pin')}<b>${a ? '1' : '0'}</b><span>Saved address</span></a>
          <a class="acard panel" href="collection.html">${icon('tag')}<b>${PRODUCTS.length}</b><span>Toys to explore</span></a>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Recent orders</h2>${list.length ? '<a class="link" href="#orders">See all</a>' : ''}</div>
          ${list.length ? list.slice(0, 2).map(orderCard).join('') : emptyOrders}
        </div>
        <div class="acct-two">
          <div class="panel"><div class="panel-head"><h2>Default address</h2><a class="link" href="#address">${a ? 'Edit' : 'Add'}</a></div>
            ${a ? `<p class="addr-block">${addrText(a)}</p>` : '<p class="muted small">No saved address yet. It’s saved automatically when you place an order, or you can add it now.</p>'}</div>
          <div class="panel"><div class="panel-head"><h2>Need help?</h2></div>
            <ul class="plain help-list">
              <li>${icon('whatsapp')}<a href="${waLink('Hi Toy Kingdom!')}" target="_blank" rel="noopener">Chat with us on WhatsApp</a></li>
              <li>${icon('phone')}<a href="tel:+${SITE.wa}">${SITE.phoneDisplay}</a></li>
              <li>${icon('receipt')}<a href="${SITE.refund}">Returns &amp; refund policy</a></li>
              <li>${icon('clock')}<span>${SITE.hours}</span></li>
            </ul></div>
        </div>`;
    },

    async orders() {
      body.innerHTML = '<div class="panel"><p class="muted">Loading your orders…</p></div>';
      let list;
      try { list = await loadOrders(); } catch (err) { body.innerHTML = `<div class="panel"><p class="form-msg bad">${esc(err.message)}</p></div>`; return; }
      const TABS = [['all', 'All'], ['open', 'In progress'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
      body.innerHTML = `<div class="panel">
        <div class="panel-head"><h2>My orders</h2>
          <label class="search-field mini">${icon('search')}<input id="oq" type="search" placeholder="Search orders or toys" aria-label="Search orders"></label></div>
        <div class="otabs" role="tablist">${TABS.map(([k, t], i) => `<button role="tab" data-ot="${k}" aria-selected="${!i}">${t}</button>`).join('')}</div>
        <div id="olist"></div></div>`;
      let tab = 'all';
      const draw = () => {
        const q = $('#oq').value.trim().toLowerCase();
        const shown = list.filter(o => (tab === 'all' || (tab === 'open' ? isOpen(o) : o.status === tab))
          && (!q || o.id.toLowerCase().includes(q) || o.items.some(i => i.name.toLowerCase().includes(q))));
        $('#olist').innerHTML = shown.length ? shown.map(orderCard).join('') : (list.length ? '<p class="muted small empty-filter">No orders match.</p>' : emptyOrders);
      };
      body.querySelector('.otabs').addEventListener('click', e => {
        const b = e.target.closest('[data-ot]'); if (!b) return;
        tab = b.dataset.ot; $$('[data-ot]', body).forEach(x => x.setAttribute('aria-selected', String(x === b))); draw();
      });
      $('#oq').addEventListener('input', draw);
      draw();
    },

    async address() {
      body.innerHTML = '<div class="panel"><p class="muted">Loading…</p></div>';
      const a = await loadAddress();
      const viewMode = () => {
        body.innerHTML = `<div class="panel">
          <div class="panel-head"><h2>Saved address</h2></div>
          ${a ? `<div class="addr-card"><span class="badge">Default</span><p class="addr-block">${addrText(a)}</p>
              ${a.verified ? `<p class="small ok-text">${icon('check')} PIN verified with India Post</p>` : ''}
              <div class="row-actions"><button class="btn btn-sm" id="editA">Edit</button><button class="btn btn-sm btn-outline" id="delA">Remove</button></div></div>`
            : `<div class="empty-state">${icon('pin')}<h3>No saved address</h3><p class="muted">Save it once and checkout will fill it in for you.</p><button class="btn" id="editA">Add address</button></div>`}
          <p class="small muted">Checkout always asks you to confirm the address before an order is placed.</p></div>`;
        $('#editA').onclick = editMode;
        if ($('#delA')) $('#delA').onclick = async e => {
          if (e.target.dataset.confirm !== '1') { e.target.dataset.confirm = '1'; e.target.textContent = 'Confirm remove?'; return; }
          await Profile.removeAddress(); address = null; toast('Address removed'); VIEWS.address();
        };
      };
      const editMode = () => {
        const v = a || { name: s.name };
        const fld = (id, label, val, attrs = '', req = true) => `<div class="field" id="f_${id}"><label for="ad_${id}">${label}${req ? ' <span class="req">*</span>' : ''}</label>
          <input id="ad_${id}" name="${id}" value="${esc(val || '')}" ${attrs}><p class="field-err" id="e_${id}"></p></div>`;
        body.innerHTML = `<form class="panel cform" id="addrForm" novalidate>
          <div class="panel-head"><h2>${a ? 'Edit address' : 'Add address'}</h2></div>
          <div class="frow">${fld('name', 'Full name', v.name, 'autocomplete="name" maxlength="60"')}${fld('phone', 'Mobile number', v.phone, 'type="tel" inputmode="numeric" maxlength="14"')}</div>
          <div class="frow">${fld('pincode', 'PIN code', v.pincode, 'inputmode="numeric" maxlength="6"')}${fld('alt', 'Alternate mobile', v.alt, 'type="tel" inputmode="numeric" maxlength="14"', false)}</div>
          <p class="pin-status" id="pinStatus"></p>
          ${fld('house', 'House / flat no., building', v.house, 'maxlength="80"')}
          ${fld('area', 'Street, area / locality', v.area, 'maxlength="120" list="pinPlaces"')}<datalist id="pinPlaces"></datalist>
          ${fld('landmark', 'Landmark', v.landmark, 'maxlength="80"', false)}
          <div class="frow">${fld('city', 'City / town', v.city, 'maxlength="50"')}
            <div class="field" id="f_state"><label for="ad_state">State <span class="req">*</span></label>
              <select id="ad_state" name="state" class="select"><option value="">Select state</option>${STATES.map(x => `<option ${x === matchState(v.state) ? 'selected' : ''}>${x}</option>`).join('')}</select><p class="field-err" id="e_state"></p></div></div>
          <p class="form-msg" id="addrMsg" role="status"></p>
          <div class="form-actions"><button class="btn btn-lg" type="submit">Save address</button><button class="btn btn-outline btn-lg" type="button" id="cancelA">Cancel</button></div>
        </form>`;
        const A = k => $('#ad_' + k), setErr = (k, t) => { $('#e_' + k).textContent = t || ''; $('#f_' + k).classList.toggle('err', !!t); };
        let pin = null;
        const checkPin = async () => {
          const p = digitsOnly(A('pincode').value).slice(0, 6), st = $('#pinStatus'); A('pincode').value = p; pin = null; st.className = 'pin-status'; st.textContent = '';
          if (!/^[1-9]\d{5}$/.test(p)) return;
          st.textContent = 'Checking PIN code…';
          const info = await lookupPin(p); pin = { p, ...info };
          if (info.ok) {
            st.className = 'pin-status ok'; st.innerHTML = `${icon('check')} PIN ${p}: <b>${esc(info.district)}, ${esc(info.state)}</b>`;
            $('#pinPlaces').innerHTML = info.places.map(x => `<option value="${esc(x)}">`).join('');
            if (matchState(info.state)) A('state').value = matchState(info.state);
            if (!A('city').value.trim()) A('city').value = info.district;
          } else if (info.notFound) { st.className = 'pin-status bad'; st.textContent = `PIN ${p} doesn’t exist in India Post records.`; }
          else { st.className = 'pin-status warn'; st.textContent = 'Couldn’t verify the PIN code right now. Please double-check it.'; }
        };
        A('pincode').addEventListener('input', checkPin);
        if (v.pincode) checkPin();
        $('#cancelA').onclick = viewMode;
        $('#addrForm').addEventListener('submit', async e => {
          e.preventDefault();
          const val = k => cleanSpaces(A(k).value);
          const n = { name: val('name'), phone: normPhone(val('phone')), alt: normPhone(val('alt')), pincode: digitsOnly(val('pincode')), house: val('house'), area: val('area'), landmark: val('landmark'), city: val('city'), state: A('state').value };
          const errs = {
            name: letters(n.name) < 3 || !/^[a-z][a-z .'-]*$/i.test(n.name) ? 'Please enter a real name (letters only).' : '',
            phone: phoneProblem(n.phone), alt: n.alt ? (phoneProblem(n.alt, 'alternate number') || (n.alt === n.phone ? 'Must be different from the mobile number.' : '')) : '',
            pincode: !/^[1-9]\d{5}$/.test(n.pincode) ? 'Please enter your 6-digit PIN code.' : pin && pin.notFound ? 'This PIN code doesn’t exist.' : '',
            house: !n.house ? 'Please enter the house / flat number.' : '', area: letters(n.area) < 4 ? 'Please enter the street / area name.' : '',
            city: letters(n.city) < 2 || /\d/.test(n.city) ? 'Please enter a valid city.' : '',
            state: !n.state ? 'Please select your state.' : pin && pin.ok && matchState(pin.state) && matchState(pin.state) !== n.state ? `PIN ${n.pincode} is in ${pin.state}.` : '',
          };
          Object.entries(errs).forEach(([k, t]) => setErr(k, t));
          const bad = Object.keys(errs).find(k => errs[k]);
          if (bad) { A(bad).focus(); return; }
          const saved = { ...n, district: pin && pin.ok ? pin.district : '', verified: !!(pin && pin.ok) };
          await Profile.saveAddress(saved); address = { ...saved, savedAt: Date.now() };
          toast('Address saved'); VIEWS.address();
        });
      };
      viewMode();
    },

    async profile() {
      const google = s.providers.includes('google.com'), pw = s.providers.includes('password');
      body.innerHTML = `<div class="panel">
          <div class="panel-head"><h2>Profile</h2></div>
          <form class="cform" id="nameForm" novalidate>
            <div class="frow"><div class="field"><label for="pName">Name</label><input id="pName" value="${esc(s.name)}" maxlength="60" autocomplete="name"></div>
              <div class="field"><label>Email</label><input value="${esc(s.email)}" disabled></div></div>
            <p class="form-msg" id="nameMsg" role="status"></p>
            <div class="form-actions"><button class="btn" type="submit">Save name</button></div>
          </form>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Login &amp; security</h2></div>
          <ul class="plain sec-list">
            <li><div><b>Signed in with</b><span class="muted small">${google ? 'Google' : ''}${google && pw ? ' and ' : ''}${pw ? 'Email &amp; password' : ''}</span></div>${google ? `<span class="ostatus delivered">${icon('check')}Google</span>` : ''}</li>
            <li><div><b>Email</b><span class="muted small">${esc(s.email)}</span></div>${s.verified ? `<span class="ostatus delivered">${icon('check')}Verified</span>` : '<button class="btn btn-sm btn-outline" id="sendV">Verify email</button>'}</li>
            ${pw ? '<li><div><b>Password</b><span class="muted small">We’ll email you a secure link to set a new password.</span></div><button class="btn btn-sm btn-outline" id="resetPw">Change password</button></li>' : ''}
            ${s.since ? `<li><div><b>Member since</b><span class="muted small">${fmtDate(s.since)}</span></div></li>` : ''}
          </ul>
          <p class="form-msg" id="secMsg" role="status"></p>
          <button class="btn btn-outline" id="logoutB">Log out</button>
        </div>
        ${s.adminEmail && !s.verified ? `<div class="panel note verify-box"><p><b>Verify your admin email to unlock the admin page.</b></p>
          <p class="small">Click <b>Verify email</b> above, open the link sent to ${esc(s.email)}, then click <b>I've verified</b>.</p>
          <button class="btn btn-outline" id="checkVerify">I've verified</button></div>` : ''}`;
      const say = (id, cls, t) => { const m = $(id); m.className = 'form-msg ' + cls; m.textContent = t; };
      $('#nameForm').addEventListener('submit', async e => {
        e.preventDefault();
        try { const n = await Auth.updateName($('#pName').value); s.name = n.name; say('#nameMsg', 'ok', 'Name saved.'); $('.acct-id h1').textContent = `Hello, ${n.name.split(' ')[0]}`; }
        catch (err) { say('#nameMsg', 'bad', err.message); }
      });
      if ($('#resetPw')) $('#resetPw').onclick = async () => {
        try { await Auth.resetPassword(s.email); say('#secMsg', 'ok', `Password reset link sent to ${s.email}. Check your inbox (and Spam).`); }
        catch (err) { say('#secMsg', 'bad', err.message); }
      };
      if ($('#sendV')) $('#sendV').onclick = async () => {
        try { await Auth.sendVerification(); say('#secMsg', 'ok', `Verification email sent to ${s.email}.`); }
        catch (err) { say('#secMsg', 'bad', err.message); }
      };
      if ($('#checkVerify')) $('#checkVerify').onclick = async () => {
        const now = await Auth.refresh().catch(() => null);
        if (now && now.role === 'admin') location.href = 'admin.html'; else say('#secMsg', 'bad', 'Not verified yet. Click the link in the email first.');
      };
      $('#logoutB').onclick = async () => { await Auth.logout(); location.href = 'account.html'; };
    },
  };

  /* buy again: put the order's items back in the cart */
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-again]'); if (!b || !orders) return;
    const o = orders.find(x => x.id === b.dataset.again); if (!o) return;
    let added = 0;
    o.items.forEach(i => { const p = byId(i.id); if (p && p.stock) { cartAdd(p.id, i.qty, false); added++; } });
    if (added) openLayer($('#cartSheet')); else toast('These toys are out of stock right now');
  });

  function show() {
    const sec = (location.hash || '#overview').slice(1);
    const key = VIEWS[sec] ? sec : 'overview';
    if (key === current) return;
    current = key;
    $$('.acct-nav [data-sec]').forEach(a => a.classList.toggle('on', a.dataset.sec === key));
    document.title = `${SECTIONS.find(x => x[0] === key)[1]} – Toy Kingdom`;
    VIEWS[key]();
  }
  addEventListener('hashchange', show);
  show();
}
