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
const SERVER =
  window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://auralis-ai-6dnq.onrender.com";

// ================= STATE =================
let currentUser = null;
let currentChatId = null;

let voiceMode = localStorage.getItem("voice") || "random";

const cache = new Map();

let memoryCache = "";
let memoryTime = 0;

let recognition = null;
let isRecording = false;

let dailyStats = JSON.parse(
  localStorage.getItem("stats") || "{}"
);

// ================= UI =================
const chatBox = document.getElementById("chatBox");
const textInput = document.getElementById("textInput");
const status = document.getElementById("status");
const historyList = document.getElementById("historyList");
const analyticsBox = document.getElementById("analyticsBox");
const fileInput = document.getElementById("fileInput");

let uploadedFile = null;

window.pickFile = () => {
  fileInput.click();
};

window.takePhoto = () => {
  fileInput.accept = "image/*";
  fileInput.capture = "environment";
  fileInput.click();
};

fileInput.addEventListener("change", async e => {

  const file = e.target.files[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {

    uploadedFile = {
      name: file.name,
      type: file.type,
      data: reader.result
    };

    render(
      "user",
      "📎 " + file.name
    );

  };

  reader.readAsDataURL(file);

});

// ================= NAV =================
window.openTab = function (tab) {

  document.querySelectorAll(".page").forEach(page => {
    page.classList.add("hidden");
  });

  document.getElementById(tab).classList.remove("hidden");

  if (tab === "analytics") {
    loadAnalytics();
  }
};

// ================= AUTH =================
onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "auth.html#login";
    return;
  }

  currentUser = user;

  document.getElementById("userInfo").innerText = user.email;

  try {
    await loadChats();
    await getMemory();
  } catch (err) {
    console.log(err);
  }
});

// ================= MEMORY =================
async function getMemory() {

  const now = Date.now();

  if (memoryCache && now - memoryTime < 20000) {
    return memoryCache;
  }

  try {

    const q = query(
      collection(db, "users", currentUser.uid, "history"),
      orderBy("createdAt", "desc"),
      limit(5)
    );

    const snap = await getDocs(q);

    let mem = "";

    snap.forEach(doc => {

      const data = doc.data();

      mem += `
User: ${data.user}
AI: ${data.ai}
`;
    });

    memoryCache = mem;
    memoryTime = now;

    return mem;

  } catch (err) {
    console.log("MEMORY ERROR:", err);
    return "";
  }
}

// ================= PROFILE =================
function getProfile() {

  return JSON.parse(
    localStorage.getItem("profile_" + currentUser.uid) || "{}"
  );
}

function updateProfile(message) {

  const profile = getProfile();

  const lower = message.toLowerCase();

  if (lower.includes("my name is")) {

    profile.name =
      message.split("my name is")[1]?.trim() || profile.name;
  }

  if (lower.includes("i like")) {

    profile.likes = profile.likes || [];

    const like =
      message.split("I like")[1]?.trim();

    if (like) {
      profile.likes.push(like);
    }
  }

  localStorage.setItem(
    "profile_" + currentUser.uid,
    JSON.stringify(profile)
  );
}

// ================= RENDER =================
function render(role, text) {

  const div = document.createElement("div");

  div.className = `msg ${role}`;

  div.textContent = text;

  chatBox.appendChild(div);

  requestAnimationFrame(() => {
    chatBox.scrollTop = chatBox.scrollHeight;
  });

  return div;
}

// ================= SOUND =================
let lastSound = 0;

const keySound = new Audio(
  "https://www.soundjay.com/keyboard/keyboard-1.mp3"
);

keySound.volume = 0.03;

function playSound() {

  const now = Date.now();

  if (now - lastSound < 120) return;

  lastSound = now;

  try {
    keySound.currentTime = 0;
    keySound.play().catch(() => {});
  } catch {}
}

// ================= VOICE =================
function getVoicesSafe() {

  return new Promise(resolve => {

    let voices = speechSynthesis.getVoices();

    if (voices.length) {
      resolve(voices);
      return;
    }

    speechSynthesis.onvoiceschanged = () => {
      voices = speechSynthesis.getVoices();
      resolve(voices);
    };
  });
}

// ================= SPEAK =================
async function speak(text) {

  try {

    const voices = await getVoicesSafe();

    const utter = new SpeechSynthesisUtterance(text);

    if (voiceMode === "random") {

      utter.voice =
        voices[Math.floor(Math.random() * voices.length)];

    } else if (voiceMode === "female") {

      utter.voice =
        voices.find(v =>
          v.name.toLowerCase().includes("female")
        ) || voices[0];

    } else if (voiceMode === "male") {

      utter.voice =
        voices.find(v =>
          v.name.toLowerCase().includes("male")
        ) || voices[0];
    }

    utter.rate = 1;
    utter.pitch = 1;

    speechSynthesis.cancel();
    speechSynthesis.speak(utter);

  } catch (err) {
    console.log(err);
  }
}

// ================= REAL VOICE INPUT =================
if ("webkitSpeechRecognition" in window) {

  recognition = new webkitSpeechRecognition();

  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onstart = () => {

    isRecording = true;

    status.textContent = "🎤 Listening...";
  };

  recognition.onend = () => {

    isRecording = false;

    status.textContent = "";
  };

  recognition.onerror = (event) => {

    console.log(event.error);

    status.textContent = "Mic error";
  };

  recognition.onresult = (event) => {

    let transcript = "";

    for (
      let i = event.resultIndex;
      i < event.results.length;
      i++
    ) {

      transcript += event.results[i][0].transcript;
    }

    textInput.value = transcript;

    const final =
      event.results[event.results.length - 1].isFinal;

    if (final) {
      sendMessage();
    }
  };
}

// ================= MIC =================
window.startHoldRecord = function () {

  if (!recognition || isRecording) return;

  recognition.start();
};

window.stopHoldRecord = function () {

  if (!recognition || !isRecording) return;

  recognition.stop();
};

// ================= AI =================
async function askAI(message, box) {

  const key = message.toLowerCase();

  if (cache.has(key)) {

    const cached = cache.get(key);

    box.textContent = cached;

    return cached;
  }

  const memory = await getMemory();

  const profile = getProfile();

  try {

    const res = await fetch(`${SERVER}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
    message,
    memory,
   profile,
   email: currentUser.email,
   file: uploadedFile
   })
    });

    // ================= FIXED ERROR HANDLER =================
    if (!res.ok) {

      const errText = await res.text();

      console.log("SERVER ERROR:", errText);

      box.textContent = errText;

      return errText;
    }

    // ================= STREAM =================
    const reader = res.body.getReader();

    const decoder = new TextDecoder();

    let result = "";
    let buffer = "";

    while (true) {

      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value);

      if (buffer.length > 15) {

        result += buffer;

        box.textContent = result + "▌";

        buffer = "";

        playSound();

        requestAnimationFrame(() => {
          chatBox.scrollTop = chatBox.scrollHeight;
        });
      }
    }

    result += buffer;

    box.textContent = result;

    cache.set(key, result);

    uploadedFile = null;

    return result;

  } catch (err) {

    console.log("FETCH ERROR:", err);

    box.textContent =
      "Cannot connect to server";

    return "Server offline";
  }
}

// ================= SEND =================
window.sendMessage = async function () {

  const text = textInput.value.trim();

  if (!text) return;

  textInput.value = "";

  updateProfile(text);

  render("user", text);

  const aiBox = render("ai", "Thinking...");

  status.textContent = "Auralis thinking...";

  try {

    const reply = await askAI(text, aiBox);

    await saveHistory(text, reply);

    trackUsage();

    speak(reply);

  } catch (err) {

    console.log(err);

    aiBox.textContent = "Server error";

  } finally {

    status.textContent = "";
  }
};

// ================= SAVE HISTORY =================
async function saveHistory(user, ai) {

  try {

    if (!currentChatId) {
      await createNewChat();
    }

    // Save in history collection
    await addDoc(
      collection(
        db,
        "users",
        currentUser.uid,
        "history"
      ),
      {
        user,
        ai,
        createdAt: new Date()
      }
    );

    // Save in chat messages
    await addDoc(
      collection(
        db,
        "users",
        currentUser.uid,
        "chats",
        currentChatId,
        "messages"
      ),
      {
        user,
        ai,
        createdAt: new Date()
      }
    );

  } catch (err) {
    console.error(err);
  }
}

// ================= CREATE CHAT =================
window.createNewChat = async function () {

  try {

    const ref = await addDoc(
      collection(
        db,
        "users",
        currentUser.uid,
        "chats"
      ),
      {
        name: "New Chat",
        createdAt: new Date()
      }
    );

    currentChatId = ref.id;

    chatBox.innerHTML = "";

    await loadChats();

  } catch (err) {
    console.error(err);
  }
};

// ================= LOAD CHATS =================
async function loadChats() {

  historyList.innerHTML = "";

  try {

    const q = query(
      collection(
        db,
        "users",
        currentUser.uid,
        "chats"
      ),
      orderBy("createdAt", "desc")
    );

    const snap = await getDocs(q);

    snap.forEach(docSnap => {

      const data = docSnap.data();

      const div = document.createElement("div");

      div.className = "chat-item";

      div.innerHTML = `
        <span>${data.name}</span>
        <button onclick="openChat('${docSnap.id}')">
          Open
        </button>
      `;

      historyList.appendChild(div);
    });

  } catch (err) {
    console.error(err);
  }
}
// ================= OPEN CHAT =================
window.openChat = async function (id) {

  currentChatId = id;

  chatBox.innerHTML = "";

  try {

    const q = query(
      collection(
        db,
        "users",
        currentUser.uid,
        "chats",
        id,
        "messages"
      ),
      orderBy("createdAt", "asc")
    );

    const snap = await getDocs(q);

    snap.forEach(docSnap => {

      const data = docSnap.data();

      render("user", data.user);
      render("ai", data.ai);

    });

    openTab("home");

  } catch (err) {
    console.error(err);
  }
};

// ================= ANALYTICS =================
function trackUsage() {

  const today = new Date().toDateString();

  if (!dailyStats[today]) {
    dailyStats[today] = 0;
  }

  dailyStats[today]++;

  localStorage.setItem(
    "stats",
    JSON.stringify(dailyStats)
  );
}

function loadAnalytics() {

  if (!analyticsBox) return;

  const stats = JSON.parse(
    localStorage.getItem("stats") || "{}"
  );

  const labels = Object.keys(stats);

  const values = Object.values(stats);

  analyticsBox.innerHTML = `
    <canvas id="chart"></canvas>
  `;

  setTimeout(() => {

    const ctx = document
      .getElementById("chart")
      .getContext("2d");

    new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Messages",
            data: values
          }
        ]
      },
      options: {
        responsive: true
      }
    });

  }, 200);
}

// ================= VOICE MODE =================
window.setVoice = function (mode) {

  voiceMode = mode;

  localStorage.setItem("voice", mode);
};

// ================= LOGOUT =================
window.logout = async function () {

  await signOut(auth);

  window.location.href = "auth.html#login";
};

// ================= ENTER =================
textInput.addEventListener("keydown", e => {

  if (e.key === "Enter") {
    sendMessage();
  }
});

// ================= SERVICE WORKER =================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.log("SW Registered", reg))
      .catch((err) => console.log("SW Error", err));
  });
}