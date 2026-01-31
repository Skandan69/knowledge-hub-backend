const mongoose = require("mongoose");

const AdminSchema = new mongoose.Schema({

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

  role: {
    type: String,
    default: "admin" // admin or superadmin
  },

  department: {
    type: String,
    default: null   // Only admins get department
  },

  createdAt: { 
    type: Date, 
    default: Date.now 
  }

});

module.exports = mongoose.model("Admin", AdminSchema);
