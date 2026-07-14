const jwt = require("jsonwebtoken");
const db = require("./db");

// ponytail: JWT secret from env, falls back to a fixed dev secret. Set JWT_SECRET in prod.
const SECRET = process.env.JWT_SECRET || "generation-prompt-dev-secret-change-me";

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: "12h" });
}

// Verifies token, reloads fresh user (so a disabled account loses access immediately).
function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: "Account inactive" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function adminRequired(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

module.exports = { sign, authRequired, adminRequired };
