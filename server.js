require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

// ✅ CORS (allow your Hostinger frontend)
app.use(cors());
app.use(express.json());

// -----------------------------
// ✅ MongoDB Connection
// -----------------------------
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI missing in environment variables");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("✅ MongoDB Connected");
}

// -----------------------------
// ✅ Schema + Model
// -----------------------------
const articleSchema = new mongoose.Schema(
  {
    articleNumber: { type: String, unique: true, required: true }, // KB-1001
    title: { type: String, required: true },
    summary: { type: String, default: "" },
    content: { type: String, default: "" },
    tags: [{ type: String }],
    status: { type: String, default: "published" } // published/draft
  },
  { timestamps: true }
);

articleSchema.index({ title: "text", summary: "text", content: "text", tags: "text" });

const Article = mongoose.model("Article", articleSchema);

// -----------------------------
// ✅ Health Check
// -----------------------------
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Knowledge Hub Backend is running ✅" });
});

// -----------------------------
// ✅ API: Search Articles
// -----------------------------
app.get("/api/kb/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();

    if (!q) {
      return res.json({ items: [] });
    }

    const items = await Article.find(
      {
        status: "published",
        $or: [
          { articleNumber: new RegExp(q, "i") },
          { $text: { $search: q } }
        ]
      },
      { score: { $meta: "textScore" } }
    )
      .sort({ score: { $meta: "textScore" }, updatedAt: -1 })
      .limit(20)
      .lean();

    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

// -----------------------------
// ✅ API: Get Article By Number
// -----------------------------
app.get("/api/kb/article/:articleNumber", async (req, res) => {
  try {
    const articleNumber = req.params.articleNumber.trim().toUpperCase();

    const item = await Article.findOne({
      status: "published",
      articleNumber
    }).lean();

    if (!item) return res.status(404).json({ error: "Article not found" });

    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// -----------------------------
// ✅ Seed Dummy Articles (for testing)
// -----------------------------
app.post("/api/kb/seed", async (req, res) => {
  try {
    const existing = await Article.countDocuments();
    if (existing > 0) {
      return res.json({ message: "DB already has articles, skipping seed." });
    }

    const demo = [
      {
        articleNumber: "KB-1001",
        title: "How to Reset Password",
        summary: "Steps to reset password if user forgot it.",
        content:
          "1) Go to Login page\n2) Click Forgot Password\n3) Enter registered email\n4) Check inbox and reset password",
        tags: ["login", "password", "account"]
      },
      {
        articleNumber: "KB-1002",
        title: "Refund Not Received",
        summary: "What to do if refund is delayed or not credited.",
        content:
          "Refund usually takes 5-7 business days.\nIf not received:\n1) Verify payment method\n2) Check bank statement\n3) Raise ticket with transaction ID",
        tags: ["refund", "billing", "payments"]
      }
    ];

    await Article.insertMany(demo);
    res.json({ message: "✅ Seed completed", inserted: demo.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Seed failed" });
  }
});
// -----------------------------
// ✅ API: Create Single Article
// -----------------------------
app.post("/api/kb/article", async (req, res) => {
  try {
    const { articleNumber, title, summary, content, tags, status } = req.body;

    if (!articleNumber || !title) {
      return res.status(400).json({ error: "articleNumber and title are required" });
    }

    const doc = await Article.create({
      articleNumber: String(articleNumber).trim().toUpperCase(),
      title: String(title).trim(),
      summary: summary || "",
      content: content || "",
      tags: Array.isArray(tags) ? tags : [],
      status: status || "published"
    });

    res.json({ ok: true, item: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Create article failed", details: err.message });
  }
});

// -----------------------------
// ✅ API: Bulk Create Articles
// -----------------------------
app.post("/api/kb/articles/bulk", async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items must be a non-empty array" });
    }

    const docs = items.map((a) => ({
      articleNumber: String(a.articleNumber).trim().toUpperCase(),
      title: String(a.title).trim(),
      summary: a.summary || "",
      content: a.content || "",
      tags: Array.isArray(a.tags) ? a.tags : [],
      status: a.status || "published"
    }));

    const inserted = await Article.insertMany(docs, { ordered: false });

    res.json({ ok: true, inserted: inserted.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Bulk insert failed", details: err.message });
  }
});

// -----------------------------
// ✅ Start Server
// -----------------------------
const PORT = process.env.PORT || 3000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ DB Connection Error:", err);
    process.exit(1);
  });
