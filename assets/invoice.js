'use strict';
/* ==========================================================================
   Printable bill (invoice.html?id=ORDER): A4 sheet with
   1. a shipping label to cut out and paste on the parcel, and
   2. a tax invoice (Amazon-style layout).
   Tax: INVOICE.gstRate is the GST % included in prices. Leave it null until
   your accountant confirms the rate for your products (then CGST+SGST for
   Tamil Nadu deliveries, IGST for other states are shown).
   ========================================================================== */
const INVOICE = { gstRate: null, hsn: '9503' };
const SELLER = {
  name: 'Toy Kingdom', gstin: '33BGCPL8590H1Z7', state: 'Tamil Nadu', phone: '+91 82486 40441', email: 'toykingdom1309@gmail.com',
  address: ['09, Teacher’s Colony, 2nd Street', 'N.K. Road', 'Thanjavur, Tamil Nadu - 613006'],
  addressLines: ['09, Teacher’s Colony, 2nd Street', 'N.K. Road', 'Thanjavur, Tamil Nadu'], pin: '613006',
  logo: 'assets/img/logo.png',   // same site, so it can be drawn into PDFs
};

const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rs = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = t => new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

/* Indian-system amount in words: "One Thousand Three Hundred Ninety-eight Rupees Only" */
function inWords(amount) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = n => n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10].toLowerCase() : '');
  const three = n => (n >= 100 ? ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
  const words = n => {
    if (!n) return 'Zero';
    const parts = [], crore = Math.floor(n / 1e7), lakh = Math.floor(n / 1e5) % 100, th = Math.floor(n / 1000) % 100, rest = n % 1000;
    if (crore) parts.push(words(crore) + ' Crore');
    if (lakh) parts.push(two(lakh) + ' Lakh');
    if (th) parts.push(two(th) + ' Thousand');
    if (rest) parts.push(three(rest));
    return parts.join(' ');
  };
  const r = Math.floor(amount), p = Math.round((amount - r) * 100);
  return `${words(r)} Rupees${p ? ' and ' + two(p) + ' Paise' : ''} Only`;
}

/* Code 128 (set B) barcode as SVG */
const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
/* Drawn as a crisp PNG (scales cleanly in print and in the e-mailed PDF); SVG only as a fallback. */
function barcode(text, height = 46) {
  const codes = [104, ...[...text].map(c => c.charCodeAt(0) - 32)];
  codes.push(codes.reduce((s, c, i) => s + c * (i || 1), 0) % 103, 106);
  try {
    const mod = 4, quiet = 10, widths = codes.flatMap(c => [...C128[c]].map(Number));
    const cv = document.createElement('canvas');
    cv.width = (widths.reduce((a, b) => a + b, 0) + quiet * 2) * mod; cv.height = 160;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#000';
    let x = quiet * mod;
    widths.forEach((w, i) => { if (i % 2 === 0) g.fillRect(x, 0, w * mod, cv.height); x += w * mod; });
    return `<img class="barcode" src="${cv.toDataURL('image/png')}" alt="Barcode ${h(text)}">`;
  } catch (e) { /* no canvas: fall back to SVG below */ }
  let x = 10, bars = '';
  for (const c of codes) [...C128[c]].forEach((w, i) => { w = +w; if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`; x += w; });
  return `<svg class="barcode" viewBox="0 0 ${x + 10} ${height}" preserveAspectRatio="none" role="img" aria-label="Barcode ${h(text)}">${bars}</svg>`;
}

/* tax split for a GST-inclusive amount */
function taxOf(gross, sameState) {
  const r = INVOICE.gstRate;
  if (r == null) return null;
  const net = gross / (1 + r / 100), tax = gross - net;
  return sameState ? { net, rows: [['CGST', r / 2, tax / 2], ['SGST', r / 2, tax / 2]], tax } : { net, rows: [['IGST', r, tax]], tax };
}

function addressLines(a) {
  return [a.house, a.area, a.landmark ? 'Landmark: ' + a.landmark : '',
    `${a.city}${a.district && a.district.toLowerCase() !== String(a.city).toLowerCase() ? ' (' + a.district + ' dist.)' : ''}, ${a.state}`].filter(Boolean);
}

/* Receiver and sender blocks share one layout and get equal space on the label. */
const party = (title, name, lines, pin, phone) => `<div class="box party">
  <span class="k">${h(title)}</span>
  <div class="nm">${h(name)}</div>
  <div class="ad">${lines.map(h).join('<br>')}</div>
  <div class="pin">PIN ${h(pin)}</div>
  <div class="ph">Mobile: ${h(phone)}</div>
</div>`;

/* Shipping label, printed as a full A4 page. Admin only. */
function labelHTML(o) {
  const a = o.address, pay = o.payment, cod = pay.mode === 'cod' && pay.dueOnDelivery > 0;
  const pieces = o.items.reduce((n, i) => n + i.qty, 0);
  return `<div class="label">
    <div class="box lb-head">
      <img src="${SELLER.logo}" alt="Toy Kingdom" class="logo">
      <div class="ord"><span class="k">Order</span><b>${h(o.id)}</b><span>${day(o.created)} · ${pieces} item${pieces === 1 ? '' : 's'}</span></div>
      <div class="pay ${cod ? 'cod' : ''} box">${cod
        ? `<div class="t">PARTIAL COD · COLLECT</div><div class="v">${rs(pay.dueOnDelivery)}</div><div class="t">IN CASH</div>`
        : '<div class="t">PREPAID</div><div class="v">DO NOT</div><div class="t">COLLECT CASH</div>'}</div>
    </div>
    ${party('Deliver to (receiver)', a.name, addressLines(a), a.pincode, a.phone + (a.alt ? ' / ' + a.alt : ''))}
    ${party('From (sender) · return address', SELLER.name, SELLER.addressLines, SELLER.pin, SELLER.phone)}
    <div class="bc">${barcode(o.id)}<div class="bc-text">${h(o.id)}</div></div>
  </div>
  `;
}

/* Tax invoice (A4). Shown to customers and admin. */
function invoiceHTML(o) {
  const a = o.address, pay = o.payment, same = (a.state || '').toLowerCase() === SELLER.state.toLowerCase();
  const items = o.items.map(i => ({ ...i, gross: i.price * i.qty }));
  const wrapped = o.items.filter(i => i.gift).reduce((n, i) => n + i.qty, 0);
  if (o.giftWrap) items.push({ name: 'Gift Wrapping', qty: wrapped || 1, price: wrapped ? o.giftWrap / wrapped : o.giftWrap, gross: o.giftWrap, ship: true });
  if (o.shipping) items.push({ name: 'Shipping Charges', qty: 1, price: o.shipping, gross: o.shipping, ship: true });
  const cod = pay.mode === 'cod' && pay.dueOnDelivery > 0;
  const addrLines = addressLines(a);
  let totTax = 0;

  const rows = items.map((it, n) => {
    const t = taxOf(it.gross, same);
    if (t) totTax += t.tax;
    return `<tr>
      <td class="c">${n + 1}</td>
      <td>${h(it.name)}${it.gift ? ' <b>(Gift wrapped)</b>' : ''}${it.ship ? '' : `<div class="sub">${it.sku ? 'SKU: ' + h(it.sku) + ' · ' : ''}HSN: ${INVOICE.hsn}</div>`}</td>
      <td class="r">${rs(t ? t.net / it.qty : it.price)}</td>
      <td class="c">${it.qty}</td>
      <td class="r">${rs(t ? t.net : it.gross)}</td>
      <td class="c">${t ? t.rows.map(x => x[1] + '%').join('<br>') : 'Incl.'}</td>
      <td class="c">${t ? t.rows.map(x => x[0]).join('<br>') : 'GST'}</td>
      <td class="r">${t ? t.rows.map(x => rs(x[2])).join('<br>') : 'Incl.'}</td>
      <td class="r">${rs(it.gross)}</td></tr>`;
  }).join('');

  return `${o.test ? '<div class="watermark">TEST ORDER</div>' : ''}
  <section class="invoice">
    <div class="inv-head">
      <img src="${SELLER.logo}" alt="Toy Kingdom" class="logo">
      <div class="inv-title"><b>Tax Invoice/Bill of Supply/Cash Memo</b><span>(Original for Recipient)</span></div>
    </div>
    <div class="inv-parties">
      <div><div class="k">Sold By :</div><b>${h(SELLER.name)}</b><br>${SELLER.address.map(h).join('<br>')}<br>
        <span class="k">GST Registration No:</span> ${h(SELLER.gstin)}</div>
      <div class="r-al"><div class="k">Billing Address :</div><b>${h(a.name)}</b><br>${addrLines.map(h).join('<br>')}<br>PIN: ${h(a.pincode)}<br>
        <span class="k">State/UT:</span> ${h(a.state)}</div>
    </div>
    <div class="inv-parties">
      <div><span class="k">Order Number:</span> ${h(o.id)}<br><span class="k">Order Date:</span> ${day(o.created)}<br>
        <span class="k">Payment:</span> ${h(pay.method)}${o.test ? ' (test)' : ''}</div>
      <div class="r-al"><div class="k">Shipping Address :</div><b>${h(a.name)}</b><br>${addrLines.map(h).join('<br>')}<br>PIN: ${h(a.pincode)} · Mobile: ${h(a.phone)}<br>
        <span class="k">Place of supply:</span> ${h(a.state)} · <span class="k">Place of delivery:</span> ${h(a.state)}<br>
        <span class="k">Invoice Number:</span> ${h(o.id)} · <span class="k">Invoice Date:</span> ${day(o.created)}</div>
    </div>
    <table class="inv-table">
      <thead><tr><th>Sl.<br>No</th><th>Description</th><th>Unit<br>Price</th><th>Qty</th><th>Net<br>Amount</th><th>Tax<br>Rate</th><th>Tax<br>Type</th><th>Tax<br>Amount</th><th>Total<br>Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="7"><b>TOTAL:</b></td><td class="r"><b>${INVOICE.gstRate == null ? 'Incl.' : rs(totTax)}</b></td><td class="r"><b>${rs(o.total)}</b></td></tr>
        <tr><td colspan="9"><b>Amount in Words:</b><br>${inWords(o.total)}</td></tr>
      </tfoot>
    </table>
    <div class="inv-pay">
      <div><span class="k">Paid online:</span> ${rs(pay.paidNow)}${o.test ? ' (test)' : ''}${cod ? ` · <span class="k">Due on delivery (cash):</span> <b>${rs(pay.dueOnDelivery)}</b>` : ''}</div>
      <div class="sign"><b>For ${h(SELLER.name)}:</b><div class="sign-space"></div>Authorized Signatory</div>
    </div>
    <p class="fine">${INVOICE.gstRate == null ? 'All prices are inclusive of GST. ' : ''}Whether tax is payable under reverse charge - No.
      This is a computer-generated invoice. Returns: damaged/defective items only, with a 360° unboxing video sent on WhatsApp (${h(SELLER.phone)}) within 24 hours of delivery.</p>
  </section>`;
}

/* Admin: shipping label + invoice. Customers: invoice only. */
function render(o, admin) {
  document.title = `${admin ? 'Label & bill' : 'Bill'} ${o.id} – Toy Kingdom`;
  const tools = document.getElementById('tools'), out = document.getElementById('out');
  tools.innerHTML = admin
    ? `<button id="pLabel">Print shipping label (A4)</button>
       <button id="pInv" class="ghost">Print invoice (A4)</button>
       <a href="admin.html" class="ghost">Back to orders</a>
       <span class="hint">Admin view: customers see only the invoice. Choose “Save as PDF” in the print window to keep a copy.</span>`
    : `<button id="pInv">Print / download bill</button>
       <a href="account.html" class="ghost">My orders</a>
       <span class="hint">Choose “Save as PDF” in the print window to download your bill.</span>`;
  out.innerHTML = (admin ? `<div class="page-title t-lbl">Shipping label (full A4 page)</div>
      <section class="docsheet label-sheet" id="labelSheet">${labelHTML(o)}</section>
      <div class="page-title t-inv">Tax invoice (A4)</div>` : '')
    + `<section class="docsheet" id="invoiceSheet">${invoiceHTML(o)}</section>`;
  const print = mode => { document.body.dataset.print = mode; window.print(); };
  document.getElementById('pInv').onclick = () => print('invoice');
  if (admin) document.getElementById('pLabel').onclick = () => print('label');
}

if (document.body.dataset.page === 'invoice') TK_READY.then(async () => {   // only on invoice.html; order.html uses the functions for e-mail PDFs
  const id = new URLSearchParams(location.search).get('id') || '';
  const out = document.getElementById('out');
  if (!Auth.current()) { location.replace('account.html?next=' + encodeURIComponent('invoice.html?id=' + id)); return; }
  try { render(await Orders.get(id), Auth.isAdmin()); }
  catch (e) { out.innerHTML = `<p class="docsheet err">Could not load order ${h(id)}: ${h(e.message)}</p>`; }
});
