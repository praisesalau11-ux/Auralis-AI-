import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import OpenAI from "openai";
import crypto from "crypto";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ================= OPENAI =================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ================= DATABASE (PERSISTENT) =================
const adapter = new JSONFile("db.json");
const db = new Low(adapter, { users: {} });

await db.read();

// ================= HELPERS =================
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

// ================= USAGE LIMIT =================
function canUseAI(user) {
  if (user.plan === "pro") return true;
  return user.usage < 50;
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
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: 300000, // ₦3000
        }),
      }
    );

    const data = await response.json();

    res.json({
      url: data.data.authorization_url,
    });
  } catch (err) {
    res.status(500).send("Checkout error");
  }
});

// ================= PAYSTACK WEBHOOK (SECURE) =================
app.post(
  "/paystack/webhook",
  express.json({ type: "*/*" }),
  async (req, res) => {
    try {
      const secret = process.env.PAYSTACK_SECRET;

      const hash = crypto
        .createHmac("sha512", secret)
        .update(JSON.stringify(req.body))
        .digest("hex");

      if (hash !== req.headers["x-paystack-signature"]) {
        return res.sendStatus(401);
      }

      const event = req.body;

      // PAYMENT SUCCESS → UPGRADE USER
      if (event.event === "charge.success") {
        const email = event.data.customer.email;

        const user = await getUser(email);

        user.plan = "pro";
        user.lastPayment = Date.now();

        await db.write();

        console.log("✅ PRO activated:", email);
      }

      res.sendStatus(200);
    } catch (err) {
      res.sendStatus(500);
    }
  }
);

// ================= USER INFO =================
app.get("/user/:email", async (req, res) => {
  const user = await getUser(req.params.email);
  res.json(user);
});

// ================= CHAT (STREAMING AI) =================
app.post("/chat", async (req, res) => {
  try {
    const { message, email, memory, profile, mode } = req.body;

    const user = await getUser(email);

    // ================= LIMIT CHECK =================
    if (!canUseAI(user)) {
      return res.status(403).send("Upgrade to Pro");
    }

    user.usage++;
    await db.write();

    // ================= LIVE SEARCH (BRAVE) =================
    let liveData = "";

    if (mode === "LIVE") {
      try {
        const r = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
            message
          )}`,
          {
            headers: {
              "X-Subscription-Token": process.env.BRAVE_API_KEY || "",
            },
          }
        );

        const data = await r.json();
        liveData = JSON.stringify(data?.web?.results?.slice(0, 3));
      } catch {}
    }

    // ================= STREAM RESPONSE =================
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "You are Auralis AI. Be fast, smart, and conversational.",
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
    console.log(err);
    res.status(500).send("Server error");
  }
});

// ================= TITLE GENERATION =================
app.post("/title", async (req, res) => {
  try {
    const { message } = req.body;

    const result = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Create a short chat title (max 5 words).",
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    res.json({
      title: result.choices[0].message.content,
    });
  } catch {
    res.json({ title: "New Chat" });
  }
});

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.send("Auralis AI Server Running 🚀");
});

// ================= START SERVER =================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running on port", process.env.PORT || 3000);
});