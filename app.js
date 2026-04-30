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
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 🔑 KEYS (⚠️ exposed)
const OPENAI_API_KEY = "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";
const BRAVE_API_KEY = "BSAmRMPJMctIGLePkd6Gyfh08IUObkL";

// ================= 💳 PLAN SYSTEM =================
let userPlan = localStorage.getItem("plan") || "free";


// ================= UI =================
const chatBox = document.getElementById("chatBox");
const textInput = document.getElementById("textInput");
const status = document.getElementById("status");
const historyList = document.getElementById("historyList");

let currentUser = null;
let voiceMode = "female";

// ================= CACHE =================
const cache = new Map();

// ================= NAV (FAST + SMOOTH) =================
window.openTab = function(tab){
  document.querySelectorAll(".page").forEach(p=>{
    p.style.display = "none";
  });

  const el = document.getElementById(tab);
  if(el) el.style.display = "block";
};


// ================= AUTH =================
onAuthStateChanged(auth, (user) => {
  if (!user) return window.location.href = "auth.html#login";

  currentUser = user;
  document.getElementById("userInfo").innerText = user.email;

  loadHistory();
  async function checkUserPlan() {
  const email = currentUser.email;

  const res = await fetch(`https://your-server.com/user/${email}`);
  const data = await res.json();

  userPlan = data.plan || "free";

  localStorage.setItem("plan", userPlan);
}
});

// ================= RENDER =================
function render(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.innerText = text;

  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ================= 🧠 USER PROFILE =================
function getProfile() {
  return JSON.parse(localStorage.getItem("profile_" + currentUser.uid) || "{}");
}

function updateProfile(message) {
  let p = getProfile();

  if (message.includes("my name is")) {
    p.name = message.split("my name is")[1]?.trim();
  }

  if (message.includes("I like")) {
    p.likes = (p.likes || []).concat(message.split("I like")[1]?.trim());
  }

  localStorage.setItem("profile_" + currentUser.uid, JSON.stringify(p));
}

// ================= 🧠 LONG MEMORY =================
async function getMemory() {
  const q = query(
    collection(db, "users", currentUser.uid, "history"),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(q);

  let memory = "";
  let count = 0;

  snap.forEach(doc => {
    if (count < 15) {
      const d = doc.data();
      memory += `User:${d.user}\nAI:${d.ai}\n`;
      count++;
    }
  });

  return memory;
}

// ================= 🌐 SEARCH =================
async function search(q) {
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q + " latest news")}&count=5`,
      {
        headers: {
          "X-Subscription-Token": BRAVE_API_KEY
        }
      }
    );

    const data = await res.json();

    return (data.web?.results || [])
      .map(r => `${r.title}: ${r.description}`)
      .join("\n");

  } catch {
    return "";
  }
}

// ================= ⚡ MODE =================
function decideMode(msg) {
  const m = msg.toLowerCase();

  if (m.includes("today") || m.includes("latest") || m.includes("news")) return "LIVE";
  if (msg.length < 20) return "FAST";

  return "SMART";
}

// ================= 🤖 AI =================
async function askAI(message) {

  const key = message.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const mode = decideMode(message);

  status.innerText = "Mode: " + mode;

  const profile = getProfile();
  let memory = "";
  let web = "";

  if (mode === "FAST") {
    memory = await getMemory();
  }

  if (mode === "LIVE") {
    [memory, web] = await Promise.all([getMemory(), search(message)]);
  }

  if (mode === "SMART") {
    memory = await getMemory();
  }

  // 🔥 SMART MODEL ROUTING
  const model = mode === "FAST" ? "gpt-4o-mini" : "gpt-4o";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + OPENAI_API_KEY
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `
You are an evolving AI assistant.

PERSONALITY:
Adapt to the user over time.

USER PROFILE:
${JSON.stringify(profile)}

MEMORY:
${memory}

WEB:
${web}

RULES:
- Learn user behavior
- Be smarter every response
- Use web if available
- Be natural and human-like
`
        },
        {
          role: "user",
          content: message
        }
      ]
    })
  });

  const data = await res.json();

  const reply = data.choices?.[0]?.message?.content || "No response";

  cache.set(key, reply);

  return reply;
}

// ================= SEND =================
window.sendMessage = async function () {

  const text = textInput.value.trim();
  if (!text) return;

  // 💳 LIMIT SYSTEM
  const limitKey = "usage_" + currentUser.uid;
  let usage = Number(localStorage.getItem(limitKey) || 0);

  if (userPlan === "free" && usage >= 10) {
    alert("🚫 Free limit reached. Upgrade to continue.");

    window.open("https://paystack.shop/pay/yx96a922oo");
    return;
  }

  textInput.value = "";

  updateProfile(text);

  render("user", text);

  const aiBox = document.createElement("div");
  aiBox.className = "msg ai";
  aiBox.innerText = "Thinking...";
  chatBox.appendChild(aiBox);

  const reply = await askAI(text);

  aiBox.innerText = reply;

  saveHistory(text, reply);
  saveMessage(text, reply); // ✅ also save to chat system

  speak(reply);

  // ✅ increase usage
  localStorage.setItem(limitKey, usage + 1);

  status.innerText = "";
};

// ================= HISTORY =================
async function saveHistory(user, ai) {
  await addDoc(
    collection(db, "users", currentUser.uid, "history"),
    {
      user,
      ai,
      createdAt: new Date()
    }
  );
}

async function loadHistory() {
  const q = query(
    collection(db, "users", currentUser.uid, "history"),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(q);

  historyList.innerHTML = "";

  snap.forEach(doc => {
    const d = doc.data();

    const div = document.createElement("div");
    div.className = "msg ai";

    div.innerHTML = `
      <b>You:</b> ${d.user}<br><br>
      <b>AI:</b> ${d.ai}
    `;

    historyList.appendChild(div);
  });
}

// ================= CHAT SYSTEM =================

// CREATE
window.createNewChat = async function(){

  const docRef = await addDoc(
    collection(db,"users",currentUser.uid,"chats"),
    {
      name:"New Chat",
      pinned:false,
      createdAt:new Date()
    }
  );

  currentChatId = docRef.id;
  chatBox.innerHTML="";
  loadChats();
};

// SAVE MESSAGE
async function saveMessage(user, ai){

  if(!currentChatId){
    await createNewChat();
  }

  await addDoc(
    collection(db,"users",currentUser.uid,"chats",currentChatId,"messages"),
    {
      user,
      ai,
      createdAt:new Date()
    }
  );
}

// LOAD CHATS
async function loadChats(){

  historyList.innerHTML="";

  const q = query(
    collection(db,"users",currentUser.uid,"chats"),
    orderBy("createdAt","desc")
  );

  const snap = await getDocs(q);

  snap.forEach(docSnap=>{
    const d = docSnap.data();
    const id = docSnap.id;

    const div = document.createElement("div");
    div.className="msg ai";

    div.innerHTML = `
      ${d.pinned ? "📌" : ""} ${d.name}
      <button onclick="openChat('${id}')">Open</button>
      <button onclick="renameChat('${id}')">Rename</button>
      <button onclick="pinChat('${id}', ${d.pinned})">Pin</button>
      <button onclick="deleteChat('${id}')">Delete</button>
    `;

    historyList.appendChild(div);
  });
}

// OPEN CHAT
window.openChat = async function(chatId){

  currentChatId = chatId;
  chatBox.innerHTML="";

  const q = query(
    collection(db,"users",currentUser.uid,"chats",chatId,"messages"),
    orderBy("createdAt","asc")
  );

  const snap = await getDocs(q);

  snap.forEach(doc=>{
    const d = doc.data();
    render("user",d.user);
    render("ai",d.ai);
  });

  openTab("home");
};

// RENAME
window.renameChat = async function(chatId){
  const name = prompt("New name:");
  if(!name) return;

  await updateDoc(
    doc(db,"users",currentUser.uid,"chats",chatId),
    { name }
  );

  loadChats();
};

// PIN
window.pinChat = async function(chatId,current){
  await updateDoc(
    doc(db,"users",currentUser.uid,"chats",chatId),
    { pinned: !current }
  );

  loadChats();
};

// DELETE
window.deleteChat = async function(chatId){
  if(!confirm("Delete chat?")) return;

  await deleteDoc(
    doc(db,"users",currentUser.uid,"chats",chatId)
  );

  loadChats();
};


// ================= VOICE =================
function speak(text) {
  const s = new SpeechSynthesisUtterance(text);
  speechSynthesis.speak(s);
}

// ================= 💳 ACTIVATE PRO =================
window.activatePro = function () {
  userPlan = "pro";
  localStorage.setItem("plan", "pro");

  alert("✅ Pro Activated!");
};

// ================= LOGOUT =================
window.logout = async function () {
  await signOut(auth);
  window.location.href = "auth.html#login";
};