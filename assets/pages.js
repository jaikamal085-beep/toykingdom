'use strict';
/* ============ Page controllers ============ */
const PAGE_INIT = {
  home: initHome,
  all: () => initCollection('all'),
  toys: () => initCollection('toys'),
  product: initProduct,
  contact: initContact,
  account: initAccount,
  checkout: () => initCheckout(),   // defined in assets/checkout.js (loaded only on checkout.html)
  order: () => initOrder(),         // defined in assets/orders.js (loaded only on order.html)
};
TK_READY.then(() => (PAGE_INIT[document.body.dataset.page] || (() => {}))());

/* ---------------- Home ---------------- */
/* when a product was added: Firestore "created" time, else its id (higher id = newer) */
const addedAt = p => p.created || p.id || 0;

/* Round-robin across categories so the picks are varied; within a category,
   biggest discount first, then products with more photos. */
function topPicks(list, n) {
  const byCat = new Map();
  for (const p of list) { const c = p.cats[0] || ''; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(p); }
  for (const arr of byCat.values()) arr.sort((a, b) => (off(b) - off(a)) || (b.imgs.length - a.imgs.length) || (addedAt(b) - addedAt(a)));
  const queues = [...byCat.values()], out = [];
  while (out.length < n && queues.some(q => q.length)) for (const q of queues) if (q.length && out.length < n) out.push(q.shift());
  return out;
}

function initHome() {
  const pick = (re, i) => PRODUCTS.find(p => re.test(p.name) && p.imgs.length) || PRODUCTS[i];
  const slides = [
    { k: 'Toy Kingdom', t: 'Find the Perfect Toy', s: 'Top picks for your little ones — handpicked toys for every age and every budget.', p: pick(/stunt rc car/i, 0), cta: ['Shop all toys', 'collection.html'], v: 'solid' },
    { k: 'Educational toys', t: 'Smiles start here', s: 'Toys that make learning feel like play, from music to art and more.', p: pick(/xylophone/i, 1), cta: ['Shop educational', catUrl('Educational Toys')], v: 'soft' },
    { k: 'Baby & toddler', t: 'Happy little Hearts', s: 'Walkers, rattles and play gyms your little one will love.', p: pick(/activity walker/i, 2), cta: ['Shop fun toys', catUrl('Fun Toys')], v: 'soft' },
    { k: 'Hotwheels & RC', t: 'Pure Happiness', s: 'Die-cast cars, track sets and remote-control racers.', p: pick(/power rocket/i, 3), cta: ['Shop Hotwheels', catUrl('Hotwheels')], v: 'solid' },
  ];
  /* Each home section shows different products:
     New Arrivals -> most recently added; Hotwheels Corner -> Hotwheels not already shown;
     All Products (top picks) -> a mix across categories, best discounts first,
     excluding everything already shown above. */
  const inStock = PRODUCTS.filter(p => p.stock && p.imgs.length);
  const newest = [...inStock].sort((a, b) => addedAt(b) - addedAt(a)).slice(0, 12);
  const shown = new Set(newest.map(p => String(p.id)));
  const isHW = p => p.cats.includes('Hotwheels');
  let hotwheels = inStock.filter(p => isHW(p) && !shown.has(String(p.id)));
  if (hotwheels.length < 4) hotwheels = inStock.filter(isHW);                 // too few left: allow repeats
  hotwheels = hotwheels.slice(0, 12);
  hotwheels.forEach(p => shown.add(String(p.id)));
  const featured = topPicks(inStock.filter(p => !shown.has(String(p.id)) && !isHW(p)), 8);

  $('#main').innerHTML = `
  <section class="hero"><div class="wrap">
    <div class="hero-viewport" id="hero">
      <div class="hero-track" id="heroTrack">${slides.map((s, i) => `
        <div class="hero-slide ${s.v}" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}">
          <div><p class="hero-kicker">${esc(s.k)}</p>
            ${i === 0 ? '<h1>' : '<h2 class="h1like">'}${esc(s.t)}${i === 0 ? '</h1>' : '</h2>'}
            <p class="lead">${esc(s.s)}</p>
            <a class="btn btn-lg ${s.v === 'solid' ? 'btn-white' : ''}" href="${s.cta[1]}" tabindex="${i ? -1 : 0}">${esc(s.cta[0])}${icon('right')}</a></div>
          <a class="hero-pic" href="${productUrl(s.p)}" tabindex="-1">${img(s.p.imgs[0], s.p.name, '', true)}</a>
        </div>`).join('')}
      </div>
      <div class="hero-ctrl" id="heroCtrl">
        <div class="dots" id="heroDots">${slides.map((_, i) => `<button aria-label="Go to slide ${i + 1}" data-i="${i}"></button>`).join('')}</div>
        <div class="hero-arrows"><button class="cbtn" id="heroPrev" aria-label="Previous slide">${icon('left')}</button><button class="cbtn" id="heroNext" aria-label="Next slide">${icon('right')}</button></div>
      </div>
    </div>
  </div></section>

  ${carouselHTML('New Arrivals', 'collection.html?sort=new', newest, 'The latest toys just added to the kingdom')}

  <section class="section"><div class="wrap">
    <div class="sec-head"><div><h2>Our Collections</h2><p class="muted">Shop by category</p></div></div>
    <div class="tiles">${CATEGORIES.map(c => {
      const n = PRODUCTS.filter(p => p.cats.includes(c.name)).length;
      return `<a class="tile" href="${catUrl(c.name)}"><div class="tile-img">${img(c.img, c.name)}</div>
        <div class="tile-foot"><div><h3>${esc(c.name)}</h3><span class="muted">${n} products</span></div>${icon('right')}</div></a>`;
    }).join('')}</div>
  </div></section>

  <section class="section"><div class="wrap">
    <div class="sec-head"><div><h2>All Products</h2><p class="muted">Top picks for your little ones</p></div><a class="link-arrow" href="collection.html">View all ${icon('right')}</a></div>
    <div class="grid">${featured.map(cardHTML).join('')}</div>
    <div class="center"><a class="btn btn-outline btn-lg" href="collection.html">View all ${PRODUCTS.length} products</a></div>
  </div></section>

  ${hotwheels.length ? carouselHTML('Hotwheels Corner', catUrl('Hotwheels'), hotwheels, 'Die-cast cars, track sets and more') : ''}

  <section class="features"><div class="wrap">
    ${[['truck', 'Delivery across India', 'Order online, delivered to your door'],
       ['shield', 'Safe, quality toys', 'Carefully picked for every age'],
       ['tag', 'Great prices', 'Big savings on every collection'],
       ['chat', 'WhatsApp support', SITE.phoneDisplay]].map(([ic, h, p]) =>
      `<div class="feature"><span class="feature-ic">${icon(ic)}</span><div><h3>${h}</h3><p>${esc(p)}</p></div></div>`).join('')}
  </div></section>`;

  /* hero slider */
  const track = $('#heroTrack'), dots = $$('#heroDots button'), hero = $('#hero');
  let idx = 0, timer;
  const go = i => {
    idx = (i + slides.length) % slides.length;
    track.style.transform = `translateX(-${idx * 100}%)`;
    dots.forEach((d, j) => d.classList.toggle('on', j === idx));
    $$('.hero-slide', track).forEach((s, j) => { s.setAttribute('aria-hidden', j !== idx); $$('a', s).forEach(a => (a.tabIndex = j === idx ? 0 : -1)); });
    $('#heroCtrl').style.color = slides[idx].v === 'solid' ? '#fff' : 'var(--primary)';
  };
  const play = () => { clearInterval(timer); timer = setInterval(() => go(idx + 1), 6000); };
  dots.forEach(d => (d.onclick = () => { go(+d.dataset.i); play(); }));
  $('#heroPrev').onclick = () => { go(idx - 1); play(); };
  $('#heroNext').onclick = () => { go(idx + 1); play(); };
  hero.addEventListener('mouseenter', () => clearInterval(timer));
  hero.addEventListener('mouseleave', play);
  let x0 = null;
  hero.addEventListener('touchstart', e => (x0 = e.touches[0].clientX), { passive: true });
  hero.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) { go(idx + (dx < 0 ? 1 : -1)); play(); }
  });
  go(0); play();
  $$('[data-carousel]').forEach(initCarousel);
}

/* ---------------- Collection (All products / Toys and games) ---------------- */
function initCollection(kind) {
  const qs = new URLSearchParams(location.search);
  const scopeCats = kind === 'toys' ? TOYS_AND_GAMES : CATEGORIES.map(c => c.name);
  const base = kind === 'toys' ? PRODUCTS.filter(p => p.cats.some(c => TOYS_AND_GAMES.includes(c))) : PRODUCTS;
  const PER = 24;
  const st = {
    q: qs.get('q') || '',
    cats: qs.getAll('cat').filter(c => scopeCats.includes(c)),
    avail: qs.getAll('avail').filter(a => a === 'in' || a === 'out'),
    min: qs.get('min') || '', max: qs.get('max') || '',
    sort: qs.get('sort') || (qs.get('q') ? 'relevance' : 'featured'),
    page: Math.max(1, parseInt(qs.get('page'), 10) || 1),
  };
  const highest = Math.max(...base.map(p => p.price));
  const crumb = kind === 'toys' ? 'Toys And Games' : 'All Products';
  const heading = kind === 'toys' ? 'Toys And Games' : st.q ? `Results for “${st.q}”` : st.cats.length === 1 ? st.cats[0] : 'All Products';
  const blurb = kind === 'toys'
    ? 'Educational toys, fun toys, RC toys and gadgets — something for every little one.'
    : 'Browse the full Toy Kingdom range of toys, games and collectibles.';
  const count = fn => base.filter(fn).length;
  const SORTS = [...(st.q ? [['relevance', 'Best match']] : []), ['featured', 'Featured'], ['az', 'Alphabetically, A-Z'], ['za', 'Alphabetically, Z-A'], ['low', 'Price, low to high'], ['high', 'Price, high to low'], ['new', 'Date, new to old'], ['old', 'Date, old to new']];
  if (!SORTS.some(s => s[0] === st.sort)) st.sort = 'featured';

  $('#main').innerHTML = `<div class="wrap page">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a>${icon('right')}<span>${crumb}</span></nav>
    <header class="page-head"><h1 id="colTitle">${esc(heading)}</h1><p class="muted">${esc(blurb)}</p></header>
    <div class="toolbar">
      <button class="btn-filter" id="filterOpen">${icon('filter')}<span>Filter and sort</span></button>
      <div class="facets layer" id="facets" role="region" aria-label="Filters">
        <div class="facets-head"><h2>Filter and sort</h2><button class="ibtn" data-close aria-label="Close filters">${icon('close')}</button></div>
        <div class="facets-body">
          <span class="facets-label">Filter:</span>
          <details class="facet"><summary>Availability <span class="n" data-n="avail" hidden></span>${icon('down')}</summary>
            <div class="facet-panel">
              <label class="check"><input type="checkbox" name="avail" value="in"> In stock <span class="muted">${count(p => p.stock)}</span></label>
              <label class="check"><input type="checkbox" name="avail" value="out"> Out of stock <span class="muted">${count(p => !p.stock)}</span></label>
            </div></details>
          <details class="facet"><summary>Price <span class="n" data-n="price" hidden></span>${icon('down')}</summary>
            <div class="facet-panel">
              <p class="small muted">The highest price is ${inr(highest)}</p>
              <div class="price-range">
                <label>₹<input type="number" name="min" min="0" max="${highest}" placeholder="From" inputmode="numeric"></label>
                <label>₹<input type="number" name="max" min="0" max="${highest}" placeholder="To" inputmode="numeric"></label>
              </div>
            </div></details>
          <details class="facet"><summary>Category <span class="n" data-n="cats" hidden></span>${icon('down')}</summary>
            <div class="facet-panel">${scopeCats.map(c => `<label class="check"><input type="checkbox" name="cat" value="${esc(c)}"> ${esc(c)} <span class="muted">${count(p => p.cats.includes(c))}</span></label>`).join('')}</div></details>
          <label class="sort"><span>Sort by:</span><select name="sort" aria-label="Sort by">${SORTS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
        </div>
        <div class="facets-foot"><button class="btn btn-outline" id="facetClear">Clear all</button><button class="btn" data-close>View results</button></div>
      </div>
      <span class="count" id="count" aria-live="polite"></span>
    </div>
    <div class="pills" id="pills"></div>
    <div class="grid" id="grid"></div>
    <nav class="pager" id="pager" aria-label="Pagination"></nav>
  </div>`;

  const F = $('#facets');
  const syncInputs = () => {
    $$('input[name=avail]', F).forEach(i => (i.checked = st.avail.includes(i.value)));
    $$('input[name=cat]', F).forEach(i => (i.checked = st.cats.includes(i.value)));
    $('input[name=min]', F).value = st.min; $('input[name=max]', F).value = st.max;
    $('select[name=sort]', F).value = st.sort;
  };
  const setN = (k, n) => { const el = $(`[data-n=${k}]`, F); el.textContent = n; el.hidden = !n; };

  const SORTERS = {
    az: (a, b) => a.name.localeCompare(b.name), za: (a, b) => b.name.localeCompare(a.name),
    low: (a, b) => a.price - b.price, high: (a, b) => b.price - a.price,
    new: (a, b) => addedAt(b) - addedAt(a), old: (a, b) => addedAt(a) - addedAt(b),
    featured: (a, b) => b.stock - a.stock,
  };

  let rankQ = null, rank = null;                     // hybrid-search ranking for the current query
  function apply(scroll) {
    if (st.q && rankQ !== st.q) { rankQ = st.q; rank = new Map(SEARCH.query(st.q, { limit: 1000 }).map((r, i) => [String(r.id), i])); }
    SORTERS.relevance = (a, b) => rank.get(String(a.id)) - rank.get(String(b.id));
    if (!st.q && st.sort === 'relevance') st.sort = 'featured';
    const min = st.min === '' ? null : +st.min, max = st.max === '' ? null : +st.max;
    const list = base.filter(p =>
      (!st.q || rank.has(String(p.id))) &&
      (!st.cats.length || p.cats.some(c => st.cats.includes(c))) &&
      (st.avail.length !== 1 || (st.avail[0] === 'in') === p.stock) &&
      (min === null || p.price >= min) && (max === null || p.price <= max)
    ).sort(SORTERS[st.sort]);
    const pages = Math.max(1, Math.ceil(list.length / PER));
    st.page = Math.min(st.page, pages);
    const slice = list.slice((st.page - 1) * PER, st.page * PER);

    $('#count').textContent = `${list.length} product${list.length === 1 ? '' : 's'}`;
    $('#grid').innerHTML = slice.length ? slice.map(cardHTML).join('')
      : `<div class="empty"><h3>No products found</h3><p class="muted">Try removing a filter or searching for something else.</p><button class="btn btn-outline" id="emptyClear">Clear all filters</button></div>`;

    /* pagination with ellipsis */
    const nums = [];
    for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - st.page) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
    $('#pager').innerHTML = pages > 1 ? [
      st.page > 1 ? `<button data-p="${st.page - 1}" aria-label="Previous page">${icon('left')}</button>` : '',
      ...nums.map(n => n === '…' ? '<span>…</span>' : `<button data-p="${n}" class="${n === st.page ? 'on' : ''}" ${n === st.page ? 'aria-current="page"' : ''}>${n}</button>`),
      st.page < pages ? `<button data-p="${st.page + 1}" aria-label="Next page">${icon('right')}</button>` : '',
    ].join('') : '';

    /* active filter pills */
    const pills = [];
    if (st.q) pills.push(['q', '', `Search: ${st.q}`]);
    st.avail.forEach(a => pills.push(['avail', a, a === 'in' ? 'In stock' : 'Out of stock']));
    if (min !== null || max !== null) pills.push(['price', '', `${inr(min ?? 0)} – ${inr(max ?? highest)}`]);
    st.cats.forEach(c => pills.push(['cat', c, c]));
    $('#pills').innerHTML = pills.map(([k, v, t]) => `<button class="pill" data-rm="${k}" data-v="${esc(v)}">${esc(t)}${icon('close')}</button>`).join('')
      + (pills.length ? '<button class="pill-clear" id="pillClear">Remove all</button>' : '');

    setN('avail', st.avail.length); setN('cats', st.cats.length); setN('price', min !== null || max !== null ? 1 : 0);

    /* keep URL shareable */
    const u = new URLSearchParams();
    if (st.q) u.set('q', st.q);
    st.cats.forEach(c => u.append('cat', c));
    st.avail.forEach(a => u.append('avail', a));
    if (st.min) u.set('min', st.min);
    if (st.max) u.set('max', st.max);
    if (st.sort !== 'featured') u.set('sort', st.sort);
    if (st.page > 1) u.set('page', st.page);
    const s = u.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
    if (scroll) $('.toolbar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const clearAll = () => { Object.assign(st, { q: '', cats: [], avail: [], min: '', max: '', page: 1 }); syncInputs(); apply(); $('#colTitle').textContent = kind === 'toys' ? 'Toys And Games' : 'All Products'; };

  F.addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'avail') st.avail = $$('input[name=avail]:checked', F).map(i => i.value);
    else if (t.name === 'cat') st.cats = $$('input[name=cat]:checked', F).map(i => i.value);
    else if (t.name === 'sort') st.sort = t.value;
    else return;
    st.page = 1; apply();
  });
  let deb;
  F.addEventListener('input', e => {
    if (e.target.name !== 'min' && e.target.name !== 'max') return;
    st[e.target.name] = e.target.value.replace(/[^\d]/g, '');
    st.page = 1; clearTimeout(deb); deb = setTimeout(() => apply(), 350);
  });
  /* desktop: one dropdown open at a time, close on outside click */
  const desktop = () => matchMedia('(min-width: 861px)').matches;
  F.addEventListener('toggle', e => { if (desktop() && e.target.open) $$('details.facet', F).forEach(d => d !== e.target && (d.open = false)); }, true);
  document.addEventListener('click', e => { if (desktop() && !e.target.closest('.facet')) $$('details.facet[open]', F).forEach(d => (d.open = false)); });

  $('#filterOpen').onclick = () => openLayer(F);
  $('#facetClear').onclick = clearAll;
  $('#pager').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { st.page = +b.dataset.p; apply(true); } });
  $('.page').addEventListener('click', e => {
    if (e.target.closest('#pillClear') || e.target.closest('#emptyClear')) return clearAll();
    const b = e.target.closest('[data-rm]'); if (!b) return;
    const { rm, v } = b.dataset;
    if (rm === 'q') { st.q = ''; $('#colTitle').textContent = kind === 'toys' ? 'Toys And Games' : 'All Products'; }
    if (rm === 'avail') st.avail = st.avail.filter(a => a !== v);
    if (rm === 'cat') st.cats = st.cats.filter(c => c !== v);
    if (rm === 'price') { st.min = ''; st.max = ''; }
    st.page = 1; syncInputs(); apply();
  });

  if (kind === 'toys') document.title = 'Toys And Games – Toy Kingdom';
  else if (st.q) document.title = `Search: ${st.q} – Toy Kingdom`;
  syncInputs(); apply();
}

/* ---------------- Product page ---------------- */
function initProduct() {
  const p = byId(new URLSearchParams(location.search).get('id'));
  const main = $('#main');
  if (!p) {
    main.innerHTML = `<div class="wrap page notfound"><h1>Product not found</h1><p class="muted">This product may have been removed or the link is incorrect.</p><a class="btn" href="collection.html">Browse all products</a></div>`;
    return;
  }
  document.title = `${p.name} – Toy Kingdom`;
  const o = off(p), cat = p.cats[0];
  const related = PRODUCTS.filter(x => x.id !== p.id && x.cats.some(c => p.cats.includes(c))).sort((a, b) => b.stock - a.stock).slice(0, 12);
  const clean = s => String(s || '').replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/^[ \t]+/gm, '').trim();
  const desc = clean(p.desc || p.short) || 'More details about this product are coming soon. Message us on WhatsApp for any questions.';
  const summary = clean(p.short) || (clean(p.desc).split(/\n\s*\n|(?<=[.!?])\s/)[0] || '');

  /* gallery order: first photo, then the video, then the remaining photos */
  const vHtml = p.video ? videoEmbed(p.video) : '';   // only used to check the link is playable
  const media = p.imgs.map((src, n) => ({ type: 'img', src, n: n + 1 }));
  if (vHtml) media.splice(media.length ? 1 : 0, 0, { type: 'video', thumb: videoThumb(p.video) });

  main.innerHTML = `<div class="wrap page">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a>${icon('right')}<a href="${catUrl(cat)}">${esc(cat)}</a>${icon('right')}<span>${esc(p.name)}</span></nav>
    <div class="pdp">
      <div class="gallery">
        <div class="gallery-main" id="gMain">${img(p.imgs[0], p.name, 'gimg', true)}<div class="gvideo" id="gVideo" hidden></div>
          ${media.length > 1 ? `<button class="gnav prev" data-step="-1" aria-label="Previous">${icon('left')}</button><button class="gnav next" data-step="1" aria-label="Next">${icon('right')}</button>` : ''}
          ${!p.stock ? '<span class="badge muted">Sold out</span>' : o ? '<span class="badge">Sale</span>' : ''}</div>
        ${media.length > 1 ? `<div class="thumbs" id="thumbs">${media.map((m, i) => m.type === 'video'
          ? `<button class="thumb vthumb" data-i="${i}" aria-label="Play video">${m.thumb ? img(m.thumb, '') : ''}<span class="vplay">${icon('play')}</span></button>`
          : `<button class="thumb ${i ? '' : 'on'}" data-i="${i}" aria-label="Show photo ${m.n}">${img(m.src, '')}</button>`).join('')}</div>` : ''}
      </div>
      <div class="pinfo">
        <p class="vendor">Toy Kingdom</p>
        <h1>${esc(p.name)}</h1>
        <div class="pprice">${priceHTML(p)}${!p.stock ? '<span class="badge muted">Sold out</span>' : o ? '<span class="badge">Sale</span>' : ''}</div>
        <ul class="plain ship-info">
          <li>${icon('truck')}<span>Delivery in <b>${SHIP.days}</b></span></li>
          <li>${icon('tag')}<span><b>Free Shipping</b> On All Orders Above ₹ ${SHIP.freeAbove}</span></li>
          <li>${icon('receipt')}<span><b>Partial COD</b> on orders above ₹ ${SHIP.codMin}: pay ${SHIP.codAdvancePct}% now, rest on delivery</span></li>
        </ul>
        <p class="stock ${p.stock ? 'in' : 'out'}">${icon(p.stock ? 'check' : 'close')}${p.stock ? 'In stock, ready to ship' : 'Currently out of stock'}</p>
        <div class="buy">
          <label for="qty">Quantity</label>
          <div class="qty qty-lg"><button id="qDec" aria-label="Decrease quantity">${icon('minus')}</button><input id="qty" type="number" min="1" max="99" value="1" inputmode="numeric"><button id="qInc" aria-label="Increase quantity">${icon('plus')}</button></div>
          <button class="btn btn-outline btn-lg btn-block" id="pdpAdd" ${p.stock ? '' : 'disabled'}>${p.stock ? 'Add to cart' : 'Sold out'}</button>
          <a class="btn btn-lg btn-block" id="pdpBuy" ${p.stock ? '' : 'aria-disabled="true"'}>Buy it now</a>
        </div>
        ${summary ? `<div class="psummary"><h2>Summary</h2><p>${esc(summary)}</p></div>` : ''}
        <div class="accordion">
          <details open><summary>Description ${icon('down')}</summary><div class="acc-body">${esc(desc)}</div></details>
          <details><summary>Shipping &amp; returns ${icon('down')}</summary><div class="acc-body">Delivery in ${SHIP.days}. Free shipping on all orders above ₹${SHIP.freeAbove}.
Partial cash on delivery on orders above ₹${SHIP.codMin}: pay ${SHIP.codAdvancePct}% online when you order and the rest in cash when it arrives.
For returns and refunds, please read our <a href="${SITE.refund}">Returns &amp; Refund Policy</a>.</div></details>
          <details><summary>Need help? ${icon('down')}</summary><div class="acc-body">Call <a href="tel:+${SITE.wa}">${SITE.phoneDisplay}</a> or <a href="https://wa.me/${SITE.wa}" target="_blank" rel="noopener">chat with us on WhatsApp</a>.
${SITE.hours}</div></details>
        </div>
        <button class="share" id="share">${icon('link')}<span>Copy link</span></button>
      </div>
    </div>
  </div>
  ${related.length ? carouselHTML('You may also like', catUrl(cat), related) : ''}
  <div class="mbar" id="mbar">${priceHTML(p)}<button class="btn" id="mbarAdd" ${p.stock ? '' : 'disabled'}>${p.stock ? 'Add to cart' : 'Sold out'}</button></div>`;

  /* gallery */
  const mainImg = $('#gMain .gimg'), gVideo = $('#gVideo');
  let cur = 0;
  const show = i => {
    if (!media.length) return;
    cur = (i + media.length) % media.length;
    const m = media[cur];
    if (m.type === 'video') {
      if (!gVideo.innerHTML) gVideo.innerHTML = videoEmbed(p.video, { autoplay: true });   // load the player only when opened
      mainImg.hidden = true; gVideo.hidden = false;
      const v = $('video', gVideo);
      if (v) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });   // browsers may require muted autoplay
    } else {
      const v = $('video', gVideo);
      if (v) v.pause();
      else gVideo.innerHTML = '';                                 // embedded players (YouTube etc.) stop by unloading
      gVideo.hidden = true; mainImg.hidden = false;
      mainImg.src = cld(m.src, 'f_auto,q_auto,c_limit,w_1000');
    }
    $$('.thumb').forEach((t, j) => t.classList.toggle('on', j === cur));
    /* keep the active thumbnail visible by scrolling only the thumbnail strip sideways
       (scrollIntoView would also scroll the whole page) */
    const strip = $('#thumbs'), t = $$('.thumb')[cur];
    if (strip && t) {
      const left = t.offsetLeft, right = left + t.offsetWidth;      // .thumbs is position:relative
      if (left < strip.scrollLeft) strip.scrollTo({ left, behavior: 'smooth' });
      else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: right - strip.clientWidth, behavior: 'smooth' });
    }
  };
  if ($('#thumbs')) $('#thumbs').addEventListener('click', e => { const t = e.target.closest('.thumb'); if (t) show(+t.dataset.i); });
  $('#gMain').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) show(cur + +b.dataset.step); });
  let x0 = null;
  $('#gMain').addEventListener('touchstart', e => (x0 = e.touches[0].clientX), { passive: true });
  $('#gMain').addEventListener('touchend', e => {
    if (x0 === null || media.length < 2 || media[cur].type === 'video') return;   // don't hijack swipes on the video controls
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) show(cur + (dx < 0 ? 1 : -1));
  });

  /* quantity + buy */
  const qty = $('#qty');
  const getQ = () => Math.min(99, Math.max(1, parseInt(qty.value, 10) || 1));
  const updBuy = () => { $('#pdpBuy').href = `checkout.html?buy=${encodeURIComponent(p.id)}&qty=${getQ()}`; };
  $('#qDec').onclick = () => { qty.value = Math.max(1, getQ() - 1); updBuy(); };
  $('#qInc').onclick = () => { qty.value = Math.min(99, getQ() + 1); updBuy(); };
  qty.addEventListener('change', () => { qty.value = getQ(); updBuy(); });
  updBuy();
  $('#pdpAdd').onclick = () => cartAdd(p.id, getQ());
  $('#mbarAdd').onclick = () => cartAdd(p.id, getQ());
  $('#share').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Link copied'); }
    catch (e) { prompt('Copy this link:', location.href); }
  };
  /* sticky mobile add-to-cart bar once the main button scrolls away */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => $('#mbar').classList.toggle('show', !en.isIntersecting && en.boundingClientRect.top < 0))
      .observe($('#pdpAdd'));
  }
  $$('[data-carousel]').forEach(initCarousel);
}

/* ---------------- Contact ---------------- */
function initContact() {
  const card = (ic, h, body) => `<div class="ccard"><span class="feature-ic">${icon(ic)}</span><h3>${h}</h3>${body}</div>`;
  $('#main').innerHTML = `<div class="wrap page">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a>${icon('right')}<span>Contact</span></nav>
    <header class="page-head"><h1>Contact</h1><p class="muted">Questions about a toy, an order or a gift idea? We're happy to help.</p></header>
    <div class="contact-cards">
      ${card('phone', 'Call us', `<a href="tel:+${SITE.wa}">${SITE.phoneDisplay}</a>`)}
      ${card('whatsapp', 'WhatsApp', `<a href="https://wa.me/${SITE.wa}" target="_blank" rel="noopener">Chat with us</a>`)}
      ${card('mail', 'Email', `<a href="mailto:${SITE.email}">${SITE.email}</a>`)}
      ${card('clock', 'Store hours', `<p>${SITE.hours}</p>`)}
    </div>
    <div class="contact-grid">
      <div class="panel">
        <h2>Send us a message</h2>
        <form class="cform" id="cform" novalidate>
          <div class="frow">
            <div class="field"><label for="cName">Name</label><input id="cName" name="name" autocomplete="name"></div>
            <div class="field"><label for="cEmail">Email <span class="req">*</span></label><input id="cEmail" name="email" type="email" autocomplete="email" required></div>
          </div>
          <div class="field"><label for="cPhone">Phone number</label><input id="cPhone" name="phone" type="tel" autocomplete="tel" inputmode="tel"></div>
          <div class="field"><label for="cMsg">Comment <span class="req">*</span></label><textarea id="cMsg" name="comment" rows="5" required></textarea></div>
          <p class="form-msg" id="formMsg" role="status"></p>
          <button class="btn btn-lg" type="submit">Send</button>
          <p class="small muted">Your message opens in WhatsApp so it reaches us right away.</p>
        </form>
      </div>
      <aside class="panel">
        <h2>Find us</h2>
        <ul class="plain info-list">
          <li>${icon('pin')}<span>Visit our store<br><a href="${SITE.map}" target="_blank" rel="noopener">Open in Google Maps</a></span></li>
          <li>${icon('clock')}<span>${SITE.hours}</span></li>
          <li>${icon('receipt')}<span>GSTIN: ${SITE.gst}</span></li>
          <li>${icon('chat')}<span>Follow us for new arrivals</span></li>
        </ul>
        <div style="margin-top:14px">${socialLinks()}</div>
      </aside>
    </div>
  </div>`;

  const form = $('#cform'), msg = $('#formMsg');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    $$('.field', form).forEach(x => x.classList.remove('err'));
    const bad = [];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) bad.push('email');
    if (!f.comment.trim()) bad.push('comment');
    if (bad.length) {
      bad.forEach(n => form.elements[n].closest('.field').classList.add('err'));
      msg.className = 'form-msg bad';
      msg.textContent = bad.includes('email') ? 'Please enter a valid email address.' : 'Please write a message.';
      form.elements[bad[0]].focus();
      return;
    }
    const text = `Hi Toy Kingdom! New message from the website:\nName: ${f.name || '-'}\nEmail: ${f.email}\nPhone: ${f.phone || '-'}\n\n${f.comment}`;
    window.open(waLink(text), '_blank', 'noopener');
    msg.className = 'form-msg ok';
    msg.textContent = 'Thanks! WhatsApp has opened with your message — just tap send.';
    form.reset();
  });
}

/* ---------------- Account: log in / create account ---------------- */
/* Google "G" mark (official colours, as required by Google's sign-in branding) */
const GOOGLE_G = `<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

function initAccount() {
  const qs = new URLSearchParams(location.search);
  const rawNext = qs.get('next') || '';
  /* only same-site pages, optionally with a simple query string (e.g. checkout.html?buy=12&qty=2) */
  const next = /^[a-z-]+\.html(\?[\w=&%.-]*)?$/i.test(rawNext) ? rawNext : '';
  const main = $('#main');

  const pwField = (id, label, auto) => `<div class="field"><label for="${id}">${label} <span class="req">*</span></label>
    <div class="pw"><input id="${id}" name="password" type="password" autocomplete="${auto}" required>
    <button type="button" class="pw-toggle" data-pw="${id}" aria-label="Show password">Show</button></div></div>`;

  function renderSignedIn(s) {
    main.innerHTML = `<div class="wrap page auth-page">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a>${icon('right')}<span>Account</span></nav>
      <div class="panel auth-card">
        <span class="feature-ic">${icon('user')}</span>
        <h1>Hello, ${esc(s.name)}</h1>
        <p class="muted">Signed in as <b>${esc(s.email)}</b>${s.role === 'admin' ? ' <span class="badge">Admin</span>' : ''}</p>
        ${s.adminEmail && !s.verified ? `<div class="note verify-box">
          <p><b>Verify your admin email to unlock the admin page.</b></p>
          <p class="small">1. Click <b>Send verification email</b>. 2. Open the email sent to ${esc(s.email)} and click the link (check Spam too). 3. Come back and click <b>I've verified</b>.</p>
          <div class="verify-actions"><button class="btn" id="sendVerify">Send verification email</button>
          <button class="btn btn-outline" id="checkVerify">I've verified</button></div>
          <p class="form-msg" id="verifyMsg" role="status"></p></div>`
        : next === 'admin.html' && s.role !== 'admin' ? '<p class="form-msg bad">This account does not have access to the admin page.</p>' : ''}
        <div class="auth-actions">
          ${s.role === 'admin' ? '<a class="btn btn-lg btn-block" href="admin.html">Go to admin dashboard</a>' : ''}
          <a class="btn ${s.role === 'admin' ? 'btn-outline' : ''} btn-lg btn-block" href="collection.html">Continue shopping</a>
          <button class="btn btn-outline btn-block" id="logout">Log out</button>
        </div>
      </div>
      <section class="panel my-orders"><h2>My orders</h2><div id="myOrders"><p class="muted small">Loading your orders…</p></div></section>
      </div>`;
    $('#logout').onclick = async () => { await Auth.logout(); location.href = 'account.html'; };
    Orders.mine().then(list => {
      $('#myOrders').innerHTML = list.length ? `<ul class="plain order-list">${list.map(o => `<li>
          <div><b>${esc(o.id)}</b><span class="muted small">${fmtDate(o.created)} · ${o.items.reduce((n, i) => n + i.qty, 0)} item(s) · ${inr(o.total)}${o.payment.mode === 'cod' ? ' · Partial COD' : ''}</span></div>
          <div class="row-actions"><a class="link" href="order.html?id=${encodeURIComponent(o.id)}">View</a><a class="link" href="invoice.html?id=${encodeURIComponent(o.id)}" target="_blank" rel="noopener">Bill</a></div></li>`).join('')}</ul>`
        : '<p class="muted small">No orders yet.</p>';
    }).catch(err => { $('#myOrders').innerHTML = `<p class="form-msg bad">${esc(err.message)}</p>`; });
    if (s.adminEmail && !s.verified) {
      const vmsg = $('#verifyMsg');
      const say = (cls, text) => { vmsg.className = 'form-msg ' + cls; vmsg.textContent = text; };
      $('#sendVerify').onclick = async e => {
        e.target.disabled = true;
        try { await Auth.sendVerification(); say('ok', `Email sent to ${s.email}. Open it and click the link.`); }
        catch (err) { say('bad', err.message); }
        e.target.disabled = false;
      };
      $('#checkVerify').onclick = async e => {
        e.target.disabled = true;
        try {
          const now = await Auth.refresh();
          if (now && now.role === 'admin') { location.href = 'admin.html'; return; }
          say('bad', 'Not verified yet. Click the link in the email first, then try again.');
        } catch (err) { say('bad', err.message); }
        e.target.disabled = false;
      };
    }
  }

  function renderForms(tab) {
    main.innerHTML = `<div class="wrap page auth-page">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a>${icon('right')}<span>Account</span></nav>
      <div class="panel auth-card">
        <div class="tabs" role="tablist">
          <button role="tab" class="tab" data-tab="login" aria-selected="${tab === 'login'}">Log in</button>
          <button role="tab" class="tab" data-tab="register" aria-selected="${tab === 'register'}">Create account</button>
        </div>
        ${next === 'admin.html' ? '<p class="note">Please log in with the admin account to open the admin page.</p>' : ''}
        ${next.startsWith('checkout.html') ? '<p class="note">Please log in or create an account to place your order. Your cart is saved.</p>' : ''}
        <div class="social-login">
          <button type="button" class="btn-google" id="googleBtn">${GOOGLE_G}<span>Continue with Google</span></button>
          <p class="form-msg" id="googleMsg" role="status"></p>
          <div class="or"><span>or use your email</span></div>
        </div>
        <form class="cform" id="loginForm" ${tab === 'login' ? '' : 'hidden'} novalidate>
          <div class="field"><label for="lEmail">Email <span class="req">*</span></label><input id="lEmail" name="email" type="email" autocomplete="email" required></div>
          ${pwField('lPass', 'Password', 'current-password')}
          <p class="form-msg" role="status"></p>
          <button class="btn btn-lg btn-block" type="submit">Log in</button>
          <p class="small center-text"><button type="button" class="link" id="forgotPw">Forgot password?</button></p>
          <p class="small muted center-text">New here? <button type="button" class="link" data-tab="register">Create an account</button></p>
        </form>
        <form class="cform" id="registerForm" ${tab === 'register' ? '' : 'hidden'} novalidate>
          <div class="field"><label for="rName">Full name <span class="req">*</span></label><input id="rName" name="name" autocomplete="name" required></div>
          <div class="field"><label for="rEmail">Email <span class="req">*</span></label><input id="rEmail" name="email" type="email" autocomplete="email" required></div>
          ${pwField('rPass', 'Password', 'new-password')}
          <div class="field"><label for="rPass2">Confirm password <span class="req">*</span></label><input id="rPass2" name="password2" type="password" autocomplete="new-password" required></div>
          <p class="small muted">At least 6 characters.</p>
          <p class="form-msg" role="status"></p>
          <button class="btn btn-lg btn-block" type="submit">Create account</button>
          <p class="small muted center-text">Already have an account? <button type="button" class="link" data-tab="login">Log in</button></p>
        </form>
      </div></div>`;

    main.addEventListener('click', e => {
      const t = e.target.closest('[data-tab]');
      if (t) {
        const k = t.dataset.tab;
        $$('.tab', main).forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
        $('#loginForm').hidden = k !== 'login';
        $('#registerForm').hidden = k !== 'register';
        return;
      }
      const pw = e.target.closest('[data-pw]');
      if (pw) {
        const inp = $('#' + pw.dataset.pw), show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        pw.textContent = show ? 'Hide' : 'Show';
        pw.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      }
    });

    const goOn = s => {
      if (next && (next !== 'admin.html' || s.role === 'admin')) location.href = next;
      else location.href = s.role === 'admin' ? 'admin.html' : 'account.html';
    };

    /* Google */
    const gMsg = $('#googleMsg');
    if (window.__tkRedirectError) { gMsg.className = 'form-msg bad'; gMsg.textContent = Auth._err(window.__tkRedirectError).message; }
    $('#googleBtn').onclick = async e => {
      const b = e.currentTarget; b.disabled = true;
      gMsg.className = 'form-msg'; gMsg.textContent = '';
      try {
        const s = await Auth.google();
        if (s) { goOn(s); return; }
      } catch (err) { gMsg.className = 'form-msg bad'; gMsg.textContent = err.message; }
      b.disabled = false;
    };

    const handle = (form, fn) => form.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('.form-msg', form), btn = $('button[type=submit]', form);
      msg.className = 'form-msg'; msg.textContent = '';
      btn.disabled = true;
      try {
        goOn(await fn(Object.fromEntries(new FormData(form))));
      } catch (err) {
        msg.className = 'form-msg bad';
        msg.textContent = err.message || 'Something went wrong.';
        btn.disabled = false;
      }
    });
    handle($('#loginForm'), f => Auth.login(f.email, f.password));
    $('#forgotPw').onclick = async () => {
      const msg = $('.form-msg', $('#loginForm'));
      try {
        await Auth.resetPassword($('#lEmail').value);
        msg.className = 'form-msg ok'; msg.textContent = 'Password reset email sent. Check your inbox (and Spam).';
      } catch (err) { msg.className = 'form-msg bad'; msg.textContent = err.message; }
    };
    handle($('#registerForm'), async f => {
      if (f.password !== f.password2) throw new Error('Passwords do not match.');
      return Auth.register(f.name, f.email, f.password);
    });
  }

  const s = Auth.current();
  if (s && next && next !== 'admin.html') { location.replace(next); return; }   // already logged in: continue
  if (s) (typeof renderAccountDashboard === 'function' ? renderAccountDashboard(s) : renderSignedIn(s));   // dashboard: assets/account.js
  else renderForms(qs.get('tab') === 'register' ? 'register' : 'login');
  document.title = (s ? 'My account' : 'Log in') + ' – Toy Kingdom';
}
