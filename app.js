import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ================= CONFIG =================
const SERVER = "https://auralis-ai-6dnq.onrender.com";

// ================= STATE =================
let currentUser = null;
let currentChatId = null;
let voiceMode = localStorage.getItem("voice") || "random";

const cache = new Map();
let memoryCache = "";
let memoryTime = 0;

// 📊 analytics tracking
let dailyStats = {};

// ================= UI =================
const chatBox = document.getElementById("chatBox");
const textInput = document.getElementById("textInput");
const status = document.getElementById("status");
const historyList = document.getElementById("historyList");
const analyticsBox = document.getElementById("analyticsBox");

// ================= NAV =================
window.openTab = function (tab) {
  document.querySelectorAll(".page").forEach(p => p.style.display = "none");
  document.getElementById(tab).style.display = "block";

  if (tab === "analytics") loadAnalytics();
};

// ================= AUTH =================
onAuthStateChanged(auth, async (user) => {
  if (!user) return (window.location.href = "auth.html#login");

  currentUser = user;

  document.getElementById("userInfo").innerText = user.email;

  loadChats();
  getMemory();
});

// ================= MEMORY =================
async function getMemory() {
  const now = Date.now();

  if (memoryCache && now - memoryTime < 20000) {
    return memoryCache;
  }

  const q = query(
    collection(db, "users", currentUser.uid, "history"),
    orderBy("createdAt", "desc"),
    limit(5)
  );

  const snap = await getDocs(q);

  let mem = "";
  snap.forEach(d => {
    const x = d.data();
    mem += `User:${x.user}\nAI:${x.ai}\n`;
  });

  memoryCache = mem;
  memoryTime = now;

  return mem;
}

// ================= PROFILE =================
function getProfile() {
  return JSON.parse(localStorage.getItem("profile_" + currentUser.uid) || "{}");
}

function updateProfile(msg) {
  let p = getProfile();

  if (msg.includes("my name is")) {
    p.name = msg.split("my name is")[1]?.trim();
  }

  if (msg.includes("I like")) {
    p.likes = (p.likes || []).concat(msg.split("I like")[1]?.trim());
  }

  localStorage.setItem("profile_" + currentUser.uid, JSON.stringify(p));
}

// ================= RENDER =================
function render(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = text;

  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ================= SOUND (OPTIMIZED) =================
let lastSound = 0;

function playSound() {
  const now = Date.now();
  if (now - lastSound < 120) return;

  lastSound = now;

  const audio = new Audio("https://www.soundjay.com/keyboard/keyboard-1.mp3");
  audio.volume = 0.04;
  audio.play().catch(() => {});
}

// ================= VOICE OUTPUT =================
function speak(text) {
  const utter = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();

  if (voiceMode === "random") {
    utter.voice = voices[Math.floor(Math.random() * voices.length)];
  }

  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

// ================= 🎤 VOICE INPUT (REAL SPEECH TO TEXT) =================
let recognition;

if ("webkitSpeechRecognition" in window) {
  recognition = new webkitSpeechRecognition();
  recognition.continuous = false;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    textInput.value = text;
    sendMessage();
  };
}

window.startHoldRecord = function () {
  if (recognition) recognition.start();
};

window.stopHoldRecord = function () {
  if (recognition) recognition.stop();
};

// ================= AI STREAM (SMOOTH) =================
async function askAI(message, box) {

  const key = message.toLowerCase();

  if (cache.has(key)) {
    box.textContent = cache.get(key);
    return cache.get(key);
  }

  const memory = await getMemory();
  const profile = getProfile();

  const res = await fetch(`${SERVER}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      memory,
      profile,
      email: currentUser.email
    })
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let result = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value);

    if (buffer.length > 20) {
      result += buffer;
      box.textContent = result + "▌";
      buffer = "";

      playSound();
    }
  }

  result += buffer;
  box.textContent = result;

  cache.set(key, result);

  return result;
}

// ================= SEND =================
window.sendMessage = async function () {

  const text = textInput.value.trim();
  if (!text) return;

  textInput.value = "";

  updateProfile(text);

  render("user", text);

  const box = document.createElement("div");
  box.className = "msg ai";
  box.textContent = "Thinking...";
  chatBox.appendChild(box);

  const reply = await askAI(text, box);

  saveHistory(text, reply);
  trackUsage(); // 📊 analytics

  speak(reply);

  status.textContent = "";
};

// ================= HISTORY =================
async function saveHistory(user, ai) {
  await addDoc(collection(db, "users", currentUser.uid, "history"), {
    user,
    ai,
    createdAt: new Date()
  });
}

// ================= LOAD CHATS =================
async function loadChats() {
  historyList.innerHTML = "";

  const q = query(
    collection(db, "users", currentUser.uid, "chats"),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(q);

  snap.forEach(d => {
    const data = d.data();
    const id = d.id;

    const div = document.createElement("div");
    div.className = "msg ai";

    div.innerHTML = `
      ${data.name}
      <button onclick="openChat('${id}')">Open</button>
    `;

    historyList.appendChild(div);
  });
}

// ================= CHAT OPEN =================
window.openChat = async function (id) {
  currentChatId = id;
  chatBox.innerHTML = "";

  const q = query(
    collection(db, "users", currentUser.uid, "chats", id, "messages"),
    orderBy("createdAt", "asc")
  );

  const snap = await getDocs(q);

  snap.forEach(m => {
    const d = m.data();
    render("user", d.user);
    render("ai", d.ai);
  });

  openTab("home");
};

// ================= NEW CHAT =================
window.createNewChat = async function () {
  const ref = await addDoc(collection(db, "users", currentUser.uid, "chats"), {
    name: "New Chat",
    createdAt: new Date()
  });

  currentChatId = ref.id;
  chatBox.innerHTML = "";
  loadChats();
};

// ================= 📊 ANALYTICS =================
function trackUsage() {
  const today = new Date().toDateString();

  if (!dailyStats[today]) {
    dailyStats[today] = 0;
  }

  dailyStats[today]++;

  localStorage.setItem("stats_" + currentUser.uid, JSON.stringify(dailyStats));
}

function loadAnalytics() {
  const data = JSON.parse(localStorage.getItem("stats_" + currentUser.uid) || "{}");

  const labels = Object.keys(data);
  const values = Object.values(data);

  analyticsBox.innerHTML = `
    <canvas id="chart"></canvas>
  `;

  setTimeout(() => {
    new Chart(document.getElementById("chart"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Messages per Day",
          data: values
        }]
      }
    });
  }, 200);
}

// ================= LOGOUT =================
window.logout = async function () {
  await signOut(auth);
  window.location.href = "auth.html#login";
};