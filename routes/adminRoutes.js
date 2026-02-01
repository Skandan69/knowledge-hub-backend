const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Admin = require("../models/Admin");
const User = require("../models/User");

const auth = require("../middleware/auth");

const router = express.Router();

/* ===============================
   (OPTIONAL) REGISTER ADMIN / SUPERADMIN
   👉 Use only for setup/testing
================================ */

router.post("/register", async (req, res) => {

  try {

    const { name, email, password, role, department } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: "All fields required" });
    }

    const exists = await Admin.findOne({ email });
    if (exists) {
      return res.status(400).json({ error: "Admin already exists" });
    }

    const hash = await bcrypt.hash(password, 10);

    const admin = await Admin.create({
      name,
      email,
      password: hash,
      role,                         // "admin" or "superadmin"
      department: department || null
    });

    res.json({
      ok: true,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        department: admin.department
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ===============================
   ADMIN LOGIN
================================ */

router.post("/login", async (req, res) => {

  try {

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const admin = await Admin.findOne({ email });

    if (!admin) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, admin.password);

    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // ✅ JWT includes role + department (IMPORTANT for Phase 6)
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

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ===============================
   ADMIN: GET USERS OF OWN DEPARTMENT
================================ */

router.get("/users", auth, async (req, res) => {

  try {

    // 🔒 Only admins (not superadmin)
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admins only" });
    }

    const users = await User.find({
      department: req.user.department
    })
      .select("name email department approved createdAt")
      .sort({ createdAt: -1 })
      .lean();

    res.json({ items: users });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ===============================
   ADMIN: APPROVE USER (OWN DEPARTMENT ONLY)
================================ */

router.put("/users/:id/approve", auth, async (req, res) => {

  try {

    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admins only" });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 🔒 Department check
    if (user.department !== req.user.department) {
      return res.status(403).json({ error: "Not allowed" });
    }

    user.approved = true;
    await user.save();

    res.json({ ok: true, user });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
