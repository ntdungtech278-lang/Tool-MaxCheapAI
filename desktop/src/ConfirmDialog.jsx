import { useEffect } from "react";

// Centered overlay confirm dialog. Reuses .modal-bg/.modal from styles.css.
// Esc or backdrop click = cancel.
export default function ConfirmDialog({ title, confirmLabel = "Xác nhận", cancelLabel = "Hủy", onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className="danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
