const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Admin = require("../models/Admin");
const User = require("../models/User");

const auth = require("../middleware/auth");

const router = express.Router();

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

    // JWT (simple — no department dependency)
    const token = jwt.sign(
      {
        id: admin._id,
        role: admin.role
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
        role: admin.role
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ===============================
   GET PENDING USERS
================================ */

router.get("/users", auth, async (req, res) => {

  try {

    if (!["admin", "superadmin"].includes(req.user.role)) {
      return res.status(403).json({ error: "Admins only" });
    }

    // Users waiting approval
    const users = await User.find({ approved: false })
      .select("name email approved createdAt")
      .sort({ createdAt: -1 });

    res.json({ items: users });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ===============================
   APPROVE USER
================================ */

router.put("/users/:id/approve", auth, async (req, res) => {

  try {

    if (!["admin", "superadmin"].includes(req.user.role)) {
      return res.status(403).json({ error: "Admins only" });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.approved = true;
    await user.save();

    res.json({ ok: true, user });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
