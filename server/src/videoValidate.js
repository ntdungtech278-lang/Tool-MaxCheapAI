// validateVideoPayload(provider, modelId, payload) -> { ok, errors[] }
// Per-model constraints for MaxCheapAI. Keeps bad requests from ever hitting the
// API (avoids paying HP for a guaranteed 400).

const MAXCHEAP_MODELS = {
  "veo-3.1": {
    resolution: ["720p", "1080p", "4k"],
    durationRange: [3, 15],
    aspectRatio: ["16:9", "9:16"],
    endFrame: true, generateAudio: true,
  },
  "kling-3": {
    resolution: ["std", "720p", "pro", "1080p"],
    durationRange: [3, 15],
    aspectRatio: ["16:9", "9:16", "1:1"],
    endFrame: true, generateAudio: false, multiShot: true,
  },
  "kling-2.6": {
    resolution: ["std", "720p", "pro", "1080p"],
    duration: [5, 10],
    aspectRatio: ["16:9", "9:16", "1:1"],
    endFrame: true, generateAudio: true,
    // endFrame + generateAudio mutually exclusive (checked below)
    mutuallyExclusive: ["endFrame", "generateAudio"],
  },
  "byte-plus-seedance-1-5": {
    resolution: ["720p", "1080p"],
    durationRange: [4, 12],
    aspectRatio: ["16:9", "9:16", "1:1", "21:9"],
    endFrame: true, generateAudio: false,
  },
  "sora-2-pro": {
    resolution: ["720p", "1080p"],
    duration: [4, 8, 12],
    aspectRatio: ["16:9", "9:16"],
    endFrame: false, generateAudio: false, // startFrame only
  },
};

function validateMaxcheap(modelId, p) {
  const errors = [];
  const spec = MAXCHEAP_MODELS[modelId];
  if (!spec) return { ok: false, errors: [`modelId không hỗ trợ: ${modelId}`] };

  if (!p.prompt || !String(p.prompt).trim()) errors.push("Thiếu prompt");

  if (p.resolution != null && !spec.resolution.includes(p.resolution))
    errors.push(`resolution phải là một trong: ${spec.resolution.join(", ")}`);

  const dur = Number(p.duration);
  if (spec.duration && !spec.duration.includes(dur))
    errors.push(`duration phải là một trong: ${spec.duration.join(", ")}`);
  if (spec.durationRange && (dur < spec.durationRange[0] || dur > spec.durationRange[1]))
    errors.push(`duration phải trong khoảng ${spec.durationRange[0]}–${spec.durationRange[1]}`);

  if (p.aspectRatio != null && !spec.aspectRatio.includes(p.aspectRatio))
    errors.push(`aspectRatio phải là một trong: ${spec.aspectRatio.join(", ")}`);

  if (p.endFrame && !spec.endFrame)
    errors.push(`${modelId} không hỗ trợ endFrame`);

  if (Array.isArray(spec.mutuallyExclusive)) {
    const [a, b] = spec.mutuallyExclusive;
    if (p[a] && p[b]) errors.push(`${a} và ${b} không được bật cùng lúc`);
  }

  return { ok: errors.length === 0, errors };
}

function validateVideoPayload(provider, modelId, payload) {
  if (provider === "maxcheapai") return validateMaxcheap(modelId, payload || {});
  return { ok: true, errors: [] }; // unknown provider: skip (server-side)
}

module.exports = { validateVideoPayload, MAXCHEAP_MODELS };

// self-check: run `node src/videoValidate.js`
if (require.main === module) {
  const assert = require("assert");
  assert.ok(validateVideoPayload("maxcheapai", "veo-3.1",
    { prompt: "x", resolution: "720p", duration: 8, aspectRatio: "16:9" }).ok);
  assert.ok(!validateVideoPayload("maxcheapai", "veo-3.1",
    { prompt: "x", resolution: "480p", duration: 8, aspectRatio: "16:9" }).ok);
  assert.ok(!validateVideoPayload("maxcheapai", "sora-2-pro",
    { prompt: "x", duration: 8, endFrame: { url: "u" } }).ok);
  assert.ok(!validateVideoPayload("maxcheapai", "kling-2.6",
    { prompt: "x", duration: 5, endFrame: { url: "u" }, generateAudio: true }).ok);
  console.log("videoValidate.js self-check OK");
}
