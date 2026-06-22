import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import OpenAI from "openai";
import crypto from "crypto";
import fs from "fs";

// ================= LOAD ENV =================
dotenv.config();

// ================= APP =================
const app = express();

app.use(cors());

app.use(express.json({
  limit: "10mb"
}));

// ================= CONFIG =================
const PORT = process.env.PORT || 3000;

// ================= OPENAI =================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ================= DATABASE =================
const DB_FILE = "./db.json";

// create db if missing
if (!fs.existsSync(DB_FILE)) {

  fs.writeFileSync(
    DB_FILE,
    JSON.stringify({
      users: {}
    }, null, 2)
  );
}

// ================= DB HELPERS =================
function readDB() {

  try {

    return JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

  } catch {

    return {
      users: {}
    };
  }
}

function writeDB(data) {

  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(data, null, 2)
  );
}

function getUser(email) {

  const db = readDB();

  if (!db.users[email]) {

    db.users[email] = {
      plan: "free",
      usage: 0,
      lastPayment: null,
      createdAt: Date.now()
    };

    writeDB(db);
  }

  return db.users[email];
}

function updateUser(email, updates) {

  const db = readDB();

  if (!db.users[email]) {

    db.users[email] = {
      plan: "free",
      usage: 0,
      createdAt: Date.now()
    };
  }

  db.users[email] = {
    ...db.users[email],
    ...updates
  };

  writeDB(db);

  return db.users[email];
}

// ================= LIMIT SYSTEM =================
function canUseAI(user) {

  // unlimited
  if (user.plan === "pro") {
    return true;
  }

  // free tier limit
  return user.usage < 50;
}

// ================= HOME =================
app.get("/", (req, res) => {

  res.send("Auralis AI Server Running 🚀");
});

// ================= USER =================
app.get("/user/:email", (req, res) => {

  try {

    const email = req.params.email;

    const user = getUser(email);

    res.json(user);

  } catch (err) {

    console.log(err);

    res.status(500).json({
      error: "User fetch failed"
    });
  }
});

// ================= PAYSTACK CHECKOUT =================
app.post("/paystack/checkout", async (req, res) => {

  try {

    const { email } = req.body;

    if (!email) {

      return res.status(400).json({
        error: "Email required"
      });
    }

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          amount: 300000,
          callback_url:
            "https://auralis-ai.netlify.app/app.html"
        })
      }
    );

    const data = await response.json();

    if (!data.status) {

      return res.status(500).json(data);
    }

    res.json({
      url: data.data.authorization_url
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      error: "Checkout failed"
    });
  }
});

// ================= PAYSTACK WEBHOOK =================
app.post(
  "/paystack/webhook",
  express.raw({
    type: "*/*"
  }),
  async (req, res) => {

    try {

      const secret = process.env.PAYSTACK_SECRET;

      const hash = crypto
        .createHmac("sha512", secret)
        .update(req.body)
        .digest("hex");

      const signature =
        req.headers["x-paystack-signature"];

      if (hash !== signature) {

        console.log("❌ Invalid webhook signature");

        return res.sendStatus(401);
      }

      const event = JSON.parse(req.body.toString());

      console.log("PAYSTACK EVENT:", event.event);

      // ================= SUCCESS =================
      if (
        event.event === "charge.success"
      ) {

        const email =
          event.data.customer.email;

        updateUser(email, {
          plan: "pro",
          usage: 0,
          lastPayment: Date.now()
        });

        console.log(
          "✅ PRO activated:",
          email
        );
      }

      // ================= SUBSCRIPTION DISABLE =================
      if (
        event.event === "subscription.disable"
      ) {

        const email =
          event.data.customer.email;

        updateUser(email, {
          plan: "free"
        });

        console.log(
          "❌ Subscription disabled:",
          email
        );
      }

      res.sendStatus(200);

    } catch (err) {

      console.log(err);

      res.sendStatus(500);
    }
  }
);

// ================= CHAT =================
app.post("/chat", async (req, res) => {

  try {

     const {
     message,
     email,
     memory,
     profile,
     mode,
     file
    } = req.body;

    if (!message) {

      return res
        .status(400)
        .send("No message");
    }

    if (!email) {

      return res
        .status(400)
        .send("No email");
    }

    // ================= USER =================
    const user = getUser(email);

    // ================= LIMIT =================
    if (!canUseAI(user)) {

      return res
        .status(403)
        .send("Upgrade to Pro");
    }

    updateUser(email, {
      usage: user.usage + 1
    });

    // ================= LIVE SEARCH =================
    let liveData = "";

    if (
      mode === "LIVE" &&
      process.env.BRAVE_API_KEY
    ) {

      try {

        const search = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(message)}`,
          {
            headers: {
              "X-Subscription-Token":
                process.env.BRAVE_API_KEY
            }
          }
        );

        const data =
          await search.json();

        liveData = JSON.stringify(
          data?.web?.results?.slice(0, 3)
        );

      } catch (err) {

        console.log(
          "Brave search failed"
        );
      }
    }

    // ================= STREAM HEADERS =================
    res.setHeader(
      "Content-Type",
      "text/plain"
    );

    res.setHeader(
      "Transfer-Encoding",
      "chunked"
    );

    // ================= OPENAI =================
    const completion =
      await openai.chat.completions.create({
        model: "gpt-5.5",
        stream: true,
        messages: [
          {
            role: "system",
            content:
              `
You are Auralis AI, a modern AI assistant.

Your goals:
- Give accurate answers.
- Be concise unless the user asks for detail.
- Explain step-by-step when teaching.
- Admit uncertainty instead of guessing.
- Use memory and profile information when relevant.
- Be helpful for coding, business, education, research, and productivity.
- When live search data is available, prioritize it.
- Format code in proper code blocks.
- Format lists clearly and professionally.
- Maintain context across the conversation.

Style:
- Friendly and professional.
- Direct and practical.
- Avoid unnecessary filler.
- Focus on helping the user solve problems quickly.
              `
          },
          {
            role: "user",
            content:[
           {
           type:"text",
           text:`
MEMORY:
${memory || ""}

PROFILE:
${JSON.stringify(profile || {})}

LIVE DATA:
${liveData}

USER:
${message}
`
},
...(file && file.type.startsWith("image/")
? [{
type:"image_url",
image_url:{
url:file.data
         }
         }]
         : [])
         ]
          }

    // ================= STREAM =================
    for await (
      const chunk of completion
    ) {

      const text =
        chunk.choices?.[0]?.delta?.content || "";

      res.write(text);
    }

    res.end();

  } catch (err) {

    console.log("CHAT ERROR:", err);

    res
      .status(500)
      .send("Server error");
  }
});

// ================= TITLE =================
app.post("/title", async (req, res) => {

  try {

    const { message } = req.body;

    const result =
      await openai.chat.completions.create({
        model: "gpt-5.5",
        messages: [
          {
            role: "system",
            content:
              "Create a short title under 5 words."
          },
          {
            role: "user",
            content: message
          }
        ]
      });

    res.json({
      title:
        result.choices[0].message.content
    });

  } catch (err) {

    console.log(err);

    res.json({
      title: "New Chat"
    });
  }
});

// ================= RESET USAGE =================
app.post("/admin/reset", (req, res) => {

  try {

    const db = readDB();

    Object.keys(db.users).forEach(email => {

      db.users[email].usage = 0;
    });

    writeDB(db);

    res.send("Usage reset");

  } catch {

    res.status(500).send("Reset failed");
  }
});

// ================= START =================
app.listen(PORT, () => {

  console.log(
    `🚀 Server running on port ${PORT}`
  );
});