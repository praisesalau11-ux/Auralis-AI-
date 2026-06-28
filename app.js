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
  limit,
  serverTimestamp
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

  // Load the user's plan
  try {

  const res = await fetch(`${SERVER}/user/${user.email}`);
  const data = await res.json();

  document.getElementById("planInfo").textContent =
    `Plan: ${data.plan}`;

  if (data.plan === "free") {

    document.getElementById("upgradeBox").innerHTML = `
      <button class="upgrade-btn"
        onclick="window.open('https://paystack.shop/pay/j-1x5anvvc')">
        💳 Upgrade to Pro
      </button>
    `;

  } else {

    document.getElementById("upgradeBox").innerHTML =
      "✅ You are a Pro member";
  }

} catch (err) {

  console.error("Failed to load user plan:", err);

  document.getElementById("planInfo").textContent =
    "Plan: Unknown";
}

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
  message.split(/my name is/i)[1]?.trim() || profile.name;
  }

  if (lower.includes("i like")) {

    profile.likes = profile.likes || [];

    const like =
      message.split(/i like/i)[1]?.trim();

    if (like) {
      profile.likes.push(like.trim());
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
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {

  recognition = new SpeechRecognition();

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

    if (event.results[event.results.length - 1].isFinal) {
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

  const key =
  currentUser.uid + ":" + message.toLowerCase();

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

   const decoder = new TextDecoder("utf-8");

    let result = "";

     while (true) {

  const { done, value } = await reader.read();

  if (done) break;

  const chunk = decoder.decode(value, {
    stream: true
  });

  result += chunk;

  box.textContent = result + "▌";

  playSound();

  requestAnimationFrame(() => {
    chatBox.scrollTop = chatBox.scrollHeight;
  });

    }

// Flush any remaining bytes
     result += decoder.decode();

     box.textContent = result;

     cache.set(key, result);

     uploadedFile = null;
     fileInput.value = "";

     return result;

  } catch (err) {

  console.error("FETCH ERROR:", err);

  box.textContent = "Cannot connect to server";

  return "Server offline";
  }

// ================= SEND =================
window.sendMessage = async function () {

  const text = textInput.value;

  console.log("Typed:", text);

  if (!text.trim()) return;

  textInput.blur();

  textInput.value = "";

  updateProfile(text);

  render("user", text);

  const aiBox = render("ai", "Thinking...");

  status.textContent = "Auralis thinking...";

  try {

    const reply = await askAI(text, aiBox);

    await saveHistory(text, reply);
    memoryCache = "";
   memoryTime = 0;

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
      const ref = await addDoc(
        collection(db, "users", currentUser.uid, "chats"),
        {
          name: user.slice(0, 25),
          createdAt: serverTimestamp()
        }
      );

      currentChatId = ref.id;
      await loadChats();
    }

    // save message
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
        createdAt: serverTimestamp()
      }
    );
    
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
       createdAt: serverTimestamp()
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
      collection(db, "users", currentUser.uid, "chats"),
      {
        name: "New Chat",
        createdAt: serverTimestamp()
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
  try {
    historyList.innerHTML = "";

    const q = query(
      collection(db, "users", currentUser.uid, "chats"),
      orderBy("createdAt", "desc")
    );

    const snap = await getDocs(q);

    snap.forEach(docSnap => {
      const data = docSnap.data();

      const div = document.createElement("div");
      div.className = "chat-item";

      div.innerHTML = `
        <span>${data.name || "New Chat"}</span>
        <button onclick="openChat('${docSnap.id}')">Open</button>
      `;

      historyList.appendChild(div);
    });

  } catch (err) {
    console.error(err);
  }
}
// ================= OPEN CHAT =================
window.openChat = async function (id) {
  try {
    currentChatId = id;
    chatBox.innerHTML = "";

    const q = query(
      collection(db, "users", currentUser.uid, "chats", id, "messages"),
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
textInput.addEventListener("keydown", (e) => {

  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }

});

