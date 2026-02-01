const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const Admin = require("../models/Admin");
const Department = require("../models/Department");

const auth = require("../middleware/auth");
const superAdminAuth = require("../middleware/superAdminAuth");

const router = express.Router();

/* ===============================
   SUPER ADMIN LOGIN
================================ */

router.post("/login", async (req, res) => {
  try {

    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const admin = await Admin.findOne({ email, role: "superadmin" });

    if (!admin)
      return res.status(401).json({ error: "Invalid credentials" });

    const match = await bcrypt.compare(password, admin.password);

    if (!match)
      return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { id: admin._id, role: admin.role },
      process.env.JWT_SECRET || "knowledgehubsecret",
      { expiresIn: "1d" }
    );

    res.json({ ok:true, token });

  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

/* ===============================
   CREATE DEPARTMENT
================================ */

router.post("/departments", auth, superAdminAuth, async (req, res) => {
  try {

    const { name } = req.body;

    if (!name)
      return res.status(400).json({ error: "Department name required" });

    const exists = await Department.findOne({ name });

    if (exists)
      return res.status(400).json({ error: "Department already exists" });

    const dep = await Department.create({ name });

    res.json({ ok:true, department:dep });

  } catch (err) {
    res.status(500).json({ error:"Failed creating department" });
  }
});

/* ===============================
   GET DEPARTMENTS
================================ */

router.get("/departments", auth, superAdminAuth, async (req, res) => {
  try {

    const deps = await Department.find().sort({ name:1 }).lean();

    res.json({ items:deps });

  } catch (err) {
    res.status(500).json({ items:[] });
  }
});

/* ===============================
   CREATE ADMIN
================================ */

router.post("/admins", auth, superAdminAuth, async (req, res) => {
  try {

    const { name, email, password, department } = req.body;

    if (!name || !email || !password || !department)
      return res.status(400).json({ error:"All fields required" });

    const exists = await Admin.findOne({ email });

    if (exists)
      return res.status(400).json({ error:"Admin already exists" });

    const hash = await bcrypt.hash(password,10);

    const admin = await Admin.create({
      name,
      email,
      password:hash,
      role:"admin",
      department
    });

    res.json({ ok:true, admin });

  } catch (err) {
    res.status(500).json({ error:"Failed creating admin" });
  }
});

/* ===============================
   GET ADMINS
================================ */
router.get("/admins", auth, superAdminAuth, async (req,res)=>{
  try{

    const admins = await Admin.find({ role:"admin" })
      .populate("department","name")
      .lean();

res.json({ items: admins });

  }catch(err){
    res.json({ items:[] });
  }
});

/* ===============================
   DELETE ADMIN
================================ */

router.delete("/admins/:id", auth, superAdminAuth, async (req, res) => {
  try {

    const admin = await Admin.findById(req.params.id);

    if (!admin)
      return res.status(404).json({ error:"Admin not found" });

    if (admin.role === "superadmin")
      return res.status(403).json({ error:"Cannot delete super admin" });

    await Admin.findByIdAndDelete(req.params.id);

    res.json({ ok:true });

  } catch (err) {
    res.status(500).json({ error:"Delete failed" });
  }
});

/* ===============================
   UPDATE ADMIN DEPARTMENT
================================ */

router.put("/admins/:id/department", auth, superAdminAuth, async (req, res) => {
  try {

    const { department } = req.body;

    if (!department)
      return res.status(400).json({ error:"Department required" });

    const admin = await Admin.findById(req.params.id);

    if (!admin)
      return res.status(404).json({ error:"Admin not found" });

    if (admin.role === "superadmin")
      return res.status(403).json({ error:"Cannot modify super admin" });

    admin.department = department;
    await admin.save();

    res.json({ ok:true });

  } catch (err) {
    res.status(500).json({ error:"Update failed" });
  }
});

/* ===============================
   GET USERS
================================ */

router.get("/users", auth, superAdminAuth, async (req, res) => {
  try {

    const users = await User.find()
      .sort({ createdAt:-1 })
      .lean();

    res.json({ items:users });

  } catch (err) {
    res.status(500).json({ items:[] });
  }
});

/* ===============================
   APPROVE USER
================================ */

router.put("/users/:id/approve", auth, superAdminAuth, async (req, res) => {
  try {

    const user = await User.findById(req.params.id);

    if (!user)
      return res.status(404).json({ error:"User not found" });

    user.approved = true;
    await user.save();

    res.json({ ok:true });

  } catch (err) {
    res.status(500).json({ error:"Approve failed" });
  }
});

/* ===============================
   UPDATE USER DEPARTMENT
================================ */

router.put("/users/:id/department", auth, superAdminAuth, async (req, res) => {
  try {

    const { department } = req.body;

    if (!department)
      return res.status(400).json({ error:"Department required" });

    const user = await User.findById(req.params.id);

    if (!user)
      return res.status(404).json({ error:"User not found" });

    user.department = department;
    await user.save();

    res.json({ ok:true });

  } catch (err) {
    res.status(500).json({ error:"Update failed" });
  }
});
/* ===============================
   DELETE USER
================================ */

router.delete("/users/:id", auth, superAdminAuth, async (req, res) => {
  try {

    const user = await User.findById(req.params.id);

    if (!user)
      return res.status(404).json({ error:"User not found" });

    await User.findByIdAndDelete(req.params.id);

    res.json({ ok:true });

  } catch (err) {
    res.status(500).json({ error:"Delete failed" });
  }
});

module.exports = router;
