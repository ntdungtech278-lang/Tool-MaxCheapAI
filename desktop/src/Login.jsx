import { useState } from "react";
import { api, setToken } from "./api";

export default function Login({ onLogin }) {
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const { token, user } = await api.login(username, password);
      setToken(token);
      onLogin(user);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Đăng nhập</h1>
        <label>Tài khoản</label>
        <input value={username} onChange={(e) => setU(e.target.value)} autoFocus />
        <label>Mật khẩu</label>
        <input type="password" value={password} onChange={(e) => setP(e.target.value)} />
        {err && <div className="error">{err}</div>}
        <button style={{ width: "100%", marginTop: 18 }} disabled={busy}>
          {busy ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}
