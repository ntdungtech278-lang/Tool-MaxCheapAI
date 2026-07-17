// hpStore: kho HP dùng chung giữa box sidebar (App) và tab Tạo video (Video).
// App dùng thuần useState, 2 nơi ở xa nhau -> store nhỏ subscribe/emit thay cho Context.
// - balance: tổng HP hiện có (GET /hp -> totalHp). null = chưa cập nhật.
// - prices: bảng giá tự học { "model|resolution|duration|speed|audio": hpCost }.
import { useSyncExternalStore } from "react";
import { api } from "./api";

let state = { balance: null, prices: {}, loading: false };
const listeners = new Set();

const emit = () => { for (const l of listeners) l(); };
const set = (patch) => { state = { ...state, ...patch }; emit(); };

// Khóa combo phải khớp hpPriceKey() ở server/configService.js.
export const priceKey = ({ modelId, resolution, duration, speed, generateAudio }) =>
  [modelId, resolution, duration, speed, generateAudio ? 1 : 0].join("|");

// Ước tính HP cho 1 lượt tạo. Trả { total, known } — known=false nếu combo chưa học giá.
export function estimate(combo, count) {
  const unit = state.prices[priceKey(combo)];
  if (unit == null) return { total: null, known: false };
  return { total: unit * Math.max(0, count | 0), known: true };
}

// Đồng bộ số dư thực + bảng giá từ server.
export async function refreshHp() {
  set({ loading: true });
  try {
    const r = await api.hp();
    set({ balance: r.balance ?? null, prices: r.prices || {}, loading: false });
  } catch {
    set({ loading: false }); // giữ balance cũ khi lỗi mạng
  }
}

// Trừ ngay khi bấm Tạo (optimistic). hpBalance thực sẽ ghi đè qua refreshHp().
export function optimisticDeduct(n) {
  if (state.balance == null || !(n > 0)) return;
  set({ balance: Math.max(0, state.balance - n) });
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useHp = () => useSyncExternalStore(subscribe, () => state);
