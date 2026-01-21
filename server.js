require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

/* ===============================
   MIDDLEWARE
================================ */
app.use(cors());
app.use(express.json({ limit: "20mb" }));

/* ===============================
   DB CONNECT
================================ */
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI missing in environment variables");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("✅ MongoDB Connected");
}

/* ===============================
   MODEL
================================ */
const articleSchema = new mongoose.Schema(
  {
    articleNumber: { type: String, unique: true, required: true }, // KB-1001
    title: { type: String, required: true },
    summary: { type: String, default: "" },
    content: { type: String, default: "" },
    tags: [{ type: String }],
    status: { type: String, default: "published" } // published | draft
  },
  { timestamps: true }
);

// ✅ Search index
articleSchema.index({
  title: "text",
  summary: "text",
  content: "text",
  tags: "text"
});

const Article = mongoose.model("Article", articleSchema);

/* ===============================
   HELPERS
================================ */
function normalizeKB(articleNumber) {
  return String(articleNumber || "").trim().toUpperCase();
}

function makeSummary(content) {
  const txt = String(content || "").trim().replace(/\s+/g, " ");
  if (!txt) return "";
  return txt.length > 140 ? txt.slice(0, 140) + "..." : txt;
}

// ✅ IMPORTANT: this is the SOP splitter for your word doc style
// It splits articles whenever it finds "Task type:"
function splitByTaskType(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  // Split on "Task type:"
  const parts = raw.split(/(?:^|\n)\s*(?:\d+\.\s*)?Task type:\s*/gi);

  // parts[0] might be intro, ignore it
  const blocks = parts.slice(1).map((p) => p.trim()).filter(Boolean);

  return blocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trim());
    const titleLine = lines[0] || "Untitled";

    const title = titleLine.replace(/\.$/, "").trim();
    const content = lines.slice(1).join("\n").trim();

    return { title, content };
  });
}

/* ===============================
   ROUTES
================================ */

// ✅ Health check
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Knowledge Hub Backend is running ✅" });
});

/* --------------------------------
   GET: Search articles
--------------------------------- */
app.get("/api/kb/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ items: [] });

    const items = await Article.find(
      {
        status: "published",
        $or: [{ articleNumber: new RegExp(q, "i") }, { $text: { $search: q } }]
      },
      { score: { $meta: "textScore" } }
    )
      .sort({ score: { $meta: "textScore" }, updatedAt: -1 })
      .limit(50)
      .lean();

    res.json({ items });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

/* --------------------------------
   GET: Get article by KB number
--------------------------------- */
app.get("/api/kb/article/:articleNumber", async (req, res) => {
  try {
    const articleNumber = normalizeKB(req.params.articleNumber);

    const item = await Article.findOne({
      status: "published",
      articleNumber
    }).lean();

    if (!item) return res.status(404).json({ error: "Article not found" });

    res.json(item);
  } catch (err) {
    console.error("Fetch article error:", err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

/* --------------------------------
   POST: Create single article ✅
--------------------------------- */
app.post("/api/kb/article", async (req, res) => {
  try {
    const { articleNumber, title, summary, content, tags, status } = req.body || {};

    const num = normalizeKB(articleNumber);
    if (!num) return res.status(400).json({ error: "articleNumber is required" });
    if (!title) return res.status(400).json({ error: "title is required" });

    const doc = await Article.create({
      articleNumber: num,
      title: String(title).trim(),
      summary: summary ? String(summary).trim() : makeSummary(content),
      content: content ? String(content) : "",
      tags: Array.isArray(tags) ? tags : [],
      status: status || "published"
    });

    res.status(201).json({ ok: true, item: doc });
  } catch (err) {
    console.error("Create article error:", err);

    if (String(err).includes("E11000")) {
      return res.status(409).json({
        error: "Duplicate articleNumber (already exists)"
      });
    }

    res.status(500).json({ error: "Create article failed" });
  }
});

/* --------------------------------
   PUT: Update article ✅
--------------------------------- */
app.put("/api/kb/article/:articleNumber", async (req, res) => {
  try {
    const articleNumber = normalizeKB(req.params.articleNumber);

    const updates = { ...req.body };
    delete updates.articleNumber;

    const updated = await Article.findOneAndUpdate(
      { articleNumber },
      { $set: updates },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ error: "Article not found" });

    res.json({ ok: true, item: updated });
  } catch (err) {
    console.error("Update article error:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

/* --------------------------------
   POST: Bulk insert articles ✅
--------------------------------- */
app.post("/api/kb/bulk", async (req, res) => {
  try {
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items must be a non-empty array" });
    }

    const normalizedItems = items.map((it) => ({
      articleNumber: normalizeKB(it.articleNumber),
      title: String(it.title || "").trim(),
      summary: it.summary ? String(it.summary).trim() : makeSummary(it.content),
      content: it.content ? String(it.content) : "",
      tags: Array.isArray(it.tags) ? it.tags : [],
      status: it.status || "published"
    }));

    const inserted = await Article.insertMany(normalizedItems, { ordered: false });

    res.json({ ok: true, insertedCount: inserted.length });
  } catch (err) {
    console.error("Bulk insert error:", err);
    res.status(500).json({ error: "Bulk insert failed", details: err.message });
  }
});

/* --------------------------------
   POST: Import huge SOP text ✅✅✅
   Splits by "Task type:" and creates multiple KB articles
--------------------------------- */
app.post("/api/kb/import-text", async (req, res) => {
  try {
    const { text, startNumber, kbPrefix, tags } = req.body || {};

    if (!text) return res.status(400).json({ error: "text is required" });

    const prefix = kbPrefix || "KB-";
    let num = Number(startNumber || 7001);

    const sections = splitByTaskType(text);

    if (!sections.length) {
      return res.status(400).json({
        error: "No Task type sections found. Please make sure your text includes 'Task type:' headings."
      });
    }

    const items = sections.map((s) => {
      const articleNumber = normalizeKB(`${prefix}${num++}`);
      return {
        articleNumber,
        title: s.title,
        summary: makeSummary(s.content),
        content: s.content,
        tags: Array.isArray(tags) ? tags : ["kyc", "sop"],
        status: "published"
      };
    });

    const inserted = await Article.insertMany(items, { ordered: false });

    res.json({
      ok: true,
      created: inserted.length,
      firstKB: inserted[0]?.articleNumber,
      lastKB: inserted[inserted.length - 1]?.articleNumber
    });
  } catch (err) {
    console.error("Import text error:", err);
    res.status(500).json({ error: "Import failed", details: err.message });
  }
});

/* --------------------------------
   POST: Seed dummy demo articles
--------------------------------- */
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
        tags: ["login", "password", "account"],
        status: "published"
      },
      {
        articleNumber: "KB-1002",
        title: "Refund Not Received",
        summary: "What to do if refund is delayed or not credited.",
        content:
          "Refund usually takes 5-7 business days.\nIf not received:\n1) Verify payment method\n2) Check bank statement\n3) Raise ticket with transaction ID",
        tags: ["refund", "billing", "payments"],
        status: "published"
      }
    ];

    await Article.insertMany(demo);
    res.json({ message: "✅ Seed completed", inserted: demo.length });
  } catch (err) {
    console.error("Seed error:", err);
    res.status(500).json({ error: "Seed failed" });
  }
});

/* ===============================
   START SERVER
================================ */
const PORT = process.env.PORT || 3000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ DB Connection Error:", err);
    process.exit(1);
  });
