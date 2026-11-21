/* Loads Firebase Authentication and hands it to assets/store.js. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, sendEmailVerification, sendPasswordResetEmail, signOut, reload,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';

const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
window.__tkFirebaseLoaded(auth, {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, sendEmailVerification, sendPasswordResetEmail, signOut, reload,
});
