import { Document, Packer, Paragraph, TextRun, PageBreak } from "docx";
import { saveAs } from "file-saver";

function episodeParagraphs(text) {
  // Preserve line breaks: one Paragraph per line keeps docx readable.
  return text.split("\n").map(
    (line) => new Paragraph({ children: [new TextRun(line)] })
  );
}

// Export all episodes into ONE docx, each episode separated by a page break.
export async function exportAllToOneDocx(projectName, episodes) {
  const children = [];
  episodes.forEach((ep, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `Tập ${i + 1}`, bold: true, size: 28 })] }));
    children.push(...episodeParagraphs(ep));
  });
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${sanitize(projectName)}-all.docx`);
}

// Export each episode as its own docx file.
export async function exportEachToDocx(projectName, episodes) {
  for (let i = 0; i < episodes.length; i++) {
    const doc = new Document({
      sections: [{ children: [
        new Paragraph({ children: [new TextRun({ text: `Tập ${i + 1}`, bold: true, size: 28 })] }),
        ...episodeParagraphs(episodes[i]),
      ] }],
    });
    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${sanitize(projectName)}-tap-${i + 1}.docx`);
  }
}

// Xuất TẤT CẢ prompt của dự án vào 1 file, phân tách bằng dải gạch ngang.
// Tên file: <tên dự án>_<lần tạo prompt>.docx  (vd spiderman_2.docx).
export async function exportProjectPrompts(projectName, prompts, seq) {
  const children = [];
  prompts.forEach((p, i) => {
    if (i > 0) {
      children.push(new Paragraph({ children: [new TextRun("")] }));
      children.push(new Paragraph({ children: [new TextRun("--------------------------------")] }));
      children.push(new Paragraph({ children: [new TextRun("")] }));
    }
    children.push(new Paragraph({ children: [new TextRun({ text: `Prompt ${i + 1}`, bold: true, size: 28 })] }));
    children.push(new Paragraph({ children: [new TextRun("")] }));
    children.push(...episodeParagraphs(p));
  });
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${sanitize(projectName)}_${seq}.docx`);
}

// Export danh sách prompt: mỗi prompt = 1 paragraph, cách nhau bằng 1 paragraph
// trống. Không đánh số, không thêm giải thích. Giữ dấu tiếng Việt (docx dùng UTF-8).
export async function exportPromptsDocx(fileBase, prompts) {
  const children = [];
  prompts.forEach((p, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new TextRun("")] }));
    // Giữ xuống dòng trong 1 prompt thành nhiều Paragraph con.
    String(p).split("\n").forEach((line) => children.push(new Paragraph({ children: [new TextRun(line)] })));
  });
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${sanitize(fileBase)}.docx`);
}

// Export .txt: mỗi prompt cách nhau đúng 1 dòng trống, không đánh số.
export function exportPromptsTxt(fileBase, prompts) {
  const body = prompts.map((p) => String(p).trim()).join("\n\n");
  saveAs(new Blob([body], { type: "text/plain;charset=utf-8" }), `${sanitize(fileBase)}.txt`);
}

const sanitize = (s) => (s || "project").replace(/[^\w\-]+/g, "_");
