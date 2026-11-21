'use strict';
/* ============ Admin dashboard (verified admin account only) ============
   The real protection is the Firestore security rules; this check only
   decides what the page shows. */
const MAX_IMAGES = 4;

TK_READY.then(function initAdmin() {
  if (!Auth.isAdmin()) { location.replace('account.html?next=admin.html'); return; }
  document.documentElement.style.visibility = '';
  const session = Auth.current();
  const main = $('#main');
  const CAT_NAMES = CATEGORIES.map(c => c.name);
  let editingId = null;
  let uploading = 0;                       // uploads in progress (blocks saving)

  const isUrl = s => /^https?:\/\/\S+$/i.test(String(s || '').trim());
  const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';

  main.innerHTML = `<div class="wrap page admin">
    <div class="admin-top">
      <div><p class="vendor">Admin dashboard</p><h1>Products</h1>
        <p class="muted small">Signed in as <b>${esc(session.email)}</b> · saved to Firebase</p></div>
      <div class="admin-top-actions">
        <button class="btn btn-outline" id="exportBtn">${icon('receipt')}Export JSON</button>
        <button class="btn btn-outline" id="logoutBtn">Log out</button>
      </div>
    </div>

    <section class="panel admin-orders">
      <div class="panel-head"><h2>Orders</h2><button class="link" id="ordersRefresh" type="button">Refresh</button></div>
      <div id="ordersBox"><p class="muted small">Loading orders…</p></div>
    </section>
    <div id="importBox"></div>
    <div id="legacy"></div>
    <div class="stats" id="stats"></div>

    <div class="admin-grid">
      <section class="panel">
        <div class="panel-head"><h2 id="formTitle">Add a product</h2><button class="link" id="resetBtn" type="button">Clear form</button></div>
        <form class="cform" id="pForm" novalidate>
          <div class="field"><label for="fName">Product name <span class="req">*</span></label><input id="fName" name="name" maxlength="160" required></div>

          <div class="frow">
            <div class="field"><label for="fCat">Category <span class="req">*</span></label>
              <select id="fCat" name="cat" class="select">${CAT_NAMES.map(c => `<option>${esc(c)}</option>`).join('')}<option value="__other">Other…</option></select></div>
            <div class="field" id="otherCatWrap" hidden><label for="fCatOther">New category name <span class="req">*</span></label><input id="fCatOther" name="catOther" maxlength="40"></div>
            <div class="field"><label for="fSku">SKU / code</label><input id="fSku" name="sku" maxlength="40"></div>
          </div>

          <div class="frow">
            <div class="field"><label for="fPrice">Selling price (₹) <span class="req">*</span></label><input id="fPrice" name="price" type="number" min="1" step="1" inputmode="numeric" required></div>
            <div class="field"><label for="fMrp">Original price / MRP (₹)</label><input id="fMrp" name="mrp" type="number" min="1" step="1" inputmode="numeric" placeholder="Shows as struck-through"></div>
          </div>

          <div class="frow">
            <div class="field"><label for="fStock">Availability</label>
              <select id="fStock" name="stock" class="select"><option value="1">In stock</option><option value="0">Out of stock</option></select></div>
            <div class="field"><label for="fQty">Quantity available</label><input id="fQty" name="qty" type="number" min="0" step="1" inputmode="numeric" placeholder="Optional"></div>
          </div>

          <div class="field"><label for="fShort">Short description</label><input id="fShort" name="short" maxlength="200" placeholder="One line shown in previews"></div>
          <div class="field"><label for="fDesc">Full description</label><textarea id="fDesc" name="desc" rows="6" maxlength="5000" placeholder="Features, age group, what's in the box…"></textarea></div>

          <fieldset class="field">
            <legend>Photos (up to ${MAX_IMAGES}) <span class="req">*</span></legend>
            <p class="small muted">Upload from your computer or phone, or paste a link. The first photo is the main photo. JPG, PNG or WebP, max 10 MB each.</p>
            <div id="imgList" class="img-list"></div>
            <div class="upload-actions">
              <button type="button" class="btn" id="uploadImgBtn">${icon('plus')}Upload photos</button>
              <button type="button" class="btn btn-outline" id="addImg">Paste a link instead</button>
              <input type="file" id="imgFile" accept="image/jpeg,image/png,image/webp" multiple hidden>
            </div>
          </fieldset>

          <fieldset class="field">
            <legend>Video (optional)</legend>
            <p class="small muted">Upload one short MP4 (max 100 MB; under 25 MB loads fastest), or paste a YouTube / video link.</p>
            <input id="fVideo" name="video" type="url" placeholder="Video link, filled in automatically after upload" aria-label="Video link">
            <div class="upload-actions">
              <button type="button" class="btn" id="uploadVidBtn">${icon('plus')}Upload video</button>
              <button type="button" class="btn btn-outline" id="clearVid" hidden>Remove video</button>
              <input type="file" id="vidFile" accept="video/mp4,video/quicktime,video/webm,video/*" hidden>
            </div>
            <div class="upload-progress" id="vidProgress" hidden><div class="bar"><span></span></div><p class="small muted"></p></div>
            <div class="video-preview" id="videoPreview" hidden></div>
          </fieldset>

          <p class="form-msg" id="formMsg" role="status"></p>
          <div class="form-actions">
            <button class="btn btn-lg" type="submit" id="saveBtn">Save product</button>
            <button class="btn btn-outline btn-lg" type="button" id="cancelEdit" hidden>Cancel editing</button>
          </div>
        </form>
      </section>

      <aside class="admin-side">
        <div class="panel"><h2>Live preview</h2><div id="preview" class="preview"></div></div>
      </aside>
    </div>

    <section class="panel admin-list">
      <div class="panel-head"><h2>Products in Firebase</h2>
        <label class="search-field mini">${icon('search')}<input id="listSearch" type="search" placeholder="Search products" aria-label="Search products"></label></div>
      <div id="list"></div>
    </section>
  </div>`;

  const form = $('#pForm'), msg = $('#formMsg');
  const say = (cls, html) => { msg.className = 'form-msg ' + cls; msg.innerHTML = html; };

  /* ---------- photo rows ---------- */
  const imgRows = () => $$('#imgList .img-row');
  const filledRows = () => imgRows().filter(r => $('input', r).value.trim() || r.classList.contains('is-uploading'));
  function addImgRow(val = '') {
    const row = document.createElement('div');
    row.className = 'img-row';
    row.innerHTML = `<div class="img-thumb">${val ? img(val, '') : ''}</div>
      <input type="url" name="img" placeholder="https://…/photo.jpg" value="${esc(val)}" aria-label="Photo link">
      <button type="button" class="ibtn" data-rmimg aria-label="Remove photo">${icon('close')}</button>`;
    $('#imgList').append(row);
    return row;
  }
  function freeSlots() { return MAX_IMAGES - filledRows().length; }
  function emptyRow() { return imgRows().find(r => !$('input', r).value.trim() && !r.classList.contains('is-uploading')); }
  function updateImgButtons() {
    const full = freeSlots() <= 0;
    $('#uploadImgBtn').disabled = full;
    $('#addImg').disabled = full || !!emptyRow();
  }

  $('#addImg').onclick = () => { if (freeSlots() > 0) { $('input', emptyRow() || addImgRow()).focus(); updateImgButtons(); } };
  $('#uploadImgBtn').onclick = () => $('#imgFile').click();
  $('#imgFile').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    const room = freeSlots();
    if (files.length > room) say('bad', `Only ${room} more photo${room === 1 ? '' : 's'} allowed (max ${MAX_IMAGES}). Uploading the first ${room}.`);
    await Promise.all(files.slice(0, Math.max(0, room)).map(uploadPhoto));
    updateImgButtons(); refresh();
  });

  async function uploadPhoto(file) {
    const row = emptyRow() || addImgRow();
    const input = $('input', row), thumb = $('.img-thumb', row);
    row.classList.add('is-uploading');
    input.value = ''; input.placeholder = `Uploading ${file.name}… 0%`; input.readOnly = true;
    const local = URL.createObjectURL(file);
    thumb.innerHTML = `<img src="${local}" alt="">`;
    uploading++; updateImgButtons();
    try {
      input.placeholder = `Optimising ${file.name}…`;
      const small = await compressImage(file);
      const saved = small !== file ? ` (${mb(file.size)} → ${mb(small.size)})` : '';
      const r = await cloudinaryUpload(small, 'image', p => { input.placeholder = `Uploading ${file.name}${saved}… ${Math.round(p * 100)}%`; });
      input.value = r.secure_url;
      thumb.innerHTML = img(r.secure_url, '');
    } catch (err) {
      row.remove();
      say('bad', esc(err.message));
    } finally {
      URL.revokeObjectURL(local);
      row.classList.remove('is-uploading'); input.readOnly = false; input.placeholder = 'https://…/photo.jpg';
      uploading--;
      if (!imgRows().length) addImgRow();
      updateImgButtons(); refresh();
    }
  }

  $('#imgList').addEventListener('click', e => {
    const b = e.target.closest('[data-rmimg]'); if (!b) return;
    const row = b.closest('.img-row');
    if (row.classList.contains('is-uploading')) return;
    if (imgRows().length > 1) row.remove(); else { $('input', row).value = ''; $('.img-thumb', row).innerHTML = ''; }
    updateImgButtons(); refresh();
  });
  $('#imgList').addEventListener('input', e => {
    if (e.target.name !== 'img') return;
    const v = e.target.value.trim(), th = $('.img-thumb', e.target.closest('.img-row'));
    th.innerHTML = isUrl(v) ? img(v, '') : '';
    updateImgButtons();
  });

  /* ---------- category "Other" ---------- */
  $('#fCat').addEventListener('change', () => { $('#otherCatWrap').hidden = $('#fCat').value !== '__other'; });

  /* ---------- video ---------- */
  function showVideo() {
    const v = $('#fVideo').value.trim(), box = $('#videoPreview'), html = isUrl(v) ? videoEmbed(v) : '';
    box.hidden = !html; box.innerHTML = html;
    $('#clearVid').hidden = !v;
  }
  $('#fVideo').addEventListener('input', showVideo);
  $('#clearVid').onclick = () => { $('#fVideo').value = ''; showVideo(); refresh(); };
  $('#uploadVidBtn').onclick = () => $('#vidFile').click();
  $('#vidFile').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const prog = $('#vidProgress'), bar = $('.bar span', prog), label = $('p', prog), btn = $('#uploadVidBtn');
    prog.hidden = false; btn.disabled = true; uploading++;
    const set = p => { bar.style.width = Math.round(p * 100) + '%'; label.textContent = `Uploading ${file.name} (${mb(file.size)})… ${Math.round(p * 100)}%`; };
    set(0);
    try {
      const r = await cloudinaryUpload(file, 'video', set);
      $('#fVideo').value = r.secure_url; showVideo(); refresh();
      label.textContent = `Uploaded ${file.name}${r.duration ? ` · ${Math.round(r.duration)} s` : ''}. Remember to save the product.`;
    } catch (err) {
      prog.hidden = true; say('bad', esc(err.message));
    } finally { btn.disabled = false; uploading--; }
  });

  /* ---------- read form ---------- */
  function readForm() {
    const f = new FormData(form);
    const cat = f.get('cat') === '__other' ? String(f.get('catOther') || '').trim() : f.get('cat');
    const price = Math.round(+f.get('price') || 0);
    const mrpRaw = Math.round(+f.get('mrp') || 0);
    const qty = f.get('qty') === '' ? null : Math.max(0, Math.round(+f.get('qty')));
    return {
      name: String(f.get('name') || '').trim(),
      cats: cat ? [cat] : [],
      sku: String(f.get('sku') || '').trim(),
      price, mrp: Math.max(price, mrpRaw || price),
      stock: f.get('stock') === '1' && qty !== 0,
      qty,
      short: String(f.get('short') || '').trim(),
      desc: String(f.get('desc') || '').trim(),
      imgs: f.getAll('img').map(s => String(s).trim()).filter(Boolean),   // older products may have 5; uploads are capped at MAX_IMAGES
      video: String(f.get('video') || '').trim(),
    };
  }
  function validate(p) {
    const errs = [];
    if (uploading) errs.push([null, 'Please wait for the uploads to finish.']);
    if (!p.name) errs.push(['fName', 'Please enter a product name.']);
    if (!p.cats.length) errs.push(['fCatOther', 'Please enter the new category name.']);
    if (!(p.price > 0)) errs.push(['fPrice', 'Please enter a selling price above ₹0.']);
    const mrpIn = +$('#fMrp').value;
    if (mrpIn && mrpIn < p.price) errs.push(['fMrp', 'MRP should be equal to or higher than the selling price.']);
    if (!p.imgs.length) errs.push([null, 'Please add at least one photo.']);
    else if (p.imgs.some(u => !isUrl(u))) errs.push([null, 'Each photo link must start with http:// or https://']);
    if (p.video && !isUrl(p.video)) errs.push(['fVideo', 'The video link must start with http:// or https://']);
    return errs;
  }

  /* ---------- live preview ---------- */
  function refresh() {
    const p = readForm();
    const demo = { ...p, id: 'preview', name: p.name || 'Product name', price: p.price || 0, mrp: p.mrp || 0, cats: p.cats.length ? p.cats : ['Category'], imgs: p.imgs.filter(isUrl).length ? p.imgs.filter(isUrl) : [PLACEHOLDER] };
    $('#preview').innerHTML = cardHTML(demo);
    $$('#preview a, #preview button').forEach(el => { el.setAttribute('tabindex', '-1'); el.removeAttribute('data-add'); el.addEventListener('click', e => e.preventDefault()); });
  }
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);

  /* ---------- fill / reset ---------- */
  function fill(p) {
    form.reset();
    $('#fName').value = p.name || '';
    const cat = (p.cats && p.cats[0]) || CAT_NAMES[0];
    if (CAT_NAMES.includes(cat)) { $('#fCat').value = cat; $('#otherCatWrap').hidden = true; }
    else { $('#fCat').value = '__other'; $('#otherCatWrap').hidden = false; $('#fCatOther').value = cat; }
    $('#fSku').value = p.sku || '';
    $('#fPrice').value = p.price || '';
    $('#fMrp').value = p.mrp && p.mrp !== p.price ? p.mrp : '';
    $('#fStock').value = p.stock ? '1' : '0';
    $('#fQty').value = p.qty ?? '';
    $('#fShort').value = p.short || '';
    $('#fDesc').value = p.desc || '';
    $('#imgList').innerHTML = '';
    ((p.imgs && p.imgs.length) ? p.imgs : ['']).forEach(addImgRow);
    $('#fVideo').value = p.video || '';
    $('#vidProgress').hidden = true;
    showVideo(); updateImgButtons(); refresh();
  }
  function resetForm() {
    editingId = null;
    fill({ stock: true });
    $('#formTitle').textContent = 'Add a product';
    $('#saveBtn').textContent = 'Save product';
    $('#cancelEdit').hidden = true;
    $$('.field.err', form).forEach(x => x.classList.remove('err'));
    msg.className = 'form-msg'; msg.textContent = '';
  }
  $('#resetBtn').onclick = resetForm;
  $('#cancelEdit').onclick = resetForm;

  /* ---------- save ---------- */
  form.addEventListener('submit', async e => {
    e.preventDefault();
    $$('.field.err', form).forEach(x => x.classList.remove('err'));
    const p = readForm();
    const errs = validate(p);
    if (errs.length) {
      errs.forEach(([id]) => id && $('#' + id)?.closest('.field')?.classList.add('err'));
      say('bad', esc(errs[0][1]));
      const first = errs.find(x => x[0]); if (first) $('#' + first[0]).focus();
      return;
    }
    const btn = $('#saveBtn'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const wasEdit = !!editingId;
      const saved = await ProductStore.save(editingId ? { ...p, id: editingId } : p);
      renderList(); renderStats();
      resetForm();
      say('ok', `${wasEdit ? 'Changes saved' : 'Product added'}. <a class="link" href="${productUrl(saved)}" target="_blank" rel="noopener">View it in the store</a>`);
    } catch (err) {
      say('bad', esc(err.message));
      btn.textContent = label;
    } finally { btn.disabled = false; }
  });

  /* ---------- list ---------- */
  function renderStats() {
    const inFb = ProductStore.all();
    $('#stats').innerHTML = [
      ['Total in store', PRODUCTS.length], ['In Firebase', inFb.length],
      ['Added by you', inFb.filter(p => p.custom).length], ['With video', PRODUCTS.filter(p => p.video).length],
    ].map(([k, v]) => `<div class="stat"><span class="muted small">${k}</span><b>${v}</b></div>`).join('');
  }
  function renderList() {
    const q = $('#listSearch').value.trim().toLowerCase();
    const list = ProductStore.all().filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
    $('#list').innerHTML = list.length ? `<div class="table-wrap"><table class="ptable">
      <thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Status</th><th class="right">Actions</th></tr></thead>
      <tbody>${list.map(p => `<tr>
        <td><div class="pcell">${img((p.imgs || [])[0], p.name)}<div><b>${esc(p.name)}</b>${p.sku ? `<span class="muted small">SKU: ${esc(p.sku)}</span>` : ''}${p.video ? `<span class="muted small">Has video</span>` : ''}</div></div></td>
        <td>${esc((p.cats || [])[0] || '')}</td>
        <td>${inr(p.price)}${p.mrp > p.price ? `<br><s class="muted small">${inr(p.mrp)}</s>` : ''}</td>
        <td><span class="status ${p.stock ? 'in' : 'out'}">${p.stock ? 'In stock' : 'Out of stock'}</span></td>
        <td class="right"><div class="row-actions">
          <a class="link" href="${productUrl(p)}" target="_blank" rel="noopener">View</a>
          <button class="link" data-edit="${esc(p.id)}">Edit</button>
          <button class="link danger" data-del="${esc(p.id)}">Delete</button></div></td>
      </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty"><p class="muted">${q ? 'No products match your search.' : 'You haven\'t added any products yet. Use the form above to add your first one.'}</p></div>`;
  }
  $('#listSearch').addEventListener('input', renderList);
  $('#list').addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const p = ProductStore.get(ed.dataset.edit); if (!p) return;
      editingId = p.id; fill(p);
      $('#formTitle').textContent = 'Edit product';
      $('#saveBtn').textContent = 'Save changes';
      $('#cancelEdit').hidden = false;
      msg.className = 'form-msg'; msg.textContent = '';
      form.closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (del.dataset.confirm !== '1') {           // two-step delete instead of confirm()
        del.dataset.confirm = '1'; del.textContent = 'Confirm delete?';
        setTimeout(() => { if (del.isConnected) { del.dataset.confirm = ''; del.textContent = 'Delete'; } }, 4000);
        return;
      }
      del.disabled = true; del.textContent = 'Deleting…';
      try {
        await ProductStore.remove(del.dataset.del);
        if (String(editingId) === del.dataset.del) resetForm();
        renderList(); renderStats(); toast('Product deleted');
      } catch (err) { toast(err.message); renderList(); }
    }
  });

  /* ---------- one-time import of the built-in catalogue into Firebase ---------- */
  function renderImport() {
    const fix = ProductStore.pendingImageFix();
    if (fix.length) {
      $('#importBox').innerHTML = `<div class="note legacy-box">
        <p><b>${fix.length} products still use photos from the old website.</b> Switch them to the copies already in your Cloudinary account.</p>
        <button class="btn" id="fixBtn">Switch photos to Cloudinary</button></div>`;
      $('#fixBtn').onclick = async e => {
        const b = e.target; b.disabled = true; b.textContent = 'Switching…';
        try { const n = await ProductStore.fixImages((d, t) => { b.textContent = `Switching… ${d}/${t}`; }); toast(`${n} products now use Cloudinary photos`); }
        catch (err) { toast(err.message); }
        renderImport(); renderList(); renderStats();
      };
      return;
    }
    const pending = ProductStore.pendingImport();
    $('#importBox').innerHTML = pending.length ? `<div class="note legacy-box">
      <p><b>${pending.length} store products are not in Firebase yet.</b> Move them once so you can edit every product here and the store loads everything from Firebase. Their photos are already in Cloudinary.</p>
      <button class="btn" id="importBtn">Move all products to Firebase</button></div>` : '';
    if (!pending.length) return;
    $('#importBtn').onclick = async e => {
      const b = e.target; b.disabled = true; b.textContent = 'Moving…';
      try {
        const n = await ProductStore.importCatalogue((done, total) => { b.textContent = `Moving… ${done}/${total}`; });
        toast(`${n} products moved to Firebase`);
      } catch (err) { toast(err.message); }
      renderImport(); renderList(); renderStats();
    };
  }

  /* ---------- products saved by the old browser-only admin page ---------- */
  function renderLegacy() {
    const old = ProductStore.legacy();
    $('#legacy').innerHTML = old.length ? `<div class="note legacy-box">
      <p><b>${old.length} product${old.length === 1 ? ' was' : 's were'} saved only in this browser</b> by the old admin page. Move ${old.length === 1 ? 'it' : 'them'} to Firebase so ${old.length === 1 ? 'it shows' : 'they show'} on every device.</p>
      <button class="btn" id="moveLegacy">Move to Firebase</button></div>` : '';
    if (!old.length) return;
    $('#moveLegacy').onclick = async e => {
      e.target.disabled = true; e.target.textContent = 'Moving…';
      const done = [];
      try {
        for (const p of old) { await ProductStore.save({ ...p, id: p.id }); done.push(String(p.id)); }
        toast(`${done.length} product${done.length === 1 ? '' : 's'} moved to Firebase`);
      } catch (err) { toast(err.message); }
      ProductStore.clearLegacy(done);
      renderLegacy(); renderList(); renderStats();
    };
  }

  /* ---------- export / logout ---------- */
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(ProductStore.all(), null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'toykingdom-products.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#logoutBtn').onclick = async () => { await Auth.logout(); location.href = 'account.html'; };

  /* ---------- orders ---------- */
  const STATUSES = ['placed', 'packed', 'shipped', 'delivered', 'cancelled'];
  let orders = [];
  async function renderOrders() {
    const box = $('#ordersBox');
    try { orders = await Orders.all(); }
    catch (err) { box.innerHTML = `<p class="form-msg bad">${esc(err.message)}</p>`; return; }
    const local = orders.filter(o => o.storage === 'local').length;
    box.innerHTML = (local ? `<p class="note small">${local} order(s) are saved only in this browser. Publish the updated database rules (orders section) so orders from every customer appear here.</p>` : '')
      + (orders.length ? `<div class="table-wrap"><table class="ptable">
        <thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Payment</th><th>Status</th><th class="right">Bill</th></tr></thead>
        <tbody>${orders.map(o => `<tr>
          <td><b>${esc(o.id)}</b><span class="muted small">${fmtDate(o.created, true)}${o.test ? ' · test' : ''}</span></td>
          <td>${esc(o.address.name)}<span class="muted small">${esc(o.address.city)}, ${esc(o.address.pincode)} · ${esc(o.address.phone)}</span></td>
          <td>${inr(o.total)}<span class="muted small">${o.items.reduce((n, i) => n + i.qty, 0)} item(s)</span></td>
          <td>${esc(o.payment.method)}${o.payment.dueOnDelivery ? `<span class="muted small">collect ${inr(o.payment.dueOnDelivery)}</span>` : ''}</td>
          <td><select class="select mini-select" data-status="${esc(o.id)}" aria-label="Status of ${esc(o.id)}">${STATUSES.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></td>
          <td class="right"><a class="link" href="invoice.html?id=${encodeURIComponent(o.id)}" target="_blank" rel="noopener">Print bill</a></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted small">No orders yet.</p>');
  }
  $('#ordersBox').addEventListener('change', async e => {
    const sel = e.target.closest('[data-status]'); if (!sel) return;
    const o = orders.find(x => x.id === sel.dataset.status); if (!o) return;
    sel.disabled = true;
    try { await Orders.setStatus(o, sel.value); o.status = sel.value; toast(`${o.id}: ${sel.value}`); }
    catch (err) { toast(err.message); sel.value = o.status; }
    sel.disabled = false;
  });
  $('#ordersRefresh').onclick = renderOrders;

  resetForm(); renderList(); renderStats(); renderLegacy(); renderImport(); renderOrders();
  document.title = 'Admin – Toy Kingdom';
});
