const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Admin = require("../models/Admin");
const User = require("../models/User");

const auth = require("../middleware/auth");

const router = express.Router();

/* ===============================
   REGISTER (OPTIONAL - RUN ONCE)
================================ */

router.post("/register", async (req, res) => {

  const { name, email, password, role, department } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "All fields required" });
  }

  const exists = await Admin.findOne({ email });

  if (exists) {
    return res.status(400).json({ message: "Admin already exists" });
  }

  const hash = await bcrypt.hash(password, 10);

  const admin = await Admin.create({
    name,
    email,
    password: hash,
    role,
    department: department || null
  });

  res.json({
    ok: true,
    admin
  });
});

/* ===============================
   ADMIN LOGIN
================================ */

router.post("/login", async (req, res) => {

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  const admin = await Admin.findOne({ email });

  if (!admin) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const match = await bcrypt.compare(password, admin.password);

  if (!match) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

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
    ok: true,
    token,
    admin: {
      id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      department: admin.department
    }
  });
});

/* ===============================
   ADMIN: GET USERS OF OWN DEPARTMENT
================================ */

router.get("/users", auth, async (req, res) => {

  const admin = await Admin.findById(req.adminId);

  if (!admin) {
    return res.status(401).json({ error: "Admin not found" });
  }

  const users = await User.find({
    department: admin.department,
    approved: true
  }).lean();

  res.json({ items: users });
});

module.exports = router;
