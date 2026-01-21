require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

// ✅ CORS (allow all for now)
app.use(cors());
app.use(express.json({ limit: "10mb" }));

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

// ✅ Text index for search
articleSchema.index({
  title: "text",
  summary: "text",
  content: "text",
  tags: "text"
});

const Article = mongoose.model("Article", articleSchema);

// -----------------------------
// ✅ Helpers
// -----------------------------
function normalizeKB(articleNumber) {
  return String(articleNumber || "").trim().toUpperCase();
}

// Auto summary generator
function makeSummary(content) {
  const txt = String(content || "").trim().replace(/\s+/g, " ");
  if (!txt) return "";
  return txt.length > 120 ? txt.slice(0, 120) + "..." : txt;
}

// Split big SOP text into articles by headings or numbering
function splitIntoArticles(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  // Split based on headings like:
  // 1) Title
  // 1. Title
  // 1 - Title
  // ### Title
  const lines = raw.split("\n").map(l => l.trim());

  const blocks = [];
  let current = [];

  const isHeading = (line) =>
    /^(\d+[\.\)\-]\s+.+)$/.test(line) || /^#{2,}\s+.+$/.test(line);

  for (const line of lines) {
    if (!line) continue;

    if (isHeading(line) && current.length) {
      blocks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));

  return blocks.map((block) => {
    const bLines = block.split("\n");
    const titleLine = bLines[0] || "Untitled";
    const title = titleLine.replace(/^#{2,}\s+/, "").replace(/^\d+[\.\)\-]\s+/, "");

    const content = bLines.slice(1).join("\n").trim() || block.trim();

    return { title: title.trim(), content };
  });
}

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
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

// -----------------------------
// ✅ API: Get Article By Number
// -----------------------------
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
    console.error(err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// -----------------------------
// ✅ API: Create Article (NEW)
// -----------------------------
app.post("/api/kb/article", async (req, res) => {
  try {
    const { articleNumber, title, summary, content, tags, status } = req.body || {};

    const num = normalizeKB(articleNumber);
    if (!num) return res.status(400).json({ error: "articleNumber required" });
    if (!title) return res.status(400).json({ error: "title required" });

    const doc = await Article.create({
      articleNumber: num,
      title,
      summary: summary || makeSummary(content),
      content: content || "",
      tags: Array.isArray(tags) ? tags : [],
      status: status || "published"
    });

    res.json({ ok: true, item: doc });
  } catch (err) {
    console.error(err);

    // duplicate KB number
    if (String(err).includes("E11000")) {
      return res.status(409).json({
        error: "Create article failed",
        details: "Duplicate articleNumber (already exists)"
      });
    }

    res.status(500).json({ error: "Create article failed", details: String(err) });
  }
});

// -----------------------------
// ✅ API: Update Article (NEW)
// -----------------------------
app.put("/api/kb/article/:articleNumber", async (req, res) => {
  try {
    const articleNumber = normalizeKB(req.params.articleNumber);

    const updates = { ...req.body };
    delete updates.articleNumber; // prevent changing KB number

    const updated = await Article.findOneAndUpdate(
      { articleNumber },
      { $set: updates },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ error: "Article not found" });

    res.json({ ok: true, item: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Update failed", details: String(err) });
  }
});

// -----------------------------
// ✅ API: Bulk Import Articles (NEW)
// -----------------------------
app.post("/api/kb/bulk", async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items[] required" });
    }

    const normalized = items.map((it) => ({
      articleNumber: normalizeKB(it.articleNumber),
      title: it.title,
      summary: it.summary || makeSummary(it.content),
      content: it.content || "",
      tags: Array.isArray(it.tags) ? it.tags : [],
      status: it.status || "published"
    }));

    // ✅ insertMany ordered:false means it will insert others even if few fail
    const inserted = await Article.insertMany(normalized, { ordered: false });

    res.json({
      ok: true,
      insertedCount: inserted.length,
      inserted
    });
  } catch (err) {
    console.error(err);

    // insertMany errors still allow partial insert
    res.status(500).json({
      error: "Bulk import failed",
      details: String(err)
    });
  }
});

// -----------------------------
// ✅ API: Import Text and Auto-create KB articles (NEW)
// -----------------------------
app.post("/api/kb/import-text", async (req, res) => {
  try {
    const { text, kbPrefix, startNumber, tags } = req.body || {};

    if (!text) return res.status(400).json({ error: "text required" });

    const prefix = kbPrefix || "KB-";
    let kbNum = Number(startNumber || 4001);

    const parts = splitIntoArticles(text);

    if (!parts.length) {
      return res.status(400).json({ error: "Could not split text into articles" });
    }

    const toInsert = parts.map((p) => {
      const articleNumber = normalizeKB(`${prefix}${kbNum++}`);

      return {
        articleNumber,
        title: p.title || "Untitled",
        summary: makeSummary(p.content),
        content: p.content,
        tags: Array.isArray(tags) ? tags : [],
        status: "published"
      };
    });

    const inserted = await Article.insertMany(toInsert, { ordered: false });

    res.json({
      ok: true,
      created: inserted.length,
      firstKB: inserted[0]?.articleNumber,
      lastKB: inserted[inserted.length - 1]?.articleNumber
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Import failed", details: String(err) });
  }
});

// -----------------------------
// ✅ Seed Dummy Articles (existing)
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
