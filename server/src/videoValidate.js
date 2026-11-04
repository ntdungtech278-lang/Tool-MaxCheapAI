// validateVideoPayload(modelId, payload) -> { ok, errors[] }
// Ràng buộc theo từng model Kling. Chặn payload sai ngay từ đầu để không gửi request
// chắc chắn bị từ chối (tốn thời gian, có thể tốn credit).
// CẦN đối chiếu docs Kling bản hiện hành (danh sách model, duration, sound) khi thêm/sửa model.

// Id = `model_name` của API. `resolution` map sang `mode` (std|pro) trong kling.js.
const KLING_MODELS = {
  "kling-v1-6": {
    resolution: ["std(720p)", "pro(1080p)"], duration: [5, 10],
    aspectRatio: ["16:9", "9:16", "1:1"], startFrame: true, endFrame: true, generateAudio: false,
  },
  "kling-v2-5-turbo": {
    resolution: ["std(720p)", "pro(1080p)"], duration: [5, 10],
    aspectRatio: ["16:9", "9:16", "1:1"], startFrame: true, endFrame: true, generateAudio: false,
  },
  "kling-v2-6": {
    resolution: ["std(720p)", "pro(1080p)"], duration: [5, 10],
    aspectRatio: ["16:9", "9:16", "1:1"], startFrame: true, endFrame: true, generateAudio: true,
  },
  "kling-v3": {
    resolution: ["std(720p)", "pro(1080p)"], durationRange: [3, 15],
    aspectRatio: ["16:9", "9:16", "1:1"], startFrame: true, endFrame: true, generateAudio: true,
  },
};

function validateVideoPayload(modelId, p = {}) {
  const errors = [];
  const spec = KLING_MODELS[modelId];
  if (!spec) return { ok: false, errors: [`modelId không hỗ trợ: ${modelId}`] };

  if (!p.prompt || !String(p.prompt).trim()) errors.push("Thiếu prompt");

  if (p.resolution != null && !spec.resolution.includes(p.resolution))
    errors.push(`resolution phải là một trong: ${spec.resolution.join(", ")}`);

  const dur = Number(p.duration);
  if (spec.duration && !spec.duration.includes(dur))
    errors.push(`duration phải là một trong: ${spec.duration.join(", ")}`);
  if (spec.durationRange && !(dur >= spec.durationRange[0] && dur <= spec.durationRange[1]))
    errors.push(`duration phải trong khoảng ${spec.durationRange[0]}–${spec.durationRange[1]}`);

  if (p.aspectRatio != null && !spec.aspectRatio.includes(p.aspectRatio))
    errors.push(`aspectRatio phải là một trong: ${spec.aspectRatio.join(", ")}`);

  if (p.endFrame && !spec.endFrame)
    errors.push(`${modelId} không hỗ trợ ảnh cuối (endFrame)`);
  if (p.startFrame && !spec.startFrame)
    errors.push(`${modelId} không hỗ trợ ảnh đầu (startFrame)`);
  // Ảnh cuối (image_tail) chỉ có nghĩa khi có ảnh đầu: Kling coi đây là image2video.
  if (p.endFrame?.url && !p.startFrame?.url)
    errors.push("Ảnh cuối cần đi kèm ảnh đầu");

  if (p.cfgScale !== undefined && p.cfgScale !== "" && p.cfgScale !== null) {
    const c = Number(p.cfgScale);
    if (!(c >= 0 && c <= 1)) errors.push("cfgScale phải trong khoảng 0–1");
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { validateVideoPayload, KLING_MODELS };

// self-check: run `node src/videoValidate.js`
if (require.main === module) {
  const assert = require("assert");
  assert.ok(validateVideoPayload("kling-v2-6",
    { prompt: "x", resolution: "pro(1080p)", duration: 10, aspectRatio: "9:16" }).ok);
  assert.ok(!validateVideoPayload("kling-v2-6",
    { prompt: "x", resolution: "720p", duration: 5 }).ok);                      // phải là std(720p)/pro(1080p)
  assert.ok(!validateVideoPayload("kling-v2-6",
    { prompt: "x", resolution: "std(720p)", duration: 7 }).ok);                 // v2.6 chỉ 5|10
  assert.ok(validateVideoPayload("kling-v3",
    { prompt: "x", resolution: "std(720p)", duration: 12 }).ok);
  assert.ok(!validateVideoPayload("kling-v3",
    { prompt: "x", resolution: "std(720p)", duration: 16 }).ok);                // ngoài 3–15
  assert.ok(!validateVideoPayload("kling-v3",
    { prompt: "x", resolution: "std(720p)" }).ok);                              // thiếu duration
  assert.ok(!validateVideoPayload("veo-3.1", { prompt: "x" }).ok);              // model cũ đã gỡ
  assert.ok(!validateVideoPayload("kling-v2-6",
    { prompt: "x", resolution: "std(720p)", duration: 5, endFrame: { url: "u" } }).ok); // ảnh cuối không ảnh đầu
  assert.ok(validateVideoPayload("kling-v2-6", { prompt: "x", resolution: "std(720p)", duration: 5,
    startFrame: { url: "a" }, endFrame: { url: "b" }, cfgScale: 0.5 }).ok);
  assert.ok(!validateVideoPayload("kling-v2-6",
    { prompt: "x", resolution: "std(720p)", duration: 5, cfgScale: 2 }).ok);
  console.log("videoValidate.js self-check OK");
}
