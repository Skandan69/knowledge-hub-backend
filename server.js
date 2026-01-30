require("dotenv").config();
const adminRoutes = require("./routes/adminRoutes");
const userRoutes = require("./routes/userRoutes");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const fs = require("fs");

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

const app = express();
const auth = require("./middleware/auth");

app.use(cors());
app.use(express.json({ limit: "20mb" }));
const upload = multer({ dest: "uploads/" });

app.use("/api/admin", adminRoutes);
app.use("/api/users", userRoutes);

/* ===============================
   DB CONNECT
================================ */
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI missing");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("✅ MongoDB Connected");
}

/* ===============================
   ARTICLE MODEL
================================ */

const articleSchema = new mongoose.Schema({
  articleNumber: { type: String, unique: true, required: true },
  title: String,
  summary: String,
  content: String,
  tags: [String],
  status: { type: String, default: "published" }
}, { timestamps: true });

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

function makeSummary(content) {
  const txt = String(content || "").replace(/\s+/g," ").trim();
  if (!txt) return "";
  return txt.length > 140 ? txt.slice(0,140) + "..." : txt;
}

function splitByTaskType(text) {
  const parts = text.split(/(?:^|\n)\s*(?:\d+\.\s*)?Task type:\s*/gi);
  return parts.slice(1).map(p => {
    const lines = p.trim().split("\n");
    return {
      title: lines[0]?.trim() || "Untitled",
      content: lines.slice(1).join("\n").trim()
    };
  });
}

/* ===============================
   AUTO KB GENERATOR ⭐
================================ */

async function getNextKB() {
  const last = await Article.findOne()
    .sort({ articleNumber: -1 })
    .lean();

  if (!last) return "KB-1001";

  const num = parseInt(last.articleNumber.replace("KB-",""));
  return `KB-${num + 1}`;
}

/* ===============================
   ROUTES
================================ */

// Health
app.get("/", (req,res)=>{
  res.json({ ok:true, message:"Backend running ✅"});
});

/* --------------------------------
   SEARCH
-------------------------------- */
app.get("/api/kb/search", async (req,res)=>{
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ items: [] });

  const items = await Article.find({
    status:"published",
    $or:[
      { articleNumber: new RegExp(q,"i") },
      { $text:{ $search:q } }
    ]
  }).limit(50).lean();

  res.json({ items });
});

/* --------------------------------
   GET ALL (ADMIN)
-------------------------------- */
app.get("/api/kb/articles", async (req,res)=>{
  const items = await Article.find().sort({articleNumber:1}).lean();
  res.json({ items });
});

/* --------------------------------
   GET SINGLE
-------------------------------- */
app.get("/api/kb/article/:kb", async (req,res)=>{
  const item = await Article.findOne({
    articleNumber: req.params.kb,
    status:"published"
  }).lean();

  if (!item) return res.status(404).json({ error:"Not found" });

  res.json(item);
});

/* --------------------------------
   CREATE ARTICLE (AUTO KB)
-------------------------------- */
app.post("/api/kb/article", auth, async (req,res)=>{
  try{
    const { title, summary, content, tags, status } = req.body;

    if(!title) return res.status(400).json({error:"Title required"});

    const kb = await getNextKB();

    const doc = await Article.create({
      articleNumber: kb,
      title,
      summary: summary || makeSummary(content),
      content,
      tags: tags || [],
      status: status || "published"
    });

    res.json({ ok:true, item: doc });

  }catch(err){
    res.status(500).json({ error:"Create failed" });
  }
});

/* --------------------------------
   UPDATE
-------------------------------- */
app.put("/api/kb/article/:kb", auth, async (req,res)=>{

  const updated = await Article.findOneAndUpdate(
    { articleNumber: req.params.kb },
    { $set: req.body },
    { new:true }
  ).lean();

  if(!updated) return res.status(404).json({error:"Not found"});

  res.json({ ok:true, item: updated });
});

/* --------------------------------
   DELETE
-------------------------------- */
app.delete("/api/kb/article/:kb", auth, async (req,res)=>{

  const del = await Article.findOneAndDelete({
    articleNumber: req.params.kb
  });

  if(!del) return res.status(404).json({error:"Not found"});

  res.json({ ok:true });
});

/* --------------------------------
   SOP TEXT IMPORT (AUTO KB)
-------------------------------- */
app.post("/api/kb/import-text", auth, async (req,res)=>{

  const { text, tags } = req.body;
  if(!text) return res.status(400).json({error:"Text required"});

  const sections = splitByTaskType(text);
  if(!sections.length) return res.status(400).json({error:"No sections"});

  let kb = await getNextKB();
  let num = parseInt(kb.replace("KB-",""));

  const items = sections.map(sec=>({
    articleNumber:`KB-${num++}`,
    title:sec.title,
    summary:makeSummary(sec.content),
    content:sec.content,
    tags: tags || ["bulk"],
    status:"published"
  }));

  const inserted = await Article.insertMany(items);

  res.json({ ok:true, created: inserted.length });
});

/* --------------------------------
   WORD / PDF UPLOAD (AUTO KB)
-------------------------------- */
app.post("/api/kb/upload", auth, upload.single("file"), async (req,res)=>{
  try{

    const file = req.file;
    const { mode } = req.body;

    if(!file) return res.status(400).json({error:"No file"});

    let text="";

    if(file.originalname.endsWith(".docx")){
      const r = await mammoth.extractRawText({ path:file.path });
      text = r.value;
    }

    if(file.originalname.endsWith(".pdf")){
      const buf = fs.readFileSync(file.path);
      const pdf = await pdfParse(buf);
      text = pdf.text;
    }

    fs.unlinkSync(file.path);

    if(!text.trim()) return res.status(400).json({error:"No text"});

    let created=[];

    // SINGLE
    if(mode === "single"){

      const kb = await getNextKB();

      const doc = await Article.create({
        articleNumber: kb,
        title:file.originalname,
        summary:makeSummary(text),
        content:text,
        tags:["upload"],
        status:"published"
      });

      created.push(doc);
    }

    // SPLIT
    else{

      const sections = splitByTaskType(text);
      if(!sections.length) return res.status(400).json({error:"No sections"});

      let next = await getNextKB();
      let num = parseInt(next.replace("KB-",""));

      for(const sec of sections){
        const doc = await Article.create({
          articleNumber:`KB-${num++}`,
          title:sec.title,
          summary:makeSummary(sec.content),
          content:sec.content,
          tags:["upload"],
          status:"published"
        });
        created.push(doc);
      }
    }

    res.json({ ok:true, created: created.length });

  }catch(err){
    console.error(err);
    res.status(500).json({ error:"Upload failed" });
  }
});

/* ===============================
   START
================================ */

const PORT = process.env.PORT || 3000;

connectDB().then(()=>{
  app.listen(PORT, ()=>console.log("✅ Server running on",PORT));
});
