import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import ConfirmDialog from "./ConfirmDialog";

// Module "Tạo video". Mỗi dòng = 1 prompt. Mỗi prompt có ô "số video" -> tạo
// videoCount job cho prompt đó. Job hiển thị NHÓM THEO PROMPT thành từng hàng
// (hàng 1 = video của prompt 1, ...). Toàn bộ cấu hình tạo video (model, speed,
// resolution, duration, aspect ratio, concurrency, generate audio) được chọn ngay
// tại đây; server nhớ lại lựa chọn. Queue chạy server-side theo concurrency đã chọn.

const ST = {
  queued:     { label: "Chờ",         cls: "wait" },
  submitting: { label: "Đang gửi",    cls: "busy", spin: true },
  processing: { label: "Đang xử lý",  cls: "busy", spin: true },
  pending:    { label: "Đang chờ",    cls: "busy", spin: true },
  success:    { label: "Xong",        cls: "on" },
  failed:     { label: "Lỗi",         cls: "off" },
};

// Per-model UI options (mirrors server validateVideoPayload).
// duration: danh sách rời rạc (dropdown) | durationRange: [min,max] (nhập tay).
// Mỗi model: options + khả năng frame/audio (mirrors server validateVideoPayload + docs MaxCheapAI).
//  startFrame/endFrame: có hỗ trợ ảnh đầu/cuối. audioForced: audio luôn bật (sora).
//  audioExclEnd: audio ⊕ endFrame loại trừ nhau (kling-2.6). multiShot: chỉ kling-3.
const MODEL_OPTS = {
  "veo-3.1": { resolution: ["720p", "1080p", "4k"], duration: [4, 6, 8], aspectRatio: ["16:9", "9:16"], audio: true, startFrame: true, endFrame: true },
  "kling-3": { resolution: ["std(720p)", "pro(1080p)"], durationRange: [3, 15], aspectRatio: ["16:9", "9:16", "1:1"], audio: true, startFrame: true, endFrame: true, multiShot: true },
  "kling-2.6": { resolution: ["std(720p)", "pro(1080p)"], duration: [5, 10], aspectRatio: ["16:9", "9:16", "1:1"], audio: true, startFrame: true, endFrame: true, audioExclEnd: true },
  "byte-plus-seedance-1-5": { resolution: ["720p", "1080p"], durationRange: [4, 12], aspectRatio: ["16:9", "9:16", "1:1", "21:9"], audio: true, startFrame: true, endFrame: true },
  "sora-2-pro": { resolution: ["720p", "1080p"], duration: [4, 8, 12], aspectRatio: ["16:9", "9:16"], audioForced: true, startFrame: true, endFrame: false },
};
const SPEEDS = ["slow", "normal", "priority"];

// Ép duration về giá trị hợp lệ cho model (khi đổi model có thể lệch dải/list).
function clampDuration(modelId, dur) {
  const o = MODEL_OPTS[modelId] || MODEL_OPTS["veo-3.1"];
  if (o.durationRange) return Math.min(o.durationRange[1], Math.max(o.durationRange[0], Number(dur) || o.durationRange[0]));
  return o.duration.includes(Number(dur)) ? Number(dur) : o.duration[0];
}

// 1 hàng nhập = 1 prompt độc lập (không tách theo dòng). Mỗi hàng có ảnh đầu/cuối riêng.
const emptyRow = () => ({ prompt: "", videoCount: 1, startFrame: null, endFrame: null });

// Bỏ ký tự không hợp lệ cho tên file (Windows/macOS/Linux) + gọn khoảng trắng.
const sanitizeName = (s) => String(s || "").trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
// Tên file 1 video: [dự án]_[lượt]_[promptNo].[thứ tự trong prompt, 0-based].
// vd project "Spiderman", lượt "lan1", prompt 1 video thứ 1 -> Spiderman_lan1_1.0
function videoFileName(projectName, j) {
  const proj = sanitizeName(projectName) || "project";
  const lot = sanitizeName(j._batchName) || "lot";
  const promptNo = parseInt(String(j.promptId).replace(/\D/g, ""), 10) || 1;
  const order = `${promptNo}.${Math.max(0, (j.attemptIndex || 1) - 1)}`;
  const ver = (j.version || 1) > 1 ? `_v${j.version}` : ""; // bản chỉnh sửa
  return `${proj}_${lot}_${order}${ver}`;
}

// ---- Wrapper: danh sách DỰ ÁN VIDEO. Mở dự án -> vào trang tạo video của dự án đó. ----
export default function Video() {
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(null);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState("");
  const [confirmId, setConfirmId] = useState(null);

  const load = () => api.videoProjects().then(setProjects).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  async function create() {
    if (!newName.trim()) return;
    setErr("");
    try {
      const p = await api.createVideoProject(newName.trim());
      setNewName(""); await load(); setActive(p);
    } catch (e) { setErr(e.message); }
  }
  async function remove(id) {
    setErr("");
    try { await api.deleteVideoProject(id); setConfirmId(null); await load(); }
    catch (e) { setErr(e.message); }
  }

  if (active) return <VideoStudio project={active} onBack={() => { setActive(null); load(); }} />;

  return (
    <div>
      <h1>Tạo video</h1>
      <div className="card">
        <label>Tạo dự án video mới</label>
        <div className="toolbar">
          <input style={{ maxWidth: 340 }} value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Tên dự án..." onKeyDown={(e) => e.key === "Enter" && create()} />
          <button onClick={create}>+ Tạo dự án</button>
        </div>
        <span className="muted">Mỗi dự án lưu lại các video đã tạo để xem lại và quản lý.</span>
        {err && <div className="error">{err}</div>}
      </div>

      <h2 style={{ fontSize: 16 }}>Danh sách dự án</h2>
      {projects.length === 0 && <p className="muted">Chưa có dự án nào.</p>}
      {projects.length > 0 && (
        <table>
          <thead><tr><th>Tên dự án</th><th>Chủ sở hữu</th><th>Ngày tạo</th><th></th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.owner}</td>
                <td className="muted">{p.created_at}</td>
                <td style={{ width: "1%", whiteSpace: "nowrap", textAlign: "right" }}>
                  <span className="toolbar" style={{ gap: 6, marginBottom: 0, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    <button className="secondary" onClick={() => setActive(p)}>Mở</button>
                    <button className="secondary" onClick={() => setConfirmId(p.id)}>Xóa</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirmId !== null && (
        <ConfirmDialog title="Xóa dự án và toàn bộ video của dự án này?"
          onConfirm={() => remove(confirmId)} onCancel={() => setConfirmId(null)} />
      )}
    </div>
  );
}

// ---- Trang tạo video của 1 dự án (nội dung studio trước đây) ----
function VideoStudio({ project, onBack }) {
  const [rows, setRows] = useState([emptyRow()]);
  const [models, setModels] = useState([]);
  const [batchName, setBatchName] = useState(""); // tên lượt: đặt tên file video khi tải
  const [promptsCollapsed, setPromptsCollapsed] = useState(false); // thu gọn khu nhập prompt sau khi Tạo
  // Cấu hình tạo video (chuyển từ tab Cấu hình API sang đây). Khởi tạo từ settings đã lưu.
  const [cfg, setCfg] = useState({
    modelId: "veo-3.1", speed: "normal", resolution: "720p",
    duration: 8, aspectRatio: "16:9", generateAudio: false, concurrency: 2,
  });
  const [batchId, setBatchId] = useState(null);
  const [batch, setBatch] = useState(null);
  const [history, setHistory] = useState([]);   // các batch cũ đã xong, không ẩn đi
  const [paused, setPaused] = useState(false);
  const [err, setErr] = useState("");
  const [cancelAsk, setCancelAsk] = useState(false);
  const [preview, setPreview] = useState(null);  // job đang xem video chi tiết (modal)
  const [dlDir] = useState(() => localStorage.getItem("dlDir") || ""); // fallback khi chạy ngoài Electron
  const [dl, setDl] = useState(null);            // { message } khi đang tải (để disable nút)
  const [toast, setToast] = useState(null);      // { text, ok } thông báo nổi tự tắt
  const toastRef = useRef(null);
  const showToast = (text, ok = true) => {
    setToast({ text, ok });
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 3000);
  };
  // Đánh dấu video "đạt yêu cầu" — lưu localStorage để reload không mất.
  const [marked, setMarked] = useState(() => {
    try { return JSON.parse(localStorage.getItem("videoMarked") || "{}"); } catch { return {}; }
  });
  const toggleMark = (id) => setMarked((m) => {
    const next = { ...m, [id]: !m[id] };
    if (!next[id]) delete next[id];
    localStorage.setItem("videoMarked", JSON.stringify(next));
    return next;
  });
  const pollRef = useRef(null);

  useEffect(() => {
    api.videoModels().then((r) => {
      setModels(r.models || []);
      if (r.settings) setCfg((c) => ({ ...c, ...r.settings }));
    }).catch((e) => setErr(e.message));
  }, []);

  // Helper set 1 field cfg; đổi model thì tự kẹp duration hợp lệ.
  const setCfgField = (field, value) =>
    setCfg((c) => field === "modelId"
      ? { ...c, modelId: value, duration: clampDuration(value, c.duration) }
      : { ...c, [field]: value });
  const mopts = MODEL_OPTS[cfg.modelId] || MODEL_OPTS["veo-3.1"];
  // kling-2.6: audio ⊕ endFrame. Nếu có hàng dùng ảnh cuối -> khóa audio để tránh 400.
  const audioLocked = !!mopts.audioExclEnd && rows.some((r) => r.endFrame?.url);
  const durErr = mopts.durationRange && cfg.duration !== "" && cfg.duration != null &&
    (Number(cfg.duration) < mopts.durationRange[0] || Number(cfg.duration) > mopts.durationRange[1])
      ? `Thời lượng phải từ ${mopts.durationRange[0]} đến ${mopts.durationRange[1]} giây` : "";

  // Tải lịch sử video của dự án từ server (bền vững, reload không mất).
  const loadHistory = () =>
    api.projectVideoBatches(project.id)
      .then((r) => setHistory(r.batches || []))
      .catch((e) => setErr(e.message));
  useEffect(() => { loadHistory(); }, [project.id]);

  // Khi có video đang tạo lại (revise) trong lịch sử -> poll để cập nhật tới khi xong.
  const historyBusy = history.some((h) => h.processing > 0);
  useEffect(() => {
    if (!historyBusy || batchId) return; // batchId đang chạy đã có poll riêng
    const t = setInterval(loadHistory, 5000);
    return () => clearInterval(t);
  }, [historyBusy, batchId]);

  useEffect(() => {
    if (!batchId) return;
    const tick = async () => {
      try {
        const b = await api.videoBatch(batchId);
        setBatch(b);
        // Batch xong (không còn job đang chạy): dừng poll, xóa ô prompt và mở khóa
        // để nhập lượt mới. Vẫn giữ `batch` nên kết quả lượt vừa xong vẫn hiển thị.
        if (b.processing === 0) {
          clearInterval(pollRef.current); pollRef.current = null;
          setBatch(null);
          setRows([emptyRow()]); setBatchName(""); setBatchId(null); setPaused(false); setPromptsCollapsed(false);
          loadHistory(); // đồng bộ lịch sử dự án từ server (đã lưu batch vừa xong)
        }
      } catch (e) { setErr(e.message); }
    };
    tick();
    pollRef.current = setInterval(tick, 5000);
    return () => pollRef.current && clearInterval(pollRef.current);
  }, [batchId]);

  const validRows = rows.filter((r) => r.prompt.trim());
  const totalJobs = validRows.reduce((n, r) => n + Math.max(1, parseInt(r.videoCount, 10) || 1), 0);
  const anyUploading = rows.some((r) => r.upStart || r.upEnd);

  const patchRow = (i, patch) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i) => setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : rs));

  // Chọn ảnh đầu/cuối cho 1 hàng: mở file dialog -> đọc base64 -> upload -> lưu url.
  async function pickFrame(i, which) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => {
      const file = inp.files?.[0]; if (!file) return;
      const upKey = which === "startFrame" ? "upStart" : "upEnd";
      patchRow(i, { [upKey]: true }); setErr("");
      try {
        const dataUrl = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error("Không đọc được ảnh"));
          fr.readAsDataURL(file);
        });
        const r = await api.uploadImage(dataUrl, file.name);
        patchRow(i, { [which]: { url: r.url, preview: dataUrl }, [upKey]: false });
      } catch (e) { patchRow(i, { [upKey]: false }); setErr(e.message); }
    };
    inp.click();
  }

  async function start() {
    setErr("");
    if (validRows.length === 0) { setErr("Vui lòng nhập ít nhất 1 prompt video."); return; }
    if (durErr) { setErr(durErr); return; }
    if (anyUploading) { setErr("Đang tải ảnh lên, vui lòng đợi."); return; }
    try {
      // id ổn định p1,p2... để nhóm job theo prompt; kèm ảnh đầu/cuối của từng hàng.
      const items = validRows.map((r, i) => ({
        id: `p${i + 1}`, promptText: r.prompt.trim(),
        videoCount: Math.max(1, parseInt(r.videoCount, 10) || 1),
        ...(mopts.startFrame && r.startFrame?.url ? { startFrame: { url: r.startFrame.url } } : {}),
        ...(mopts.endFrame && r.endFrame?.url ? { endFrame: { url: r.endFrame.url } } : {}),
      }));
      const { batchId: id } = await api.startVideoJobs(items, {
        modelId: cfg.modelId, speed: cfg.speed, resolution: cfg.resolution,
        duration: cfg.duration, aspectRatio: cfg.aspectRatio,
        // sora tự bật audio; kling-2.6 khóa audio khi có ảnh cuối.
        generateAudio: mopts.audioForced ? false : (audioLocked ? false : cfg.generateAudio),
        concurrency: cfg.concurrency,
      }, project.id, batchName.trim());
      setBatch(null); setBatchId(id); setPaused(false); setDl(null); setPromptsCollapsed(true);
    } catch (e) { setErr(e.message); }
  }
  async function pause() { await api.pauseBatch(batchId); setPaused(true); }
  async function resume() { await api.resumeBatch(batchId); setPaused(false); }
  async function cancel() { await api.cancelBatch(batchId); setCancelAsk(false); }

  // Video đã tạo thành công (có URL) — nguồn để chọn tải về. Gộp lượt hiện tại + lịch sử.
  // Gắn tên lượt vào từng job (lượt đang chạy lấy từ ô nhập; lượt cũ lấy từ server).
  const allJobs = [
    ...(batch?.jobs || []).map((j) => ({ ...j, _batchName: batchName })),
    ...history.flatMap((h) => (h.jobs || []).map((j) => ({ ...j, _batchName: h.batchName || "" }))),
  ];
  const doneJobs = allJobs.filter((j) => j.status === "success" && j.resultVideoUrl);
  // Video sẽ tải = các video đã đánh dấu "Đạt".
  const markedJobs = doneJobs.filter((j) => marked[j.id]);

  async function download() {
    setDl(null); setErr("");
    if (markedJobs.length === 0) { setErr("Chưa có video nào được đánh dấu Đạt."); return; }
    // Mở hộp thoại chọn thư mục (Electron IPC). Cần preload đã nạp -> khởi động lại app nếu thiếu.
    let dir = "";
    if (window.desktop?.pickDirectory) {
      dir = await window.desktop.pickDirectory();
      if (!dir) return; // user hủy
    } else {
      dir = (dlDir || localStorage.getItem("dlDir") || "").trim();
      if (!dir) {
        setErr("Chưa mở được hộp thoại chọn thư mục. Hãy khởi động lại ứng dụng (đóng cửa sổ Electron và chạy lại npm run dev).");
        return;
      }
    }
    localStorage.setItem("dlDir", dir);
    setDl({ message: `Đang tải ${markedJobs.length} video...` });
    try {
      const items = markedJobs.map((j) => ({
        url: j.resultVideoUrl, name: videoFileName(project.name, j) + ".mp4",
      }));
      const r = await api.downloadVideos(dir, items);
      setDl(null);
      showToast(`Đã tải ${r.success}/${r.total} video vào ${r.dir}`, r.success === r.total);
    } catch (e) { setDl(null); showToast(e.message, false); }
  }

  // Tải 1 video riêng (từ modal chi tiết). Chọn thư mục rồi tải đúng file đó.
  async function downloadOne(job, fileBase) {
    let dir = "";
    if (window.desktop?.pickDirectory) { dir = await window.desktop.pickDirectory(); if (!dir) return; }
    else { dir = (dlDir || localStorage.getItem("dlDir") || "").trim(); if (!dir) { showToast("Không mở được hộp thoại chọn thư mục.", false); return; } }
    localStorage.setItem("dlDir", dir);
    try {
      const r = await api.downloadVideos(dir, [{ url: job.resultVideoUrl, name: fileBase + ".mp4" }]);
      showToast(r.success ? `Đã tải vào ${r.dir}` : "Tải thất bại", !!r.success);
    } catch (e) { showToast(e.message, false); }
  }

  // Xuất prompt + ảnh đầu/cuối của các video ĐẠT ra Google Sheet.
  const [exporting, setExporting] = useState(false);
  async function exportSheet() {
    if (markedJobs.length === 0) { showToast("Chưa có video nào được đánh dấu Đạt.", false); return; }
    setExporting(true);
    try {
      const items = markedJobs.map((j) => ({
        prompt: j.promptText || "",
        startUrl: j.startFrame?.url || "",
        endUrl: j.endFrame?.url || "",
      }));
      const title = `${project.name} - prompts (${markedJobs.length})`;
      const r = await api.exportSheet(title, items);
      showToast("Đã xuất Google Sheet", true);
      if (window.desktop?.openExternal) window.desktop.openExternal(r.url);
      else window.open(r.url, "_blank");
    } catch (e) { showToast(e.message, false); }
    finally { setExporting(false); }
  }

  // Reload 1 video lỗi: tạo bản mới đưa vào hàng đợi (hiện "Chờ"), rồi poll cập nhật.
  async function retryVideo(jobId) {
    try {
      await api.retryVideo(jobId);
      loadHistory();               // hiện ngay job "Chờ" mới trong lượt
      showToast("Đã đưa video vào hàng đợi tạo lại", true);
    } catch (e) { showToast(e.message, false); }
  }

  // Xóa vĩnh viễn 1 video khỏi dự án. Xóa dấu "Đạt" nếu có + nạp lại lịch sử.
  async function deleteVideo(jobId) {
    await api.deleteVideoJob(jobId);
    setMarked((m) => { const n = { ...m }; delete n[jobId]; localStorage.setItem("videoMarked", JSON.stringify(n)); return n; });
    loadHistory();
    showToast("Đã xóa video", true);
  }

  // Tạo lại 1 video (revise) từ modal. Sau khi gửi, reload để video _v mới hiện cạnh gốc.
  async function reviseVideo(jobId, body) {
    const r = await api.reviseVideo(jobId, body);
    // Nếu revise thuộc lượt đang chạy thì poll đang chạy sẽ tự cập nhật; else nạp lại lịch sử.
    if (!batchId) loadHistory();
    showToast(`Đang tạo lại video (bản v${r.version})...`, true);
    return r;
  }

  const done = batch ? batch.success + batch.failed : 0;
  const total = batch ? batch.total : totalJobs;
  const running = !!batchId && batch && batch.processing > 0;

  // Nhóm job 1 batch theo promptId (p1,p2,...); trong mỗi nhóm, video Xong đẩy lên trước.
  const groupJobs = (jobs = []) => {
    const map = new Map(), gs = [];
    for (const j of jobs) {
      if (!map.has(j.promptId)) { map.set(j.promptId, []); gs.push({ promptId: j.promptId, jobs: map.get(j.promptId) }); }
      map.get(j.promptId).push(j);
    }
    const pnum = (id) => parseInt(String(id).replace(/\D/g, ""), 10) || 0;
    gs.sort((a, b) => pnum(a.promptId) - pnum(b.promptId));
    // Trong nhóm: gom theo CHUỖI sửa (root = parentJobId || id). Chuỗi sắp theo id gốc;
    // trong chuỗi theo version tăng dần -> bản _v nằm ngay bên phải video gốc.
    const rootOf = (j) => j.parentJobId || j.id;
    for (const g of gs) {
      g.jobs.sort((a, b) => {
        const ra = rootOf(a), rb = rootOf(b);
        if (ra !== rb) return ra - rb;            // khác chuỗi: theo thứ tự tạo gốc
        return (a.version || 1) - (b.version || 1); // cùng chuỗi: gốc -> _v2 -> _v3
      });
    }
    return gs;
  };

  // Batch hiển thị: đang chạy trên cùng, rồi lịch sử mới→cũ. Lượt sau ở đầu, lượt cũ vẫn còn.
  const olderFirst = history.filter((h) => h.batchId !== batch?.batchId);
  const shownBatches = [...(batch ? [batch] : []), ...olderFirst.slice().reverse()];

  return (
    <div>
      <div className="toolbar">
        <button className="secondary" onClick={onBack}>← Quay lại</button>
        <h1 style={{ margin: 0 }}>Dự án: {project.name}</h1>
      </div>

      <div className="card">
        {/* Cấu hình tạo video (chuyển từ tab Cấu hình API sang đây) */}
        <div className="settings-grid">
          <div>
            <label>Model</label>
            <select value={cfg.modelId} onChange={(e) => setCfgField("modelId", e.target.value)} disabled={!!batchId}>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label>Speed</label>
            <select value={cfg.speed} onChange={(e) => setCfgField("speed", e.target.value)} disabled={!!batchId}>
              {SPEEDS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label>Resolution</label>
            <select value={cfg.resolution} onChange={(e) => setCfgField("resolution", e.target.value)} disabled={!!batchId}>
              {mopts.resolution.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label>Duration (giây)</label>
            {mopts.durationRange ? (
              <input type="number" min={mopts.durationRange[0]} max={mopts.durationRange[1]} step={1} disabled={!!batchId}
                placeholder={`Từ ${mopts.durationRange[0]} đến ${mopts.durationRange[1]} giây`}
                value={cfg.duration ?? ""}
                onChange={(e) => setCfgField("duration", e.target.value === "" ? "" : Number(e.target.value))} />
            ) : (
              <select value={cfg.duration} onChange={(e) => setCfgField("duration", Number(e.target.value))} disabled={!!batchId}>
                {mopts.duration.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            )}
          </div>
          <div>
            <label>Aspect ratio</label>
            <select value={cfg.aspectRatio} onChange={(e) => setCfgField("aspectRatio", e.target.value)} disabled={!!batchId}>
              {mopts.aspectRatio.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label>Concurrency</label>
            <input type="number" min={1} max={4} value={cfg.concurrency} disabled={!!batchId}
              onChange={(e) => setCfgField("concurrency", Math.min(4, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
          <div>
            <label>Tên lượt (đặt tên file)</label>
            <input type="text" value={batchName} disabled={!!batchId} maxLength={60}
              placeholder="vd: lan1" onChange={(e) => setBatchName(e.target.value)} />
          </div>
          {mopts.audioForced ? (
            <div>
              <label>Âm thanh</label>
              <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>Luôn bật (theo model)</div>
            </div>
          ) : mopts.audio && (
            <div>
              <label>Generate audio</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, cursor: audioLocked ? "not-allowed" : "pointer" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={!!cfg.generateAudio && !audioLocked}
                  disabled={!!batchId || audioLocked}
                  onChange={(e) => setCfgField("generateAudio", e.target.checked)} />
                <span className="muted">Bật âm thanh</span>
              </label>
            </div>
          )}
        </div>
        {audioLocked && <div className="field-error">{cfg.modelId}: âm thanh và ảnh cuối không dùng cùng lúc — audio đã tắt vì có ảnh cuối.</div>}
        {durErr && <div className="field-error">{durErr}</div>}

        {/* Header: khi thu gọn thì bấm để sổ ra/đóng lại danh sách prompt đã nhập */}
        <div className="toolbar prompt-header" style={{ marginTop: 12, marginBottom: 8 }}
          onClick={() => promptsCollapsed && setPromptsCollapsed(false)}
          role={promptsCollapsed ? "button" : undefined}>
          <label style={{ margin: 0, cursor: promptsCollapsed ? "pointer" : "default" }}>Prompt video</label>
          <span className="spacer" />
          <span className="muted">{validRows.length} prompt · <strong>{totalJobs}</strong> video job</span>
          {promptsCollapsed && (
            <button className="caret-btn" title="Xem danh sách prompt đã nhập"
              onClick={(e) => { e.stopPropagation(); setPromptsCollapsed((c) => !c); }}>
              <span className="caret-tri" />
            </button>
          )}
          {!promptsCollapsed && rows.length > 0 && batchId && (
            <button className="caret-btn open" title="Thu gọn"
              onClick={(e) => { e.stopPropagation(); setPromptsCollapsed(true); }}>
              <span className="caret-tri" />
            </button>
          )}
        </div>

        {/* Mỗi hàng = 1 prompt độc lập: Prompt (hẹp) · Ảnh đầu · Ảnh cuối. Ẩn khi thu gọn. */}
        {!promptsCollapsed && rows.map((r, i) => (
          <div key={i} className="prompt-row">
            <div className="prompt-grid">
              <textarea value={r.prompt} disabled={!!batchId}
                onChange={(e) => patchRow(i, { prompt: e.target.value })}
                placeholder={`Prompt ${i + 1}…`} />
              <FrameBox label="Ảnh đầu" frame={r.startFrame} uploading={r.upStart}
                disabled={!!batchId || !mopts.startFrame}
                hint={mopts.startFrame ? "Bấm để chọn ảnh" : "Model không hỗ trợ"}
                onPick={() => pickFrame(i, "startFrame")} onClear={() => patchRow(i, { startFrame: null })} />
              <FrameBox label="Ảnh cuối" frame={r.endFrame} uploading={r.upEnd}
                disabled={!!batchId || !mopts.endFrame}
                hint={mopts.endFrame ? "Bấm để chọn ảnh" : "Model không hỗ trợ"}
                onPick={() => pickFrame(i, "endFrame")} onClear={() => patchRow(i, { endFrame: null })} />
            </div>
            <div className="prompt-actions">
              <label style={{ margin: 0, fontSize: 12 }}>Số video</label>
              <input type="number" min={1} max={50} className="row-btn" value={r.videoCount} disabled={!!batchId}
                onChange={(e) => patchRow(i, { videoCount: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
              <span className="spacer" />
              {rows.length > 1 && !batchId &&
                <button className="secondary row-btn" onClick={() => removeRow(i)}>Xóa</button>}
            </div>
          </div>
        ))}

        {!promptsCollapsed && (
          <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
            {!batchId && <button className="secondary" onClick={addRow}>+ Thêm prompt</button>}
            <span className="spacer" />
            {!batchId && <button onClick={start} disabled={validRows.length === 0 || anyUploading}>Tạo video ({totalJobs})</button>}
          </div>
        )}
        {err && <div className="error">{err}</div>}
      </div>

      {batch && (
        <div className="card">
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <strong>{done}/{total} video</strong>
            <span className="badge on">✓ {batch.success}</span>
            <span className="badge off">✗ {batch.failed}</span>
            <span className="badge busy">{running && <i className="spin" />}⋯ {batch.processing}</span>
            <span className="spacer" />
            {running && !paused && <button className="secondary" onClick={pause}>Tạm dừng</button>}
            {running && paused && <button className="secondary" onClick={resume}>Tiếp tục</button>}
            {running && <button className="secondary" onClick={() => setCancelAsk(true)}>Hủy</button>}
          </div>
          <div className="progress"><i style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
        </div>
      )}



      {/* Mỗi lượt (batch) 1 khối; lượt mới trên đầu, lượt cũ vẫn còn.
          Trong khối: TẤT CẢ video của lượt xếp chung 1 lưới ngang — prompt 1 bên trái,
          prompt 2 bên phải,... hết hàng thì tự xuống hàng dưới. Video Xong đẩy lên trước. */}
      {shownBatches.map((bt, bi) => (
        <div key={bt.batchId} className="card" style={{ padding: 12 }}>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <strong>{bi === 0 && batch ? "Lượt hiện tại" : "Lượt trước"}</strong>
            <span className="muted">· ✓ {bt.success}/{bt.total}</span>
          </div>
          <div className="video-grid">
            {groupJobs(bt.jobs).flatMap((g, gi) =>
              g.jobs.map((j) => {
                const jn = { ...j, _batchName: bt === batch ? batchName : bt.batchName, _promptNo: gi + 1 };
                return <JobCell key={j.id} j={jn} promptNo={gi + 1} onOpen={() => setPreview(jn)}
                  marked={!!marked[j.id]} onMark={() => toggleMark(j.id)}
                  fileName={videoFileName(project.name, jn)} onRetry={retryVideo} onDeleteFail={deleteVideo} />;
              })
            )}
          </div>
        </div>
      ))}

      {cancelAsk && (
        <ConfirmDialog title="Hủy hàng đợi? Video đã xong vẫn được giữ."
          confirmLabel="Hủy" onConfirm={cancel} onCancel={() => setCancelAsk(false)} />
      )}

      {preview && (
        <PreviewModal job={preview} projectName={project.name} models={models}
          fileNameBase={videoFileName(project.name, preview)}
          onClose={() => setPreview(null)}
          onDownloadOne={downloadOne}
          onRevise={reviseVideo}
          onDelete={async (id) => { await deleteVideo(id); setPreview(null); }} />
      )}

      {/* Thanh nổi góc dưới-phải: luôn thấy khi cuộn. Hiện khi có video đã đánh dấu Đạt. */}
      {markedJobs.length > 0 && (
        <div className="download-bar">
          <button className="secondary" onClick={exportSheet} disabled={exporting}>
            {exporting ? <><i className="spin" /> Đang xuất...</> : "Xuất Sheet"}
          </button>
          <button onClick={download} disabled={!!dl?.message}>
            {dl?.message ? <><i className="spin" /> Đang tải...</> : `Tải ${markedJobs.length} video`}
          </button>
        </div>
      )}

      {/* Thông báo nổi tự tắt sau 3s */}
      {toast && (
        <div className={"toast" + (toast.ok ? " ok" : " err")}>{toast.text}</div>
      )}
    </div>
  );
}

// Ô chọn ảnh đầu/cuối cho 1 hàng prompt. Bấm -> mở file dialog (xử lý ở onPick).
function FrameBox({ label, frame, uploading, disabled, hint, onPick, onClear }) {
  const clickable = !disabled && !uploading;
  return (
    <div className={"frame-box" + (disabled ? " disabled" : "")}
      onClick={() => clickable && onPick()}
      title={hint} style={{ cursor: clickable ? "pointer" : "default" }}>
      <span className="frame-tag">{label}</span>
      {uploading ? (
        <div className="muted"><i className="spin" /> Đang tải…</div>
      ) : frame?.preview ? (
        <>
          <img src={frame.preview} alt={label} className="frame-img" />
          {!disabled && (
            <button className="frame-clear" title="Xóa ảnh"
              onClick={(e) => { e.stopPropagation(); onClear(); }}>×</button>
          )}
        </>
      ) : (
        <div className="frame-empty muted">{hint}</div>
      )}
    </div>
  );
}

// Thông tin cơ bản của 1 video (độ phân giải · tỉ lệ · tốc độ · ngày tạo).
const fmtDate = (s) => { try { return new Date(s).toLocaleString("vi-VN"); } catch { return s || ""; } };

function JobCell({ j, onOpen, marked, onMark, promptNo, fileName, onRetry, onDeleteFail }) {
  const st = ST[j.status] || ST.queued;
  const ok = j.status === "success" && j.resultVideoUrl;
  return (
    <div className={"video-box" + (marked ? " marked" : "")}>
      {/* Trên cùng: nhãn prompt + nút sao chép link + trạng thái */}
      <div className="video-box-head">
        {promptNo != null && <span className="prompt-tag">P{promptNo}·#{j.attemptIndex}</span>}
        {ok && (
          <button className="secondary" style={{ padding: "3px 10px", fontSize: 12 }}
            onClick={() => navigator.clipboard.writeText(j.resultVideoUrl)}>Sao chép link</button>
        )}
        <span className="spacer" />
        <span className={"badge " + st.cls}>{st.spin && <i className="spin" />}{st.label}</span>
      </div>

      {/* Giữa: ảnh đầu video, bấm để xem chi tiết */}
      {ok ? (
        j.thumbnailUrl ? (
          <img className="job-thumb" src={j.thumbnailUrl} alt="Ảnh đầu video"
            title="Bấm để xem video" onClick={onOpen}
            onError={(e) => { e.currentTarget.style.display = "none"; }} />
        ) : (
          <div className="job-thumb job-thumb-empty" title="Bấm để xem video" onClick={onOpen}>▶ Xem video</div>
        )
      ) : j.status === "failed" ? (
        <div className="error" style={{ fontSize: 11, marginTop: 6 }}>{j.errorMessage}</div>
      ) : (
        <div className="job-thumb job-thumb-empty muted">{st.label}…</div>
      )}

      {/* Video lỗi: hàng thông tin dưới cùng, nút Xóa + Reload căn phải */}
      {j.status === "failed" && (
        <div className="fail-actions">
          <span className="muted" style={{ fontSize: 11 }}>Tạo lỗi</span>
          <span className="spacer" />
          {onDeleteFail && (
            <button className="del-btn" title="Xóa video lỗi" onClick={() => onDeleteFail(j.id)}>×</button>
          )}
          {onRetry && (
            <button className="reload-btn" title="Tạo lại video này (đưa vào hàng đợi)"
              onClick={() => onRetry(j.id)}>↻</button>
          )}
        </div>
      )}

      {/* Tên video (định dạng file tải): dưới cùng bên trái ô video */}
      {ok && fileName && <div className="video-name" title={fileName}>{fileName}</div>}

      {/* Dưới: thông tin cơ bản + ô đánh dấu "đạt yêu cầu" căn phải, thẳng với badge trạng thái */}
      {ok && (
        <div className="video-meta">
          {j.duration != null && <span>{j.duration}s</span>}
          {j.resolution && <span>{j.resolution}</span>}
          {j.aspectRatio && <span>{j.aspectRatio}</span>}
          {j.speed && <span>{j.speed}</span>}
          {j.createdAt && <span>{fmtDate(j.createdAt)}</span>}
          <span className="spacer" />
          <label className="mark-check" title="Đánh dấu đạt yêu cầu">
            <input type="checkbox" checked={marked} onChange={onMark} />
            <span>Đạt</span>
          </label>
        </div>
      )}
    </div>
  );
}

// Modal xem chi tiết video: video bên trái, panel setting + prompt bên phải.
// Nút Tạo lại (bật chế độ sửa: enable setting/prompt + ảnh đầu/cuối, nút Xác nhận/Hủy) và Tải riêng.
function PreviewModal({ job, projectName, models, fileNameBase, onClose, onDownloadOne, onRevise, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [askDelete, setAskDelete] = useState(false);
  // Cấu hình sửa được, khởi tạo từ chính video đang xem.
  const [f, setF] = useState({
    modelId: job.modelId, speed: job.speed, resolution: job.resolution,
    duration: job.duration, aspectRatio: job.aspectRatio, generateAudio: !!job.generateAudio,
    prompt: job.promptText || "",
  });
  // Ảnh đầu/cuối (chỉ hiện khi sửa). { url, preview } | null. upX = đang tải.
  const [startFrame, setStartFrame] = useState(job.startFrame?.url ? { url: job.startFrame.url, preview: job.startFrame.url } : null);
  const [endFrame, setEndFrame] = useState(job.endFrame?.url ? { url: job.endFrame.url, preview: job.endFrame.url } : null);
  const [upStart, setUpStart] = useState(false);
  const [upEnd, setUpEnd] = useState(false);

  const mopts = MODEL_OPTS[f.modelId] || MODEL_OPTS["veo-3.1"];
  const setField = (k, v) => setF((s) => k === "modelId"
    ? { ...s, modelId: v, duration: clampDuration(v, s.duration) } : { ...s, [k]: v });
  const audioLocked = !!mopts.audioExclEnd && !!endFrame?.url;

  const portrait = String(job.aspectRatio || "").startsWith("9:16")
    || (job.aspectRatio && /^(\d+):(\d+)$/.test(job.aspectRatio)
        && Number(job.aspectRatio.split(":")[0]) < Number(job.aspectRatio.split(":")[1]));

  async function pickFrame(which) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => {
      const file = inp.files?.[0]; if (!file) return;
      const setUp = which === "start" ? setUpStart : setUpEnd;
      const setFr = which === "start" ? setStartFrame : setEndFrame;
      setUp(true); setErr("");
      try {
        const dataUrl = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error("Không đọc được ảnh"));
          fr.readAsDataURL(file);
        });
        const r = await api.uploadImage(dataUrl, file.name);
        setFr({ url: r.url, preview: dataUrl });
      } catch (e) { setErr(e.message); } finally { setUp(false); }
    };
    inp.click();
  }

  async function confirmRevise() {
    setErr("");
    if (!f.prompt.trim()) { setErr("Prompt không được để trống."); return; }
    if (upStart || upEnd) { setErr("Đang tải ảnh, vui lòng đợi."); return; }
    setBusy(true);
    try {
      await onRevise(job.id, {
        overrides: {
          modelId: f.modelId, speed: f.speed, resolution: f.resolution,
          duration: f.duration, aspectRatio: f.aspectRatio,
          generateAudio: mopts.audioForced ? false : (audioLocked ? false : f.generateAudio),
        },
        prompt: f.prompt.trim(),
        // Chỉ gửi frame nếu model hỗ trợ; gửi null để xóa.
        startFrame: mopts.startFrame ? (startFrame?.url ? { url: startFrame.url } : null) : null,
        endFrame: mopts.endFrame ? (endFrame?.url ? { url: endFrame.url } : null) : null,
      });
      onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const dis = !editing; // ngoài chế độ sửa: các ô chỉ đọc

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={"modal detail-modal" + (portrait ? " portrait" : "") + (editing ? " editing" : "")} onClick={(e) => e.stopPropagation()}>
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <strong>{fileNameBase}</strong>
          <span className="spacer" />
          <button className="secondary" onClick={onClose}>Đóng</button>
        </div>

        <div className="detail-body">
          {/* Trái: video + (khi sửa) ảnh đầu/cuối bên dưới video */}
          <div className="detail-left">
            <div className="detail-video">
              <video src={job.resultVideoUrl} controls autoPlay
                poster={job.thumbnailUrl || undefined} className="preview-video" />
            </div>
            {editing && (mopts.startFrame || mopts.endFrame) && (
              <div className="detail-frames">
                {mopts.startFrame && (
                  <FrameBox label="Ảnh đầu" frame={startFrame} uploading={upStart} disabled={false}
                    hint="Bấm để chọn ảnh" onPick={() => pickFrame("start")} onClear={() => setStartFrame(null)} />
                )}
                {mopts.endFrame && (
                  <FrameBox label="Ảnh cuối" frame={endFrame} uploading={upEnd} disabled={false}
                    hint="Bấm để chọn ảnh" onPick={() => pickFrame("end")} onClear={() => setEndFrame(null)} />
                )}
              </div>
            )}
          </div>

          {/* Phải: panel setting + prompt (thiết kế giống mục setting tab tạo video) */}
          <div className="detail-panel">
            <div className="settings-grid compact">
              <div>
                <label>Model</label>
                <select value={f.modelId} disabled={dis} onChange={(e) => setField("modelId", e.target.value)}>
                  {(models.length ? models : [f.modelId]).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label>Speed</label>
                <select value={f.speed} disabled={dis} onChange={(e) => setField("speed", e.target.value)}>
                  {SPEEDS.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>
              <div>
                <label>Resolution</label>
                <select value={f.resolution} disabled={dis} onChange={(e) => setField("resolution", e.target.value)}>
                  {mopts.resolution.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>
              <div>
                <label>Duration (giây)</label>
                {mopts.durationRange ? (
                  <input type="number" min={mopts.durationRange[0]} max={mopts.durationRange[1]} disabled={dis}
                    value={f.duration ?? ""} onChange={(e) => setField("duration", e.target.value === "" ? "" : Number(e.target.value))} />
                ) : (
                  <select value={f.duration} disabled={dis} onChange={(e) => setField("duration", Number(e.target.value))}>
                    {mopts.duration.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label>Aspect ratio</label>
                <select value={f.aspectRatio} disabled={dis} onChange={(e) => setField("aspectRatio", e.target.value)}>
                  {mopts.aspectRatio.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>
              {mopts.audioForced ? (
                <div><label>Âm thanh</label><div className="muted" style={{ marginTop: 10, fontSize: 13 }}>Luôn bật</div></div>
              ) : mopts.audio && (
                <div>
                  <label>Generate audio</label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, cursor: dis || audioLocked ? "default" : "pointer" }}>
                    <input type="checkbox" style={{ width: "auto" }} checked={!!f.generateAudio && !audioLocked}
                      disabled={dis || audioLocked} onChange={(e) => setField("generateAudio", e.target.checked)} />
                    <span className="muted">Bật âm thanh</span>
                  </label>
                </div>
              )}
            </div>

            {/* Ô prompt của video — giãn lấp phần trống panel */}
            <label style={{ marginTop: 10 }}>Prompt</label>
            <textarea className="detail-prompt" value={f.prompt} disabled={dis}
              onChange={(e) => setField("prompt", e.target.value)} />

            {err && <div className="error">{err}</div>}
          </div>
        </div>

        {/* Góc dưới phải: Xóa (xám) · Tải (xanh lá) · Tạo lại | (khi sửa) Xác nhận + Hủy */}
        <div className="detail-actions">
          {!editing ? (
            <>
              <button className="btn-gray detail-btn" onClick={() => setAskDelete(true)}>Xóa video</button>
              <button className="btn-green detail-btn" onClick={() => onDownloadOne(job, fileNameBase)}>Tải video</button>
              <button className="detail-btn" onClick={() => setEditing(true)}>Tạo lại video</button>
            </>
          ) : (
            <>
              <button className="secondary detail-btn" onClick={() => { setEditing(false); setErr(""); }} disabled={busy}>Hủy</button>
              <button className="detail-btn" onClick={confirmRevise} disabled={busy}>{busy ? "Đang gửi..." : "Xác nhận"}</button>
            </>
          )}
        </div>
      </div>

      {askDelete && (
        <ConfirmDialog title="Xóa video vĩnh viễn?"
          onConfirm={() => { setAskDelete(false); onDelete(job.id); }}
          onCancel={() => setAskDelete(false)} />
      )}
    </div>
  );
}
