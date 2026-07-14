const db = require("./db");

const stmt = db.prepare(
  "INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)"
);

// Fire-and-forget activity log.
function log(userId, action, detail = "") {
  try {
    stmt.run(userId ?? null, action, typeof detail === "string" ? detail : JSON.stringify(detail));
  } catch {
    /* logging must never break a request */
  }
}

module.exports = log;
