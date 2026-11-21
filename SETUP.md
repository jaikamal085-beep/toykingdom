# Toy Kingdom: setup and free tools

## Running locally

From this folder, run:

```
python -m http.server 8080 --bind 127.0.0.1
```

Then open **http://localhost:8080** (use `localhost`: Firebase login only allows authorised domains).
Log in at `account.html`. The admin page is `admin.html`.

**Current setup (connected):**
- **Login:** Firebase Authentication, project `toykingdom-ad0ab`. Admin: `toykingdom1309@gmail.com`.
  The admin email must be **verified** (button on the account page) before the admin page opens.
- **Products added in the admin page:** Cloud Firestore, database `default` (Enterprise edition),
  collection `products`. The 112 imported products stay built into `assets/products.js`.
- **Photos and videos:** uploaded from the admin page to Cloudinary (cloud `jk6jvwvb`, unsigned
  preset `toykingdom_products`, folder `toykingdom/products`). Up to 4 photos (10 MB each) and
  1 video (100 MB max) per product.
- Settings: `assets/firebase-config.js` (public values only, no secrets).
- Security: only the verified admin can add, edit or delete products. This is enforced by the
  Firestore rules, not by the page.

---

## Free tools you need

| Need | Tool | Free plan | Notes |
|---|---|---|---|
| Login / create account | **Firebase Authentication** | Spark (free) | Email + password sign-in. Passwords must be **at least 6 characters**, so the admin password `1234` must change, e.g. to `visu@1234`. |
| Database (products, users, orders) | **Cloud Firestore** (Firebase) | Spark (free) | Free daily read/write quota and about 1 GB of storage, enough for a small store. |
| Image storage | **Cloudinary** | Free plan | Upload photos and paste the link into the admin page. Resizes and compresses images automatically. Its free "Upload Widget" can be added to the admin page later. |
| Video storage | **YouTube (Unlisted)**, or **Cloudinary** video | Free | YouTube is free with no storage limit. Upload as *Unlisted* and paste the link. Cloudinary videos use up your free credits faster. |
| Website hosting | **Firebase Hosting** (or Netlify / Vercel / GitHub Pages) | Free | Includes HTTPS and a free subdomain such as `toykingdom.web.app`. |
| Code + backups | **GitHub** + **VS Code** | Free | Keeps the version history of the site. |
| Domain name (optional) | Any registrar | **Paid**, roughly ₹500–1,000/year | e.g. `toykingdom.in`. Not required, since hosting gives a free address. |
| Contact form by email (optional) | **EmailJS** | Free tier | Only needed if you want emails as well as WhatsApp messages. |
| Online payments (later) | **Razorpay** | No setup fee | Charges a fee per successful payment. |

> **Why not Firebase Storage for images?** New Firebase projects now need the pay-as-you-go
> *Blaze* plan (with a card attached) to use Cloud Storage. Cloudinary + YouTube keep you on
> fully free plans. Always check each tool's current free limits on its pricing page.

---

## Moving to Firebase (when you're ready)

1. Go to https://console.firebase.google.com, then **Add project**.
2. **Build → Authentication → Sign-in method**: enable **Email/Password**.
   Create the admin user `toykingdom1309@gmail.com` with a password of 6+ characters.
3. **Build → Firestore Database → Create database** (production mode).
4. Security rules in use (the admin must have a verified email):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /products/{id} {
      allow read: if true;
      allow create, update, delete: if request.auth != null
        && request.auth.token.email == 'toykingdom1309@gmail.com'
        && request.auth.token.email_verified == true;
    }
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

5. **Project settings → Your apps → Web app**: copy the `firebaseConfig` and send it to me.
   I'll replace the `localStorage` code in `assets/store.js` with Firebase calls.
6. Move the 112 imported products and anything you exported with **Export JSON** into Firestore.
7. Deploy with `npm install -g firebase-tools`, then `firebase login`, `firebase init hosting`
   and `firebase deploy`.

## Cloudinary

Uploads happen from the admin page (**Upload photos** / **Upload video**). Free plan: 25 credits
a month (1 credit = 1 GB storage, 1 GB viewing bandwidth, or 1,000 resizes). Photos and videos are
compressed automatically when shown. Check usage under Cloudinary → Settings → Usage.

## Search (assets/search.js)

The header search bar (every page) and All Products results use a hybrid engine that runs in the browser:
- **Inverted index (BM25F):** keyword ranking with search-as-you-type prefixes, synonyms (e.g. drone = quadcopter) and typo tolerance (e.g. "bubbel").
- **Vector search (HNSW):** hashed word and character-trigram vectors find similar product names. These are lexical vectors, not AI embeddings.
- **B-Tree term dictionary:** ordered prefix and typo scans, with O(log n) inserts.
- Results are merged with Reciprocal Rank Fusion.
- Products added, edited or deleted in the admin page update the index in place, with no rebuild. Deleted vectors are compacted once more than 30% of the graph is deleted.
- Synonyms live in `SYN_GROUPS` at the top of the file, so you can add your own.

## Catalogue in the cloud

- All 112 products' photos (403 images, 48 MB) are copied to Cloudinary as `tk-<productId>-<n>`.
  `assets/products.js` now points to them. The original links are in `assets/products.original.js`.
- Admin page → **Move all products to Firebase** copies the catalogue into Firestore in one go.
  After that, Firestore is the source for every product and `products.js` is only an offline fallback.
- Visitors' browsers cache the product list for 5 minutes to save Firestore reads. The admin page always reads fresh.
- New photo uploads are compressed in the browser first: longest side at most 2560 px, WebP at quality 0.92.
  This looks the same as the original, and the original is kept if compressing saves less than 10%.
  Videos are stored as uploaded and delivered compressed by Cloudinary (H.264, auto quality, at most 1280 px).

## Viewing on phones and other devices on the same Wi-Fi

Run `python -m http.server 8080 --bind 0.0.0.0` from this folder, then open `http://<this PC's Wi-Fi IP>:8080`
(it was http://192.168.0.102:8080). A Windows Firewall rule, "Toy Kingdom site (LAN 8080)", allows this on
Private networks only. Remove it with: `Remove-NetFirewallRule -DisplayName "Toy Kingdom site (LAN 8080)"`.
Logging in from another device also needs that IP added under Firebase → Authentication → Settings → Authorized domains.

## Order confirmation e-mails (Google Apps Script)

After an order is placed, the customer's browser builds the bill and label PDFs (`assets/mailer.js`)
and sends them to a Google Apps Script web app (`email/order-mailer.gs`). The script runs in the store's
Gmail account and sends:
- the customer: order confirmation + bill PDF
- the admin: new-order details + bill PDF + shipping label PDF

The script reads the order from Firestore with the customer's own login token, only writes to the
order's e-mail and the admin address, ignores orders older than 2 hours, and sends each order once.
The free Gmail limit is about 100 recipients per day, which is roughly 50 orders a day.
To switch e-mails on, deploy the script and put its URL in `window.MAIL_ENDPOINT` in `assets/firebase-config.js`.
