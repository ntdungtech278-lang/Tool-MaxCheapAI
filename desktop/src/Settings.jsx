import { useEffect, useState } from "react";
import { api } from "./api";

const PROVIDERS = [
  { key: "openrouter", label: "9router (OpenAI-compatible)", openai: true },
  { key: "gemini", label: "Gemini" },
  { key: "chatgpt", label: "ChatGPT (OpenAI)", openai: true },
  { key: "claude", label: "Claude" },
];

const DEFAULT_MAXCHEAP = {
  apiKey: "", baseUrl: "https://maxcheapai.com/api", modelId: "veo-3.1",
  speed: "normal", resolution: "720p", duration: 8, aspectRatio: "16:9", generateAudio: false,
};

// Đảm bảo mọi nhánh UI cần luôn tồn tại — tránh màn hình đen khi server/DB cũ
// trả thiếu videoApi/veo3. Bổ khuyết chứ không ghi đè giá trị đã có.
function normalizeSettings(raw) {
  const s = { ...(raw || {}) };
  s.providers = s.providers || {};
  s.veo3 = { model: "", geminiApiKey: "", hasKey: false, apiKeyMask: "", ...(s.veo3 || {}) };
  const va = s.videoApi || {};
  s.videoApi = {
    activeProvider: va.activeProvider || "maxcheapai",
    concurrency: va.concurrency || 2,
    providers: { ...(va.providers || {}), maxcheapai: { ...DEFAULT_MAXCHEAP, ...(va.providers?.maxcheapai || {}) } },
  };
  s.sheetApi = { clientId: "", clientSecret: "", hasSecret: false, connected: false, connectedEmail: "", folderId: "", ...(s.sheetApi || {}) };
  return s;
}

// Admin-only screen. Configures third-party API keys + selects active prompt model
// and the video-generation provider. Keys are masked; blank input keeps stored key.
export default function ApiConfig() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [test, setTest] = useState(null); // { ok, status, message, endpoint }
  const [vtest, setVtest] = useState(null);
  const [probe, setProbe] = useState({});   // { [providerKey]: { ok, message, models } }
  const [probing, setProbing] = useState({});// { [providerKey]: bool }
  const [toast, setToast] = useState("");    // box thông báo nổi khi test key thất bại
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    api.getSettings().then((d) => setS(normalizeSettings(d))).catch((e) => setErr(e.message));
  }, []);
  if (!s) return <div><h1>Cấu hình API</h1><p className="muted">Đang tải...</p></div>;

  const setProvider = (key, field, value) =>
    setS({ ...s, providers: { ...s.providers, [key]: { ...s.providers[key], [field]: value } } });
  const setVideo = (field, value) => {
    const p = s.videoApi?.providers?.maxcheapai || {};
    setS({ ...s, videoApi: { ...s.videoApi, providers: { ...s.videoApi?.providers, maxcheapai: { ...p, [field]: value } } } });
  };

  // Tự test key khi rời ô/nhấn Enter: OK -> nạp list model; lỗi -> toast nổi.
  async function probeProvider(key) {
    const prov = s.providers[key];
    if (!prov.apiKey && !prov.hasKey) return; // chưa có key thì bỏ qua
    setProbing((m) => ({ ...m, [key]: true }));
    setToast("");
    try {
      const r = await api.testModelPrompt(key, {
        baseUrl: prov.baseUrl, model: prov.model, apiKey: prov.apiKey || undefined,
      });
      setProbe((m) => ({ ...m, [key]: r }));
      if (!r.ok) setToast(`API key ${key} không hoạt động: ${r.message}`);
      else if (r.models?.length && !r.models.includes(prov.model))
        setProvider(key, "model", r.models[0]); // chọn model đầu nếu model cũ không nằm trong list
    } catch (e) {
      setProbe((m) => ({ ...m, [key]: { ok: false, message: e.message, models: [] } }));
      setToast(`API key ${key} không hoạt động: ${e.message}`);
    } finally {
      setProbing((m) => ({ ...m, [key]: false }));
    }
  }
  const setVideoTop = (field, value) => setS({ ...s, videoApi: { ...s.videoApi, [field]: value } });

  const enabledKeys = PROVIDERS.filter((p) => s.providers[p.key]?.enabled).map((p) => p.key);
  const vp = s.videoApi?.providers?.maxcheapai || {};

  async function save() {
    setErr(""); setMsg("");
    if (!enabledKeys.includes(s.promptModel)) {
      setErr("Model đang kích hoạt phải là một model đã được bật.");
      return;
    }
    try {
      const saved = await api.saveSettings(s);
      // Chỉ nhận lại các mask/hasKey mới; giữ nguyên state hiện tại để tránh
      // crash nếu server trả thiếu nhánh. Không thay cả object.
      if (saved && saved.providers) setS(normalizeSettings(saved));
      setMsg("Đã lưu cấu hình.");
    } catch (e) { setErr(e.message); }
  }

  async function testModel() {
    setTest({ message: "Đang kiểm tra..." });
    const cfg = s.providers[s.promptModel];
    try {
      const r = await api.testModelPrompt(s.promptModel, {
        baseUrl: cfg.baseUrl, model: cfg.model, apiKey: cfg.apiKey || undefined,
      });
      setTest(r);
    } catch (e) { setTest({ ok: false, message: e.message }); }
  }
  async function testVideo() {
    setVtest({ message: "Đang kiểm tra..." });
    try { setVtest(await api.testVideoApi("maxcheapai")); }
    catch (e) { setVtest({ ok: false, message: e.message }); }
  }

  const keyPlaceholder = (prov) => (prov.hasKey ? `Đã lưu: ${prov.apiKeyMask} — nhập để đổi` : "Nhập API key");

  // Kết nối Google: lưu Client ID/Secret trước, lấy URL đăng nhập, mở browser, rồi làm mới trạng thái.
  async function connectGoogle() {
    setErr(""); setMsg("");
    if (!s.sheetApi.clientId || (!s.sheetApi.clientSecret && !s.sheetApi.hasSecret)) {
      setErr("Nhập OAuth Client ID và Client Secret trước.");
      return;
    }
    setConnecting(true);
    try {
      await api.saveSettings(s);               // đảm bảo server có client id/secret mới nhất
      const { url } = await api.sheetAuthUrl();
      if (window.desktop?.openExternal) window.desktop.openExternal(url);
      else window.open(url, "_blank");
      // Chờ user hoàn tất trên browser rồi làm mới trạng thái kết nối.
      setMsg("Đã mở trình duyệt. Sau khi cấp quyền xong, bấm 'Làm mới trạng thái' hoặc lưu lại.");
    } catch (e) { setErr(e.message); }
    finally { setConnecting(false); }
  }
  async function refreshStatus() {
    try { const d = await api.getSettings(); setS(normalizeSettings(d)); } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <h1>Cấu hình API bên thứ 3</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Model Prompt</h2>
        <p className="muted">Chọn model dùng để tạo kịch bản (prompt). Chỉ 1 model được kích hoạt.</p>
        <label>Model đang kích hoạt</label>
        <select value={s.promptModel} onChange={(e) => setS({ ...s, promptModel: e.target.value })}>
          {enabledKeys.length === 0 && <option value="">— Chưa bật model nào —</option>}
          {PROVIDERS.filter((p) => s.providers[p.key]?.enabled).map((p) =>
            <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>

        {PROVIDERS.map((p) => {
          const prov = s.providers[p.key];
          return (
            <div key={p.key} style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #22262f" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, cursor: "pointer" }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={!!prov.enabled}
                    onChange={(e) => setProvider(p.key, "enabled", e.target.checked)} />
                  <strong style={{ color: "#e6e8eb" }}>{p.label}</strong>
                </label>
                <span className={"badge " + (prov.enabled ? "on" : "off")}>
                  {prov.enabled ? "Đang bật" : "Đang tắt"}
                </span>
              </div>

              {/* Base URL / endpoint — required for 9router (openrouter), optional override for OpenAI. */}
              {p.openai && (
                <div style={{ marginTop: 8 }}>
                  <label>Base Endpoint / Base URL {p.key === "openrouter" && <span style={{ color: "#f87171" }}>*</span>}</label>
                  <input value={prov.baseUrl || ""} onChange={(e) => setProvider(p.key, "baseUrl", e.target.value)}
                    placeholder="https://duc3k.minet.vn/v1" />
                  <span className="muted" style={{ fontSize: 12 }}>
                    Ví dụ https://domain/v1 — app tự gọi {"{baseUrl}"}/chat/completions.
                  </span>
                </div>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>API Key</label>
                  <input type="password" value={prov.apiKey || ""}
                    onChange={(e) => setProvider(p.key, "apiKey", e.target.value)} placeholder={keyPlaceholder(prov)}
                    onBlur={() => probeProvider(p.key)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } }} />
                  {probing[p.key] && <span className="muted" style={{ fontSize: 12 }}><i className="spin" /> Đang kiểm tra key...</span>}
                  {probe[p.key]?.ok && <span style={{ color: "#4ade80", fontSize: 12 }}>✓ Key hoạt động</span>}
                </div>
                <div>
                  <label>Model ID</label>
                  {probe[p.key]?.ok && probe[p.key].models?.length ? (
                    <select value={prov.model} onChange={(e) => setProvider(p.key, "model", e.target.value)}>
                      {!probe[p.key].models.includes(prov.model) && <option value={prov.model}>{prov.model}</option>}
                      {probe[p.key].models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input value={prov.model} onChange={(e) => setProvider(p.key, "model", e.target.value)} />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div className="toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
          <button className="secondary" onClick={testModel}>Test kết nối</button>
          {test && (
            <span className={test.ok ? "" : "error"} style={{ color: test.ok ? "#4ade80" : undefined }}>
              {test.ok ? "OK" : "Lỗi"} {test.status != null ? `[${test.status}]` : ""} — {test.message}
              {test.endpoint && <span className="muted"> · {test.endpoint}</span>}
            </span>
          )}
        </div>
      </div>

      {/* ---- API tạo video: MaxCheapAI ---- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>API tạo video</h2>
        <p className="muted">Cấu hình provider tạo video (dùng cho chức năng Tạo video).</p>
        <div className="row">
          <div>
            <label>Provider</label>
            <select value={s.videoApi.activeProvider} onChange={(e) => setVideoTop("activeProvider", e.target.value)}>
              <option value="maxcheapai">MaxCheapAI</option>
            </select>
          </div>
          <div>
            <label>Base URL</label>
            <input value={vp.baseUrl || ""} onChange={(e) => setVideo("baseUrl", e.target.value)}
              placeholder="https://maxcheapai.com/api" />
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div>
            <label>API Key</label>
            <input type="password" value={vp.apiKey || ""} onChange={(e) => setVideo("apiKey", e.target.value)}
              placeholder={keyPlaceholder(vp)} />
          </div>
        </div>
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          Model, speed, resolution, duration, aspect ratio, concurrency và generate audio nay được chọn ở tab <strong>Tạo video</strong>.
        </p>
        <div className="toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
          <button className="secondary" onClick={testVideo}>Test kết nối</button>
          {vtest && (
            <span className={vtest.ok ? "" : "error"} style={{ color: vtest.ok ? "#4ade80" : undefined }}>
              {vtest.ok ? "OK" : "Lỗi"} {vtest.status != null ? `[${vtest.status}]` : ""} — {vtest.message}
            </span>
          )}
        </div>
      </div>

      {/* Legacy Veo3 (Gemini) block kept for backward compat. */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Model Veo3 (Gemini — tuỳ chọn)</h2>
        <p className="muted">Cấu hình API Gemini để gọi tới Veo3 chính chủ (không bắt buộc).</p>
        <div className="row">
          <div>
            <label>Gemini API Key</label>
            <input type="password" value={s.veo3.geminiApiKey || ""}
              onChange={(e) => setS({ ...s, veo3: { ...s.veo3, geminiApiKey: e.target.value } })}
              placeholder={s.veo3.hasKey ? `Đã lưu: ${s.veo3.apiKeyMask} — nhập để đổi` : "Nhập API key"} />
          </div>
          <div>
            <label>Veo3 Model ID</label>
            <input value={s.veo3.model}
              onChange={(e) => setS({ ...s, veo3: { ...s.veo3, model: e.target.value } })} />
          </div>
        </div>
      </div>

      {/* ---- API Google Sheet (OAuth) ---- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>API Google Sheet (OAuth)</h2>
        <p className="muted">Đăng nhập Google để xuất prompt ra Sheet bằng chính tài khoản của bạn (sheet nằm trong Drive của bạn).</p>
        <div className="row">
          <div>
            <label>OAuth Client ID</label>
            <input value={s.sheetApi.clientId || ""}
              onChange={(e) => setS({ ...s, sheetApi: { ...s.sheetApi, clientId: e.target.value.trim() } })}
              placeholder="xxxxx.apps.googleusercontent.com" />
          </div>
          <div>
            <label>OAuth Client Secret</label>
            <input type="password" value={s.sheetApi.clientSecret || ""}
              onChange={(e) => setS({ ...s, sheetApi: { ...s.sheetApi, clientSecret: e.target.value } })}
              placeholder={s.sheetApi.hasSecret ? "Đã lưu — nhập để đổi" : "GOCSPX-..."} />
          </div>
        </div>
        <label style={{ marginTop: 10 }}>Folder ID trên Google Drive (tùy chọn — để gom sheet vào 1 thư mục)</label>
        <input value={s.sheetApi.folderId || ""}
          onChange={(e) => setS({ ...s, sheetApi: { ...s.sheetApi, folderId: e.target.value.trim() } })}
          placeholder="Phần sau /folders/ trong URL (bỏ trống = lưu ở Drive gốc)" />

        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="secondary" onClick={connectGoogle} disabled={connecting}>
            {connecting ? "Đang mở Google..." : (s.sheetApi.connected ? "Kết nối lại Google" : "Kết nối Google")}
          </button>
          <button className="secondary" onClick={refreshStatus}>Làm mới trạng thái</button>
          {s.sheetApi.connected
            ? <span style={{ color: "#4ade80" }}>✓ Đã kết nối{s.sheetApi.connectedEmail ? `: ${s.sheetApi.connectedEmail}` : ""}</span>
            : <span className="muted">Chưa kết nối</span>}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Bấm "Kết nối Google" mở trình duyệt để đăng nhập + cấp quyền. Redirect URI trong OAuth Client phải có <code>http://localhost:4000/api/sheet/callback</code>. Lưu cấu hình (Client ID/Secret) trước khi kết nối.
        </p>
      </div>

      <button onClick={save}>Lưu cấu hình</button>
      {msg && <span style={{ color: "#4ade80", marginLeft: 12 }}>{msg}</span>}
      {err && <div className="error">{err}</div>}

      {toast && (
        <div className="toast" role="alert">
          <span>{toast}</span>
          <button className="toast-close" onClick={() => setToast("")}>×</button>
        </div>
      )}
    </div>
  );
}
