
// System prompt cho chế độ "1 ý tưởng -> 1 prompt Veo 3" kèm thời lượng.
// outputConfig (tuỳ chọn): định hướng phong cách/cấu trúc/chất lượng đầu ra, áp cho mọi ý tưởng.
function buildIdeaSystem(seconds, outputConfig = "") {
  const base = `Bạn là chuyên gia viết prompt Google Veo 3. Với MỖI ý tưởng người dùng đưa vào,
hãy viết đúng MỘT prompt Veo 3 hoàn chỉnh, đủ chi tiết để dán trực tiếp vào Veo 3.
Thời lượng mỗi video: ${seconds} giây. Prompt Veo 3 viết bằng tiếng Anh; phần mô tả/tên có thể tiếng Việt.
Chỉ trả về nội dung prompt, không thêm lời dẫn hay giải thích ngoài lề.`;
  const cfg = String(outputConfig || "").trim();
  return cfg
    ? `${base}\n\nYÊU CẦU ĐỊNH HƯỚNG ĐẦU RA (áp dụng cho mọi prompt):\n${cfg}`
    : base;
}

// Delimiter the model must print between prompts so we can split reliably.
const PROMPT_DELIM = "=====PROMPT=====";

// Base system prompt for the "N prompt liên tục, mỗi prompt = 1 video `seconds`s" flow.
// Effect-specific system prompt is sent as a SECOND system message by the caller.
function buildPromptSeriesSystem(count, seconds, continuity) {
  const continuityBlock = continuity
    ? `- Các prompt phải NỐI TIẾP mượt mà: prompt 1 mở đầu cảnh; prompt k tiếp tục từ trạng thái cuối của prompt k-1.
- Giữ NHẤT QUÁN: nhân vật, trang phục, địa điểm, ánh sáng, mood, camera style, color grading.
- Mỗi prompt vẫn phải ĐỘC LẬP, đủ thông tin để API tạo video hiểu mà không cần đọc prompt khác.`
    : `- Mỗi prompt là một cảnh độc lập, không bắt buộc nối tiếp.`;

  return `Bạn là chuyên gia viết prompt video AI (Veo 3 / tương đương).
Tạo ĐÚNG ${count} prompt, KHÔNG thiếu KHÔNG thừa. Mỗi prompt dùng cho 1 video ${seconds} giây.
Mỗi prompt là một cảnh ngắn, rõ ràng, giàu mô tả hình ảnh, đủ chi tiết để dán trực tiếp vào công cụ tạo video.
${continuityBlock}
Không thêm giải thích, lời dẫn hay tiêu đề ngoài nội dung prompt.
ĐỊNH DẠNG BẮT BUỘC: giữa mỗi prompt in ra một dòng riêng chứa đúng chuỗi "${PROMPT_DELIM}" (không thêm ký tự nào khác trên dòng đó). Không đặt delimiter trước prompt đầu hay sau prompt cuối. KHÔNG đánh số thứ tự trong nội dung prompt.`;
}

// User message describing the request.
function buildPromptSeriesUser(context, count, seconds, effectLabel, continuity) {
  return `Bối cảnh / hoàn cảnh tổng thể:
${String(context || "").trim()}

Số lượng prompt cần tạo: ${count}
Độ dài mỗi video: ${seconds} giây
Hiệu ứng video: ${effectLabel}
Yêu cầu liên tục/mượt mà giữa các video: ${continuity ? "CÓ" : "KHÔNG"}

Hãy tạo đúng ${count} prompt theo đúng định dạng đã yêu cầu.`;
}

// Split model output into exactly the prompt list. Prefer the delimiter; fall
// back to blank-line splitting if the model ignored it.
function splitPrompts(text, expected) {
  const raw = String(text || "");
  let parts = raw.includes(PROMPT_DELIM)
    ? raw.split(PROMPT_DELIM)
    : raw.split(/\n\s*\n/);
  parts = parts.map((t) => t.trim()).filter(Boolean);
  // Trim leading "Prompt N:" / "1." style numbering the model may add anyway.
  parts = parts.map((t) => t.replace(/^\s*(prompt\s*)?#?\d+[\).:\-]\s*/i, "").trim());
  if (expected && parts.length > expected) parts = parts.slice(0, expected);
  return parts;
}

module.exports = { buildIdeaSystem, buildPromptSeriesSystem, buildPromptSeriesUser, splitPrompts, PROMPT_DELIM };

// self-check: node src/styleTemplates.js
if (require.main === module) {
  const assert = require("assert");
  const d = PROMPT_DELIM;
  assert.deepStrictEqual(splitPrompts(`A${d}B${d}C`, 3), ["A", "B", "C"]);
  assert.deepStrictEqual(splitPrompts("A\n\nB\n\nC"), ["A", "B", "C"]); // fallback
  assert.deepStrictEqual(splitPrompts(`Prompt 1: A${d}2. B`, 2), ["A", "B"]); // strip numbering
  assert.deepStrictEqual(splitPrompts(`A${d}B${d}C${d}D`, 2), ["A", "B"]); // trim extras
  console.log("styleTemplates self-check OK");
}
