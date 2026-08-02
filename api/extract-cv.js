const { reportError } = require("../lib/sentry");

const MAX_BYTES = 8 * 1024 * 1024;

// pdf-parse (via pdfjs-dist) needs a few browser DOM constructors for page
// geometry even during plain text extraction. It normally gets these from
// the native @napi-rs/canvas addon, but that native binary frequently fails
// to load on Vercel's serverless runtime (platform/architecture mismatch),
// and pdf-parse swallows that failure silently - leaving e.g. DOMMatrix
// undefined and throwing a bare "ReferenceError: DOMMatrix is not defined"
// for any PDF whose layout analysis needs it. Polyfill defensively with a
// pure-JS implementation so text extraction never depends on that native
// binary loading correctly.
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = require("dommatrix");
}
if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D {
    constructor(){}
    moveTo(){} lineTo(){} bezierCurveTo(){} quadraticCurveTo(){}
    closePath(){} arc(){} arcTo(){} rect(){} ellipse(){} addPath(){}
  };
}
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(dataOrWidth, widthOrHeight, height){
      if (dataOrWidth instanceof Uint8ClampedArray){
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height;
      } else {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  };
}

// pdf-parse also needs its PDF.js "worker" script. By default it resolves
// that file's path dynamically inside its own bundled code, which Vercel's
// build can't see when tracing which files to include - so the file is
// simply missing at runtime ("Setting up fake worker failed: Cannot find
// module '.../pdf.worker.mjs'"). Resolving it here instead, via a plain
// static require.resolve() in our own code, makes it a reference Vercel's
// build *can* see and therefore bundles correctly.
// (Deliberately not pdf-parse's own "pdf-parse/worker" helper for this:
// that submodule unconditionally requires "@napi-rs/canvas" too, and on
// Vercel that native binary fails to load - crashing this require outright
// instead of degrading, the same native-binary problem the DOMMatrix
// polyfill above works around.)
const { PDFParse } = require("pdf-parse");
PDFParse.setWorker(require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"));

function extForName(name){
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

async function extractPdf(buffer){
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
    await reportError("extract-cv parse error", err, { filename, mimeType });
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
