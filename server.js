import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();

app.use(cors());
app.use(bodyParser.json());

// fake DB (replace with Firebase later)
const usersDB = {};

const PAYSTACK_SECRET = "sk_test_aa353018ef793f566064ca5b3577f1d9a0b40d2a";

// ================= WEBHOOK =================
app.post("/paystack-webhook", (req, res) => {

  const event = req.body;

  // ONLY handle successful payments
  if (event.event === "charge.success") {

    const email = event.data.customer.email;

    console.log("💰 Payment received:", email);

    // ✅ unlock user
    usersDB[email] = {
      plan: "pro",
      paid: true
    };

    console.log("✅ USER UPGRADED TO PRO:", email);
  }

  res.sendStatus(200);
});

// ================= CHECK USER PLAN =================
app.get("/user/:email", (req, res) => {
  const email = req.params.email;

  res.json(usersDB[email] || { plan: "free" });
});

app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});