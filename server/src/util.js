// Shared helpers: endpoint normalization + secret masking.
// Keys NEVER get logged in full; use maskKey() everywhere a key might surface.

// Trim trailing slashes so "https://d/v1/" -> "https://d/v1".
// Never double-appends: joinUrl(base, "/chat/completions") on ".../v1" = ".../v1/chat/completions".
function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function joinUrl(base, path) {
  const b = normalizeBaseUrl(base);
  const p = String(path || "").replace(/^\/+/, "");
  return p ? `${b}/${p}` : b;
}

// sk-1234abcd -> sk-****abcd ; mcai_1234abcd -> mcai_****abcd. Short keys fully masked.
function maskKey(key) {
  const k = String(key || "");
  if (!k) return "";
  const m = k.match(/^([a-zA-Z]+[-_])?(.*)$/);
  const prefix = m?.[1] || "";
  const rest = m?.[2] || k;
  if (rest.length <= 4) return `${prefix}****`;
  return `${prefix}****${rest.slice(-4)}`;
}

module.exports = { normalizeBaseUrl, joinUrl, maskKey };

// self-check: run `node src/util.js`
if (require.main === module) {
  const assert = require("assert");
  assert.equal(normalizeBaseUrl("https://d/v1/"), "https://d/v1");
  assert.equal(joinUrl("https://d/v1/", "/chat/completions"), "https://d/v1/chat/completions");
  assert.equal(joinUrl("https://d/v1", "chat/completions"), "https://d/v1/chat/completions");
  assert.equal(maskKey("sk-1234abcd"), "sk-****abcd");
  assert.equal(maskKey("mcai_1234abcd"), "mcai_****abcd");
  assert.equal(maskKey("abc"), "****");
  console.log("util.js self-check OK");
}
