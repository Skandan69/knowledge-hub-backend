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

    // ✅ JWT includes department + role
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
   GET PENDING USERS (ALL ADMINS SEE SAME LIST)
================================ */

  try {

    if (!["admin", "superadmin"].includes(req.user.role)) {
  return res.status(403).json({ error: "Admins only" });
}
    // ✅ Only users waiting for approval
let filter = { approved: false };
const users = await User.find(filter)
  .select("name email department approved createdAt")
  .sort({ createdAt: -1 });

    res.json({ items: users });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ===============================
   APPROVE USER (AUTO ASSIGN DEPARTMENT)
================================ */

  try {

    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admins only" });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 🚨 Safety check (important)
    if (user.department !== req.user.department) {
      return res.status(403).json({ error: "Not your department user" });
    }

    user.approved = true;
    await user.save();

    res.json({ ok: true, user });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
