const jwt = require("jsonwebtoken");
require("dotenv").config();

const auth = async (req, res, next) => {
  let authHeader = req.headers.Authorization || req.headers.authorization;
  try {
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      throw "Token Is Missing";
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
      throw "User is not authorized or token is missing";
    }
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECERT);
    if (!decoded) {
      throw "User is not authorized";
    }
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).send({ status: "Error", data: error?.message || error });
  }
};

module.exports = auth;
