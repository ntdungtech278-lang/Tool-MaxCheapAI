// self-check: node desktop/src/name3d.test.mjs
import assert from "assert";
import { parse3dImageName, threeDBaseName } from "./name3d.js";

const p = parse3dImageName("EP_016_Posing_Uyen.effectsResult.0009.png");
assert.strictEqual(p.episode, "EP_016");
assert.strictEqual(p.stage, "Posing");
assert.strictEqual(p.person, "Uyen");
assert.strictEqual(p.frame, "0009");

assert.strictEqual(
  threeDBaseName("EP_016_Posing_Uyen.effectsResult.0009.png", "EP_016_Posing_Uyen.effectsResult.0010.png"),
  "EP_016_0009_0010");
assert.strictEqual(threeDBaseName("EP_016_Posing_Uyen.effectsResult.0009.png", ""), "EP_016_0009_0000"); // thiếu ảnh cuối
assert.strictEqual(threeDBaseName("", "EP_016_Posing_Uyen.effectsResult.0010.png"), "EP_016_0000_0010"); // thiếu ảnh đầu
assert.strictEqual(parse3dImageName("EP_016_Posing_Uyen.png").frame, null);                              // không có frame
assert.strictEqual(threeDBaseName("EP_016_Posing_Uyen.png", "EP_016_Posing_Uyen.png"), "EP_016_0000_0000");

console.log("name3d self-check OK");
