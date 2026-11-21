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
  logo: 'https://toykingdomonline.com/wp-content/uploads/2025/04/toykingdomlogo.png',
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
function barcode(text, height = 46) {
  const codes = [104, ...[...text].map(c => c.charCodeAt(0) - 32)];
  codes.push(codes.reduce((s, c, i) => s + c * (i || 1), 0) % 103, 106);
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

function render(o) {
  const a = o.address, pay = o.payment, same = (a.state || '').toLowerCase() === SELLER.state.toLowerCase();
  const items = o.items.map(i => ({ ...i, gross: i.price * i.qty }));
  if (o.shipping) items.push({ name: 'Shipping Charges', qty: 1, price: o.shipping, gross: o.shipping, ship: true });
  const pieces = o.items.reduce((n, i) => n + i.qty, 0);
  const cod = pay.mode === 'cod' && pay.dueOnDelivery > 0;
  const addrLines = [a.house, a.area, a.landmark ? 'Landmark: ' + a.landmark : '', `${a.city}${a.district && a.district.toLowerCase() !== a.city.toLowerCase() ? ' (' + a.district + ' dist.)' : ''}`, a.state].filter(Boolean);
  let totNet = 0, totTax = 0;

  const rows = items.map((it, n) => {
    const t = taxOf(it.gross, same);
    if (t) { totNet += t.net; totTax += t.tax; }
    return `<tr>
      <td class="c">${n + 1}</td>
      <td>${h(it.name)}${it.ship ? '' : `<div class="sub">${it.sku ? 'SKU: ' + h(it.sku) + ' · ' : ''}HSN: ${INVOICE.hsn}</div>`}</td>
      <td class="r">${rs(t ? t.net / it.qty : it.price)}</td>
      <td class="c">${it.qty}</td>
      <td class="r">${rs(t ? t.net : it.gross)}</td>
      <td class="c">${t ? t.rows.map(x => x[1] + '%').join('<br>') : 'Incl.'}</td>
      <td class="c">${t ? t.rows.map(x => x[0]).join('<br>') : 'GST'}</td>
      <td class="r">${t ? t.rows.map(x => rs(x[2])).join('<br>') : 'Incl.'}</td>
      <td class="r">${rs(it.gross)}</td></tr>`;
  }).join('');

  document.title = `Bill ${o.id} – Toy Kingdom`;
  document.getElementById('sheet').innerHTML = `
  ${o.test ? '<div class="watermark">TEST ORDER</div>' : ''}
  <section class="label">
    <div class="label-top">
      <img src="${SELLER.logo}" alt="Toy Kingdom" class="logo">
      <div class="lbl-order"><div class="k">ORDER</div><div class="v">${h(o.id)}</div><div class="k">${day(o.created)} · ${pieces} item${pieces === 1 ? '' : 's'}</div></div>
      <div class="pay-box ${cod ? 'cod' : 'prepaid'}">${cod
        ? `<div class="pk">PARTIAL COD</div><div class="pv">COLLECT ${rs(pay.dueOnDelivery)}</div><div class="pk">in cash</div>`
        : '<div class="pk">PREPAID</div><div class="pv">DO NOT COLLECT CASH</div>'}</div>
    </div>
    <div class="ship-to">
      <div class="k">SHIP TO</div>
      <div class="to-name">${h(a.name)}</div>
      <div class="to-addr">${addrLines.map(h).join('<br>')}</div>
      <div class="to-pin">PIN ${h(a.pincode)}</div>
      <div class="to-phone">Mobile: ${h(a.phone)}${a.alt ? ' / ' + h(a.alt) : ''}</div>
    </div>
    <div class="label-foot">
      <div class="from"><span class="k">FROM / RETURN TO:</span> ${h(SELLER.name)}, ${SELLER.address.map(h).join(', ')} · ${h(SELLER.phone)}</div>
      ${barcode(o.id)}
      <div class="bc-text">${h(o.id)}</div>
    </div>
  </section>

  <div class="cutline"><span>✂ Cut along this line and paste the label on the parcel</span></div>

  <section class="invoice">
    <div class="inv-head">
      <img src="${SELLER.logo}" alt="Toy Kingdom" class="logo">
      <div class="inv-title"><b>Tax Invoice/Bill of Supply/Cash Memo</b><span>(Original for Recipient)</span></div>
    </div>
    <div class="inv-parties">
      <div><div class="k">Sold By :</div><b>${h(SELLER.name)}</b><br>${SELLER.address.map(h).join('<br>')}<br>
        <span class="k">GST Registration No:</span> ${h(SELLER.gstin)}</div>
      <div class="r-al"><div class="k">Billing Address :</div><b>${h(a.name)}</b><br>${addrLines.map(h).join('<br>')}<br>PIN: ${h(a.pincode)}<br>
        <span class="k">State/UT Code:</span> ${h(a.state)}</div>
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

TK_READY.then(async () => {
  const id = new URLSearchParams(location.search).get('id') || '';
  const sheet = document.getElementById('sheet');
  if (!Auth.current()) { location.replace('account.html?next=' + encodeURIComponent('invoice.html?id=' + id)); return; }
  try { render(await Orders.get(id)); }
  catch (e) { sheet.innerHTML = `<p class="err">Could not load order ${h(id)}: ${h(e.message)}</p>`; return; }
  const setMode = m => { document.body.dataset.print = m; };
  document.getElementById('pAll').onclick = () => { setMode('all'); window.print(); };
  document.getElementById('pLabel').onclick = () => { setMode('label'); window.print(); };
  document.getElementById('pInv').onclick = () => { setMode('invoice'); window.print(); };
  window.addEventListener('afterprint', () => setMode('all'));
});
