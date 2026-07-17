import { useState, useEffect } from "react";
import { setToken } from "./api";
import { useHp, refreshHp } from "./hpStore";
import Login from "./Login";
import Users from "./Users";
import ApiConfig from "./Settings";
import Video from "./Video";
import Logs from "./Logs";

// User-facing nav + admin-only nav. Admin sees everything; user sees only user tools.
const USER_NAV = [
  { key: "scenario", label: "Tạo kịch bản" },
  { key: "promptgen", label: "Tạo Prompt" },
  { key: "video", label: "Tạo video" },
  { key: "logs", label: "Logs" },
];
const ADMIN_NAV = [
  { key: "users", label: "Quản lý người dùng" },
  { key: "apiconfig", label: "Cấu hình API" },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("video");

  if (!user) return <Login onLogin={(u) => { setUser(u); setTab("video"); }} />;

  const isAdmin = user.role === "admin";

  function logout() {
    setToken(null);
    setUser(null);
  }

  return (
    <div className="app">
      <div className="sidebar">
        <h2>Generation Prompt v1</h2>
        <HpBox />
        <div className="nav-sep">Chức năng</div>
        {USER_NAV.map((n) => (
          <div key={n.key} className={"nav-item " + (tab === n.key ? "active" : "")}
            onClick={() => setTab(n.key)}>{n.label}</div>
        ))}
        {isAdmin && <>
          <div className="nav-sep">Quản trị</div>
          {ADMIN_NAV.map((n) => (
            <div key={n.key} className={"nav-item " + (tab === n.key ? "active" : "")}
              onClick={() => setTab(n.key)}>{n.label}</div>
          ))}
        </>}
        <div className="spacer" />
        <div className="muted" style={{ padding: "0 8px 8px" }}>
          {user.full_name || user.username} · {isAdmin ? "Admin" : "User"}
        </div>
        <button className="secondary" onClick={logout}>Đăng xuất</button>
      </div>

      <div className="main">
        {/* Keep every tab mounted; toggle with CSS so in-progress form data survives tab switches. */}
        <Tab show={tab === "scenario"}><ComingSoon title="Tạo kịch bản" /></Tab>
        <Tab show={tab === "promptgen"}><ComingSoon title="Tạo Prompt" /></Tab>
        <Tab show={tab === "video"}><Video /></Tab>
        <Tab show={tab === "logs"}><Logs /></Tab>
        {isAdmin && <Tab show={tab === "users"}><Users /></Tab>}
        {isAdmin && <Tab show={tab === "apiconfig"}><ApiConfig /></Tab>}
      </div>
    </div>
  );
}

const Tab = ({ show, children }) => (
  <div style={{ display: show ? "block" : "none" }}>{children}</div>
);

// Box HP: viền xanh phát sáng, nền xanh nhạt trong suốt, số HP xanh ở giữa.
// Số dư lấy từ GET /hp, poll mỗi 60s + refresh ngay khi mở app.
const HpBox = () => {
  const { balance, loading } = useHp();
  useEffect(() => {
    refreshHp();
    const t = setInterval(refreshHp, 60000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="hp-box" title="Số HP hiện có của tài khoản API">
      <span className="hp-value">{balance == null ? (loading ? "…" : "--") : balance.toLocaleString()}</span>
      <span className="hp-label">HP</span>
    </div>
  );
};

// Module đang phát triển: ẩn nội dung, chỉ báo trạng thái.
const ComingSoon = ({ title }) => (
  <div>
    <h1>{title}</h1>
    <div className="card" style={{ textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Tính năng đang phát triển</div>
      <div className="muted">Module này sẽ sớm ra mắt.</div>
    </div>
  </div>
);
