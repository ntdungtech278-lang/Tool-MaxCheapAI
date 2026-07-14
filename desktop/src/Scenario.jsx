import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { exportProjectPrompts } from "./docxExport";
import { readTextFile } from "./readTextFile";
import ConfirmDialog from "./ConfirmDialog";

export default function Scenario({ onStartVideo }) {
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(null); // selected project
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState("");
  const [confirmId, setConfirmId] = useState(null); // project pending delete confirm

  const loadProjects = () => api.projects().then(setProjects).catch((e) => setErr(e.message));
  useEffect(() => { loadProjects(); }, []);

  async function createProject() {
    if (!newName.trim()) return;
    setErr("");
    try {
      const p = await api.createProject(newName.trim());
      setNewName("");
      await loadProjects();
      setActive(p);
    } catch (e) { setErr(e.message); }
  }

  async function deleteProject(id) {
    setErr("");
    try {
      await api.deleteProject(id);
      setConfirmId(null);
      await loadProjects();
    } catch (e) { setErr(e.message); }
  }

  if (active) return <ProjectView project={active} onBack={() => { setActive(null); loadProjects(); }} onStartVideo={onStartVideo} />;

  return (
    <div>
      <h1>Tạo kịch bản</h1>
      <div className="card">
        <label>Tạo dự án mới</label>
        <div className="toolbar">
          <input style={{ maxWidth: 340 }} value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Tên dự án..." onKeyDown={(e) => e.key === "Enter" && createProject()} />
          <button onClick={createProject}>+ Tạo dự án</button>
        </div>
        {err && <div className="error">{err}</div>}
      </div>

      <h2 style={{ fontSize: 16 }}>Danh sách dự án</h2>
      {projects.length === 0 && <p className="muted">Chưa có dự án nào.</p>}
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

      {confirmId !== null && (
        <ConfirmDialog
          title="Xóa vĩnh viễn?"
          onConfirm={() => deleteProject(confirmId)}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </div>
  );
}

function ProjectView({ project, onBack, onStartVideo }) {
  const [text, setText] = useState("");
  const [outputConfig, setOutputConfig] = useState(project.output_config || "");
  const [seconds, setSeconds] = useState(8);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [scenarios, setScenarios] = useState([]);   // các lần tạo prompt, thứ tự tạo tăng dần
  const [selected, setSelected] = useState({});     // key "scId:idx" -> true
  const fileRef = useRef(null);

  // Sắp theo thứ tự tạo (id tăng dần) để đánh số Prompt 1..N ổn định.
  const load = () =>
    api.scenarios(project.id)
      .then((rows) => setScenarios(rows.slice().sort((a, b) => a.id - b.id)))
      .catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [project.id]);

  // Parse an toàn: scenario có result hỏng sẽ bị bỏ qua thay vì làm sập cả trang.
  const safeResult = (r) => { try { const a = JSON.parse(r); return Array.isArray(a) ? a : []; } catch { return []; } };
  // Làm phẳng toàn bộ prompt của dự án, giữ thứ tự, kèm khoá chọn.
  const allPrompts = scenarios.flatMap((sc) =>
    safeResult(sc.result).map((content, idx) => ({ key: `${sc.id}:${idx}`, scId: sc.id, idx, content: String(content ?? "") }))
  );
  const selectedList = allPrompts.filter((p) => selected[p.key]);

  async function generate() {
    setErr(""); setBusy(true);
    try {
      await saveOutputConfig();  // đảm bảo định hướng đầu ra đã lưu trước khi sinh
      await api.generate(project.id, { text, seconds: Number(seconds) });
      setText("");
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // cho phép chọn lại cùng file
    if (!file) return;
    setErr("");
    try {
      const content = await readTextFile(file);
      setText((prev) => (prev ? prev + "\n\n" : "") + content);
    } catch (er) { setErr(er.message); }
  }

  // Lưu 1 prompt đã sửa: cập nhật đúng scenario chứa nó rồi PUT.
  async function savePrompt(scId, idx, value) {
    const sc = scenarios.find((s) => s.id === scId);
    const arr = safeResult(sc.result);
    if (arr[idx] === value) return;             // không đổi -> khỏi gọi API
    arr[idx] = value;
    try {
      const updated = await api.updateScenario(scId, arr);
      setScenarios((prev) => prev.map((s) => (s.id === scId ? updated : s)));
    } catch (e) { setErr(e.message); }
  }

  // Lưu định hướng prompt đầu ra vào dự án (khi rời ô, nếu có thay đổi).
  async function saveOutputConfig() {
    if (outputConfig === (project.output_config || "")) return;
    try {
      await api.updateProject(project.id, { output_config: outputConfig });
      project.output_config = outputConfig; // đồng bộ bản trong bộ nhớ
    } catch (e) { setErr(e.message); }
  }

  const toggle = (key) => setSelected((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div>
      <div className="toolbar">
        <button className="secondary" onClick={onBack}>← Quay lại</button>
        <h1 style={{ margin: 0 }}>Dự án: {project.name}</h1>
      </div>

      {/* Section Tạo Prompt */}
      <div className="card" style={{ position: "relative" }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Tạo Prompt</h2>

        <label>Nội dung ý tưởng (cách nhau bằng 1 dòng trống = 1 ý tưởng)</label>
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"Nhập văn bản..."} />

        <label>Thiết lập Prompt đầu ra</label>
        <textarea rows={4} value={outputConfig} onBlur={saveOutputConfig}
          onChange={(e) => setOutputConfig(e.target.value)}
          placeholder={"Mô tả cách bạn muốn prompt được tạo ra...\nVí dụ: phong cách điện ảnh, tối ưu Veo 3, mô tả camera chi tiết, có lời thoại..."} />

        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <button className="secondary" onClick={() => fileRef.current?.click()}>Upload file</button>
          <input ref={fileRef} type="file" accept=".txt,.docx,.doc,text/plain"
            style={{ display: "none" }} onChange={onUpload} />
          <span className="muted">Hỗ trợ .txt, .docx</span>

          <span className="spacer" />

          <label style={{ margin: 0 }}>Thời lượng (giây)</label>
          <input type="number" min={1} max={60} style={{ width: 90 }}
            value={seconds} onChange={(e) => setSeconds(e.target.value)} />
          <button onClick={generate} disabled={busy || !text.trim()}>
            {busy ? "Đang tạo..." : "Tạo Prompt"}
          </button>
        </div>
        {err && <div className="error">{err}</div>}
      </div>

      {/* Xuất DOCX: nằm giữa section Tạo Prompt và Danh sách Prompt */}
      {allPrompts.length > 0 && (
        <div className="toolbar">
          <span className="spacer" />
          <button className="secondary"
            onClick={() => exportProjectPrompts(project.name, allPrompts.map((p) => p.content), scenarios.length)}>
            Xuất DOCX
          </button>
        </div>
      )}

      {/* Section danh sách Prompt */}
      {allPrompts.length > 0 && <h2 style={{ fontSize: 16 }}>Danh sách Prompt</h2>}
      {allPrompts.map((p, i) => (
        <PromptBox key={p.key} n={i + 1} prompt={p}
          checked={!!selected[p.key]} onToggle={() => toggle(p.key)}
          onSave={(v) => savePrompt(p.scId, p.idx, v)} />
      ))}

      {/* Thanh hành động dưới cùng */}
      {selectedList.length > 0 && (
        <div className="action-bar">
          <span>Đã chọn <strong>{selectedList.length}</strong> / {allPrompts.length} prompt</span>
          <span className="spacer" />
          <button onClick={() => onStartVideo?.({
            projectId: project.id, projectName: project.name,
            prompts: selectedList.map((p) => p.content),
          })}>Tạo Video</button>
        </div>
      )}
    </div>
  );
}

function PromptBox({ n, prompt, checked, onToggle, onSave }) {
  const [value, setValue] = useState(prompt.content);
  const taRef = useRef(null);
  // Đồng bộ khi nội dung từ server đổi (sau khi lưu / tải lại).
  useEffect(() => { setValue(prompt.content); }, [prompt.content]);
  // Auto-resize theo nội dung: khớp height với scrollHeight, không giới hạn dòng, không scroll trong box.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [value]);

  return (
    <div className={"episode-box" + (checked ? " selected" : "")}>
      <div className="ep-head">
        <span>Prompt {n}</span>
        <span className="toolbar" style={{ margin: 0, gap: 6 }}>
          <button className="secondary" style={{ padding: "3px 10px", fontSize: 12 }}
            onClick={() => navigator.clipboard.writeText(value)}>Copy</button>
          <button className={checked ? "" : "secondary"} style={{ padding: "3px 10px", fontSize: 12 }}
            onClick={onToggle}>{checked ? "Đã chọn" : "Chọn"}</button>
        </span>
      </div>
      <textarea ref={taRef} className="prompt-edit" rows={1}
        value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => onSave(value)} />
    </div>
  );
}
