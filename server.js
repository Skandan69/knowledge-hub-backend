require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const Counter = require("./models/Counter");

const adminRoutes = require("./routes/adminRoutes");
const userRoutes = require("./routes/userRoutes");
const auth = require("./middleware/auth");
const superAdminRoutes = require("./routes/superAdminRoutes");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

/* ===============================
   UPLOAD SETUP
================================ */
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
const upload = multer({ dest: "uploads/" });

/* ===============================
   DB CONNECT
================================ */
async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB Connected");
}

/* ===============================
   ARTICLE MODEL
================================ */
const articleSchema = new mongoose.Schema({
  articleNumber: { type: String, unique: true },
  title: String,
  summary: String,
  content: String,
  category: { type: String, default: "General" }, // NEW
  tags: [String],
  status: { type: String, default: "published" }
},{ timestamps:true });

articleSchema.index({
  title:"text",
  summary:"text",
  content:"text",
  tags:"text"
});

const Article = mongoose.model("Article", articleSchema);

/* ===============================
   HELPERS
================================ */

function makeSummary(content){
  const t = String(content||"").replace(/\s+/g," ").trim();
  return t.length>140 ? t.slice(0,140)+"..." : t;
}

// AUTO NEXT KB NUMBER
async function generateNextKB(){

  const counter = await Counter.findOneAndUpdate(
    { name: "kb" },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  );

  return "KB-" + String(counter.value).padStart(6, "0");
}

// OLD PDF / TEXT SPLIT
function splitByTaskType(text){
  const parts = text.split(/(?:^|\n)\s*(?:\d+\.\s*)?Task type:\s*/gi);

  return parts.slice(1).map(p=>{
    const lines = p.trim().split("\n");

    return {
      title: lines[0] || "Untitled",
      content: lines.slice(1).join("\n")
    };
  });
}

// NEW WORD HEADING SPLIT
function splitByHeadings(html){

  const parts = html.split(/<h1[^>]*>/i).slice(1);

  return parts.map(block => {

    const endTitle = block.indexOf("</h1>");

    const title = block
      .slice(0, endTitle)
      .replace(/<[^>]+>/g,"")
      .trim();

    const body = block
      .slice(endTitle + 5)
      .replace(/<[^>]+>/g,"")
      .trim();

    return {
      title: title || "Untitled",
      content: body
    };
  });
}
  
/* ===============================
   ROUTES
================================ */

app.get("/",(req,res)=>{
  res.json({ ok:true, message:"Knowledge Hub running ✅"});
});

app.use("/api/admin", adminRoutes);
app.use("/api/users", userRoutes);
app.use("/api/superadmin", superAdminRoutes);
/* ===============================
   SEARCH
================================ */

app.get("/api/kb/search", async(req,res)=>{
  const q = req.query.q || "";
  if(!q) return res.json({ items:[] });

  const items = await Article.find({
    status:"published",
    $or:[
      { articleNumber:new RegExp(q,"i") },
      { $text:{ $search:q } }
    ]
  }).limit(50).lean();

  res.json({ items });
});

/* ===============================
   GET ALL ARTICLES (ADMIN)
================================ */

app.get("/api/kb/articles", async(req,res)=>{
  const items = await Article.find().sort({ articleNumber:1 }).lean();
  res.json({ items });
});

/* ===============================
   GET SINGLE ARTICLE
================================ */

app.get("/api/kb/article/:kb", async(req,res)=>{
  const item = await Article.findOne({ articleNumber:req.params.kb }).lean();
  if(!item) return res.status(404).json({ error:"Not found" });
  res.json(item);
});

/* ===============================
   CREATE ARTICLE (AUTO KB)
================================ */

app.post("/api/kb/article", auth, async(req,res)=>{
  const { title, summary, content, tags, status, category } = req.body;

  if(!title) return res.status(400).json({ error:"Title required" });

  const kb = await generateNextKB();

 const doc = await Article.create({
  articleNumber: kb,
  title,
  summary: summary || makeSummary(content),
  content,
  category: category || "General",
  tags: tags || [],
  status: status || "published"
});

  res.json({ ok:true, item:doc });
});

/* ===============================
   UPDATE
================================ */

app.put("/api/kb/article/:kb", auth, async(req,res)=>{
  const updated = await Article.findOneAndUpdate(
    { articleNumber:req.params.kb },
    { $set:req.body },
    { new:true }
  );

  res.json({ ok:true, item:updated });
});

/* ===============================
   DELETE
================================ */

app.delete("/api/kb/article/:kb", auth, async(req,res)=>{
  await Article.findOneAndDelete({ articleNumber:req.params.kb });
  res.json({ ok:true });
});

/* ===============================
   IMPORT SOP TEXT
================================ */

app.post("/api/kb/import-text", auth, async(req,res)=>{
  const { text } = req.body;
  if(!text) return res.status(400).json({ error:"Text required" });

  const sections = splitByTaskType(text);

  let created=0;

  for(const sec of sections){
    const kb = await generateNextKB();
    await Article.create({
  articleNumber: kb,
  title: sec.title,
  summary: makeSummary(sec.content),
  content: sec.content,
  category: "General",
  tags:["bulk"],
  status:"published"
});
    created++;
  }

  res.json({ ok:true, created });
});

/* ===============================
   UPLOAD WORD / PDF
================================ */

app.post("/api/kb/upload", auth, upload.single("file"), async(req,res)=>{
  const { mode } = req.body;
  const file = req.file;

  if(!file) return res.status(400).json({ error:"No file" });

  let text="";

 if(file.originalname.endsWith(".docx")){
  const r = await mammoth.convertToHtml({ path: file.path });
  text = r.value;
}

  if(file.originalname.endsWith(".pdf")){
    const buf = fs.readFileSync(file.path);
    const pdf = await pdfParse(buf);
    text = pdf.text;
  }

  fs.unlinkSync(file.path);

  if(!text.trim()) return res.status(400).json({ error:"No text extracted" });

  let created=0;

  // SINGLE
  if(mode==="single"){
    const kb = await generateNextKB();
   await Article.create({
  articleNumber: kb,
  title: file.originalname,
  summary: makeSummary(text),
  content:text,
  category: "General",
  tags:["upload"]
});
    created=1;
  }

  // SPLIT
  else{
    let sections = [];

if(file.originalname.endsWith(".docx")){
   sections = splitByHeadings(text);
} else {
   sections = splitByTaskType(text);
}
    for(const sec of sections){
      const kb = await generateNextKB();
     await Article.create({
  articleNumber: kb,
  title: sec.title,
  summary: makeSummary(sec.content),
  content: sec.content,
  category: "General",
  tags:["upload"]
});
      created++;
    }
  }

  res.json({ ok:true, created });
});
/* ===============================
   ONE TIME SUPER ADMIN SETUP
================================ */

const bcrypt = require("bcryptjs");
const Admin = require("./models/Admin");

app.post("/setup-superadmin", async (req, res) => {

  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: "All fields required" });
  }

  // Check if super admin already exists
  const exists = await Admin.findOne({ role: "superadmin" });

  if (exists) {
    return res.status(400).json({ error: "Super Admin already created" });
  }

  const hash = await bcrypt.hash(password, 10);

  const superAdmin = await Admin.create({
    name,
    email,
    password: hash,
    role: "superadmin"
  });

  res.json({
    ok: true,
    message: "Super Admin created successfully",
    admin: {
      email: superAdmin.email,
      role: superAdmin.role
    }
  });
});

/* ===============================
   START
================================ */

const PORT = process.env.PORT || 3000;

connectDB().then(()=>{
  app.listen(PORT, ()=>console.log("✅ Server running"));
});
