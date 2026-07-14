// Self-check thuần Node, không framework:  node desktop/src/promptLogic.test.mjs
import assert from "node:assert";

// Bản sao logic tách ý tưởng ở server (index.js) — phải khớp.
const splitIdeas = (text) =>
  String(text || "").split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);

// Tách 3 ý tưởng, giữ thứ tự
assert.deepStrictEqual(
  splitIdeas("Ý tưởng A\n\nÝ tưởng B\n\nÝ tưởng C"),
  ["Ý tưởng A", "Ý tưởng B", "Ý tưởng C"]
);
// Dòng trống thừa / khoảng trắng vẫn tách đúng
assert.deepStrictEqual(splitIdeas("A\n\n\n  \nB"), ["A", "B"]);
// Một ý tưởng
assert.deepStrictEqual(splitIdeas("chỉ một ý"), ["chỉ một ý"]);
// Rỗng
assert.deepStrictEqual(splitIdeas("\n\n  \n"), []);

// Tên file: <duan>_<seq>.docx
const sanitize = (s) => (s || "project").replace(/[^\w\-]+/g, "_");
const fileName = (name, seq) => `${sanitize(name)}_${seq}.docx`;
assert.strictEqual(fileName("spiderman", 2), "spiderman_2.docx");
assert.strictEqual(fileName("Dự án X", 1), "D_n_X_1.docx"); // chuỗi ký tự lạ liền -> 1 dấu _

console.log("promptLogic self-check OK");
