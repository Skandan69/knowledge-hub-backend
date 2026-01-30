const jwt = require("jsonwebtoken");

module.exports = function(req, res, next) {
  const header = req.headers.authorization;

  if (!header) return res.status(401).json({ message: "No token provided" });

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "knowledgehubsecret"
    );

    req.adminId = decoded.id;
    next();

  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};
