const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

const router = express.Router();

/* ===============================
   REGISTER FIRST SUPER ADMIN (RUN ONCE ONLY)
   (Optional – you can disable later)
================================ */

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, department } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "All fields required" });
    }

    const existing = await Admin.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "Admin already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const admin = await Admin.create({
      name,
      email,
      password: hashed,
      role,                // "superadmin" or "admin"
      department: department || null
    });

    res.json({
      ok: true,
      message: "Admin created",
      admin: {
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

    // ✅ JWT now includes role + department
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

module.exports = router;
