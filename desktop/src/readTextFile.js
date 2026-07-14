import JSZip from "jszip";

// Đọc nội dung văn bản từ file người dùng upload.
// Hỗ trợ .txt (và text/*) đọc thẳng; .docx giải nén lấy word/document.xml.
// .doc (binary cũ) không hỗ trợ — yêu cầu lưu sang .docx/.txt.
// ponytail: parser docx tối giản (strip tag). Nâng cấp bằng mammoth nếu cần giữ định dạng.
export async function readTextFile(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".docx")) {
    const zip = await JSZip.loadAsync(file);
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("File .docx không hợp lệ");
    return docxXmlToText(xml);
  }

  if (name.endsWith(".doc")) {
    throw new Error("Định dạng .doc cũ không hỗ trợ — vui lòng lưu sang .docx hoặc .txt");
  }

  // .txt và mọi text/* còn lại
  return file.text();
}

// <w:p> = đoạn -> xuống dòng; <w:tab/> -> tab; còn lại bỏ tag, giải mã entity cơ bản.
function docxXmlToText(xml) {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
