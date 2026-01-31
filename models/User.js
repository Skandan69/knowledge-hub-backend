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

  verificationToken: String,

  resetToken: String,
  resetTokenExpiry: Date,

  role: {
    type: String,
    default: "user"
  },

  department: {
    type: String   // user belongs to department
  },

  approved: {
    type: Boolean,
    default: false
  },

  createdAt: { 
    type: Date, 
    default: Date.now 
  }

});

module.exports = mongoose.model("User", UserSchema);
