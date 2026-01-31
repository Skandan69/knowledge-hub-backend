module.exports = function(req, res, next){

  if(!req.user || req.user.role !== "superadmin"){
    return res.status(403).json({ error: "Super admin access only" });
  }

  next();
};
