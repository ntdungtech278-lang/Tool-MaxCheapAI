# Generation Prompt — tạo kịch bản, prompt và video hàng loạt bằng Kling AI

Ứng dụng desktop (Electron + React) kèm backend Express + SQLite. Dùng để:

- **Tạo kịch bản / prompt** bằng LLM (9router/OpenRouter, ChatGPT, Gemini, Claude).
- **Tạo video hàng loạt** bằng **Kling AI** (API chính chủ): nhập nhiều prompt, mỗi prompt có ảnh đầu/cuối riêng,
  tool đưa vào **hàng đợi** và chạy lần lượt theo giới hạn đồng thời.
- Tải video về máy, **xuất prompt + ảnh ra Google Sheet**.
- Quản lý người dùng, dự án video, nhật ký thao tác (Logs).

> Provider video duy nhất là Kling AI. Các provider cũ (MaxCheapAI: Veo, Sora, Seedance…) đã được gỡ.

## Yêu cầu

- **Node.js 20 hoặc 22 (LTS)**. Backend dùng `better-sqlite3` (module native). Node quá mới (ví dụ 24) có thể
  không có bản build sẵn, khi đó `npm install` sẽ phải biên dịch và cần Visual Studio Build Tools — xem
  [Xử lý sự cố](#xử-lý-sự-cố).
- Windows 10/11 (đã dùng để phát triển; Electron/Vite chạy được trên hệ khác nhưng chưa kiểm tra).
- Tài khoản Kling AI có **Access Key** và **Secret Key** (Kling AI Console → API Keys).

## Cài đặt và chạy

```bash
npm run setup   # cài dependency cho thư mục gốc, server/ và desktop/ (chạy 1 lần)
npm run dev     # chạy server + Vite + cửa sổ Electron cùng lúc
```

`npm run dev` khởi động đồng thời:

| Thành phần | Địa chỉ | Ghi chú |
|---|---|---|
| Backend (Express) | http://localhost:4000 | tự reload khi sửa code (`node --watch`) |
| Giao diện (Vite)  | http://localhost:5173 | hot reload |
| Cửa sổ Electron   | — | mở sau khi cả hai cổng trên sẵn sàng; đóng cửa sổ sẽ tắt luôn server và Vite |

Đăng nhập lần đầu: **`admin` / `admin123`**. Tài khoản này được tạo tự động khi chưa có admin nào.
Hãy **đổi mật khẩu** (tab *Quản lý người dùng*) trước khi dùng thật.

Chạy bản đóng gói/sản xuất trên Windows: `start.bat` (tự cài dependency, build giao diện, mở server và app).
Đóng gói bộ cài: `cd desktop && npm run dist`.

## Cấu hình Kling AI

Vào **Cấu hình API** (chỉ admin) → khối **API tạo video — Kling AI**:

1. Chọn **Vùng API**: tài khoản quốc tế dùng *Singapore* (`api-singapore.klingai.com`), tài khoản Trung Quốc dùng
   `api.klingai.com`. Chọn sai vùng sẽ báo lỗi xác thực.
2. Nhập **Access Key** và **Secret Key**, bấm **Lưu cấu hình**.
3. Bấm **Test kết nối** (gọi lệnh liệt kê task, không tốn credit).

Bí mật chỉ lưu ở server (`data.db`); giao diện chỉ nhận bản che (`****abcd`). Để trống ô key khi lưu = giữ key cũ.
Server tự ký JWT (HS256) cho mỗi request, bạn không cần tạo token.

Khối **Model Prompt** ở cùng màn hình dùng để chọn LLM tạo kịch bản/prompt (độc lập với Kling).

## Tạo video

Tab **Tạo video** → tạo/mở một **dự án video** → nhập prompt:

1. Mỗi hàng = 1 prompt. Ô *số video* = số video tạo cho prompt đó. Có thể gắn **ảnh đầu** và **ảnh cuối** riêng cho từng hàng.
2. Chọn thiết lập chung: Model, Resolution, Duration, Aspect ratio, Concurrency, Generate audio (nếu model hỗ trợ),
   CFG scale và Negative prompt (tùy chọn). Server nhớ lựa chọn cho lần sau.
3. Bấm **Tạo video**. Job vào hàng đợi, trạng thái: Chờ → Đang gửi → Đang xử lý → Xong / Lỗi.
4. Đánh dấu video **Đạt**, rồi **Tải** về máy hoặc **Xuất Sheet**. Có thể **Tạo lại** video (sửa prompt/thiết lập/ảnh)
   hoặc **tạo lại bản lỗi**.

### Có ảnh đầu → image2video, không có → text2video

- Hàng không có ảnh → `text2video` (dùng Aspect ratio).
- Hàng có ảnh đầu → `image2video` (tỉ lệ khung hình theo ảnh). Ảnh cuối chỉ dùng được khi có ảnh đầu.

Kling **không có endpoint upload ảnh**, nên ảnh được lưu ở thư mục `uploads/` cạnh server
(hoặc trong thư mục dữ liệu của app) và gửi dạng base64 khi gọi API. Thư mục này **chưa tự dọn**.

### Model và ràng buộc

| Model | Resolution (`mode`) | Duration | Aspect ratio | Audio |
|---|---|---|---|---|
| `kling-v1-6` | `std(720p)` / `pro(1080p)` | 5, 10 | 16:9, 9:16, 1:1 | — |
| `kling-v2-5-turbo` | `std(720p)` / `pro(1080p)` | 5, 10 | 16:9, 9:16, 1:1 | — |
| `kling-v2-6` | `std(720p)` / `pro(1080p)` | 5, 10 | 16:9, 9:16, 1:1 | có |
| `kling-v3` | `std(720p)` / `pro(1080p)` | 3–15 | 16:9, 9:16, 1:1 | có |

> **Cần đối chiếu với tài liệu Kling bản hiện hành** (tên model, duration, `sound` theo model và `mode`). Bảng nằm ở
> `server/src/videoValidate.js` (`KLING_MODELS`) và bản sao cho giao diện ở `desktop/src/Video.jsx` (`MODEL_OPTS`).
> Khi sửa, cập nhật cả hai nơi.

Server kiểm tra payload **trước khi gửi** để không gọi request chắc chắn lỗi.

### Hàng đợi

- Chạy lần lượt theo **Concurrency** (tối đa 4, tùy gói Kling cho phép). Có Tạm dừng / Tiếp tục / Hủy.
- Vượt giới hạn tần suất hoặc số video đồng thời của Kling (mã 1302/1303 hoặc HTTP 429) → tự **chờ và thử lại**
  (backoff lũy thừa, tối đa 5 lần).
- Poll kết quả mỗi 15 giây. Quá 10 phút vẫn chưa xong → job chuyển **Đối soát** (không hủy, vì credit có thể đã trừ);
  tiến trình nền hỏi lại Kling mỗi 30 giây tới khi có kết quả chắc chắn.
- Server khởi động lại giữa chừng: job đã gửi sang Kling được đối soát tiếp, job chưa gửi được đánh dấu lỗi để tạo lại.
- Link video do Kling trả về **có hạn dùng**: nên tải video quan trọng về máy sớm.

### Phòng 3D

Chọn *Phòng ban = Phòng 3D* để bật quy trình riêng: đặt tên video theo tên ảnh đầu/cuối
(`[Mã tập]_[Frame đầu]_[Frame cuối]`), gộp nút *Tải video* + *Xuất Sheet*, và **tự tạo lại** video lỗi (đẩy lên đầu
hàng đợi, tối đa 3 lần/video để không tốn credit vô hạn). Thêm phòng ban mới ở hằng `DEPARTMENTS` trong `desktop/src/Video.jsx`.

## Google Sheet

Cấu hình trong **Cấu hình API → API Google Sheet (OAuth)**: nhập OAuth Client ID/Secret (loại Desktop), thêm redirect URI
`http://localhost:4000/api/sheet/callback`, lưu rồi bấm **Kết nối Google**. Sau đó có thể **xuất prompt + ảnh đầu/cuối**
của các video đã đánh dấu *Đạt* ra một Google Sheet trong Drive của bạn (tùy chọn gom vào một thư mục qua Folder ID).

## Cấu trúc thư mục

```
server/                    Backend Express + SQLite (better-sqlite3)
  src/index.js             Các endpoint REST
  src/kling.js             Client Kling: ký JWT, text2video/image2video, poll, upload ảnh local
  src/queueService.js      Hàng đợi, retry/backoff, đối soát job treo
  src/videoValidate.js     Ràng buộc từng model Kling
  src/configService.js     Đọc/ghi settings, che bí mật
  src/db.js                Schema, seed admin, migrate settings
  src/llm.js               Gọi các LLM tạo kịch bản/prompt
  src/googleSheets.js      OAuth + xuất Google Sheet
desktop/                   Electron + React (Vite)
  src/Video.jsx            Tab Tạo video
  src/Settings.jsx         Cấu hình API
  electron/                main process, preload, launcher dev
start.bat                  Chạy bản sản xuất trên Windows
```

Dữ liệu (`data.db`, `uploads/`) nằm cạnh `server/`; khi chạy bản đóng gói Electron truyền `APP_DATA_DIR`
(thư mục userData) nên cài đè/cập nhật **không mất dữ liệu**.

## Kiểm tra nhanh

```bash
npm test                 # self-check: validate model, ký JWT/dựng body Kling, tiện ích
```

Các bài test giao diện nằm ở `desktop/src/*.test.mjs` (chạy bằng `node`).

## Nâng cấp từ bản dùng MaxCheapAI

Lần khởi động đầu, server tự migrate settings: thêm khối Kling, **xóa** cấu hình MaxCheapAI, Veo3/Gemini video và bảng giá HP.
Key LLM và Google Sheet được giữ nguyên. Video đã tạo (đã *Xong*) vẫn xem/tải được vì chỉ là URL; job dang dở của provider cũ
bị đánh dấu lỗi, và video cũ không thể "tạo lại" (cần tạo video mới bằng Kling). Đừng quên nhập Access/Secret Key Kling.

## Xử lý sự cố

- **`npm install` lỗi ở `better-sqlite3` (`No prebuilt binaries`, `gyp ERR! find VS`)**: Node của bạn chưa có bản build sẵn.
  Cách dễ nhất là dùng Node 20/22 LTS (ví dụ qua `nvm`). Hoặc cài *Visual Studio Build Tools* (workload C++) rồi cài lại.
- **Test kết nối Kling báo lỗi xác thực (1000–1004)**: kiểm tra Access/Secret Key, **vùng API**, và đồng hồ máy
  (token có thời hạn ngắn, lệch giờ nhiều sẽ bị từ chối).
- **Lỗi 1102**: hết credit/gói tài nguyên Kling. **1303**: vượt số video đồng thời của gói, hãy giảm Concurrency.
- **Cổng 4000/5173 đã bị chiếm**: tắt tiến trình đang dùng cổng đó (Electron chỉ cho 1 instance chạy).
- **Quên mật khẩu admin**: xóa `server/data.db` để seed lại `admin/admin123` (sẽ mất toàn bộ dữ liệu), hoặc sửa trực tiếp bảng `users`.
