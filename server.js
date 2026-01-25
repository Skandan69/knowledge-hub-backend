require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const fs = require("fs");

const app = express();

/* ===============================
   MIDDLEWARE
================================ */
app.use(cors());
app.use(express.json({ limit: "20mb" }));
const upload = multer({ dest: "uploads/" });

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
    articleNumber: { type: String, unique: true, required: true },
    title: { type: String, required: true },
    summary: { type: String, default: "" },
    content: { type: String, default: "" },
    tags: [{ type: String }],
    status: { type: String, default: "published" }
  },
  { timestamps: true }
);

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

function splitByTaskType(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const parts = raw.split(/(?:^|\n)\s*(?:\d+\.\s*)?Task type:\s*/gi);
  const blocks = parts.slice(1).map((p) => p.trim()).filter(Boolean);

  return blocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trim());
    const title = (lines[0] || "Untitled").replace(/\.$/, "").trim();
    const content = lines.slice(1).join("\n").trim();

    return { title, content };
  });
}

/* ===============================
   ROUTES
================================ */

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Knowledge Hub Backend is running ✅" });
});

/* --------------------------------
   SEARCH
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
    res.status(500).json({ error: "Search failed" });
  }
});

/* --------------------------------
   GET SINGLE ARTICLE
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
    res.status(500).json({ error: "Fetch failed" });
  }
});

/* --------------------------------
   👉 GET ALL ARTICLES (ADMIN CMS)
--------------------------------- */
app.get("/api/kb/articles", async (req, res) => {
  try {
    const items = await Article.find()
      .sort({ articleNumber: 1 })
      .lean();

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: "Fetch all failed" });
  }
});

/* --------------------------------
   CREATE ARTICLE
--------------------------------- */
app.post("/api/kb/article", async (req, res) => {
  try {
    const { articleNumber, title, summary, content, tags, status } = req.body || {};

    const num = normalizeKB(articleNumber);
    if (!num) return res.status(400).json({ error: "articleNumber required" });
    if (!title) return res.status(400).json({ error: "title required" });

    const doc = await Article.create({
      articleNumber: num,
      title: title.trim(),
      summary: summary ? summary.trim() : makeSummary(content),
      content: content || "",
      tags: Array.isArray(tags) ? tags : [],
      status: status || "published"
    });

    res.status(201).json({ ok: true, item: doc });
  } catch (err) {
    if (String(err).includes("E11000")) {
      return res.status(409).json({ error: "Duplicate KB number" });
    }

    res.status(500).json({ error: "Create failed" });
  }
});

/* --------------------------------
   👉 UPDATE ARTICLE
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
    res.status(500).json({ error: "Update failed" });
  }
});

/* --------------------------------
   👉 DELETE ARTICLE
--------------------------------- */
app.delete("/api/kb/article/:articleNumber", async (req, res) => {
  try {
    const articleNumber = normalizeKB(req.params.articleNumber);

    const deleted = await Article.findOneAndDelete({ articleNumber }).lean();

    if (!deleted) return res.status(404).json({ error: "Article not found" });

    res.json({ ok: true, message: "Article deleted" });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

/* --------------------------------
   BULK INSERT
--------------------------------- */
app.post("/api/kb/bulk", async (req, res) => {
  try {
    const { items } = req.body || {};

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "items required" });
    }

    const normalized = items.map((it) => ({
      articleNumber: normalizeKB(it.articleNumber),
      title: it.title.trim(),
      summary: it.summary ? it.summary.trim() : makeSummary(it.content),
      content: it.content || "",
      tags: Array.isArray(it.tags) ? it.tags : [],
      status: it.status || "published"
    }));

    const inserted = await Article.insertMany(normalized, { ordered: false });

    res.json({ ok: true, insertedCount: inserted.length });
  } catch (err) {
    res.status(500).json({ error: "Bulk insert failed" });
  }
});

/* --------------------------------
   IMPORT SOP TEXT
--------------------------------- */
app.post("/api/kb/import-text", async (req, res) => {
  try {
    const { text, startNumber, kbPrefix, tags } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });

    let num = Number(startNumber || 7001);
    const prefix = kbPrefix || "KB-";

    const sections = splitByTaskType(text);

    if (!sections.length) {
      return res.status(400).json({ error: "No Task type sections found" });
    }

    const items = sections.map((s) => ({
      articleNumber: normalizeKB(`${prefix}${num++}`),
      title: s.title,
      summary: makeSummary(s.content),
      content: s.content,
      tags: Array.isArray(tags) ? tags : ["bulk"],
      status: "published"
    }));

    const inserted = await Article.insertMany(items, { ordered: false });

    res.json({
      ok: true,
      created: inserted.length,
      firstKB: inserted[0].articleNumber,
      lastKB: inserted[inserted.length - 1].articleNumber
    });
  } catch (err) {
    res.status(500).json({ error: "Import failed" });
  }
});

/* --------------------------------
   SEED DEMO
--------------------------------- */
app.post("/api/kb/seed", async (req, res) => {
  try {
    const count = await Article.countDocuments();
    if (count) return res.json({ message: "Already seeded" });

    await Article.insertMany([
      {
        articleNumber: "KB-1001",
        title: "How to Reset Password",
        summary: "Steps to reset password.",
        content: "Click forgot password and follow email instructions.",
        tags: ["password"],
        status: "published"
      },
      {
        articleNumber: "KB-1002",
        title: "Refund Not Received",
        summary: "What to do if refund delayed.",
        content: "Wait 5-7 days then contact support.",
        tags: ["refund"],
        status: "published"
      }
    ]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Seed failed" });
  }
});
/* --------------------------------
   📄 UPLOAD WORD / PDF WITH DROPDOWN LOGIC
--------------------------------- */

app.post("/api/kb/upload", upload.single("file"), async (req, res) => {
  try {
    const { mode, startNumber } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "No file uploaded" });

    let extractedText = "";

    // WORD
    if (file.originalname.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ path: file.path });
      extractedText = result.value;
    }

    // PDF
    if (file.originalname.endsWith(".pdf")) {
      const buffer = fs.readFileSync(file.path);
      const pdf = await pdfParse(buffer);
      extractedText = pdf.text;
    }

    fs.unlinkSync(file.path); // remove temp file

    if (!extractedText.trim()) {
      return res.status(400).json({ error: "No text extracted" });
    }

    let created = [];

    // ==========================
    // SINGLE ARTICLE MODE
    // ==========================
    if (mode === "single") {

      const kb = "KB-" + Date.now();

      const doc = await Article.create({
        articleNumber: kb,
        title: file.originalname,
        summary: makeSummary(extractedText),
        content: extractedText,
        tags: ["upload"],
        status: "published"
      });

      created.push(doc);
    }

    // ==========================
    // AUTO SPLIT MODE
    // ==========================
    else {

      let num = Number(startNumber || 8000);
      const sections = splitByTaskType(extractedText);

      if (!sections.length) {
        return res.status(400).json({ error: "No Task type sections found" });
      }

      for (const sec of sections) {
        const doc = await Article.create({
          articleNumber: normalizeKB(`KB-${num++}`),
          title: sec.title,
          summary: makeSummary(sec.content),
          content: sec.content,
          tags: ["upload"],
          status: "published"
        });

        created.push(doc);
      }
    }

    res.json({
      ok: true,
      created: created.length
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});

/* ===============================
   START SERVER
================================ */
const PORT = process.env.PORT || 3000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`✅ Server running on ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ DB connection failed", err);
    process.exit(1);
  });
