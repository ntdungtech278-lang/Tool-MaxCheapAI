// googleSheets: xuất prompt + ảnh đầu/cuối ra Google Sheet bằng OAuth (tài khoản người dùng).
// Sheet do CHÍNH tài khoản user tạo -> dùng quota của user (gmail thường vẫn được), không như
// Service Account (không có Drive quota). Ảnh hiện qua =IMAGE(url) (URL ảnh phải public).

const { google } = require("googleapis");

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file", // chỉ file do app tạo — đủ để tạo/ghi sheet
  "https://www.googleapis.com/auth/userinfo.email", // để hiển thị email tài khoản đã kết nối
];

// Redirect cố định về server. Desktop OAuth client chấp nhận http://localhost.
const REDIRECT_URI = "http://localhost:4000/api/sheet/callback";

function makeOAuth(clientId, clientSecret) {
  if (!clientId || !clientSecret) throw new Error("Thiếu OAuth Client ID/Secret cho Google Sheet");
  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

// URL để user đăng nhập + cấp quyền. state để chống CSRF (tùy).
function getAuthUrl(clientId, clientSecret, state = "") {
  const o = makeOAuth(clientId, clientSecret);
  return o.generateAuthUrl({
    access_type: "offline",       // để nhận refresh_token
    prompt: "consent",            // buộc trả refresh_token cả lần sau
    scope: SCOPES,
    state,
  });
}

// Đổi authorization code -> tokens (gồm refresh_token). Trả tokens.
async function exchangeCode(clientId, clientSecret, code) {
  const o = makeOAuth(clientId, clientSecret);
  const { tokens } = await o.getToken(code);
  return tokens; // { refresh_token, access_token, ... }
}

// OAuth2 client đã nạp refresh token -> tự làm mới access token khi gọi API.
function clientFromRefresh(clientId, clientSecret, refreshToken) {
  const o = makeOAuth(clientId, clientSecret);
  o.setCredentials({ refresh_token: refreshToken });
  return o;
}

const A1 = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`; // escape cho =IMAGE / literal

// items: [{ prompt, startUrl, endUrl }]. title: tên sheet. folderId: (tùy) thư mục Drive để gom.
// auth: OAuth2 client (clientFromRefresh). Trả { url, spreadsheetId }.
async function exportPromptsSheet({ auth, title, items, folderId }) {
  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

  // Tạo file spreadsheet (owner = user). Nếu có folderId hợp lệ thì đặt trong đó.
  const create = await drive.files.create({
    requestBody: {
      name: title || "Prompts export",
      mimeType: "application/vnd.google-apps.spreadsheet",
      ...(folderId ? { parents: [folderId] } : {}),
    },
    fields: "id",
  });
  const spreadsheetId = create.data.id;

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const sheetId = meta.data.sheets[0].properties.sheetId;
  const sheetName = meta.data.sheets[0].properties.title; // "Sheet1" mặc định — không hardcode

  // Ghi dữ liệu: header + mỗi video 1 hàng. Ảnh dùng =IMAGE(url) để hiện luôn.
  const rows = [["STT", "Prompt", "Ảnh đầu", "Ảnh cuối"]];
  items.forEach((it, i) => {
    rows.push([
      i + 1,
      String(it.prompt ?? ""),
      it.startUrl ? `=IMAGE(${A1(it.startUrl)})` : "",
      it.endUrl ? `=IMAGE(${A1(it.endUrl)})` : "",
    ]);
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `${sheetName}!A1`, valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  // Định dạng: cột prompt rộng + wrap; cột ảnh rộng; hàng dữ liệu cao; header đậm + đóng băng.
  const dataRows = items.length;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 50 }, fields: "pixelSize" } }, // STT
        { repeatCell: { range: { sheetId, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "TOP" } }, fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 420 }, fields: "pixelSize" } }, // Prompt
        { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } }, fields: "userEnteredFormat(wrapStrategy,verticalAlignment)" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 4 }, properties: { pixelSize: 240 }, fields: "pixelSize" } }, // Ảnh đầu/cuối
        ...(dataRows > 0 ? [{ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 1 + dataRows }, properties: { pixelSize: 140 }, fields: "pixelSize" } }] : []),
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat(textFormat.bold,horizontalAlignment)" } },
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
        // Viền lưới toàn bảng (header + data), 4 cột.
        { updateBorders: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 + dataRows, startColumnIndex: 0, endColumnIndex: 4 },
          top:    { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
          bottom: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
          left:   { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
          right:  { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
          innerHorizontal: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
          innerVertical:   { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
        } },
      ],
    },
  });

  return { url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, spreadsheetId };
}

module.exports = { getAuthUrl, exchangeCode, clientFromRefresh, exportPromptsSheet, REDIRECT_URI, SCOPES };
