import { useEffect, useState } from "react";
import { api } from "./api";

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [err, setErr] = useState("");
  useEffect(() => { api.logs().then(setLogs).catch((e) => setErr(e.message)); }, []);

  return (
    <div>
      <h1>Logs</h1>
      {err && <div className="error">{err}</div>}
      <table>
        <thead><tr><th>Thời gian</th><th>Người dùng</th><th>Hành động</th><th>Chi tiết</th></tr></thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="muted">{l.created_at}</td>
              <td>{l.username || "-"}</td>
              <td>{l.action}</td>
              <td className="muted">{l.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
