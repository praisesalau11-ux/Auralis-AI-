import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import OpenAI from "openai";
import crypto from "crypto";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

const app = express();
app.use(cors());
app.use(express.json());

// ================= 🔑 HARD-CODED KEYS (TEMP ONLY) =================
const OPENAI_API_KEY = "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";
const PAYSTACK_SECRET = "sk_test_aa353018ef793f566064ca5b3577f1d9a0b40d2a";
const BRAVE_API_KEY = "BSAmRMPJMctIGLePkd6Gyfh08IUObkL";

// ================= OPENAI =================
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// ================= DATABASE =================
const adapter = new JSONFile("db.json");
const db = new Low(adapter, { users: {} });

await db.read();

// ================= GET USER =================
async function getUser(email) {
  if (!db.data.users[email]) {
    db.data.users[email] = {
      plan: "free",
      usage: 0,
      lastPayment: null,
    };
    await db.write();
  }
  return db.data.users[email];
}

// ================= LIMIT CHECK =================
function canUseAI(user) {
  return user.plan === "pro" ? true : user.usage < 50;
}

// ================= PAYSTACK CHECKOUT =================
app.post("/paystack/checkout", async (req, res) => {
  try {
    const { email } = req.body;

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: 300000,
        }),
      }
    );

    const data = await response.json();

    res.json({
      url: data.data.authorization_url,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Checkout error");
  }
});

// ================= PAYSTACK WEBHOOK =================
app.post("/paystack/webhook", async (req, res) => {
  try {
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.sendStatus(401);
    }

    const event = req.body;

    if (event.event === "charge.success") {
      const email = event.data.customer.email;

      const user = await getUser(email);

      user.plan = "pro";
      user.lastPayment = Date.now();

      await db.write();

      console.log("✅ PRO USER:", email);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ================= USER =================
app.get("/user/:email", async (req, res) => {
  const user = await getUser(req.params.email);
  res.json(user);
});

// ================= CHAT (FIXED STREAM) =================
app.post("/chat", async (req, res) => {
  try {
    const { message, email, memory, profile, mode } = req.body;

    const user = await getUser(email);

    if (!canUseAI(user)) {
      return res.status(403).send("Upgrade to Pro");
    }

    user.usage++;
    await db.write();

    // ================= LIVE SEARCH =================
    let liveData = "";

    if (mode === "LIVE") {
      try {
        const r = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(message)}`,
          {
            headers: {
              "X-Subscription-Token": BRAVE_API_KEY,
            },
          }
        );

        const data = await r.json();
        liveData = JSON.stringify(data?.web?.results?.slice(0, 3));
      } catch (e) {
        console.log("Brave error:", e.message);
      }
    }

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      stream: true,
      messages: [
        {
          role: "system",
          content: "You are Auralis AI. Be fast and helpful.",
        },
        {
          role: "user",
          content: `
MEMORY:
${memory || ""}

PROFILE:
${JSON.stringify(profile || {})}

LIVE DATA:
${liveData}

USER:
${message}
          `,
        },
      ],
    });

    for await (const chunk of completion) {
      const text = chunk.choices[0]?.delta?.content || "";
      res.write(text);
    }

    res.end();
  } catch (err) {
    console.error("🔥 CHAT ERROR:", err);
    res.status(500).send(err.message || "Server error");
  }
});

// ================= TITLE =================
app.post("/title", async (req, res) => {
  try {
    const { message } = req.body;

    const result = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Create a short title (max 5 words).",
        },
        { role: "user", content: message },
      ],
    });

    res.json({ title: result.choices[0].message.content });
  } catch {
    res.json({ title: "New Chat" });
  }
});

// ================= HEALTH =================
app.get("/", (req, res) => {
  res.send("Auralis AI Running 🚀");
});

// ================= START =================
app.listen(3000, () => {
  console.log("Server running on port 3000");
});