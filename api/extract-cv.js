const MAX_BYTES = 8 * 1024 * 1024;

function extForName(name){
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

async function extractPdf(buffer){
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer){
  const mammoth = require("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { filename, mimeType, dataBase64 } = req.body || {};
  if (!dataBase64 || !String(dataBase64).trim()) {
    return res.status(400).json({ error: "Fichier requis." });
  }

  let buffer;
  try {
    buffer = Buffer.from(dataBase64, "base64");
  } catch (err) {
    return res.status(400).json({ error: "Fichier invalide." });
  }
  if (!buffer.length) return res.status(400).json({ error: "Fichier vide." });
  if (buffer.length > MAX_BYTES) {
    return res.status(413).json({ error: "Fichier trop volumineux (8 Mo maximum)." });
  }

  const ext = extForName(filename);
  const isPdf = ext === "pdf" || mimeType === "application/pdf";
  const isDocx = ext === "docx" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  if (!isPdf && !isDocx) {
    return res.status(400).json({
      error: ext === "doc"
        ? "Le format .doc (Word 97-2003) n'est pas pris en charge, seulement .docx et PDF. Ouvrez le fichier et enregistrez-le en .docx."
        : "Format non pris en charge. Utilisez un fichier PDF ou Word (.docx)."
    });
  }

  let text = "";
  try {
    text = isPdf ? await extractPdf(buffer) : await extractDocx(buffer);
  } catch (err) {
    console.error("extract-cv parse error", err);
    return res.status(422).json({ error: "Impossible de lire ce fichier. Vérifiez qu'il n'est pas protégé par mot de passe ou corrompu." });
  }

  text = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n*--\s*\d+\s*of\s*\d+\s*--\n*/g, "\n\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (!text) {
    return res.status(422).json({ error: "Aucun texte n'a pu être extrait de ce fichier (peut-être un scan/image). Collez le contenu manuellement." });
  }

  res.status(200).json({ text });
};
