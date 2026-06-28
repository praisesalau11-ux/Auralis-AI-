import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";
import crypto from "crypto";
import fs from "fs";

// ================= LOAD ENV =================
dotenv.config();

// ================= APP =================
const app = express();

app.use(cors());

app.use((req, res, next) => {

  if (req.originalUrl === "/paystack/webhook") {
    next();
  } else {
    express.json({
      limit: "15mb"
    })(req, res, next);
  }

});

// ================= CONFIG =================
const PORT = process.env.PORT || 3000;

// ================= OPENAI =================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ================= DATABASE =================
const DB_FILE = "./db.json";

// Create database if missing
if (!fs.existsSync(DB_FILE)) {

  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(
      {
        users: {}
      },
      null,
      2
    )
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

      email,

      plan: "free",

      usage: 0,

      createdAt: Date.now(),

      lastPayment: null

    };

    writeDB(db);

  }

  return db.users[email];

}

function updateUser(email, updates) {

  const db = readDB();

  if (!db.users[email]) {

    db.users[email] = {

      email,

      plan: "free",

      usage: 0,

      createdAt: Date.now(),

      lastPayment: null

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

  if (user.plan === "pro") {

    return true;

  }

  return user.usage < 50;

}

// ================= HOME =================
app.get("/", (req, res) => {

  res.send({
    status: "online",
    app: "Auralis AI",
    version: "2.0"
  });

});

// ================= USER =================
app.get("/user/:email", (req, res) => {

  try {

    res.setHeader("Cache-Control", "no-store");

    const user = getUser(req.params.email);

    res.json(user);

  } catch (err) {

    console.error(err);

    res.status(500).json({

      error: "Unable to fetch user"

    });

  }

});

// ================= CHAT =================
app.post("/chat", async (req, res) => {
  try {
    const {
      message,
      email,
      memory = "",
      profile = {},
      mode,
      file
    } = req.body;

    if (!message) {
      return res.status(400).send("No message");
    }

    if (!email || !email.includes("@")) {
      return res.status(400).send("Invalid email");
    }

    if (
      file &&
      file.data &&
      file.data.length > 8_000_000
    ) {
      return res.status(400).send("Image too large");
    }

    // User
    const user = getUser(email);

    if (!canUseAI(user)) {
      return res.status(403).send("Upgrade to Pro");
    }

    updateUser(email, {
      usage: user.usage + 1
    });

    // Live Search
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

        const data = await search.json();

        liveData = JSON.stringify(
          data?.web?.results?.slice(0, 3) || []
        );

      } catch (err) {
        console.error("Brave Search:", err);
      }
    }

    // Stream headers
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Build content
    const content = [
      {
        type: "text",
        text: `
MEMORY:
${memory}

PROFILE:
${JSON.stringify(profile)}

LIVE DATA:
${liveData}

USER:
${message}
`
      }
    ];

    if (
      file &&
      file.type &&
      file.type.startsWith("image/")
    ) {
      content.push({
        type: "image_url",
        image_url: {
          url: file.data
        }
      });
    }

    // OpenAI
    const stream =
      await openai.chat.completions.create({
        model: "gpt-5.5",
        stream: true,
        messages: [
          {
            role: "system",
            content: `
You are Auralis AI.

Give clear, accurate answers.

Use memory and profile if useful.

Be friendly.

Do not guess.

When live data exists, prioritize it.
`
          },
          {
            role: "user",
            content
          }
        ]
      });

    // Stream response
    for await (const chunk of stream) {

      const text =
        chunk.choices?.[0]?.delta?.content;

      if (text) {
        res.write(text);
      }

    }

    res.end();

  } catch (err) {

    console.error("CHAT ERROR:", err);

    if (!res.headersSent) {
      res.status(500).send("Server error");
    } else {
      res.end();
    }

  }
});