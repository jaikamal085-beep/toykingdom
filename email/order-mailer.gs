/**
 * Toy Kingdom – order server: Razorpay payments + order e-mails (Google Apps Script web app)
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
 * WhatsApp alert to the shop owner (optional, free via CallMeBot, own number only):
 *   Project Settings > Script properties > add  CALLMEBOT_APIKEY = <key from CallMeBot>.
 *   Without that property no WhatsApp message is sent. Run testWhatsApp() to check it.
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
  maxOrdersPerHourPerCustomer: 5,               // e-mails for more orders than this per hour are refused
};

function doGet() {
  return ContentService.createTextOutput('Toy Kingdom order mailer is running.');
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'createPayment') return reply(createPayment_(body));
    if (body.action === 'confirmPayment') return reply(confirmPayment_(body));
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

    /* stop one account from using up the daily Gmail quota with many orders */
    const cache = CacheService.getScriptCache(), rateKey = 'rate_' + o.uid;
    const sentRecently = Number(cache.get(rateKey) || 0);
    if (sentRecently >= CFG.maxOrdersPerHourPerCustomer) return reply({ ok: false, error: 'Too many orders from this account in the last hour. Please contact us on WhatsApp.' });

    /* 2. send once (lock so two quick requests can't both send) */
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (props.getProperty('sent_' + id)) return reply({ ok: true, already: true });
      const invoice = pdfBlob(body.invoicePdf, 'Invoice-' + id + '.pdf');
      const label = pdfBlob(body.labelPdf, 'Shipping-label-' + id + '.pdf');
      const test = o.test ? '[TEST] ' : '';

      /* plain-text + HTML versions together: HTML-only mail with attachments is more likely to be filtered as spam */
      MailApp.sendEmail({
        to: o.email,
        name: CFG.storeName,
        replyTo: CFG.adminEmail,
        subject: test + 'Your Toy Kingdom order ' + id + ' is confirmed',
        body: plainText(o, false),
        htmlBody: customerHtml(o),
        attachments: invoice ? [invoice] : [],
      });
      MailApp.sendEmail({
        to: CFG.adminEmail,
        name: CFG.storeName + ' Orders',
        replyTo: o.email,
        subject: test + 'New order ' + id + ' – ' + rs(o.total) + (o.payment && o.payment.mode === 'cod' ? ' (Partial COD)' : ' (Prepaid)'),
        body: plainText(o, true),
        htmlBody: adminHtml(o),
        attachments: [invoice, label].filter(Boolean),
      });
      props.setProperty('sent_' + id, String(Date.now()));
      cache.put(rateKey, String(sentRecently + 1), 3600);
      try { notifyWhatsApp(o); } catch (waErr) { console.warn('WhatsApp alert failed: ' + waErr); }   // never blocks the e-mails
    } finally { lock.releaseLock(); }

    return reply({ ok: true, to: o.email });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

/* =====================================================================
   Razorpay payments (the server side: the browser is never trusted)
   Script properties needed (Project Settings > Script properties):
     RAZORPAY_KEY_SECRET       = Key Secret from Razorpay (test or live)
     FIREBASE_SERVICE_ACCOUNT  = the whole service-account JSON file from Firebase
   Flow:
     1. createPayment: checks the login, prices the cart from the database,
        creates a Razorpay order for the amount to pay now.
     2. Razorpay Checkout runs in the customer's browser.
     3. confirmPayment: checks Razorpay's signature, re-reads the payment from
        Razorpay (amount, order, captured), then saves the order as paid.
   ===================================================================== */
const PAY = {
  keyId: 'rzp_test_U45clzycX4Yiar',             // public Key ID (rzp_test_... = test mode, rzp_live_... = real money)
  freeAbove: 499, fee: 50, codMin: 999, codAdvance: 99, giftWrap: 30,
  maxLines: 8,
};

function secret_(name) {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new Error('Payments are not fully set up yet (' + name + ' is missing).');
  return v;
}

/* the customer's Firebase login, checked by Google */
function verifyUser_(idToken) {
  if (!idToken) throw new Error('Please log in again.');
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + CFG.apiKey, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true,
  });
  const u = r.getResponseCode() === 200 ? (JSON.parse(r.getContentText()).users || [])[0] : null;
  if (!u || !u.email) throw new Error('Your login has expired. Please log in again.');
  return { uid: u.localId, email: String(u.email).toLowerCase() };
}

function fsBase_() {
  return 'https://firestore.googleapis.com/v1/projects/' + CFG.projectId + '/databases/' + CFG.database + '/documents';
}
function getProduct_(id) {
  const r = UrlFetchApp.fetch(fsBase_() + '/products/' + encodeURIComponent(id) + '?key=' + CFG.apiKey, { muteHttpExceptions: true });
  return r.getResponseCode() === 200 ? decodeFields(JSON.parse(r.getContentText()).fields) : null;
}

function cleanStr_(v, max) { return String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }
function checkAddress_(a) {
  a = a || {};
  const o = {
    name: cleanStr_(a.name, 60), phone: String(a.phone || '').replace(/\D/g, ''), alt: String(a.alt || '').replace(/\D/g, ''),
    house: cleanStr_(a.house, 80), area: cleanStr_(a.area, 120), landmark: cleanStr_(a.landmark, 80),
    city: cleanStr_(a.city, 50), state: cleanStr_(a.state, 60), pincode: String(a.pincode || '').replace(/\D/g, ''),
    district: cleanStr_(a.district, 60), verified: a.verified === true,
  };
  if (o.name.length < 2 || !/^[6-9]\d{9}$/.test(o.phone) || (o.alt && !/^[6-9]\d{9}$/.test(o.alt)) || !o.house ||
      o.area.length < 3 || !o.city || !o.state || !/^[1-9]\d{5}$/.test(o.pincode)) throw new Error('Please check the delivery address.');
  return o;
}

function newOrderId_() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  let r = '';
  for (let i = 0; i < 5; i++) r += A[(bytes[i] + 256) % 32];
  return 'TK-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyMMdd') + '-' + r;
}

/* the order, priced only from the database */
function buildOrder_(user, body) {
  const cart = Array.isArray(body.items) ? body.items : [];
  if (!cart.length || cart.length > PAY.maxLines) throw new Error('An order can have 1 to ' + PAY.maxLines + ' different products.');
  const seen = {}, items = [];
  cart.forEach(function (c) {
    const id = String(c && c.id || ''), qty = Number(c && c.qty);
    if (!id || seen[id]) throw new Error('Your cart has a problem. Please refresh the page and try again.');
    seen[id] = true;
    if (!(qty >= 1 && qty <= 99 && Math.floor(qty) === qty)) throw new Error('Each quantity must be between 1 and 99.');
    const p = getProduct_(id);
    if (!p || p.deleted || p.stock === false) throw new Error('Sorry, ' + (p && p.name ? '"' + p.name + '"' : 'a product in your cart') + ' is no longer available.');
    items.push({ id: id, name: String(p.name || ''), sku: String(p.sku || ''), price: Number(p.price), mrp: Number(p.mrp || p.price),
      qty: qty, img: String((p.imgs && p.imgs[0]) || ''), gift: c.gift === true });
  });
  const subtotal = items.reduce(function (s, i) { return s + i.price * i.qty; }, 0);
  const giftWrap = items.reduce(function (s, i) { return s + (i.gift ? PAY.giftWrap * i.qty : 0); }, 0);
  const shipping = subtotal >= PAY.freeAbove ? 0 : PAY.fee;
  const total = subtotal + giftWrap + shipping;
  const mode = body.mode === 'cod' ? 'cod' : 'online';
  if (mode === 'cod' && subtotal < PAY.codMin) throw new Error('Partial COD is available on orders of ' + rs(PAY.codMin) + ' and above.');
  const paidNow = mode === 'cod' ? Math.min(PAY.codAdvance, total) : total;
  return {
    id: newOrderId_(), uid: user.uid, email: user.email, created: Date.now(), status: 'placed',
    test: PAY.keyId.indexOf('rzp_test_') === 0,
    items: items, subtotal: subtotal, giftWrap: giftWrap, shipping: shipping, total: total,
    payment: { mode: mode, method: mode === 'cod' ? 'Partial COD' : 'Online', paidNow: paidNow, dueOnDelivery: total - paidNow, status: 'pending' },
    address: checkAddress_(body.address),
  };
}

function razorpay_(method, path, payload) {
  const opts = { method: method, headers: { Authorization: 'Basic ' + Utilities.base64Encode(PAY.keyId + ':' + secret_('RAZORPAY_KEY_SECRET')) }, muteHttpExceptions: true };
  if (payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(payload); }
  const r = UrlFetchApp.fetch('https://api.razorpay.com/v1' + path, opts);
  let d = {}; try { d = JSON.parse(r.getContentText() || '{}'); } catch (e) { /* not JSON */ }
  if (r.getResponseCode() >= 300) throw new Error('Payment service: ' + ((d.error && d.error.description) || ('error ' + r.getResponseCode())));
  return d;
}

function createPayment_(body) {
  const user = verifyUser_(body.idToken);
  const o = buildOrder_(user, body);
  const rz = razorpay_('post', '/orders', { amount: o.payment.paidNow * 100, currency: 'INR', receipt: o.id, notes: { orderId: o.id, uid: user.uid } });
  o.payment.razorpayOrderId = rz.id;
  CacheService.getScriptCache().put('rzp_' + rz.id, JSON.stringify(o), 21600);     // kept 6 hours for the confirmation
  return { ok: true, keyId: PAY.keyId, rzpOrderId: rz.id, amount: rz.amount, currency: 'INR', orderId: o.id, test: o.test };
}

function hex_(bytes) { return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }

function confirmPayment_(body) {
  const user = verifyUser_(body.idToken);
  const rzpOrderId = String(body.rzpOrderId || ''), paymentId = String(body.paymentId || ''), sig = String(body.signature || '');
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const done = props.getProperty('paid_' + rzpOrderId);
    if (done) return { ok: true, orderId: done, already: true };              // confirmed before (double click / retry)
    const raw = CacheService.getScriptCache().get('rzp_' + rzpOrderId);
    if (!raw) throw new Error('This payment session has expired. If money was taken, WhatsApp us with payment ID ' + paymentId + '.');
    const o = JSON.parse(raw);
    if (o.uid !== user.uid) throw new Error('This payment belongs to a different account.');

    /* 1. Razorpay's signature proves the payment details came from Razorpay */
    const expected = hex_(Utilities.computeHmacSha256Signature(rzpOrderId + '|' + paymentId, secret_('RAZORPAY_KEY_SECRET')));
    if (expected !== sig) throw new Error('The payment could not be verified.');
    /* 2. ask Razorpay directly: right order, right amount, money captured */
    let pay = razorpay_('get', '/payments/' + encodeURIComponent(paymentId));
    if (pay.order_id !== rzpOrderId || Number(pay.amount) !== o.payment.paidNow * 100) throw new Error('The payment details do not match this order.');
    if (pay.status === 'authorized') pay = razorpay_('post', '/payments/' + encodeURIComponent(paymentId) + '/capture', { amount: pay.amount, currency: 'INR' });
    if (pay.status !== 'captured') throw new Error('The payment is not complete yet (' + pay.status + ').');

    /* 3. save the paid order (server login, so customers can't create paid orders themselves) */
    o.created = Date.now();
    const hasServerKey = !!PropertiesService.getScriptProperties().getProperty('FIREBASE_SERVICE_ACCOUNT');
    if (hasServerKey) {
      o.payment.status = o.payment.mode === 'cod' ? 'advance paid' : 'paid';
      o.payment.razorpayPaymentId = paymentId;
      if (pay.method) o.payment.method += ' · ' + String(pay.method).toUpperCase();
      saveOrderAsServer_(o);
    } else if (o.test) {
      /* TEST MODE without the server key: save with the customer's own login, in the exact
         shape the current database rules accept. Live payments always need the server key. */
      o.payment.status = o.payment.mode === 'cod' ? 'advance paid (test)' : 'paid (test)';
      delete o.payment.razorpayOrderId;
      saveOrderAsCustomer_(o, body.idToken, paymentId);
    } else {
      throw new Error('Payments are not fully set up yet (FIREBASE_SERVICE_ACCOUNT is missing). Your payment ' + paymentId + ' will be refunded – please WhatsApp us.');
    }
    props.setProperty('paid_' + rzpOrderId, o.id);
    return { ok: true, orderId: o.id };
  } finally { lock.releaseLock(); }
}

/* ---------- writing to Firestore as the server (service account) ---------- */
function encodeValue_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue_) } };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Math.floor(v) === v ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') {
    const f = {};
    Object.keys(v).forEach(function (k) { if (v[k] !== undefined) f[k] = encodeValue_(v[k]); });
    return { mapValue: { fields: f } };
  }
  return { stringValue: String(v) };
}

function serverToken_() {
  const cache = CacheService.getScriptCache(), cached = cache.get('sa_token');
  if (cached) return cached;
  const sa = JSON.parse(secret_('FIREBASE_SERVICE_ACCOUNT'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ''); };
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64(Utilities.computeRsaSha256Signature(head + '.' + claim, sa.private_key));
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }, muteHttpExceptions: true,
  });
  const d = JSON.parse(r.getContentText() || '{}');
  if (!d.access_token) throw new Error('Server login to the database failed: ' + (d.error_description || d.error || r.getResponseCode()));
  cache.put('sa_token', d.access_token, 3000);
  return d.access_token;
}

function saveOrderAsServer_(o) {
  const r = UrlFetchApp.fetch(fsBase_() + '/orders/' + encodeURIComponent(o.id) + '?currentDocument.exists=false', {
    method: 'patch', contentType: 'application/json', headers: { Authorization: 'Bearer ' + serverToken_() },
    payload: JSON.stringify({ fields: encodeValue_(o).mapValue.fields }), muteHttpExceptions: true,
  });
  if (r.getResponseCode() === 200) return;
  throw new Error('The payment worked but the order could not be saved (' + r.getResponseCode() + '). Please WhatsApp us with payment ID ' + o.payment.razorpayPaymentId + '.');
}

function saveOrderAsCustomer_(o, idToken, paymentId) {
  const r = UrlFetchApp.fetch(fsBase_() + '/orders/' + encodeURIComponent(o.id) + '?currentDocument.exists=false&key=' + CFG.apiKey, {
    method: 'patch', contentType: 'application/json', headers: { Authorization: 'Bearer ' + idToken },
    payload: JSON.stringify({ fields: encodeValue_(o).mapValue.fields }), muteHttpExceptions: true,
  });
  if (r.getResponseCode() === 200) return;
  throw new Error('The test payment worked but the order could not be saved (' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200) + '). Payment ID ' + paymentId + '.');
}

/* Run once from the editor to check the setup (Razorpay key + database login). */
function testPaymentSetup() {
  razorpay_('get', '/orders?count=1');
  Logger.log('Razorpay key: OK (' + (PAY.keyId.indexOf('rzp_test_') === 0 ? 'TEST mode' : 'LIVE mode') + ')');
  if (PropertiesService.getScriptProperties().getProperty('FIREBASE_SERVICE_ACCOUNT')) { serverToken_(); Logger.log('Database server login: OK'); }
  else Logger.log('FIREBASE_SERVICE_ACCOUNT not set: test payments save with the customer login; needed before going live.');
}

/* ---------- WhatsApp alert to the owner (CallMeBot) ---------- */
function sendWhatsApp(text) {
  const key = PropertiesService.getScriptProperties().getProperty('CALLMEBOT_APIKEY');
  if (!key) return false;                                   // not set up: skip silently
  const url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent('+' + CFG.whatsapp) +
    '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(key);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('CallMeBot ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return true;
}

function notifyWhatsApp(o) {
  const a = o.address || {}, p = o.payment || {};
  const items = (o.items || []).map(function (i) { return '• ' + i.name + ' × ' + i.qty + (i.gift ? ' 🎁' : ''); }).join('\n');
  const pay = p.mode === 'cod'
    ? 'Partial COD – paid ' + rs(p.paidNow) + ', *collect ' + rs(p.dueOnDelivery) + ' in cash*'
    : 'Prepaid ' + rs(p.paidNow) + ' – do not collect cash';
  sendWhatsApp([
    (o.test ? '[TEST] ' : '') + '🛒 *New order ' + o.id + '* – ' + rs(o.total),
    items,
    (o.giftWrap ? 'Gift wrap: ' + rs(o.giftWrap) + '\n' : '') + pay,
    '📦 ' + a.name + ', ' + a.city + ' ' + a.pincode + ' · ' + a.phone,
    CFG.siteUrl + 'admin.html',
  ].join('\n\n'));
}

/* Run this once from the editor (select testWhatsApp > Run) to check the WhatsApp alert. */
function testWhatsApp() {
  const ok = sendWhatsApp('✅ Toy Kingdom: WhatsApp order alerts are working.');
  Logger.log(ok ? 'Sent. Check WhatsApp.' : 'CALLMEBOT_APIKEY is not set in Script properties.');
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
    return '<tr><td style="padding:8px;border-bottom:1px solid #eee">' + esc(i.name) + (i.gift ? ' <b>(Gift wrapped)</b>' : '') + '</td>' +
      '<td style="padding:8px;border-bottom:1px solid #eee;text-align:center">' + i.qty + '</td>' +
      '<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">' + rs(i.price * i.qty) + '</td></tr>';
  }).join('');
  const ship = o.shipping === 0 ? 'Free' : (o.shipping ? rs(o.shipping) : 'To be confirmed');
  const p = o.payment || {};
  return '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
    '<tr style="background:#F8EDFD"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px">Qty</th><th style="padding:8px;text-align:right">Amount</th></tr>' +
    rows +
    '<tr><td colspan="2" style="padding:6px 8px">Subtotal</td><td style="padding:6px 8px;text-align:right">' + rs(o.subtotal) + '</td></tr>' +
    (o.giftWrap ? '<tr><td colspan="2" style="padding:6px 8px">Gift wrap</td><td style="padding:6px 8px;text-align:right">' + rs(o.giftWrap) + '</td></tr>' : '') +
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
    '<div style="background:#9D10DB;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;font-size:20px;font-weight:bold">' + CFG.storeName + '</div>' +
    '<div style="border:1px solid #eee;border-top:0;padding:22px;border-radius:0 0 12px 12px">' + inner + '</div>' +
    '<p style="font-size:12px;color:#888;text-align:center;margin-top:14px">' + CFG.storeName + ' · ' + CFG.phone + ' · <a href="' + CFG.siteUrl + '" style="color:#9D10DB">' + CFG.siteUrl + '</a></p></div>';
}

/* Plain-text version of the e-mail (sent together with the HTML version) */
function plainText(o, admin) {
  const a = o.address, p = o.payment || {};
  const lines = [];
  if (o.test) lines.push('TEST ORDER: no money was taken.', '');
  lines.push(admin ? 'New order ' + o.id + ' (' + day(o.created) + ')' : 'Hi ' + a.name.split(' ')[0] + ', thank you! Your order ' + o.id + ' is confirmed.', '');
  o.items.forEach(function (i) { lines.push('- ' + i.name + ' x ' + i.qty + ' = ' + rs(i.price * i.qty) + (i.gift ? ' (gift wrapped)' : '')); });
  if (o.giftWrap) lines.push('Gift wrap: ' + rs(o.giftWrap));
  lines.push('Shipping: ' + (o.shipping ? rs(o.shipping) : 'Free'));
  lines.push('', 'Total: ' + rs(o.total), 'Paid online: ' + rs(p.paidNow) + (p.dueOnDelivery ? ' | Pay on delivery (cash): ' + rs(p.dueOnDelivery) : ''), '');
  lines.push((admin ? 'Ship to: ' : 'Delivering to: ') + a.name + ', ' + a.house + ', ' + a.area + (a.landmark ? ', Landmark: ' + a.landmark : '') + ', ' + a.city + ', ' + a.state + ' - ' + a.pincode + ' | Mobile: ' + a.phone);
  lines.push('');
  if (admin) lines.push('Customer: ' + o.email, 'Attached: shipping label and bill.', 'Admin orders: ' + CFG.siteUrl + 'admin.html');
  else lines.push('Delivery in 3-5 working days. Your bill is attached as a PDF.', 'View your order: ' + CFG.siteUrl + 'order.html?id=' + encodeURIComponent(o.id),
    'Questions? Reply to this e-mail or WhatsApp ' + CFG.phone + '.');
  lines.push('', CFG.storeName + ' · ' + CFG.siteUrl);
  return lines.join('\n');
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
    '<p><a href="' + CFG.siteUrl + 'order.html?id=' + encodeURIComponent(o.id) + '" style="background:#9D10DB;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;display:inline-block">View your order</a></p>' +
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
    '<p><a href="' + CFG.siteUrl + 'admin.html" style="background:#9D10DB;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;display:inline-block">Open admin orders</a></p>');
}

/** Run this once from the editor (select it, click Run) to check e-mail works and to grant permission. */
function testMail() {
  MailApp.sendEmail(CFG.adminEmail, 'Toy Kingdom mailer test', 'The order mailer can send e-mail. Remaining daily quota: ' + MailApp.getRemainingDailyQuota());
}
