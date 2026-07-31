module.exports = (...allowedRoles) => {
  const normalizedAllowed = allowedRoles.map((role) =>
    String(role || "").trim().toLowerCase()
  );

  return (req, res, next) => {
    const role = String(req.user?.role || "").trim().toLowerCase();
    if (!role || !normalizedAllowed.includes(role)) {
      return res.status(403).send({
        status: "Error",
        message: "Forbidden",
      });
    }
    next();
  };
};
