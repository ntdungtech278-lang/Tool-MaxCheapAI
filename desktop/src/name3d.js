// Đặt tên video cho Phòng 3D từ tên ảnh đầu vào.
// Tên ảnh: [Mã tập]_[Khâu sản xuất]_[Người thực hiện].effectsResult.[Frame].[ext]
//   vd: EP_016_Posing_Uyen.effectsResult.0009.png -> mã tập EP_016, khâu Posing, người Uyen, frame 0009
// Tên video: [Mã tập]_[Frame đầu]_[Frame cuối]  (bỏ khâu sản xuất theo yêu cầu)
//   thiếu ảnh đầu/cuối -> frame tương ứng = "0000". Nhiều video/prompt -> thêm _1, _2 (caller gắn).

// Mã tập có thể chứa "_" (EP_016) nên tách NGƯỜI/KHÂU từ phải; phần còn lại = mã tập.
export function parse3dImageName(filename) {
  const base = String(filename || "").replace(/^.*[\\/]/, "").trim(); // bỏ đường dẫn
  if (!base) return { episode: "", stage: "", person: "", frame: null };
  const noExt = base.replace(/\.[^.]+$/, "");   // bỏ đuôi: ...effectsResult.0009
  const segs = noExt.split(".");                // [EP_016_Posing_Uyen, effectsResult, 0009]
  const namePart = segs[0];
  const last = segs[segs.length - 1];
  const frame = segs.length >= 2 && /^\d+$/.test(last) ? last : null;
  const parts = namePart.split("_").filter(Boolean);
  let episode = namePart, stage = "", person = "";
  if (parts.length >= 3) { person = parts.pop(); stage = parts.pop(); episode = parts.join("_"); }
  return { episode, stage, person, frame };
}

// Tên gốc (chưa gắn thứ tự) của 1 video từ ảnh đầu + ảnh cuối.
export function threeDBaseName(startName, endName) {
  const s = parse3dImageName(startName);
  const e = parse3dImageName(endName);
  const episode = s.episode || e.episode || "video";
  const f0 = s.frame || "0000";
  const f1 = e.frame || "0000";
  return `${episode}_${f0}_${f1}`;
}
