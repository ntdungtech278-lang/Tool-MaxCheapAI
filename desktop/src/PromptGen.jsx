import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { exportPromptsTxt, exportPromptsDocx } from "./docxExport";

// Tạo Prompt: nhập bối cảnh + số lượng N + hiệu ứng + continuity -> sinh đúng N
// prompt liên tục, mỗi prompt = 1 video 8 giây. Danh sách prompt có thể sửa/xoá/
// thêm/copy, export .txt/.docx, và chuyển sang tab Tạo Video.

const DURATION = 8; // mỗi prompt = 1 video 8 giây

export default function PromptGen({ onStartVideo }) {
  const [context, setContext] = useState("");
  const [count, setCount] = useState(5);
  const [effects, setEffects] = useState([]);
  const [effectId, setEffectId] = useState("");
  const [continuity, setContinuity] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [prompts, setPrompts] = useState([]); // string[]
  const [copied, setCopied] = useState("");

  useEffect(() => {
    api.videoEffects().then((list) => {
      setEffects(list);
      if (list.length) setEffectId(list[0].id);
    }).catch((e) => setErr(e.message));
  }, []);

  const setN = (v) => setCount(Math.max(1, parseInt(v, 10) || 1)); // min 1, không âm/0

  async function generate() {
    setErr("");
    if (!context.trim()) { setErr("Vui lòng nhập bối cảnh để tạo prompt."); return; }
    if (count < 1) { setErr("Số lượng prompt phải lớn hơn hoặc bằng 1."); return; }
    setBusy(true);
    try {
      const r = await api.generatePrompts({
        context, count, seconds: DURATION, effectId, continuity,
      });
      const list = Array.isArray(r?.prompts) ? r.prompts.map((p) => p?.promptText ?? "") : [];
      if (list.length === 0) { setErr("Model không trả về prompt nào. Thử lại hoặc đổi bối cảnh."); return; }
      setPrompts(list);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const editPrompt = (i, v) => setPrompts((p) => p.map((x, k) => (k === i ? v : x)));
  const deletePrompt = (i) => setPrompts((p) => p.filter((_, k) => k !== i));
  const addPrompt = () => setPrompts((p) => [...p, ""]);

  async function copyAll() {
    await navigator.clipboard.writeText(prompts.map((p) => p.trim()).join("\n\n"));
    setCopied("all"); setTimeout(() => setCopied(""), 1500);
  }
  async function copyOne(i) {
    await navigator.clipboard.writeText(prompts[i]);
    setCopied(i); setTimeout(() => setCopied(""), 1500);
  }

  const fileBase = `prompts_${effectId || "video"}`;

  return (
    <div>
      <h1>Tạo Prompt</h1>

      <div className="card">
        <label>Bối cảnh / hoàn cảnh tổng thể</label>
        <textarea rows={5} value={context} onChange={(e) => setContext(e.target.value)}
          placeholder="Mô tả nội dung chung, nhân vật, địa điểm, phong cách, câu chuyện, mục tiêu video..." />

        <div className="row" style={{ marginTop: 10 }}>
          <div>
            <label>Số lượng prompt cần tạo</label>
            <input type="number" min={1} value={count} onChange={(e) => setN(e.target.value)} />
          </div>
          <div>
            <label>Hiệu ứng video</label>
            <select value={effectId} onChange={(e) => setEffectId(e.target.value)}>
              {effects.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, cursor: "pointer" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={continuity}
              onChange={(e) => setContinuity(e.target.checked)} />
            <span>Liên tục / mượt giữa các video</span>
          </label>
          <span className="muted">· Mỗi prompt = 1 video {DURATION} giây</span>
          <span className="spacer" />
          <button onClick={generate} disabled={busy || !context.trim()}>
            {busy ? "Đang tạo..." : `Tạo ${count} prompt`}
          </button>
        </div>
        {err && <div className="error">{err}</div>}
      </div>

      {prompts.length > 0 && (
        <>
          <div className="toolbar">
            <h2 style={{ margin: 0, fontSize: 16 }}>Danh sách Prompt ({prompts.length})</h2>
            <span className="spacer" />
            <button className="secondary" onClick={copyAll}>{copied === "all" ? "Đã copy ✓" : "Copy tất cả"}</button>
            <button className="secondary" onClick={() => exportPromptsTxt(fileBase, prompts)}>Export .txt</button>
            <button className="secondary" onClick={() => exportPromptsDocx(fileBase, prompts)}>Export .docx</button>
            <button onClick={() => onStartVideo?.({ prompts: prompts.map((p) => p.trim()).filter(Boolean) })}>
              Chuyển sang Tạo Video
            </button>
          </div>

          {prompts.map((p, i) => (
            <div key={i} className="episode-box">
              <div className="ep-head">
                <span>Prompt {i + 1} <span className="muted">· 8s</span></span>
                <span className="toolbar" style={{ margin: 0, gap: 6 }}>
                  <button className="secondary" style={{ padding: "3px 10px", fontSize: 12 }}
                    onClick={() => copyOne(i)}>{copied === i ? "Đã copy ✓" : "Copy"}</button>
                  <button className="secondary" style={{ padding: "3px 10px", fontSize: 12 }}
                    onClick={() => deletePrompt(i)}>Xoá</button>
                </span>
              </div>
              <textarea className="prompt-edit" rows={3} value={p}
                onChange={(e) => editPrompt(i, e.target.value)} />
            </div>
          ))}

          <div className="toolbar" style={{ marginTop: 8 }}>
            <button className="secondary" onClick={addPrompt}>+ Thêm prompt</button>
          </div>
        </>
      )}
    </div>
  );
}
