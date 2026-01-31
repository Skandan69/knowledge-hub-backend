const express = require("express");
const bcrypt = require("bcryptjs");

const Admin = require("../models/Admin");
const Department = require("../models/Department");
const auth = require("../middleware/auth");
const superAdminAuth = require("../middleware/superAdminAuth");

const router = express.Router();

/* ===============================
   CREATE DEPARTMENT
================================ */

router.post("/departments", auth, superAdminAuth, async(req,res)=>{

  const { name } = req.body;

  if(!name) return res.status(400).json({ error:"Department name required" });

  const exists = await Department.findOne({ name });
  if(exists) return res.status(400).json({ error:"Department already exists" });

  const dep = await Department.create({
    name,
    createdBy: req.user.id
  });

  res.json({ ok:true, department: dep });
});

/* ===============================
   GET ALL DEPARTMENTS
================================ */

router.get("/departments", auth, superAdminAuth, async(req,res)=>{

  const deps = await Department.find().sort({ name:1 }).lean();
  res.json({ items: deps });
});

/* ===============================
   CREATE ADMIN
================================ */

router.post("/admins", auth, superAdminAuth, async(req,res)=>{

  const { name, email, password, department } = req.body;

  if(!name || !email || !password || !department){
    return res.status(400).json({ error:"All fields required" });
  }

  const exists = await Admin.findOne({ email });
  if(exists) return res.status(400).json({ error:"Admin already exists" });

  const hash = await bcrypt.hash(password, 10);

  const admin = await Admin.create({
    name,
    email,
    password: hash,
    role: "admin",
    department
  });

  res.json({ ok:true, admin });
});
/* ===============================
   SUPER ADMIN LOGIN
================================ */

router.post("/login", async (req, res) => {

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const admin = await Admin.findOne({ email, role: "superadmin" });

  if (!admin) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const match = await bcrypt.compare(password, admin.password);

  if (!match) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const jwt = require("jsonwebtoken");

  const token = jwt.sign(
    { id: admin._id, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  res.json({
    ok: true,
    token,
    admin: {
      email: admin.email,
      role: admin.role
    }
  });
});
module.exports = router;
