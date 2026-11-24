'use strict';
/* ============ Site config ============ */
const IMG_BASE = 'https://toykingdomonline.com/wp-content/uploads/';
const SITE = {
  phone: '8248640441', phoneDisplay: '+91 82486 40441', wa: '918248640441',
  email: 'toykingdom1309@gmail.com', hours: 'Mon – Fri, 10am – 10pm',
  ig: 'https://www.instagram.com/toykingdom1309/', yt: 'https://www.youtube.com/@ToyKingdom-1309',
  map: 'https://maps.app.goo.gl/UDhWqDFfMkqGMgtW7', gst: '33BGCPL8590H1Z7',
  legalName: 'Toy Kingdom',
  address: ['09, Teacher’s Colony, 2nd Street', 'N.K. Road', 'Thanjavur, Tamil Nadu - 613006'],
  state: 'Tamil Nadu',
  logo: 'assets/img/logo.webp',
  refund: 'refund-policy.html', account: 'https://toykingdomonline.com/my-account/',
};
const CATEGORIES = [
  { name: 'Educational Toys', img: 'assets/img/cat-educational.png' },
  { name: 'Fun Toys',         img: 'assets/img/cat-fun.png' },
  { name: 'RC Toys',          img: 'assets/img/cat-rc.png' },
  { name: 'Gadgets',          img: 'assets/img/cat-gadgets.png' },
  { name: 'Hotwheels',        img: 'assets/img/cat-hotwheels.png' },
];
const TOYS_AND_GAMES = ['Educational Toys', 'Fun Toys', 'RC Toys', 'Gadgets'];

/* ============ Helpers ============ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n).toLocaleString('en-IN');
const off = p => (p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0);
const byId = id => PRODUCTS.find(p => String(p.id) === String(id));
const productUrl = p => 'product.html?id=' + p.id;
const catUrl = c => 'collection.html?cat=' + encodeURIComponent(c);
const waLink = text => `https://wa.me/${SITE.wa}?text=${encodeURIComponent(text)}`;

/* Minimal line icons (24px grid, 1.6 stroke) */
const ICONS = {
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5Z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  bag: '<path d="M5 8h14l-1.2 12.1a1 1 0 0 1-1 .9H7.2a1 1 0 0 1-1-.9L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  phone: '<path d="M6.6 3.5h2.8l1.6 4.3-2 1.4a11 11 0 0 0 5.8 5.8l1.4-2 4.3 1.6v2.8a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  truck: '<path d="M3 6.5h11v10H3zM14 10h3.8l3.2 3.4v3.1h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.1 7.1a1 1 0 0 1-1.4 0l-8.5-8.1Z"/><circle cx="8" cy="8" r="1.4"/>',
  chat: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4V5.5Z"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1-1"/>',
  gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-1.5-3.5-5.5-4-5.5-1.5S10 8 12 8Zm0 0c1.5-3.5 5.5-4 5.5-1.5S14 8 12 8Z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.8"/><circle cx="17.2" cy="6.8" r=".4" fill="currentColor"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10.2 9.3 4.6 2.7-4.6 2.7V9.3Z"/>',
  whatsapp: '<path d="M4 20l1.2-3.8A8.5 8.5 0 1 1 8 19l-4 1Z"/><path d="M9.3 8.6c.2 2.6 3.1 5.5 5.7 5.8.6 0 1.2-.5 1.3-1.1l-1.6-.9-.9.8a5 5 0 0 1-2.9-2.9l.8-.9-.9-1.6c-.6.1-1.5.7-1.5 1.3Z"/>',
};
const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#F8EDFD"/><rect x="34" y="38" width="32" height="26" rx="3" fill="none" stroke="#9D10DB" stroke-width="2"/><circle cx="43" cy="47" r="3" fill="none" stroke="#9D10DB" stroke-width="2"/><path d="m36 62 10-9 6 5 5-4 8 8" fill="none" stroke="#9D10DB" stroke-width="2"/></svg>');
function imgFail(el) { el.onerror = null; el.src = PLACEHOLDER; }

/* Adds a Cloudinary transformation (resize/compress) to an untransformed Cloudinary URL. */
function cld(url, t) {
  const m = String(url || '').match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video)\/upload\/)(.*)$/i);
  if (!m || /^(?!v\d+\/)[a-z]{1,3}_[^/]*\//i.test(m[2])) return url;
  return m[1] + t + '/' + m[2];
}
const img = (src, alt = '', cls = '', eager = false) =>
  `<img class="${cls}" src="${esc(cld(src, 'f_auto,q_auto,c_limit,w_1000'))}" alt="${esc(alt)}" ${eager ? '' : 'loading="lazy"'} decoding="async" onerror="imgFail(this)">`;

const socialLinks = () => `<div class="social">
  <a href="${SITE.ig}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>
  <a href="${SITE.yt}" target="_blank" rel="noopener" aria-label="YouTube">${icon('youtube')}</a>
  <a href="https://wa.me/${SITE.wa}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp')}</a></div>`;

/* ============ Video links (YouTube, Vimeo, Google Drive, direct .mp4 e.g. Cloudinary) ============ */
function videoEmbed(url, { autoplay = false } = {}) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  const ap = autoplay ? '?autoplay=1&mute=1&playsinline=1' : '';
  const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  if (yt) return `<iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}${ap}" title="Product video" allow="autoplay; accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vm) return `<iframe src="https://player.vimeo.com/video/${vm[1]}${autoplay ? '?autoplay=1&muted=1' : ''}" title="Product video" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  const gd = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/i);
  if (gd) return `<iframe src="https://drive.google.com/file/d/${gd[1]}/preview" title="Product video" allow="fullscreen" allowfullscreen loading="lazy"></iframe>`;
  if (/^https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\//i.test(url)) {
    /* compressed 720p-ish MP4 first; the original file is the fallback if Cloudinary can't convert it */
    const small = cld(url, 'q_auto,c_limit,w_1280').replace(/\.[a-z0-9]+$/i, '.mp4');
    const poster = cld(url, 'so_1,q_auto,c_limit,w_1000').replace(/\.[a-z0-9]+$/i, '.jpg');
    return `<video controls playsinline ${autoplay ? 'autoplay preload="auto"' : 'preload="none"'} poster="${esc(poster)}"><source src="${esc(small)}" type="video/mp4"><source src="${esc(url)}"></video>`;
  }
  return `<video src="${esc(url)}" controls playsinline ${autoplay ? 'autoplay preload="auto"' : 'preload="metadata"'}></video>`;
}

/* Small preview image for a video link (used for gallery thumbnails); '' if none. */
function videoThumb(url) {
  url = String(url || '').trim();
  const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  if (yt) return `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`;
  if (/^https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\//i.test(url))
    return cld(url, 'so_1,q_auto,c_fill,w_200,h_200').replace(/\.[a-z0-9]+$/i, '.jpg');
  return '';
}

const fmtDate = (t, withTime = false) => new Date(t).toLocaleString('en-IN', withTime
  ? { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }
  : { day: 'numeric', month: 'short', year: 'numeric' });

/* Delivery & payment rules (used by the product page, cart and checkout)
   freeAbove:  orders (items total) of this amount or more ship free
   fee:        shipping charge below freeAbove
   codMin:     partial cash-on-delivery is offered from this items total (shown only at checkout)
   codAdvance: fixed amount paid online in advance with partial COD; the rest is paid in cash
   giftWrap:   gift wrapping charge per wrapped item */
const SHIP = { days: '3-5 Working Days', freeAbove: 499, fee: 50, codMin: 999, codAdvance: 99, giftWrap: 30 };
const shippingFor = subtotal => subtotal >= SHIP.freeAbove ? 0 : SHIP.fee;
const codSplit = total => { const now = Math.min(SHIP.codAdvance, total); return { now, later: total - now }; };

/* ============ Shared UI pieces ============ */
function priceHTML(p) {
  const o = off(p);
  return `<div class="price"><span class="now">${inr(p.price)}</span>${o ? `<s>${inr(p.mrp)}</s><span class="save">${o}% off</span>` : ''}</div>`;
}
function cardHTML(p) {
  const o = off(p);
  const badge = !p.stock ? '<span class="badge muted">Sold out</span>' : o ? '<span class="badge">Sale</span>' : '';
  return `<article class="card">
    <a class="card-media" href="${productUrl(p)}" aria-label="${esc(p.name)}">
      ${img(p.imgs[0], p.name, 'main')}${p.imgs[1] ? img(p.imgs[1], '', 'alt') : ''}
      <div class="badges">${badge}</div>
    </a>
    <div class="card-body">
      <a class="card-title" href="${productUrl(p)}">${esc(p.name)}</a>
      ${priceHTML(p)}
      ${p.stock ? `<button class="btn btn-outline btn-block" data-add="${p.id}">Add to cart</button>`
                : `<button class="btn btn-outline btn-block" disabled>Sold out</button>`}
    </div>
  </article>`;
}
function carouselHTML(title, link, items, sub = '') {
  return `<section class="section"><div class="wrap">
    <div class="sec-head"><div><h2>${esc(title)}</h2>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}</div>
      ${link ? `<a class="link-arrow" href="${link}">View all ${icon('right')}</a>` : ''}</div>
    <div class="carousel" data-carousel>
      <div class="track">${items.map(cardHTML).join('')}</div>
      <div class="car-ctrl"><button class="cbtn" data-prev aria-label="Previous">${icon('left')}</button>
        <span data-count>1 / 1</span>
        <button class="cbtn" data-next aria-label="Next">${icon('right')}</button></div>
    </div></div></section>`;
}
function initCarousel(root) {
  const track = $('.track', root), prev = $('[data-prev]', root), next = $('[data-next]', root), label = $('[data-count]', root);
  const update = () => {
    const w = track.clientWidth || 1;
    const pages = Math.max(1, Math.ceil((track.scrollWidth - 4) / w));
    const atEnd = track.scrollLeft + w >= track.scrollWidth - 4;
    const cur = atEnd ? pages : Math.min(pages, Math.floor((track.scrollLeft + 4) / w) + 1);
    label.textContent = `${cur} / ${pages}`;
    prev.disabled = track.scrollLeft <= 4;
    next.disabled = atEnd;
    root.querySelector('.car-ctrl').hidden = pages <= 1;
  };
  prev.onclick = () => track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' });
  next.onclick = () => track.scrollBy({ left: track.clientWidth, behavior: 'smooth' });
  track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  addEventListener('resize', update);
  update();
}

let toastTimer;
function toast(msg) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.innerHTML = icon('check') + `<span>${esc(msg)}</span>`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2000);
}

/* ============ Layers (drawers / search) ============ */
function openLayer(el) {
  closeLayers();
  el.classList.add('open');
  $('#scrim').hidden = false;
  document.documentElement.classList.add('locked');
}
function closeLayers() {
  $$('.layer.open').forEach(e => e.classList.remove('open'));
  const s = $('#scrim'); if (s) s.hidden = true;
  document.documentElement.classList.remove('locked');
}

/* ============ Header & footer ============ */
const NAV = [['index.html', 'Home', 'home'], ['collection.html', 'All Products', 'all'], ['toys-and-games.html', 'Toys And Games', 'toys'], ['contact.html', 'Contact', 'contact']];

function renderHeader() {
  const page = document.body.dataset.page;
  const user = typeof Auth !== 'undefined' ? Auth.current() : null;
  const isAdmin = typeof Auth !== 'undefined' && Auth.isAdmin();
  if (isAdmin && !NAV.some(n => n[2] === 'admin')) NAV.push(['admin.html', 'Admin', 'admin']);
  const accountLabel = user ? 'My account' : 'Log in';
  const navLinks = NAV.map(([h, t, k]) => `<a href="${h}" class="${k === page ? 'active' : ''}" ${k === page ? 'aria-current="page"' : ''}>${t}</a>`).join('');
  $('#site-header').outerHTML = `
  <a class="sr-only" href="#main">Skip to content</a>
  <div class="announce"><div class="wrap announce-in">
    ${socialLinks()}
    <p>Order easily on WhatsApp · <a href="https://wa.me/${SITE.wa}" target="_blank" rel="noopener">${SITE.phoneDisplay}</a></p>
    <span class="announce-hours">${SITE.hours}</span>
  </div></div>
  <header class="header">
    <div class="wrap header-in">
      <div class="h-left">
        <button class="ibtn only-mobile" id="navOpen" aria-label="Open menu">${icon('menu')}</button>
      </div>
      <a href="index.html" class="logo" aria-label="Toy Kingdom home"><img src="${SITE.logo}" alt="Toy Kingdom" onerror="this.outerHTML='<span class=logo-text>Toy Kingdom</span>'"></a>
      <form class="hsearch" id="hsearch" role="search" action="collection.html" autocomplete="off">
        <label class="search-field">${icon('search')}<input id="hsInput" name="q" type="search" placeholder="Search toys, cars, gifts…" aria-label="Search all products" aria-autocomplete="list" aria-controls="hsResults" aria-expanded="false" enterkeyhint="search"></label>
        <div class="hs-results" id="hsResults" role="listbox" aria-label="Search suggestions" hidden></div>
      </form>
      <div class="h-right">
        <a class="ibtn only-desktop ${page === 'account' ? 'is-active' : ''}" href="account.html" aria-label="${accountLabel}" title="${user ? esc(user.email) : 'Log in'}">${icon('user')}${user ? '<span class="user-dot"></span>' : ''}</a>
        <button class="ibtn" id="cartOpen" aria-label="Open cart">${icon('bag')}<span class="cart-count" id="cartCount" hidden>0</span></button>
      </div>
    </div>
    <nav class="mainnav only-desktop" aria-label="Main"><div class="wrap">${navLinks}</div></nav>
  </header>
  <div class="scrim" id="scrim" hidden></div>

  <aside class="sheet sheet-left layer" id="navSheet" aria-label="Menu">
    <div class="sheet-head"><h2>Menu</h2><button class="ibtn" data-close aria-label="Close menu">${icon('close')}</button></div>
    <div class="sheet-body">
      <nav class="mnav">${NAV.map(([h, t, k]) => `<a href="${h}" class="${k === page ? 'active' : ''}">${t}${icon('right')}</a>`).join('')}
        <a href="account.html" class="${page === 'account' ? 'active' : ''}">${accountLabel}${icon('right')}</a></nav>
      <div class="m-contact">
        <a href="tel:+${SITE.wa}">${icon('phone')}${SITE.phoneDisplay}</a>
        <a href="mailto:${SITE.email}">${icon('mail')}${SITE.email}</a>
        <span>${icon('clock')}${SITE.hours}</span>
      </div>
      ${socialLinks()}
    </div>
  </aside>

  <aside class="sheet sheet-right layer" id="cartSheet" aria-label="Cart">
    <div class="sheet-head"><h2>Your cart</h2><button class="ibtn" data-close aria-label="Close cart">${icon('close')}</button></div>
    <div class="sheet-body" id="cartBody"></div>
    <div class="sheet-foot" id="cartFoot" hidden>
      <div class="subtotal sub-gift" id="cartGiftRow" hidden><span>Gift wrap</span><span id="cartGift">₹0</span></div>
      <div class="subtotal"><span>Subtotal</span><b id="cartTotal">₹0</b></div>
      <p class="small muted">${icon('truck')} Free shipping on orders above ₹${SHIP.freeAbove} (₹${SHIP.fee} below) · Delivery in ${SHIP.days}</p>
      <a class="btn btn-lg btn-block" href="checkout.html">${icon('lock')}Checkout</a>
      <button class="btn btn-outline btn-block" data-close>Continue shopping</button>
    </div>
  </aside>`;
}

function renderFooter() {
  $('#site-footer').outerHTML = `
  <footer class="footer">
    <div class="wrap footer-grid">
      <div class="f-brand">
        <img class="f-logo" src="${SITE.logo}" alt="Toy Kingdom" width="138" height="60">
        <p>Find the perfect toy — educational toys, fun toys, RC toys, gadgets and Hotwheels for happy little hearts.</p>
        ${socialLinks()}
      </div>
      <div><h3>Quick links</h3><ul>${NAV.map(([h, t]) => `<li><a href="${h}">${t}</a></li>`).join('')}</ul></div>
      <div><h3>Customer care</h3><ul class="f-contact">
        <li>${icon('phone')}<a href="tel:+${SITE.wa}">${SITE.phoneDisplay}</a></li>
        <li>${icon('mail')}<a href="mailto:${SITE.email}">${SITE.email}</a></li>
        <li>${icon('clock')}<span>${SITE.hours}</span></li>
        <li>${icon('pin')}<a href="${SITE.map}" target="_blank" rel="noopener">Find us on Google Maps</a></li>
      </ul></div>
      <div><h3>Policies</h3><ul>
        <li><a href="${SITE.refund}">Returns &amp; refund policy</a></li>
        <li><a href="contact.html">Contact information</a></li>
        <li><a href="account.html">My account</a></li>
      </ul></div>
    </div>
    <div class="wrap f-bottom"><span>© ${new Date().getFullYear()} Toy Kingdom. All rights reserved.</span><span>GSTIN: ${SITE.gst}</span></div>
  </footer>`;
}

/* ============ Search ============ */
/* Header search bar (every page): suggestions as you type, Enter opens all results. */
function initHeaderSearch() {
  const form = $('#hsearch'), input = $('#hsInput'), box = $('#hsResults');
  const cur = new URLSearchParams(location.search).get('q');
  if (cur && /collection\.html$/.test(location.pathname)) input.value = cur;
  let active = -1, timer = 0;

  const open = on => { box.hidden = !on; input.setAttribute('aria-expanded', String(on)); if (!on) active = -1; };
  const items = () => $$('.sr', box);
  const highlight = i => {
    const list = items(); if (!list.length) return;
    active = (i + list.length) % list.length;
    list.forEach((a, j) => a.classList.toggle('on', j === active));
    const el = list[active];                     // scroll inside the dropdown only, never the page
    if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight;
  };

  function render() {
    const q = input.value.trim();
    if (!q) { box.innerHTML = ''; open(false); return; }
    const res = SEARCH.query(q, { typing: true, limit: 200 });
    box.innerHTML = res.length
      ? res.slice(0, 6).map(({ product: p }) => `<a class="sr" role="option" href="${productUrl(p)}">${img(p.imgs[0], p.name)}<span><b>${esc(p.name)}</b>${priceHTML(p)}</span></a>`).join('')
        + `<a class="sr-all" href="collection.html?q=${encodeURIComponent(q)}">See all ${res.length} result${res.length === 1 ? '' : 's'} in All Products ${icon('right')}</a>`
      : `<div class="sr-empty"><p class="muted">No toys found for “${esc(q)}”.</p><a class="link" href="collection.html">Browse all products</a></div>`;
    active = -1; open(true);
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 60); });
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (box.hidden) render(); highlight(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
    else if (e.key === 'Escape') { open(false); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); location.href = items()[active].href; }
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim();
    location.href = q ? 'collection.html?q=' + encodeURIComponent(q) : 'collection.html';
  });
  document.addEventListener('click', e => { if (!form.contains(e.target)) open(false); });
}

/* ============ Cart ============ */
const CART_KEY = 'tk-cart-v2';
let cart = {};
try { cart = JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch (e) { cart = {}; }
function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* storage unavailable */ } }
/* gift wrap choice per product in the cart: { id: true } */
const GIFT_KEY = 'tk-gift-v1';
let gifts = {};
try { gifts = JSON.parse(localStorage.getItem(GIFT_KEY)) || {}; } catch (e) { gifts = {}; }
function saveGifts() { try { localStorage.setItem(GIFT_KEY, JSON.stringify(gifts)); } catch (e) { /* storage unavailable */ } }
function giftSet(id, on) { if (on) gifts[id] = true; else delete gifts[id]; saveGifts(); renderCart(); }
function cartAdd(id, qty = 1, open = true, gift) {
  const p = byId(id);
  if (!p || !p.stock) return;
  cart[p.id] = Math.min(99, (cart[p.id] || 0) + qty);
  if (gift !== undefined) { if (gift) gifts[p.id] = true; else delete gifts[p.id]; saveGifts(); }
  saveCart(); renderCart();
  if (open) openLayer($('#cartSheet')); else toast('Added to cart');
}
function cartSet(id, qty) {
  if (qty <= 0) { delete cart[id]; if (gifts[id]) { delete gifts[id]; saveGifts(); } } else cart[id] = Math.min(99, qty);
  saveCart(); renderCart();
}
const qtyHTML = (id, q) => `<div class="qty"><button data-dec="${id}" aria-label="Decrease quantity">${icon('minus')}</button><span>${q}</span><button data-inc="${id}" aria-label="Increase quantity">${icon('plus')}</button></div>`;
function renderCart() {
  const ids = Object.keys(cart).filter(id => byId(id) && cart[id] > 0);
  const count = ids.reduce((s, id) => s + cart[id], 0);
  const badge = $('#cartCount'); badge.textContent = count; badge.hidden = !count;
  const body = $('#cartBody'), foot = $('#cartFoot');
  if (!ids.length) {
    body.innerHTML = `<div class="cart-empty">${icon('bag')}<p>Your cart is empty</p><a class="btn" href="collection.html">Continue shopping</a></div>`;
    foot.hidden = true; return;
  }
  let total = 0, wrap = 0;
  body.innerHTML = ids.map(id => {
    const p = byId(id), q = cart[id]; total += p.price * q;
    if (gifts[id]) wrap += SHIP.giftWrap * q;
    return `<div class="cline">
      <a href="${productUrl(p)}" class="cline-img">${img(p.imgs[0], p.name)}</a>
      <div class="cline-info"><a href="${productUrl(p)}" class="cline-name">${esc(p.name)}</a><span class="muted">${inr(p.price)}</span>
        <div class="cline-row">${qtyHTML(id, q)}<button class="link" data-remove="${id}">Remove</button></div>
        <label class="gift-mini">${icon('gift')}Gift wrap <span class="muted">+${inr(SHIP.giftWrap)}${q > 1 ? ' each' : ''}</span><input type="checkbox" class="switch sm" role="switch" data-gift="${id}" ${gifts[id] ? 'checked' : ''} aria-label="Gift wrap"></label></div>
      <b>${inr(p.price * q)}</b></div>`;
  }).join('');
  foot.hidden = false;
  $('#cartGiftRow').hidden = !wrap;
  $('#cartGift').textContent = inr(wrap);
  $('#cartTotal').textContent = inr(total + wrap);
}

/* ============ Boot (after login state and products have loaded) ============ */
TK_READY.then(() => {
  renderHeader();
  renderFooter();
  renderCart();
  initHeaderSearch();
  /* floating WhatsApp chat button */
  document.body.insertAdjacentHTML('beforeend', `<a class="wa-float" href="${waLink('Hi Toy Kingdom! I have a question.')}" target="_blank" rel="noopener" aria-label="Chat with us on WhatsApp" title="Chat with us on WhatsApp">${icon('whatsapp')}</a>`);
});

document.addEventListener('click', e => {
  const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-remove],[data-search],[data-close],#cartOpen,#navOpen,#scrim');
  if (!t) return;
  const d = t.dataset;
  if (d.add !== undefined) cartAdd(d.add);
  else if (d.inc !== undefined) cartSet(d.inc, (cart[d.inc] || 0) + 1);
  else if (d.dec !== undefined) cartSet(d.dec, (cart[d.dec] || 0) - 1);
  else if (d.remove !== undefined) cartSet(d.remove, 0);
  else if (d.search !== undefined) { closeLayers(); $('#hsInput').focus(); }
  else if (d.close !== undefined || t.id === 'scrim') closeLayers();
  else if (t.id === 'cartOpen') openLayer($('#cartSheet'));
  else if (t.id === 'navOpen') openLayer($('#navSheet'));
});
document.addEventListener('change', e => { const g = e.target.closest('[data-gift]'); if (g) giftSet(g.dataset.gift, g.checked); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLayers(); });
addEventListener('storage', e => {
  if (e.key === GIFT_KEY) { try { gifts = JSON.parse(e.newValue) || {}; } catch (_) { gifts = {}; } renderCart(); }
  if (e.key === CART_KEY) { try { cart = JSON.parse(e.newValue) || {}; } catch (_) { cart = {}; } renderCart(); } });

/* ============ Scroll reveal: content fades and slides up as it scrolls into view ============ */
(function () {
  const SEL = '.sec-head,.card,.tile,.feature,.gallery,.pinfo,.psummary,.accordion,.policy-body,.policy-side,.ccard,.ocard,.page-head,.toolbar';
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const io = new IntersectionObserver(entries => {
    let n = 0;
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      el.style.transitionDelay = Math.min(n++, 5) * 40 + 'ms';     // small stagger for items that appear together
      el.classList.add('rv-in');
      io.unobserve(el);
      setTimeout(() => { el.style.transitionDelay = ''; el.classList.remove('rv', 'rv-in'); el.dataset.rv = '1'; }, 700);   // hand back hover effects
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
  const scan = root => {
    if (!(root instanceof Element)) return;
    const list = root.matches(SEL) ? [root] : [];
    list.push(...root.querySelectorAll(SEL));
    list.forEach(el => {
      if (el.classList.contains('rv') || el.dataset.rv || el.closest('.sheet,.modal,.hs-results,.layer,.admin-grid,.checkout')) return;
      el.classList.add('rv'); io.observe(el);
    });
  };
  const start = () => {
    document.documentElement.classList.add('rv-on');
    scan(document.body);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
