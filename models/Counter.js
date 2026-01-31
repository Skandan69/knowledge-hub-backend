const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
  name: { type: String, unique: true },
  value: { type: Number, default: 1000 }  // start before KB-1001
});

module.exports = mongoose.model("Counter", counterSchema);
