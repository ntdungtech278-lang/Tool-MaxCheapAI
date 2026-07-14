import { useEffect, useState } from "react";
import { api } from "./api";

const empty = { username: "", password: "", full_name: "", employee_code: "", phone: "", email: "", role: "user", active: true };

export default function Users() {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null); // null | {} (new) | user (edit)

  const load = () => api.users().then(setUsers).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  async function save(form) {
    setErr("");
    try {
      if (form.id) await api.updateUser(form.id, form);
      else await api.createUser(form);
      setEditing(null);
      load();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <h1>Quản lý người dùng</h1>
      <div className="toolbar">
        <button onClick={() => setEditing({ ...empty })}>+ Thêm người dùng</button>
      </div>
      {err && <div className="error">{err}</div>}
      <table>
        <thead>
          <tr>
            <th>Tên</th><th>Mã NV</th><th>SĐT</th><th>Email</th><th>Quyền</th><th>Trạng thái</th><th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.full_name || u.username}</td>
              <td>{u.employee_code}</td>
              <td>{u.phone}</td>
              <td>{u.email}</td>
              <td>{u.role === "admin" ? "Admin" : "User"}</td>
              <td>
                <span className={"badge " + (u.active ? "on" : "off")}>
                  {u.active ? "Hoạt động" : "Dừng"}
                </span>
              </td>
              <td><button className="secondary" onClick={() => setEditing(u)}>Sửa</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && <UserModal user={editing} onCancel={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function UserModal({ user, onCancel, onSave }) {
  const [form, setForm] = useState({ ...empty, ...user, active: user.active !== false, password: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const isNew = !user.id;

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h1 style={{ fontSize: 18 }}>{isNew ? "Thêm người dùng" : "Sửa người dùng"}</h1>
        {isNew && (<>
          <label>Tài khoản đăng nhập *</label>
          <input value={form.username} onChange={set("username")} />
        </>)}
        <label>{isNew ? "Mật khẩu *" : "Mật khẩu mới (để trống nếu không đổi)"}</label>
        <input type="password" value={form.password} onChange={set("password")} />
        <label>Họ tên</label>
        <input value={form.full_name} onChange={set("full_name")} />
        <label>Mã nhân viên</label>
        <input value={form.employee_code} onChange={set("employee_code")} />
        <div className="row">
          <div><label>Số điện thoại</label><input value={form.phone} onChange={set("phone")} /></div>
          <div><label>Email</label><input value={form.email} onChange={set("email")} /></div>
        </div>
        <div className="row">
          <div>
            <label>Quyền</label>
            <select value={form.role} onChange={set("role")}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label>Trạng thái</label>
            <select value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
              <option value="1">Hoạt động</option>
              <option value="0">Dừng hoạt động</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={() => onSave(form)}>Lưu</button>
          <button className="secondary" onClick={onCancel}>Hủy</button>
        </div>
      </div>
    </div>
  );
}
