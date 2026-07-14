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
const MODEL_OPTS = {
  "veo-3.1": { resolution: ["720p", "1080p", "4k"], duration: [4, 6, 8], aspectRatio: ["16:9", "9:16"], audio: true },
  "kling-3": { resolution: ["std", "pro"], durationRange: [3, 15], aspectRatio: ["16:9", "9:16", "1:1"], audio: false },
  "kling-2.6": { resolution: ["std", "pro"], duration: [5, 10], aspectRatio: ["16:9", "9:16", "1:1"], audio: true },
  "byte-plus-seedance-1-5": { resolution: ["720p", "1080p"], durationRange: [4, 12], aspectRatio: ["16:9", "9:16", "1:1", "21:9"], audio: false },
  "sora-2-pro": { resolution: ["720p", "1080p"], duration: [4, 8, 12], aspectRatio: ["16:9", "9:16"], audio: false },
};
const SPEEDS = ["slow", "normal", "priority"];

// Ép duration về giá trị hợp lệ cho model (khi đổi model có thể lệch dải/list).
function clampDuration(modelId, dur) {
  const o = MODEL_OPTS[modelId] || MODEL_OPTS["veo-3.1"];
  if (o.durationRange) return Math.min(o.durationRange[1], Math.max(o.durationRange[0], Number(dur) || o.durationRange[0]));
  return o.duration.includes(Number(dur)) ? Number(dur) : o.duration[0];
}

// Parser: mỗi dòng không rỗng = 1 prompt (trim, bỏ dòng trống).
const parsePrompts = (text) =>
  String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);

export default function Video({ payload }) {
  const [text, setText] = useState("");
  const [counts, setCounts] = useState({});     // { [lineIndex]: số video }
  const [models, setModels] = useState([]);
  // Cấu hình tạo video (chuyển từ tab Cấu hình API sang đây). Khởi tạo từ settings đã lưu.
  const [cfg, setCfg] = useState({
    modelId: "veo-3.1", speed: "normal", resolution: "720p",
    duration: 8, aspectRatio: "16:9", generateAudio: false, concurrency: 2,
  });
  const [batchId, setBatchId] = useState(null);
  const [batch, setBatch] = useState(null);
  const [paused, setPaused] = useState(false);
  const [err, setErr] = useState("");
  const [cancelAsk, setCancelAsk] = useState(false);
  const [preview, setPreview] = useState(null);  // job đang xem video chi tiết (modal)
  const [dlDir, setDlDir] = useState(() => localStorage.getItem("dlDir") || "");
  const [sel, setSel] = useState({});            // { [jobId]: true } video được chọn để tải
  const [dl, setDl] = useState(null);            // { message } | { success, total, results }
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
  const durErr = mopts.durationRange && cfg.duration !== "" && cfg.duration != null &&
    (Number(cfg.duration) < mopts.durationRange[0] || Number(cfg.duration) > mopts.durationRange[1])
      ? `Thời lượng phải từ ${mopts.durationRange[0]} đến ${mopts.durationRange[1]} giây` : "";

  // Handoff từ tab Tạo Prompt.
  useEffect(() => {
    const incoming = payload?.prompts;
    if (Array.isArray(incoming) && incoming.length) {
      setText(incoming.join("\n"));
      setBatchId(null); setBatch(null); setPaused(false); setErr(""); setCounts({});
    }
  }, [payload]);

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
          setText(""); setCounts({}); setBatchId(null); setPaused(false);
        }
      } catch (e) { setErr(e.message); }
    };
    tick();
    pollRef.current = setInterval(tick, 5000);
    return () => pollRef.current && clearInterval(pollRef.current);
  }, [batchId]);

  const prompts = parsePrompts(text);
  const countOf = (i) => Math.max(1, parseInt(counts[i], 10) || 1);
  const totalJobs = prompts.reduce((n, _, i) => n + countOf(i), 0);
  const setCount = (i, v) => setCounts((c) => ({ ...c, [i]: Math.max(1, parseInt(v, 10) || 1) }));

  async function start() {
    setErr("");
    if (prompts.length === 0) { setErr("Vui lòng nhập ít nhất 1 prompt video."); return; }
    if (durErr) { setErr(durErr); return; }
    try {
      // id ổn định p1,p2... để nhóm job theo prompt ở phần hiển thị.
      const items = prompts.map((promptText, i) => ({ id: `p${i + 1}`, promptText, videoCount: countOf(i) }));
      const { batchId: id } = await api.startVideoJobs(items, {
        modelId: cfg.modelId, speed: cfg.speed, resolution: cfg.resolution,
        duration: cfg.duration, aspectRatio: cfg.aspectRatio,
        generateAudio: cfg.generateAudio, concurrency: cfg.concurrency,
      });
      setBatch(null); setBatchId(id); setPaused(false); setSel({}); setDl(null);
    } catch (e) { setErr(e.message); }
  }
  async function pause() { await api.pauseBatch(batchId); setPaused(true); }
  async function resume() { await api.resumeBatch(batchId); setPaused(false); }
  async function cancel() { await api.cancelBatch(batchId); setCancelAsk(false); }

  // Video đã tạo thành công (có URL) — nguồn để chọn tải về.
  const doneJobs = (batch?.jobs || []).filter((j) => j.status === "success" && j.resultVideoUrl);
  const allDone = !!batch && !batchId && batch.processing === 0; // đã xong toàn bộ, không còn poll
  const selectedIds = doneJobs.filter((j) => sel[j.id]).map((j) => j.id);

  const toggleSel = (id) => setSel((m) => ({ ...m, [id]: !m[id] }));
  const toggleAll = () => {
    const on = selectedIds.length !== doneJobs.length;
    setSel(on ? Object.fromEntries(doneJobs.map((j) => [j.id, true])) : {});
  };

  async function download() {
    setDl(null); setErr("");
    if (!dlDir.trim()) { setErr("Vui lòng nhập thư mục tải về."); return; }
    if (selectedIds.length === 0) { setErr("Chưa chọn video nào để tải."); return; }
    localStorage.setItem("dlDir", dlDir.trim());
    setDl({ message: "Đang tải..." });
    try {
      const items = doneJobs.filter((j) => sel[j.id]).map((j) => ({
        url: j.resultVideoUrl, name: `${j.promptId}_${j.attemptIndex}.mp4`,
      }));
      setDl(await api.downloadVideos(dlDir.trim(), items));
    } catch (e) { setDl(null); setErr(e.message); }
  }

  const done = batch ? batch.success + batch.failed : 0;
  const total = batch ? batch.total : totalJobs;
  const running = !!batchId && batch && batch.processing > 0;

  // Nhóm job theo promptId, giữ thứ tự p1,p2,... -> mỗi nhóm = 1 hàng.
  const groups = [];
  if (batch?.jobs) {
    const map = new Map();
    for (const j of batch.jobs) {
      if (!map.has(j.promptId)) { map.set(j.promptId, []); groups.push({ promptId: j.promptId, jobs: map.get(j.promptId) }); }
      map.get(j.promptId).push(j);
    }
    groups.sort((a, b) => {
      const na = parseInt(String(a.promptId).replace(/\D/g, ""), 10) || 0;
      const nb = parseInt(String(b.promptId).replace(/\D/g, ""), 10) || 0;
      return na - nb;
    });
  }

  return (
    <div>
      <h1>Tạo video</h1>

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
          {mopts.audio && (
            <div>
              <label>Generate audio</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, cursor: "pointer" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={!!cfg.generateAudio} disabled={!!batchId}
                  onChange={(e) => setCfgField("generateAudio", e.target.checked)} />
                <span className="muted">Bật âm thanh</span>
              </label>
            </div>
          )}
        </div>
        {durErr && <div className="field-error">{durErr}</div>}

        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <label style={{ margin: 0 }}>Nhập prompt video</label>
          <span className="spacer" />
          <span className="muted">{prompts.length} prompt · <strong>{totalJobs}</strong> video job</span>
        </div>
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} disabled={!!batchId}
          placeholder="Nhập mỗi prompt trên một dòng. Mỗi dòng sẽ tạo 1 hàng video." />

        {/* Số video / prompt */}
        {!batchId && prompts.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {prompts.map((p, i) => (
              <div key={i} className="episode-box" style={{ whiteSpace: "normal" }}>
                <div className="ep-head">
                  <span>Prompt {i + 1}</span>
                  <span className="toolbar" style={{ margin: 0, gap: 8 }}>
                    <label style={{ margin: 0 }}>Số video</label>
                    <input type="number" min={1} max={50} style={{ width: 80 }} value={counts[i] ?? 1}
                      onChange={(e) => setCount(i, e.target.value)} />
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{p.length > 120 ? p.slice(0, 120) + "…" : p}</div>
              </div>
            ))}
          </div>
        )}

        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <span className="muted">Mỗi prompt = 1 hàng, số video theo ô ở trên.</span>
          <span className="spacer" />
          {!batchId && <button onClick={start} disabled={prompts.length === 0}>Tạo video ({totalJobs})</button>}
        </div>
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

      {/* Tải về: chỉ hiện khi toàn bộ đã xong và có video thành công */}
      {allDone && doneJobs.length > 0 && (
        <div className="card">
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <strong>Tải video về ({selectedIds.length}/{doneJobs.length})</strong>
            <button className="secondary" onClick={toggleAll}>
              {selectedIds.length === doneJobs.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {doneJobs.map((j) => (
              <label key={j.id} className={"pill" + (sel[j.id] ? " active" : "")}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={!!sel[j.id]} onChange={() => toggleSel(j.id)} />
                {j.promptId}·#{j.attemptIndex}
              </label>
            ))}
          </div>
          <label>Thư mục tải về</label>
          <div className="row">
            <input value={dlDir} onChange={(e) => setDlDir(e.target.value)}
              placeholder="Ví dụ: D:\\videos hoặc C:\\Users\\ban\\Downloads" />
            <button onClick={download} disabled={selectedIds.length === 0 || !dlDir.trim()}
              style={{ whiteSpace: "nowrap" }}>Tải {selectedIds.length} video</button>
          </div>
          {dl?.message && <div className="muted" style={{ marginTop: 8 }}><i className="spin" /> {dl.message}</div>}
          {dl?.results && (
            <div style={{ marginTop: 8 }}>
              <div className={dl.success === dl.total ? "" : "error"}
                style={{ color: dl.success === dl.total ? "#4ade80" : undefined }}>
                Đã tải {dl.success}/{dl.total} video vào {dl.dir}
              </div>
              {dl.results.filter((r) => !r.ok).map((r, i) => (
                <div key={i} className="error" style={{ fontSize: 12 }}>Lỗi: {r.url} — {r.error}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mỗi prompt = 1 nhóm; các video hiển thị dạng lưới box co giãn theo cửa sổ */}
      {groups.map((g, gi) => (
        <div key={g.promptId} className="card" style={{ padding: 12 }}>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <strong>Prompt {gi + 1}</strong>
            <span className="muted">· {g.jobs.length} video</span>
          </div>
          <div className="video-grid">
            {g.jobs.map((j) => <JobCell key={j.id} j={j} onOpen={() => setPreview(j)} />)}
          </div>
        </div>
      ))}

      {cancelAsk && (
        <ConfirmDialog title="Hủy hàng đợi? Video đã xong vẫn được giữ."
          confirmLabel="Hủy" onConfirm={cancel} onCancel={() => setCancelAsk(false)} />
      )}

      {preview && (
        <div className="modal-bg" onClick={() => setPreview(null)}>
          <div className="modal" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
            <div className="toolbar" style={{ marginBottom: 10 }}>
              <strong>{preview.promptId}·#{preview.attemptIndex}</strong>
              <span className="spacer" />
              <button className="secondary" onClick={() => setPreview(null)}>Đóng</button>
            </div>
            <video src={preview.resultVideoUrl} controls autoPlay
              poster={preview.thumbnailUrl || undefined}
              style={{ width: "100%", borderRadius: 8, background: "#000" }} />
          </div>
        </div>
      )}
    </div>
  );
}

// Thông tin cơ bản của 1 video (độ phân giải · tỉ lệ · tốc độ · ngày tạo).
const fmtDate = (s) => { try { return new Date(s).toLocaleString("vi-VN"); } catch { return s || ""; } };

function JobCell({ j, onOpen }) {
  const st = ST[j.status] || ST.queued;
  const ok = j.status === "success" && j.resultVideoUrl;
  return (
    <div className="video-box">
      {/* Trên cùng: nút sao chép link + trạng thái */}
      <div className="video-box-head">
        {ok ? (
          <button className="secondary" style={{ padding: "3px 10px", fontSize: 12 }}
            onClick={() => navigator.clipboard.writeText(j.resultVideoUrl)}>Sao chép link</button>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>#{j.attemptIndex}</span>
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

      {/* Dưới: thông tin cơ bản */}
      {ok && (
        <div className="video-meta">
          {j.duration != null && <span>{j.duration}s</span>}
          {j.resolution && <span>{j.resolution}</span>}
          {j.aspectRatio && <span>{j.aspectRatio}</span>}
          {j.speed && <span>{j.speed}</span>}
          {j.createdAt && <span>{fmtDate(j.createdAt)}</span>}
        </div>
      )}
    </div>
  );
}
