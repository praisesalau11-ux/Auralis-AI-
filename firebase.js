import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC8Fid9JPDBGg9o-YXeWULLBrETRCPnw0I",
  authDomain: "voice-translator-app-88354.firebaseapp.com",
  projectId: "voice-translator-app-88354",
  storageBucket: "voice-translator-app-88354.firebasestorage.app",
  messagingSenderId: "192540316575",
  appId: "1:192540316575:web:958f5df0469d41f69a23aa"
};

const app = initializeApp(firebaseConfig);

const storage = getStorage(app);
const db = getFirestore(app);
const auth = getAuth(app);

export { storage, db, auth };