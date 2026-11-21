'use strict';
/* ==========================================================================
   Order confirmation e-mails
   After an order is placed (order.html?new=1), the customer's browser:
   1. builds the bill PDF and the shipping-label PDF from the same templates as
      invoice.html (assets/invoice.js + invoice.css), and
   2. sends them with the customer's Firebase login token to the Google Apps
      Script mailer (window.MAIL_ENDPOINT, see email/order-mailer.gs).
   The mailer checks the order in Firestore with that token, then e-mails:
   - the customer: confirmation + bill PDF
   - the admin:    new-order details + bill PDF + label PDF
   It only ever writes to the order's own e-mail and the admin, once per order.
   ========================================================================== */
const PDF_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
const scriptCache = {};
const loadScriptOnce = src => scriptCache[src] || (scriptCache[src] = new Promise((ok, fail) => {
  const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Could not load the PDF tool.'));
  document.head.append(s);
}));

/* Renders bill/label HTML off-screen and returns the PDF as base64 */
async function htmlToPdfBase64(innerHtml, label) {
  await loadScriptOnce(PDF_LIB);
  /* off-screen holder > .tkdoc (the element converted, so the scoped invoice.css rules apply) > page */
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1';
  /* 296.5mm instead of 297mm: html2pdf rounds up, and a full-height page would spill onto a blank 2nd page */
  host.innerHTML = `<div class="tkdoc" style="width:210mm;background:#fff"><section class="docsheet${label ? ' label-sheet' : ''}" style="${label ? 'height:296.5mm;min-height:0' : 'min-height:296.5mm'}">${innerHtml}</section></div>`;
  document.body.append(host);
  try {
    await Promise.all([...host.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
    const uri = await window.html2pdf().set({
      margin: 0, image: { type: 'jpeg', quality: 0.9 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(host.firstElementChild).outputPdf('datauristring');
    return uri.slice(uri.indexOf(',') + 1);
  } finally { host.remove(); }
}

const Mailer = {
  enabled: () => !!window.MAIL_ENDPOINT,
  sentKey: id => 'tk-mailed-' + id,
  alreadySent(id) { try { return !!localStorage.getItem(this.sentKey(id)); } catch (e) { return false; } },

  /* returns { ok, skipped?, to? } */
  async sendOrder(o) {
    if (!this.enabled()) return { skipped: 'not-configured' };
    if (o.storage !== 'cloud') return { skipped: 'local-order' };     // the mailer can only verify orders saved in Firebase
    if (this.alreadySent(o.id)) return { skipped: 'already-sent' };
    const invoicePdf = await htmlToPdfBase64(invoiceHTML(o), false);
    const labelPdf = await htmlToPdfBase64(labelHTML(o), true);
    const idToken = await Auth.token();
    /* text/plain body = a "simple" request, so the browser doesn't need a CORS preflight (Apps Script can't answer one) */
    const r = await fetch(window.MAIL_ENDPOINT, { method: 'POST', body: JSON.stringify({ orderId: o.id, idToken, invoicePdf, labelPdf }) });
    let d = {}; try { d = await r.json(); } catch (e) { d = { ok: r.ok }; }
    if (!d.ok) throw new Error(d.error || 'The e-mail service did not respond.');
    try { localStorage.setItem(this.sentKey(o.id), String(Date.now())); } catch (e) { /* ignore */ }
    return { ok: true, to: o.email };
  },
};
