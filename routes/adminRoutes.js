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

  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Required" });

  const admin = await Admin.findOne({ email });

  if (!admin)
    return res.status(401).json({ error: "Invalid" });

  const match = await bcrypt.compare(password, admin.password);

  if (!match)
    return res.status(401).json({ error: "Invalid" });

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
      name: admin.name,
      email: admin.email,
      role: admin.role,
      department: admin.department
    }
  });
});

/* ===============================
   GET USERS (OWN DEPARTMENT)
================================ */

router.get("/users", auth, async (req, res) => {

  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admins only" });

  const users = await User.find({
    department: req.user.department
  })
    .select("name email department approved createdAt")
    .sort({ createdAt: -1 })
    .lean();

  res.json({ items: users });
});

/* ===============================
   APPROVE USER (OWN DEPT)
================================ */

router.put("/users/:id/approve", auth, async (req, res) => {

  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admins only" });

  const user = await User.findById(req.params.id);

  if (!user)
    return res.status(404).json({ error: "Not found" });

  if (user.department !== req.user.department)
    return res.status(403).json({ error: "Not allowed" });

  user.approved = true;
  await user.save();

  res.json({ ok: true });
});

module.exports = router;
