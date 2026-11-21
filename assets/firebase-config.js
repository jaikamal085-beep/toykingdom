/* Firebase web config for project toykingdom-ad0ab.
   These values are public by design (they ship in every Firebase website);
   data is protected by the Firestore security rules, not by hiding this. */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyA8Tf9YM0eAvsAJhTIGIG4fbvyT0xCgWXk",
  authDomain: "toykingdom-ad0ab.firebaseapp.com",
  projectId: "toykingdom-ad0ab",
  storageBucket: "toykingdom-ad0ab.firebasestorage.app",
  messagingSenderId: "854203974425",
  appId: "1:854203974425:web:3a918172e8c2801c0dbb88"
};
window.ADMIN_EMAIL = "toykingdom1309@gmail.com";
/* Firestore database ID: the project uses an Enterprise-edition database named "default"
   (not the standard "(default)"), so code must call getFirestore(app, FIRESTORE_DB). */
window.FIRESTORE_DB = "default";

/* Order e-mails: URL of the deployed Google Apps Script web app (email/order-mailer.gs).
   Empty = e-mails switched off. Public value; the script itself checks every request. */
window.MAIL_ENDPOINT = "https://script.google.com/macros/s/AKfycbxDbp_ArvT0MRVhcP8drFLfLWZuh2aMpg0YA80Hqwj7dhYIQ6xju6gvJOlPJ8y2PWX0jQ/exec";

/* Cloudinary: unsigned upload preset (public values, no secret here). */
window.CLOUDINARY = { cloudName: "jk6jvwvb", uploadPreset: "toykingdom_products", folder: "toykingdom/products" };
