/**
 * Toy Kingdom – order confirmation e-mails (Google Apps Script web app)
 *
 * Sends from the Google account that deploys this script (toykingdom1309@gmail.com):
 *   - customer: "Order confirmed" + bill PDF
 *   - admin:    "New order" + bill PDF + shipping label PDF
 *
 * Safety: every request must carry the customer's Firebase login token. The script
 * reads the order from Firestore WITH that token (so it only works for a real order
 * that belongs to the logged-in customer), uses the e-mail address stored on that
 * order (never one from the request), refuses old orders, and sends each order once.
 *
 * Gmail limit for free accounts: about 100 recipients per day (= ~50 orders/day,
 * because each order sends 2 e-mails). See SETUP.md for deployment steps.
 */
const CFG = {
  projectId: 'toykingdom-ad0ab',
  database: 'default',                          // Firestore database ID
  apiKey: 'AIzaSyA8Tf9YM0eAvsAJhTIGIG4fbvyT0xCgWXk', // public web API key (same as the website)
  adminEmail: 'toykingdom1309@gmail.com',
  storeName: 'Toy Kingdom',
  siteUrl: 'https://jaikamal085-beep.github.io/toykingdom/',
  phone: '+91 82486 40441',
  whatsapp: '918248640441',
  maxOrderAgeMinutes: 120,                      // only e-mail orders placed in the last 2 hours
  maxPdfBytes: 6 * 1024 * 1024,
};

function doGet() {
  return ContentService.createTextOutput('Toy Kingdom order mailer is running.');
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const id = String(body.orderId || '');
    if (!/^TK-\d{6}-[A-Z0-9]{5}$/.test(id)) return reply({ ok: false, error: 'Invalid order number.' });
    if (!body.idToken) return reply({ ok: false, error: 'Please log in again.' });

    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('sent_' + id)) return reply({ ok: true, already: true });

    /* 1. read the order from Firestore as the logged-in customer */
    const url = 'https://firestore.googleapis.com/v1/projects/' + CFG.projectId + '/databases/' + CFG.database +
      '/documents/orders/' + encodeURIComponent(id) + '?key=' + CFG.apiKey;
    const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + body.idToken }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return reply({ ok: false, error: 'Order not found for this account (' + res.getResponseCode() + ').' });
    const o = decodeFields(JSON.parse(res.getContentText()).fields);
    if (!o.email || !o.items || !o.address) return reply({ ok: false, error: 'Order data is incomplete.' });
    if (Date.now() - Number(o.created || 0) > CFG.maxOrderAgeMinutes * 60000) return reply({ ok: false, error: 'This order is too old to e-mail.' });

    /* 2. send once (lock so two quick requests can't both send) */
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (props.getProperty('sent_' + id)) return reply({ ok: true, already: true });
      const invoice = pdfBlob(body.invoicePdf, 'Invoice-' + id + '.pdf');
      const label = pdfBlob(body.labelPdf, 'Shipping-label-' + id + '.pdf');
      const test = o.test ? '[TEST] ' : '';

      MailApp.sendEmail({
        to: o.email,
        name: CFG.storeName,
        replyTo: CFG.adminEmail,
        subject: test + 'Your Toy Kingdom order ' + id + ' is confirmed',
        htmlBody: customerHtml(o),
        attachments: invoice ? [invoice] : [],
      });
      MailApp.sendEmail({
        to: CFG.adminEmail,
        name: CFG.storeName + ' Orders',
        replyTo: o.email,
        subject: test + 'New order ' + id + ' – ' + rs(o.total) + (o.payment && o.payment.mode === 'cod' ? ' (Partial COD)' : ' (Prepaid)'),
        htmlBody: adminHtml(o),
        attachments: [invoice, label].filter(Boolean),
      });
      props.setProperty('sent_' + id, String(Date.now()));
    } finally { lock.releaseLock(); }

    return reply({ ok: true, to: o.email });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

/* ---------- helpers ---------- */
function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function pdfBlob(b64, name) {
  if (!b64) return null;
  const bytes = Utilities.base64Decode(String(b64));
  if (bytes.length > CFG.maxPdfBytes) throw new Error('Attachment too large.');
  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (head !== '%PDF') throw new Error('Attachment is not a PDF.');
  return Utilities.newBlob(bytes, 'application/pdf', name);
}

function decodeValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields);
  return null;
}
function decodeFields(f) {
  const out = {};
  Object.keys(f || {}).forEach(function (k) { out[k] = decodeValue(f[k]); });
  return out;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function rs(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
function day(t) { return Utilities.formatDate(new Date(Number(t)), 'Asia/Kolkata', 'dd MMM yyyy, hh:mm a'); }

function itemsTable(o) {
  const rows = o.items.map(function (i) {
    return '<tr><td style="padding:8px;border-bottom:1px solid #eee">' + esc(i.name) + '</td>' +
      '<td style="padding:8px;border-bottom:1px solid #eee;text-align:center">' + i.qty + '</td>' +
      '<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">' + rs(i.price * i.qty) + '</td></tr>';
  }).join('');
  const ship = o.shipping === 0 ? 'Free' : (o.shipping ? rs(o.shipping) : 'To be confirmed');
  const p = o.payment || {};
  return '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
    '<tr style="background:#F5F0FF"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px">Qty</th><th style="padding:8px;text-align:right">Amount</th></tr>' +
    rows +
    '<tr><td colspan="2" style="padding:6px 8px">Subtotal</td><td style="padding:6px 8px;text-align:right">' + rs(o.subtotal) + '</td></tr>' +
    '<tr><td colspan="2" style="padding:6px 8px">Shipping</td><td style="padding:6px 8px;text-align:right">' + ship + '</td></tr>' +
    '<tr><td colspan="2" style="padding:8px;font-weight:bold">Total</td><td style="padding:8px;text-align:right;font-weight:bold">' + rs(o.total) + '</td></tr>' +
    '<tr><td colspan="2" style="padding:6px 8px">Paid online' + (o.test ? ' (test)' : '') + '</td><td style="padding:6px 8px;text-align:right">' + rs(p.paidNow) + '</td></tr>' +
    (p.dueOnDelivery ? '<tr><td colspan="2" style="padding:6px 8px;font-weight:bold">To pay in cash on delivery</td><td style="padding:6px 8px;text-align:right;font-weight:bold">' + rs(p.dueOnDelivery) + '</td></tr>' : '') +
    '</table>';
}
function addressBlock(a) {
  return '<b>' + esc(a.name) + '</b><br>' + esc(a.house) + '<br>' + esc(a.area) +
    (a.landmark ? '<br>Landmark: ' + esc(a.landmark) : '') + '<br>' + esc(a.city) + ', ' + esc(a.state) + ' - <b>' + esc(a.pincode) + '</b>' +
    '<br>Mobile: ' + esc(a.phone) + (a.alt ? ' / ' + esc(a.alt) : '');
}
function shell(inner) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#313131">' +
    '<div style="background:#8649FB;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;font-size:20px;font-weight:bold">' + CFG.storeName + '</div>' +
    '<div style="border:1px solid #eee;border-top:0;padding:22px;border-radius:0 0 12px 12px">' + inner + '</div>' +
    '<p style="font-size:12px;color:#888;text-align:center;margin-top:14px">' + CFG.storeName + ' · ' + CFG.phone + ' · <a href="' + CFG.siteUrl + '" style="color:#8649FB">' + CFG.siteUrl + '</a></p></div>';
}

function customerHtml(o) {
  const a = o.address;
  return shell(
    (o.test ? '<p style="background:#fff4d6;padding:10px;border-radius:8px">This is a <b>test order</b>. No money was taken.</p>' : '') +
    '<h2 style="margin:0 0 6px">Thank you, ' + esc(a.name.split(' ')[0]) + '! Your order is confirmed.</h2>' +
    '<p style="margin:0 0 16px;color:#666">Order <b>' + esc(o.id) + '</b> · ' + day(o.created) + '</p>' +
    itemsTable(o) +
    '<h3 style="margin:22px 0 6px">Delivering to</h3><p style="margin:0;line-height:1.6">' + addressBlock(a) + '</p>' +
    '<p style="margin:16px 0">Delivery in <b>3-5 working days</b>. Your bill is attached as a PDF.</p>' +
    '<p><a href="' + CFG.siteUrl + 'order.html?id=' + encodeURIComponent(o.id) + '" style="background:#8649FB;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;display:inline-block">View your order</a></p>' +
    '<p style="font-size:13px;color:#666">Questions? Reply to this e-mail or WhatsApp us at <a href="https://wa.me/' + CFG.whatsapp + '">' + CFG.phone + '</a>.<br>' +
    'Returns: damaged or defective items only, with a 360° unboxing video sent on WhatsApp within 24 hours of delivery.</p>');
}

function adminHtml(o) {
  const a = o.address, p = o.payment || {};
  const cod = p.mode === 'cod' && p.dueOnDelivery > 0;
  return shell(
    (o.test ? '<p style="background:#fff4d6;padding:10px;border-radius:8px"><b>TEST ORDER</b>: no money was taken.</p>' : '') +
    '<h2 style="margin:0 0 6px">New order ' + esc(o.id) + '</h2>' +
    '<p style="margin:0 0 6px;color:#666">' + day(o.created) + ' · Customer: ' + esc(o.email) + '</p>' +
    '<p style="margin:0 0 16px;padding:10px;border-radius:8px;background:' + (cod ? '#111;color:#fff' : '#E6F4EC;color:#1A8754') + '"><b>' +
      (cod ? 'PARTIAL COD: collect ' + rs(p.dueOnDelivery) + ' in cash on delivery' : 'PREPAID: do not collect cash') + '</b></p>' +
    itemsTable(o) +
    '<h3 style="margin:22px 0 6px">Ship to</h3><p style="margin:0;line-height:1.6">' + addressBlock(a) + '</p>' +
    '<p style="margin:16px 0">Attached: <b>shipping label</b> (print on A4 and paste on the parcel) and the <b>bill</b> (put inside the parcel).</p>' +
    '<p><a href="' + CFG.siteUrl + 'admin.html" style="background:#8649FB;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;display:inline-block">Open admin orders</a></p>');
}

/** Run this once from the editor (select it, click Run) to check e-mail works and to grant permission. */
function testMail() {
  MailApp.sendEmail(CFG.adminEmail, 'Toy Kingdom mailer test', 'The order mailer can send e-mail. Remaining daily quota: ' + MailApp.getRemainingDailyQuota());
}
