'use strict';
/* ==========================================================================
   Data layer
   - Login:     Firebase Authentication (SDK loaded by assets/fb.js)
   - Products:  the 112 imported products are built in (assets/products.js);
                products added in the admin page live in Cloud Firestore
                (collection "products"), read/written through the REST API.
   - Uploads:   photos and videos go to Cloudinary (unsigned upload preset).
   Settings come from assets/firebase-config.js.
   Who may change products is enforced by the Firestore security rules,
   not by this file.
   ========================================================================== */
const CFG = window.FIREBASE_CONFIG;
const ADMIN_EMAIL = String(window.ADMIN_EMAIL || '').toLowerCase();
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${CFG.projectId}/databases/${encodeURIComponent(window.FIRESTORE_DB || '(default)')}/documents`;
const REMOTE_CACHE = 'tk-remote-products';   // last products read from Firestore (offline fallback)
const LEGACY_KEY = 'tk-admin-products';      // products saved by the old browser-only admin page
const BUILTIN_ORDER = PRODUCTS.map(p => String(p.id));   // original catalogue order (kept after import)
const BUILTIN_IMGS = new Map(PRODUCTS.map(p => [String(p.id), p.imgs]));   // Cloudinary photo links from products.js
const onCloudinary = u => /^https:\/\/res\.cloudinary\.com\//i.test(String(u));

/* Writes many product documents at once (Firestore commit, max 400 per batch). */
async function fsCommit(docs, onProgress) {
  const token = await Auth.token();
  const root = `projects/${CFG.projectId}/databases/${window.FIRESTORE_DB || '(default)'}/documents/products/`;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const r = await fetch(`${FS_BASE}:commit?key=${CFG.apiKey}`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: chunk.map(d => ({ update: { name: root + d.id, fields: fsEncode(d).mapValue.fields } })) }),
    });
    if (!r.ok) {
      if (r.status === 403) throw new Error('Permission denied. Only the verified admin account can change products.');
      let m = ''; try { m = (await r.json()).error.message; } catch (e) { /* ignore */ }
      throw new Error(`Saving failed (${r.status}${m ? ': ' + m : ''}).`);
    }
    if (onProgress) onProgress(Math.min(docs.length, i + 400), docs.length);
  }
}

const readLS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const normEmail = e => String(e || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/* ---------- Firestore REST value encoding ---------- */
function fsDecode(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsDecode);
  if ('mapValue' in v) return fsFields(v.mapValue.fields);
  return null;
}
const fsFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, fsDecode(v)]));
function fsEncode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsEncode) } };
  switch (typeof v) {
    case 'boolean': return { booleanValue: v };
    case 'number': return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    case 'object': return { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, fsEncode(x)])) } };
    default: return { stringValue: String(v) };
  }
}

async function fetchRemoteProducts() {
  const r = await fetch(`${FS_BASE}:runQuery?key=${CFG.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'products' }], limit: 1000 } }),
  });
  if (!r.ok) throw new Error('Database read failed (' + r.status + ')');
  return (await r.json()).filter(x => x.document).map(x => fsFields(x.document.fields))
    .sort((a, b) => (b.created || 0) - (a.created || 0));
}

async function fsWrite(method, id, data) {
  const token = await Auth.token();
  const r = await fetch(`${FS_BASE}/products/${encodeURIComponent(String(id))}?key=${CFG.apiKey}`, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? JSON.stringify({ fields: fsEncode(data).mapValue.fields }) : undefined,
  });
  if (r.ok) return;
  if (r.status === 403) throw new Error('Permission denied. Only the verified admin account can change products.');
  let m = ''; try { m = (await r.json()).error.message; } catch (e) { /* ignore */ }
  throw new Error(`Could not save to the database (${r.status}${m ? ': ' + m : ''}).`);
}

/* ---------- catalogue merge ----------
   Before the one-time import, Firestore only holds admin-added products and they are
   shown in front of the built-in list (assets/products.js). After the import
   (products marked imported:true), Firestore is the whole catalogue and products.js
   is only an offline fallback. */
let remoteProducts = [];
const IMPORT_BASE = 1700000000000;           // "created" for imported products: older than anything added later
const catalogueImported = () => remoteProducts.some(p => p.imported);
function mergeIntoCatalogue(p) {
  const i = PRODUCTS.findIndex(x => String(x.id) === String(p.id));
  if (p.deleted) { if (i >= 0) PRODUCTS.splice(i, 1); return; }
  if (i >= 0) PRODUCTS[i] = p; else PRODUCTS.unshift(p);
}
function buildCatalogue() {
  const live = remoteProducts.filter(p => !p.deleted);
  if (catalogueImported()) { PRODUCTS.length = 0; PRODUCTS.push(...live); }
  else live.slice().reverse().forEach(mergeIntoCatalogue);
}
function dropFromCatalogue(id) {
  const i = PRODUCTS.findIndex(x => String(x.id) === String(id));
  if (i >= 0) PRODUCTS.splice(i, 1);
}

/* ---------- Firebase Auth hookup (assets/fb.js calls __tkFirebaseLoaded) ---------- */
let fbAuth = null, fb = null, authUser = null, resolveAuth;
const authReady = new Promise(r => { resolveAuth = r; });
window.__tkFirebaseLoaded = (auth, fns) => {
  fbAuth = auth; fb = fns;
  fns.onAuthStateChanged(auth, u => { authUser = u; resolveAuth(); });
};

/* Products are cached in the browser for a few minutes so repeat page views don't
   re-read the database (saves Firestore read quota). The admin page always reads fresh. */
const CACHE_MINUTES = 5;
const readCache = () => { const c = readLS(REMOTE_CACHE, null); return Array.isArray(c) ? { t: 0, list: c } : (c || { t: 0, list: [] }); };
const writeCache = list => writeLS(REMOTE_CACHE, { t: Date.now(), list });

/* Everything on the page waits for this: login state known + products loaded. */
const TK_READY = (async () => {
  const cache = readCache();
  const fresh = document.body.dataset.page !== 'admin' && cache.list.length && Date.now() - cache.t < CACHE_MINUTES * 60000;
  const products = fresh ? Promise.resolve(cache.list) : withTimeout(fetchRemoteProducts(), 6000)
    .then(list => { writeCache(list); return list; })
    .catch(e => { console.warn('Using cached products:', e.message); return cache.list; });
  const [list] = await Promise.all([
    products,
    withTimeout(authReady, 10000).catch(() => console.warn('Login service did not load.')),
  ]);
  remoteProducts = list;
  buildCatalogue();
})();

/* ---------- Auth ---------- */
const AUTH_ERRORS = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/invalid-login-credentials': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/email-already-in-use': 'An account with this email already exists. Please log in.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
  'auth/network-request-failed': 'Network error. Check your internet connection and try again.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/missing-password': 'Please enter your password.',
  'auth/operation-not-allowed': 'Google sign-in isn’t switched on yet. Please use email and password for now.',
  'auth/unauthorized-domain': 'Google sign-in isn’t allowed on this web address yet (add it under Firebase → Authentication → Authorized domains).',
  'auth/account-exists-with-different-credential': 'An account with this email already exists. Log in with your email and password.',
  'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Please allow pop-ups and try again.',
  'auth/web-storage-unsupported': 'Please turn off private browsing or allow cookies to sign in with Google.',
};
const authErr = e => new Error(AUTH_ERRORS[e && e.code] || (e && e.message) || 'Something went wrong.');
function needFb() {
  if (!fbAuth) throw new Error('The login service could not load. Check your internet connection and reload the page.');
}

const Auth = {
  /* { uid, email, name, verified, role: 'admin'|'customer', adminEmail } or null */
  current() {
    const u = authUser; if (!u) return null;
    const email = normEmail(u.email), adminEmail = email === ADMIN_EMAIL;
    return {
      uid: u.uid, email, name: u.displayName || email.split('@')[0], verified: !!u.emailVerified,
      role: adminEmail && u.emailVerified ? 'admin' : 'customer', adminEmail,
    };
  },
  isAdmin() { const s = this.current(); return !!s && s.role === 'admin'; },

  async register(name, email, password) {
    name = String(name || '').trim(); email = normEmail(email);
    if (!name) throw new Error('Please enter your name.');
    if (!EMAIL_RE.test(email)) throw new Error('Please enter a valid email address.');
    if (String(password).length < 6) throw new Error('Password must be at least 6 characters.');
    needFb();
    try {
      const cred = await fb.createUserWithEmailAndPassword(fbAuth, email, password);
      await fb.updateProfile(cred.user, { displayName: name });
      try { await fb.sendEmailVerification(cred.user); } catch (e) { /* optional for customers */ }
      authUser = fbAuth.currentUser;
      return this.current();
    } catch (e) { throw authErr(e); }
  },

  async login(email, password) {
    email = normEmail(email);
    if (!EMAIL_RE.test(email) || !password) throw new Error('Please enter your email and password.');
    needFb();
    try {
      await fb.signInWithEmailAndPassword(fbAuth, email, password);
      authUser = fbAuth.currentUser;
      return this.current();
    } catch (e) { throw authErr(e); }
  },

  /* Google sign-in: popup first; full-page redirect if the popup is blocked.
     Returns the session, or null when the user simply closed the Google window. */
  async google() {
    needFb();
    const provider = new fb.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await fb.signInWithPopup(fbAuth, provider);
      authUser = fbAuth.currentUser;
      return this.current();
    } catch (e) {
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return null;
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-environment')) {
        await fb.signInWithRedirect(fbAuth, provider);                 // page navigates away to Google
        return new Promise(() => {});
      }
      throw authErr(e);
    }
  },

  _err: e => authErr(e),

  async logout() { if (fbAuth) await fb.signOut(fbAuth); authUser = null; },

  async sendVerification() {
    needFb();
    if (!fbAuth.currentUser) throw new Error('Please log in first.');
    try { await fb.sendEmailVerification(fbAuth.currentUser); } catch (e) { throw authErr(e); }
  },

  /* Re-reads the account from Firebase (e.g. after clicking the verification link). */
  async refresh() {
    needFb();
    const u = fbAuth.currentUser; if (!u) return null;
    try { await fb.reload(u); await u.getIdToken(true); } catch (e) { throw authErr(e); }
    authUser = fbAuth.currentUser;
    return this.current();
  },

  async resetPassword(email) {
    email = normEmail(email);
    if (!EMAIL_RE.test(email)) throw new Error('Enter your email address above first.');
    needFb();
    try { await fb.sendPasswordResetEmail(fbAuth, email); } catch (e) { throw authErr(e); }
  },

  async token() {
    needFb();
    if (!fbAuth.currentUser) throw new Error('Your login has expired. Please log in again.');
    return fbAuth.currentUser.getIdToken();
  },
};

/* ---------- Products added by the admin (Firestore) ---------- */
const ProductStore = {
  all() { return remoteProducts.filter(p => !p.deleted); },
  get(id) { return this.all().find(p => String(p.id) === String(id)); },

  async save(p) {
    const id = p.id || Date.now();
    const old = this.get(id) || {};
    const doc = { ...old, ...p, id, custom: !old.imported, created: old.created || Date.now(), updated: Date.now() };
    await fsWrite('PATCH', id, doc);
    const i = remoteProducts.findIndex(x => String(x.id) === String(id));
    if (i >= 0) remoteProducts[i] = doc; else remoteProducts.unshift(doc);
    writeCache(remoteProducts);
    mergeIntoCatalogue(doc);
    if (window.SEARCH) SEARCH.upsert(doc);          // keep the search index current
    return doc;
  },

  async remove(id) {
    await fsWrite('DELETE', id);
    remoteProducts = remoteProducts.filter(p => String(p.id) !== String(id));
    writeCache(remoteProducts);
    dropFromCatalogue(id);
    if (window.SEARCH) SEARCH.remove(id);
  },

  isImported() { return catalogueImported(); },

  /* built-in products (assets/products.js) that are not in Firestore yet */
  pendingImport() {
    const have = new Set(remoteProducts.map(p => String(p.id)));
    return PRODUCTS.filter(p => !p.custom && !p.imported && !have.has(String(p.id)));
  },

  /* One-time move of the built-in catalogue into Firestore, in atomic batches of 400 writes. */
  async importCatalogue(onProgress) {
    const list = this.pendingImport();
    const order = new Map(BUILTIN_ORDER.map((id, i) => [id, i]));
    const docs = list.map(p => ({
      ...p, imgs: (BUILTIN_IMGS.get(String(p.id)) || p.imgs), imported: true, custom: false,
      created: IMPORT_BASE - (order.get(String(p.id)) ?? 0) * 1000, updated: Date.now(),
    }));
    await fsCommit(docs, onProgress);
    remoteProducts.push(...docs);
    remoteProducts.sort((a, b) => (b.created || 0) - (a.created || 0));
    writeCache(remoteProducts);
    buildCatalogue();
    return docs.length;
  },

  /* imported products whose photos still point to the old website instead of Cloudinary */
  pendingImageFix() {
    return remoteProducts.filter(p => p.imported && (p.imgs || []).some(u => !onCloudinary(u))
      && (BUILTIN_IMGS.get(String(p.id)) || []).every(onCloudinary) && (BUILTIN_IMGS.get(String(p.id)) || []).length);
  },
  async fixImages(onProgress) {
    const docs = this.pendingImageFix().map(p => ({ ...p, imgs: BUILTIN_IMGS.get(String(p.id)), updated: Date.now() }));
    await fsCommit(docs, onProgress);
    const byId = new Map(docs.map(d => [String(d.id), d]));
    remoteProducts = remoteProducts.map(p => byId.get(String(p.id)) || p);
    writeCache(remoteProducts);
    buildCatalogue();
    return docs.length;
  },

  /* products saved by the old browser-only admin page, waiting to be moved to Firebase */
  legacy() { return readLS(LEGACY_KEY, []); },
  clearLegacy(ids) {
    const left = this.legacy().filter(p => !ids.includes(String(p.id)));
    if (left.length) writeLS(LEGACY_KEY, left); else { try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ } }
  },
};

/* ---------- Photo compression before upload ----------
   Visually lossless: longest side capped at 2560 px (the site shows at most ~1000 px)
   and re-encoded as WebP at quality 0.92 (JPEG 0.92 if the browser can't make WebP).
   Keeps the original whenever compression wouldn't save at least 10%. */
const COMPRESS = { maxSide: 2560, quality: 0.92 };
async function compressImage(file) {
  if (!/^image\/(jpeg|png|webp|bmp)$/i.test(file.type)) return file;      // leave GIF/SVG/HEIC untouched
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, COMPRESS.maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    const toBlob = type => new Promise(r => canvas.toBlob(r, type, COMPRESS.quality));
    let blob = await toBlob('image/webp');
    if (!blob || blob.type !== 'image/webp') {
      if (file.type === 'image/png') return file;                          // JPEG would lose transparency
      blob = await toBlob('image/jpeg');
    }
    if (!blob || blob.size > file.size * 0.9) return file;
    const ext = blob.type === 'image/webp' ? '.webp' : '.jpg';
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + ext, { type: blob.type });
  } catch (e) { return file; }                                              // any problem: upload the original
}

/* ---------- Cloudinary uploads (unsigned preset; no secret in the browser) ---------- */
const UPLOAD_LIMITS = { image: 10 * 1024 * 1024, video: 100 * 1024 * 1024 };
function cloudinaryUpload(file, kind, onProgress) {
  const C = window.CLOUDINARY;
  return new Promise((resolve, reject) => {
    if (file.size > UPLOAD_LIMITS[kind]) {
      reject(new Error(`"${file.name}" is too large (max ${UPLOAD_LIMITS[kind] / 1048576} MB).`)); return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${C.cloudName}/${kind}/upload`);
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let d = {}; try { d = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && d.secure_url) resolve(d);
      else reject(new Error((d.error && d.error.message) || `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your internet connection.'));
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', C.uploadPreset);
    xhr.send(fd);
  });
}

/* ==========================================================================
   Orders & saved addresses (Firestore: orders/{orderId}, users/{uid})
   Until the database rules include "orders", orders fall back to this
   browser's storage so checkout can still be tested (order.storage = 'local').
   ========================================================================== */
async function fsRequest(method, path, body) {
  const token = await Auth.token();
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${FS_BASE}${path}${sep}key=${CFG.apiKey}`, {
    method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.ok) return r.status === 204 ? null : r.json();
  let m = ''; try { m = (await r.json()).error.message; } catch (e) { /* ignore */ }
  const err = new Error(`Database error (${r.status}${m ? ': ' + m : ''}).`); err.status = r.status; throw err;
}
const fsQueryAuth = async q => (await fsRequest('POST', ':runQuery', { structuredQuery: q }))
  .filter(x => x.document).map(x => fsFields(x.document.fields));

const LOCAL_ORDERS = 'tk-orders-local';
const localOrders = () => readLS(LOCAL_ORDERS, []);
const byNewest = (a, b) => (b.created || 0) - (a.created || 0);

const Orders = {
  newId() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';                        // no 0/O/1/I mix-ups
    const r = [...crypto.getRandomValues(new Uint8Array(5))].map(b => A[b % 32]).join('');
    return `TK-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${r}`;
  },
  async create(order) {
    try {
      await fsRequest('PATCH', `/orders/${encodeURIComponent(order.id)}?currentDocument.exists=false`, { fields: fsEncode(order).mapValue.fields });
      return { ...order, storage: 'cloud' };
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) throw e;
      const saved = { ...order, storage: 'local' };                          // rules not published yet
      writeLS(LOCAL_ORDERS, [saved, ...localOrders()].slice(0, 50));
      return saved;
    }
  },
  async get(id) {
    const local = localOrders().find(o => o.id === id);
    if (local) return local;
    const d = await fsRequest('GET', `/orders/${encodeURIComponent(id)}`);
    return { ...fsFields(d.fields), storage: 'cloud' };
  },
  async mine() {
    const me = Auth.current(); if (!me) return [];
    let cloud = [];
    try {
      cloud = await fsQueryAuth({ from: [{ collectionId: 'orders' }], where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: me.uid } } }, limit: 100 });
    } catch (e) { if (e.status !== 403) throw e; }
    return [...cloud, ...localOrders().filter(o => o.uid === me.uid)].sort(byNewest);
  },
  async all() {                                                              // admin only (rules)
    let cloud = [];
    try { cloud = await fsQueryAuth({ from: [{ collectionId: 'orders' }], limit: 300 }); }
    catch (e) { if (e.status !== 403) throw e; }
    return [...cloud, ...localOrders()].sort(byNewest);
  },
  async setStatus(order, status) {
    const o = { ...order, status, updated: Date.now() }; delete o.storage;
    if (order.storage === 'local') { writeLS(LOCAL_ORDERS, localOrders().map(x => x.id === o.id ? { ...o, storage: 'local' } : x)); return; }
    await fsRequest('PATCH', `/orders/${encodeURIComponent(o.id)}?updateMask.fieldPaths=status&updateMask.fieldPaths=updated`, { fields: { status: fsEncode(status), updated: fsEncode(o.updated) } });
  },
};

/* Last delivery address of the logged-in customer (Firestore users/{uid}, with a local copy) */
const Profile = {
  key() { const me = Auth.current(); return me ? 'tk-addr-' + me.uid : null; },
  async getAddress() {
    const me = Auth.current(); if (!me) return null;
    try {
      const d = await fsRequest('GET', `/users/${me.uid}`);
      const f = fsFields(d.fields);
      if (f.address) return f.address;
    } catch (e) { /* no profile yet or rules: use local copy */ }
    return readLS(this.key(), null);
  },
  async saveAddress(address) {
    const me = Auth.current(); if (!me) return;
    const a = { ...address, savedAt: Date.now() };
    writeLS(this.key(), a);
    try {
      await fsRequest('PATCH', `/users/${me.uid}?updateMask.fieldPaths=address&updateMask.fieldPaths=email&updateMask.fieldPaths=updated`,
        { fields: { address: fsEncode(a), email: fsEncode(me.email), updated: fsEncode(Date.now()) } });
    } catch (e) { /* local copy is enough */ }
  },
};
