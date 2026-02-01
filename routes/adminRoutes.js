const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Admin = require("../models/Admin");
const User = require("../models/User");
const Article = require("../models/Article");

const auth = require("../middleware/auth");

const router = express.Router();

/* ===============================
   ADMIN LOGIN
================================ */

router.post("/login", async (req, res) => {

  const { email, password } = req.body;

  const admin = await Admin.findOne({ email });

  if (!admin) return res.status(401).json({ error: "Invalid credentials" });

  const match = await bcrypt.compare(password, admin.password);

  if (!match) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    {
      id: admin._id,
      role: admin.role,
      department: admin.department
    },
    process.env.JWT_SECRET || "knowledgehubsecret",
    { expiresIn: "8h" }
  );

  res.json({
    ok:true,
    token,
    admin:{
      name: admin.name,
      department: admin.department
    }
  });
});

/* ===============================
   ADMIN → GET OWN DEPARTMENT ARTICLES
================================ */

router.get("/articles", auth, async (req,res)=>{

  const admin = await Admin.findById(req.adminId);

  if(!admin) return res.status(401).json({error:"Admin not found"});

  const articles = await Article.find({
    department: admin.department
  }).sort({createdAt:-1});

  res.json({ items: articles });
});

/* ===============================
   ADMIN → CREATE ARTICLE (AUTO DEPT)
================================ */

router.post("/article", auth, async (req,res)=>{

  const admin = await Admin.findById(req.adminId);

  if(!admin) return res.status(401).json({error:"Admin not found"});

  const { title, summary, content, tags } = req.body;

  const article = await Article.create({
    title,
    summary,
    content,
    tags,
    department: admin.department,
    status:"published"
  });

  res.json({ ok:true, article });
});

/* ===============================
   ADMIN → GET USERS OF DEPARTMENT
================================ */

router.get("/users", auth, async (req,res)=>{

  const admin = await Admin.findById(req.adminId);

  if(!admin) return res.status(401).json({error:"Admin not found"});

  const users = await User.find({
    department: admin.department
  });

  res.json({ items: users });
});

/* ===============================
   ADMIN → APPROVE USER
================================ */

router.put("/users/:id/approve", auth, async (req,res)=>{

  const admin = await Admin.findById(req.adminId);

  if(!admin) return res.status(401).json({error:"Admin not found"});

  const user = await User.findById(req.params.id);

  if(!user) return res.status(404).json({error:"User not found"});

  // security check
  if(user.department !== admin.department){
    return res.status(403).json({error:"Not allowed"});
  }

  user.approved = true;
  await user.save();

  res.json({ ok:true });
});

module.exports = router;
