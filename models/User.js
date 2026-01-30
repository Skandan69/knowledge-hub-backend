const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },

  email: {
    type: String,
    required: true,
    unique: true
  },

  password: {
    type: String,
    required: true
  },

  emailVerified: {
    type: Boolean,
    default: false
  },

  verificationToken: {
    type: String
  },

  // 🔑 Forgot password fields
  resetToken: {
    type: String
  },

  resetTokenExpiry: {
    type: Date
  },

  role: {
    type: String,
    default: "user"
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("User", UserSchema);
