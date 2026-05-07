import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { countries } from "./countries.js";
import { genders } from "./gender.js";

// ================= UI =================
const signupBox = document.getElementById("signupBox");
const loginBox = document.getElementById("loginBox");
const title = document.getElementById("title");

const countrySelect = document.getElementById("country");
const genderSelect = document.getElementById("gender");

// ================= DROPDOWNS =================
countries.forEach(c => {
  const option = document.createElement("option");
  option.value = c.name;
  option.textContent = `${c.flag} ${c.name}`;
  countrySelect.appendChild(option);
});

genders.forEach(g => {
  const option = document.createElement("option");
  option.value = g.value;
  option.textContent = g.label;
  genderSelect.appendChild(option);
});

// ================= NAV =================
function showSignup() {
  signupBox.classList.add("active");
  loginBox.classList.remove("active");
  title.innerText = "Create Account";
}

function showLogin() {
  loginBox.classList.add("active");
  signupBox.classList.remove("active");
  title.innerText = "Login";
}

function handleRoute() {
  if (window.location.hash === "#login") showLogin();
  else showSignup();
}

handleRoute();
window.addEventListener("hashchange", handleRoute);

window.goLogin = () => (window.location.hash = "#login");
window.goSignup = () => (window.location.hash = "#signup");

// ================= SIGNUP =================
window.signup = async function () {

  const username = document.getElementById("username").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const dob = document.getElementById("dob").value;

  const country = countrySelect.value;
  const gender = genderSelect.value;

  if (!username || !email || !password || !phone || !dob) {
    alert("⚠️ Fill all fields");
    return;
  }

  try {

    console.log("🚀 Creating user...");

    // ================= CREATE USER =================
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCred.user;

    const age = calculateAge(dob);

    console.log("✅ UID:", user.uid);

    // ================= SAVE USER =================
    await setDoc(doc(db, "users", user.uid), {
      username,
      email,
      phone,
      country,
      gender,
      dob,
      age,
      plan: "free",
      usage: 0,
      createdAt: Date.now()
    });

    // ================= SAVE PHONE INDEX (SAFE UNIQUE STORAGE) =================
    // THIS replaces your broken query system
    await setDoc(doc(db, "phones", phone), {
      uid: user.uid,
      email: email,
      createdAt: Date.now()
    });

    alert("✅ Signup successful!");
    window.location.hash = "#login";

  } catch (err) {
    console.error("🔥 SIGNUP ERROR:", err);

    if (err.code === "auth/email-already-in-use") {
      alert("❌ Email already exists");
    } else if (err.code === "auth/weak-password") {
      alert("❌ Password too weak");
    } else {
      alert(err.message);
    }
  }
};

// ================= LOGIN =================
window.login = async function () {

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();

  if (!email || !password) {
    alert("⚠️ Enter email and password");
    return;
  }

  try {

    await signInWithEmailAndPassword(auth, email, password);

    alert("✅ Login successful");
    window.location.href = "app.html";

  } catch (err) {
    console.error("🔥 LOGIN ERROR:", err);
    alert("❌ " + err.message);
  }
};

// ================= AGE =================
function calculateAge(dob) {
  const birth = new Date(dob);
  const diff = Date.now() - birth.getTime();
  const ageDate = new Date(diff);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}